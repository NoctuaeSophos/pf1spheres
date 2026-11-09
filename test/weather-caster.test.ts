/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import {
  DEFAULT_CAST,
  castCost,
  getWeatherCaster,
  reduceWeather,
  validateCast,
} from "../src/module/weather/caster";
import type { WeatherCasterSource } from "../src/module/weather/caster";

const feat = (name: string, extra = {}) => ({ type: "feat", name, ...extra });

/** Shaped like Nix: Weather caster level 17, Cha +12, tempestarii 5 */
const nix: WeatherCasterSource = {
  items: [
    feat("Weather Sphere"),
    feat("Severe Weather"),
    feat("Greater Weather"),
    feat("Lengthened Weather"),
    feat("Climate"),
    feat("Greater Size"),
    feat("Grand Weather"),
    feat("Instant Weather"),
    feat("Rapid Weather"),
    feat("Deadly Weather"),
    feat("Storm Lord"),
    feat("Storm Lord"),
    feat("Ship Smasher"),
    feat("Ship Killer"),
    feat("Clear Skies"),
    feat("Clear Skies"),
    feat("Encompassing Weather"),
    feat("Mythic Rapid Weather (Mythic)"),
    feat("Mythic Talent (Control Weather)", { id: "mt", system: { uses: { value: 3 } } }),
    { type: "class", name: "Tempestarii" },
  ],
  system: { spheres: { cl: { weather: { total: 17 } }, cam: 12 } },
  classes: { tempestarii: { level: 5 } },
};

describe("Weather caster profile", () => {
  const c = getWeatherCaster(nix)!;

  test("reads limits from talents", () => {
    expect(c.maxSeverity).toBe(5); // 3 + floor(17 / 7)
    expect(c.dc).toBe(30); // 10 + 8 + 12
    expect(c.stormLord).toBe(2);
    expect(c.deadly).toBe(true);
    expect(c.stepsPerRound).toBe(6);
    expect(c.freeExtraCategories).toBe(1);
    expect(c.clearSkiesSteps).toBe(3); // two copies + floor(17 / 10)
    expect(c.extraMantleTargets).toBe(8);
    expect(c.mythicTalent).toEqual({ id: "mt", uses: 3 });
  });

  test("non-casters have no profile", () => {
    expect(getWeatherCaster({ items: [feat("Destruction Sphere")], system: {} })).toBeNull();
  });

  test("costs add up per option", () => {
    expect(castCost(c, DEFAULT_CAST)).toBe(1);
    expect(castCost(c, { ...DEFAULT_CAST, severe: true, greater: 2, climate: true })).toBe(5);
    expect(castCost(c, { ...DEFAULT_CAST, persist: false })).toBe(0);
  });

  test("validation enforces severity and category limits", () => {
    const calm = { wind: 1, temperature: 0, humidity: 0 };
    // Two categories: allowed with Mythic Rapid Weather's free extra
    expect(validateCast(c, calm, { wind: 5, temperature: 0, humidity: 4 }, DEFAULT_CAST)).toEqual(
      [],
    );
    // Severity 6 needs Severe Weather
    expect(
      validateCast(c, calm, { wind: 6, temperature: 0, humidity: 0 }, DEFAULT_CAST),
    ).toHaveLength(1);
    expect(
      validateCast(
        c,
        calm,
        { wind: 6, temperature: 0, humidity: 0 },
        { ...DEFAULT_CAST, severe: true },
      ),
    ).toEqual([]);
    // Three categories need Greater Weather
    const three = { wind: 4, temperature: -3, humidity: 3 };
    expect(validateCast(c, calm, three, DEFAULT_CAST)).toHaveLength(1);
    expect(validateCast(c, calm, three, { ...DEFAULT_CAST, greater: 1 })).toEqual([]);
    // Natural weather beyond the limit can't be altered
    expect(
      validateCast(c, { wind: 7, temperature: 0, humidity: 0 }, calm, DEFAULT_CAST),
    ).toHaveLength(1);
  });

  test("Clear Skies moves every category toward normal", () => {
    expect(reduceWeather({ wind: 6, temperature: -5, humidity: 2 }, 3)).toEqual({
      wind: 3,
      temperature: -2,
      humidity: 0,
    });
    expect(reduceWeather({ wind: 2, temperature: 1, humidity: -1 }, 0)).toEqual({
      wind: 2,
      temperature: 1,
      humidity: -1,
    });
  });
});
