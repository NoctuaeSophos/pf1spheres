/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import {
  getSeverities,
  getWeatherEffects,
  normaliseWeather,
  snowFall,
  snowIntensity,
  snowMovement,
  endureFromText,
  resistEnergyAmount,
  temperatureExposure,
  temperatureProtection,
  weatherRegion,
} from "../src/module/weather/conditions";

const changeFor = (target: string, effects = getWeatherEffects({})) =>
  effects.changes.filter((c) => c.target === target).reduce((sum, c) => sum + Number(c.formula), 0);

describe("Weather severities", () => {
  test("signed sliders map to cold/heat and aridity/precipitation", () => {
    expect(getSeverities({ wind: 4, temperature: -3, humidity: 2 })).toEqual({
      wind: 4,
      cold: 4,
      heat: 1,
      precipitation: 3,
      aridity: 1,
    });
    expect(getSeverities({ wind: 1, temperature: 6, humidity: -6 })).toMatchObject({
      heat: 7,
      aridity: 7,
    });
  });

  test("stored values are clamped", () => {
    expect(normaliseWeather({ wind: 12, temperature: -9, humidity: 3.6 })).toEqual({
      wind: 7,
      temperature: -6,
      humidity: 4,
    });
    expect(normaliseWeather(null)).toEqual({ wind: 1, temperature: 0, humidity: 0 });
  });
});

describe("Weather effects", () => {
  test("calm weather has no effects", () => {
    const e = getWeatherEffects({});
    expect(e.labels).toEqual([]);
    expect(e.changes).toEqual([]);
    expect(e.notes).toEqual([]);
  });

  test("strong and severe wind penalise ranged attacks, Perception and Fly", () => {
    const strong = getWeatherEffects({ wind: 3 });
    expect(changeFor("rattack", strong)).toBe(-2);
    expect(changeFor("skill.per", strong)).toBe(-2);
    expect(changeFor("skill.fly", strong)).toBe(-2);
    const severe = getWeatherEffects({ wind: 4 });
    expect(changeFor("rattack", severe)).toBe(-4);
    expect(changeFor("skill.fly", severe)).toBe(-4);
    expect(severe.labels).toContain("Severe wind");
  });

  test("windstorm makes ranged attacks impossible instead of a flat penalty", () => {
    const e = getWeatherEffects({ wind: 5 });
    expect(changeFor("rattack", e)).toBe(0);
    expect(changeFor("skill.fly", e)).toBe(-8);
    expect(e.contextNotes.map((n) => n.target)).toContain("rangedWeapon");
  });

  test("heavy rain acts as wind of equal severity without stacking, plus visibility", () => {
    const rain = getWeatherEffects({ humidity: 3 }); // precipitation 4
    expect(changeFor("rattack", rain)).toBe(-4);
    expect(changeFor("skill.per", rain)).toBe(-8);
    const both = getWeatherEffects({ wind: 4, humidity: 3 });
    expect(changeFor("rattack", both)).toBe(-4);
  });

  test("snow and storms depend on cold and wind", () => {
    const blizzard = getWeatherEffects({ temperature: -3, humidity: 4 }); // cold 4, precipitation 5
    expect(blizzard.labels).toContain("Blizzard");
    const storm = getWeatherEffects({ wind: 4, humidity: 5 }); // precipitation 6
    expect(storm.labels).toContain("Monsoon");
    expect(storm.lightningDice).toBe(8);
    expect(getWeatherEffects({ wind: 4, humidity: 2 }).lightningDice).toBe(0);
  });

  test("temperature exposure and aridity produce reminders and save notes", () => {
    const cold = getWeatherEffects({ temperature: -2 });
    expect(cold.labels).toEqual(["Cold"]);
    expect(cold.notes.some((n) => n.startsWith("Cold: Fortitude save each hour"))).toBe(true);
    const dry = getWeatherEffects({ humidity: -3 });
    expect(dry.contextNotes).toContainEqual(expect.objectContaining({ target: "allSavingThrows" }));
  });
});

describe("weather chart regions", () => {
  const region = (temperature: number, humidity: number, wind: number) =>
    weatherRegion(getWeatherEffects({ temperature, humidity, wind }));
  it("names the plain regions", () => {
    expect(region(0, 0, 1)).toBeNull();
    expect(region(0, 2, 1)).toBe("rain");
    expect(region(-3, 2, 1)).toBe("snow");
    expect(region(0, 5, 1)).toBe("flood");
    expect(region(4, -3, 1)).toBe("arid");
  });
  it("shows storms only with wind 4+, and lightning from precipitation +3", () => {
    expect(region(0, 2, 3)).toBe("rain");
    expect(region(0, 2, 4)).toBe("storm");
    expect(region(0, 3, 4)).toBe("lightning");
  });
  it("keeps snow and storm together where they overlap", () => {
    expect(region(-3, 2, 4)).toBe("snowstorm");
    expect(region(-3, 3, 5)).toBe("thundersnow");
  });
});

