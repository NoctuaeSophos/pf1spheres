/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import { getSeverities, getWeatherEffects, normaliseWeather } from "../src/module/weather/conditions";

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
    expect(getSeverities({ wind: 1, temperature: 6, humidity: -6 })).toMatchObject({ heat: 7, aridity: 7 });
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