describe("snow on the ground", () => {
  it("reads the Weather sphere's snow as light, medium or heavy", () => {
    expect(snowIntensity({ temperature: 0, humidity: 3 })).toBeNull();
    expect(snowIntensity({ temperature: -3, humidity: 1 })).toBe("light");
    expect(snowIntensity({ temperature: -3, humidity: 2 })).toBe("medium");
    expect(snowIntensity({ temperature: -5, humidity: 4 })).toBe("heavy");
  });
  it("falls by the hour, carrying part hours over", () => {
    expect(snowFall("medium", 3 * 3600 + 600, () => 4)).toEqual({ inches: 3, carry: 600 });
    expect(snowFall("light", 3 * 3600, () => 4)).toEqual({ inches: 1, carry: 3600 });
    expect(snowFall("heavy", 2 * 3600, () => 3)).toEqual({ inches: 6, carry: 0 });
  });
  it("costs extra movement from 2 inches and more from a foot", () => {
    expect([0, 1, 2, 11, 12, 30].map(snowMovement)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe("protection from cold and heat", () => {
  // Misae: Iceplant (endure elements), Cold Flesh (cold only), cold resistance 10
  const misae = temperatureProtection(
    [{ name: "Cold Flesh" }, { name: "Iceplant" }, { name: "Hex" }],
    { cold: 10 },
  );
  const coldNote = (temperature: number, protection = misae) =>
    getWeatherEffects({ temperature }, protection).notes.find((n) => n.startsWith("Cold:"));

  test("finds endure elements effects by name or flag, and resistance and immunity", () => {
    expect(misae.cold).toEqual({ endure: true, resist: 10, immune: false, source: "Cold Flesh" });
    expect(misae.heat).toEqual({ endure: true, resist: 0, immune: false, source: "Iceplant" });
    const coldOnly = temperatureProtection([{ name: "Cold Flesh" }]);
    expect(coldOnly.heat?.endure).toBe(false);
    const flagged = temperatureProtection([{ name: "Ring of Climate", endure: "heat" }]);
    expect(flagged.heat).toMatchObject({ endure: true, source: "Ring of Climate" });
    expect(temperatureProtection([], {}, { fire: true }).heat?.immune).toBe(true);
  });
  test("endure elements covers Cold up to 5 and Heat up to 4", () => {
    const endure = { endure: true };
    for (const s of [3, 4]) expect(temperatureExposure("cold", s, endure)?.shielded).toBe(true);
    expect(temperatureExposure("cold", 5, endure)?.text).toContain("below -50 °F");
    expect(temperatureExposure("cold", 6, endure)?.shielded).toBe(false);
    expect(temperatureExposure("heat", 4, endure)?.shielded).toBe(true);
    expect(temperatureExposure("heat", 5, endure)?.shielded).toBe(false);
    expect(temperatureExposure("cold", 2, endure)).toBeNull();
  });
  test("resistance is subtracted from each roll, and absorbs them when it beats the largest", () => {
    expect(temperatureExposure("cold", 6, { resist: 10 })).toMatchObject({ shielded: true });
    expect(temperatureExposure("cold", 7, { resist: 10 })?.text).toContain(
      "is subtracted from each roll",
    );
    expect(temperatureExposure("heat", 3, { resist: 5 })?.shielded).toBe(true);
    expect(temperatureExposure("heat", 5, { resist: 5 })?.shielded).toBe(false);
    expect(temperatureExposure("cold", 7, { immune: true })?.text).toContain("immune to cold");
  });
  test("a creature's buff reflects its protection", () => {
    expect(coldNote(-3)).toContain("no effect, Endure Elements (Cold Flesh)");
    // Arctic: past endure elements, but cold resistance 10 beats each 1d6 and 1d4
    expect(coldNote(-5)).toContain("Cold resistance 10 absorbs every one");
    expect(coldNote(-6)).toContain("is subtracted from each roll");
    expect(coldNote(-3, {})).toContain("Fortitude save every 10 minutes");
    const hot = getWeatherEffects({ temperature: 3 }, misae);
    expect(hot.contextNotes.some((n) => n.target === "fort")).toBe(false);
    expect(
      getWeatherEffects({ temperature: 3 }).contextNotes.some((n) => n.target === "fort"),
    ).toBe(true);
  });
  test("reads constant endure elements from descriptions", () => {
    expect(
      endureFromText(
        "<p>The wearer gains the constant effects of @UUID[Compendium.pf1.spells.Item.x]{endure elements} and takes only half damage from vacuum.</p>",
      ),
    ).toBe("both");
    expect(
      endureFromText(
        "gains endure elements as a constant spell-like ability, but only against cold temperatures.",
      ),
    ).toBe("cold");
    expect(endureFromText("You can cast endure elements once per day.")).toBeNull();
    const misae = temperatureProtection([
      {
        name: "Witch (Winter Witch)",
        text: "endure elements as a constant spell-like ability, but only against cold temperatures",
      },
      { name: "Cold Flesh" },
    ]);
    expect(misae.cold?.source).toBe("Cold Flesh");
    expect(misae.heat?.endure).toBe(false);
    const aridan = temperatureProtection([
      { name: "Iridescent Spindle Ioun Stone", text: "the constant effects of endure elements" },
    ]);
    expect(aridan.heat).toMatchObject({ endure: true, source: "Iridescent Spindle Ioun Stone" });
  });
  test("energy spell buffs: resist energy by level, protection from energy as absorbing immunity", () => {
    expect([1, 7, 11].map(resistEnergyAmount)).toEqual([10, 20, 30]);
    const johnson = temperatureProtection(
      [{ name: "Protection from Energy (Cold)", buff: true, level: 13 }],
      { fire: 5 },
    );
    expect(johnson.cold).toMatchObject({ immune: true });
    expect(temperatureExposure("cold", 7, johnson.cold)?.text).toBe(
      "Cold: no effect, Protection from Energy, until it has absorbed 120 points.",
    );
    const resisted = temperatureProtection(
      [{ name: "Resist Energy, Communal (Fire)", buff: true, level: 8 }],
      { fire: 5 },
    );
    expect(resisted.heat?.resist).toBe(20);
    // A spell item of the same name isn't a buff, so it grants nothing
    expect(temperatureProtection([{ name: "Resist Energy (Fire)", level: 8 }]).heat?.resist).toBe(
      0,
    );
  });
});
