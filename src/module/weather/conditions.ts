/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * Weather sphere conditions (Ultimate Spheres of Power, Weather sphere), turned into labels,
 * pf1 Changes that apply to creatures in the area, and reminders for the effects that need rolls
 * or rulings.
 */

/**
 * Slider state as stored on a scene. Temperature and humidity are signed: 0 is severity 1 (normal),
 * +n is Heat / Precipitation severity n + 1, and -n is Cold / Aridity severity n + 1.
 */
export interface WeatherState {
  wind: number;
  temperature: number;
  humidity: number;
}

export interface WeatherSeverities {
  wind: number;
  cold: number;
  heat: number;
  precipitation: number;
  aridity: number;
}

export interface WeatherChange {
  formula: string;
  target: string;
  type: string;
}

export interface WeatherContextNote {
  text: string;
  target: string;
}

export interface WeatherEffects {
  severities: WeatherSeverities;
  /** Named conditions, e.g. "Severe wind", "Heavy snow" */
  labels: string[];
  changes: WeatherChange[];
  contextNotes: WeatherContextNote[];
  /** Effects that need rolls, rulings or terrain, in reading order */
  notes: string[];
  /** Lightning damage dice for storms, or 0 when there is no storm */
  lightningDice: number;
}

/** What shields one creature from Cold or Heat */
export interface TemperatureGuard {
  /** Endure Elements or a constant effect like it */
  endure?: boolean;
  /** Cold (or fire) resistance */
  resist?: number;
  immune?: boolean;
  /** What grants the protection, for the reminder */
  source?: string;
}

export interface TemperatureProtection {
  cold?: TemperatureGuard;
  heat?: TemperatureGuard;
}

/**
 * The highest severity Endure Elements covers: it keeps a creature comfortable from -50 °F to 140 °F,
 * which reaches into Cold 5 (below -20 °F) and is the top of Heat 4 (above 110 °F).
 */
export const ENDURE_MAX = { cold: 5, heat: 4 };

/** Items that work as constant Endure Elements, by name, and which temperatures they cover */
const ENDURE_ITEMS: [RegExp, "cold" | "heat" | "both"][] = [
  [/^endure elements\b/i, "both"],
  // Witch hex: constant endure elements
  [/^iceplant\b/i, "both"],
  // Winter witch: endure elements against cold only
  [/^cold flesh\b/i, "cold"],
];

/**
 * A creature's protection from Cold and Heat.
 *
 * @param items - Its active items: name, and the flags.pf1spheres.endureElements setting if any
 * @param resist - Its cold and fire resistance
 * @param immune - Whether it is immune to cold or fire
 */
export const temperatureProtection = (
  items: { name: string; endure?: string }[],
  resist: { cold?: number; fire?: number } = {},
  immune: { cold?: boolean; fire?: boolean } = {},
): TemperatureProtection => {
  const covers = (kind: "cold" | "heat") =>
    items.find((i) => {
      const what = i.endure || ENDURE_ITEMS.find(([re]) => re.test(i.name))?.[1];
      return what === "both" || what === kind;
    })?.name;
  const guard = (kind: "cold" | "heat", energy: "cold" | "fire"): TemperatureGuard => {
    const endure = covers(kind);
    return {
      endure: Boolean(endure),
      resist: Math.max(0, Number(resist[energy]) || 0),
      immune: Boolean(immune[energy]),
      ...(endure ? { source: endure } : {}),
    };
  };
  return { cold: guard("cold", "cold"), heat: guard("heat", "fire") };
};

export const DEFAULT_WEATHER: WeatherState = { wind: 1, temperature: 0, humidity: 0 };

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(Number(value) || 0)));

/** Normalises stored slider values to the allowed ranges */
export const normaliseWeather = (state?: Partial<WeatherState> | null): WeatherState => ({
  wind: clamp(state?.wind ?? 1, 1, 7),
  temperature: clamp(state?.temperature ?? 0, -6, 6),
  humidity: clamp(state?.humidity ?? 0, -6, 6),
});

export const getSeverities = (state: WeatherState): WeatherSeverities => ({
  wind: state.wind,
  cold: state.temperature < 0 ? 1 - state.temperature : 1,
  heat: state.temperature > 0 ? 1 + state.temperature : 1,
  precipitation: state.humidity > 0 ? 1 + state.humidity : 1,
  aridity: state.humidity < 0 ? 1 - state.humidity : 1,
});

const WIND = [
  "Light wind",
  "Moderate wind",
  "Strong wind",
  "Severe wind",
  "Windstorm",
  "Hurricane-force winds",
  "Tornado-force winds",
];
const COLD = ["Cool", "Chilled", "Cold", "Severe cold", "Extreme cold", "Arctic", "Killing cold"];
const HEAT = ["Cool", "Warm", "Hot", "Severe heat", "Extreme heat", "Burning heat", "Boiling heat"];
const RAIN = [
  "",
  "Mist",
  "Light rain or fog",
  "Moderate rain",
  "Heavy rain",
  "Flash flood",
  "Great flood",
];
const SNOW = ["", "Light frost", "Snow", "Heavy snow", "Blizzard", "Great blizzard", "Avalanche"];
const STORM = ["", "Mist", "Light storm", "Storm", "Powerful storm", "Monsoon", "Typhoon"];
const ARID = ["", "Dry", "Very dry", "Parched", "Drought", "Sere", "Desiccating"];
const FLY_PENALTY = [0, 0, -2, -4, -8, -12, -16];
const CHECKED = ["", "", "Tiny", "Small", "Medium", "Large", "Huge"];
const BLOWN = ["", "", "", "Tiny", "Small", "Medium", "Large"];
const COLD_EXPOSURE = [
  "",
  "",
  "Fortitude save each hour (DC 15, +1 per previous check) or 1d6 nonlethal cold damage.",
  "Fortitude save every 10 minutes (DC 15, +1 per previous check) or 1d6 nonlethal cold damage.",
  "1d6 lethal cold damage every minute (no save), and a Fortitude save (DC 15, +1 per previous check) or 1d4 nonlethal cold damage.",
  "1d6 lethal cold damage every round (no save), and a Fortitude save each round (DC 15, +1 per previous check) or 1d4 nonlethal cold damage.",
  "3d6 lethal cold damage every round, no save (10d6 if encased in ice).",
];
/** The largest single damage roll at each severity (cold: 1d6, then 1d6 and 1d4, then 3d6) */
const COLD_MAX_ROLL = [0, 0, 6, 6, 6, 6, 18];
const HEAT_MAX_ROLL = [0, 0, 4, 4, 6, 6, 18];
const HEAT_EXPOSURE = [
  "",
  "",
  "Fortitude save each hour (DC 15, +1 per previous check) or 1d4 nonlethal fire damage.",
  "Fortitude save every 10 minutes (DC 15, +1 per previous check) or 1d4 nonlethal fire damage.",
  "1d6 lethal fire damage every minute (no save), and a Fortitude save every 5 minutes (DC 15, +1 per previous check) or 1d4 nonlethal fire damage.",
  "1d6 lethal fire damage every round (no save), and a Fortitude save each round (DC 15, +1 per previous check) or 1d4 nonlethal fire damage.",
  "3d6 lethal fire damage every round, no save (10d6 if immersed in boiling liquid).",
];

/**
 * Works out every effect of the given weather.
 *
 * @param input - Slider state, normalised before use
 * @returns Labels, Changes, context notes and reminders
 */
/**
 * The reminder for Cold or Heat at a severity, given what protects the creature. Endure Elements removes
 * the steps it covers, immunity removes all of them, and resistance is subtracted from each damage roll
 * (the Weather sphere calls this cold or fire damage).
 *
 * @returns The reminder, and whether nothing can get through, or null when the severity does nothing
 */
export const temperatureExposure = (
  kind: "cold" | "heat",
  severity: number,
  guard?: TemperatureGuard,
): { text: string; shielded: boolean } | null => {
  const base = (kind === "cold" ? COLD_EXPOSURE : HEAT_EXPOSURE)[severity - 1];
  if (!base) return null;
  const name = kind === "cold" ? "Cold" : "Heat";
  const energy = kind === "cold" ? "cold" : "fire";
  const from = guard?.source ? ` (${guard.source})` : "";
  if (guard?.immune) return { text: `${name}: no effect, immune to ${energy}.`, shielded: true };
  if (guard?.endure && severity <= ENDURE_MAX[kind]) {
    const edge =
      kind === "cold" && severity === ENDURE_MAX.cold
        ? " It stops protecting below -50 °F, the coldest part of this step."
        : "";
    return { text: `${name}: no effect, Endure Elements${from}.${edge}`, shielded: true };
  }
  const after =
    kind === "cold"
      ? " Damaged creatures are fatigued (frostbitten) until warmed. A cold weather outfit counts as 1 severity lower."
      : " Damaged creatures are fatigued (heatstroke) until cooled. Heavy clothing or armor: -4 on these saves.";
  const resist = Math.max(0, Math.floor(Number(guard?.resist) || 0));
  if (resist > 0) {
    const all = resist >= (kind === "cold" ? COLD_MAX_ROLL : HEAT_MAX_ROLL)[severity - 1];
    return all
      ? {
          text: `${name}: ${base} ${capitalise(energy)} resistance ${resist} absorbs every one of these rolls.`,
          shielded: true,
        }
      : {
          text: `${name}: ${base} ${capitalise(energy)} resistance ${resist} is subtracted from each roll.${after}`,
          shielded: false,
        };
  }
  return { text: `${name}: ${base}${after}`, shielded: false };
};

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const getWeatherEffects = (
  input: Partial<WeatherState>,
  protection: TemperatureProtection = {},
): WeatherEffects => {
  const state = normaliseWeather(input);
  const sev = getSeverities(state);
  const labels: string[] = [];
  const changes: WeatherChange[] = [];
  const contextNotes: WeatherContextNote[] = [];
  const notes: string[] = [];

  const snowy = sev.precipitation >= 2 && sev.cold >= 4;
  const stormy = sev.precipitation >= 2 && sev.wind >= 4;

  // Labels
  if (sev.wind >= 2) labels.push(WIND[sev.wind - 1]);
  if (sev.cold >= 2) labels.push(COLD[sev.cold - 1]);
  if (sev.heat >= 2) labels.push(HEAT[sev.heat - 1]);
  if (sev.precipitation >= 2) {
    const rainOnly = !snowy && !stormy;
    if (rainOnly || sev.precipitation >= 3) labels.push(RAIN[sev.precipitation - 1]);
    if (snowy) labels.push(SNOW[sev.precipitation - 1]);
    if (stormy) labels.push(STORM[sev.precipitation - 1]);
  }
  if (sev.aridity >= 2) labels.push(ARID[sev.aridity - 1]);
  // Mist only appears without snow or storm; avoid "Mist" twice
  const deduped = labels.filter((label, i) => label && labels.indexOf(label) === i);

  // Ranged attacks and Perception: rain of severity 4+ acts as wind of equal severity (no stacking)
  const windLike = Math.max(sev.wind, sev.precipitation >= 4 ? sev.precipitation : 0);
  if (windLike === 3) {
    changes.push({ formula: "-2", target: "rattack", type: "untyped" });
    changes.push({ formula: "-2", target: "skill.per", type: "untyped" });
  } else if (windLike === 4) {
    changes.push({ formula: "-4", target: "rattack", type: "untyped" });
    changes.push({ formula: "-4", target: "skill.per", type: "untyped" });
  } else if (windLike >= 5) {
    notes.push(
      windLike === 5
        ? "Ranged weapon attacks are impossible (siege weapons -4). Sound-based Perception checks take -8."
        : windLike === 6
          ? "Ranged weapon attacks are impossible (siege weapons -8). Sound-based Perception checks are impossible."
          : "All ranged attacks are impossible, even siege weapons. Sound-based Perception checks are impossible.",
    );
    contextNotes.push({
      text: "Weather: ranged weapon attacks are impossible",
      target: "rangedWeapon",
    });
  }
  if (sev.precipitation >= 4) {
    changes.push({ formula: "-4", target: "skill.per", type: "untyped" });
    notes.push("Rain halves visibility ranges (the extra -4 on Perception is applied).");
  }

  // Fly penalty and wind movement
  if (FLY_PENALTY[sev.wind - 1]) {
    changes.push({
      formula: String(FLY_PENALTY[sev.wind - 1]),
      target: "skill.fly",
      type: "untyped",
    });
  }
  if (CHECKED[sev.wind - 1]) {
    notes.push(
      `Checked: ${CHECKED[sev.wind - 1]} and smaller creatures can't move against the wind without a DC 10 Strength check (DC 20 Fly if airborne).`,
    );
  }
  if (BLOWN[sev.wind - 1]) {
    notes.push(
      `Blown away: ${BLOWN[sev.wind - 1]} and smaller creatures on the ground are knocked prone and rolled 1d4 × 10 ft. (1d4 nonlethal per 10 ft.) unless they make a DC 15 Strength check; flyers are blown back 2d6 × 10 ft. (2d6 nonlethal) unless they make a DC 25 Fly check.`,
    );
  }
  const flames = [
    "",
    "Small unprotected flames have a 50% chance to go out.",
    "Unprotected flames go out.",
    "Unprotected flames go out; protected flames (lanterns) have a 50% chance to go out.",
    "Unprotected flames go out; protected flames have a 75% chance to go out.",
    "All flames go out.",
    "All flames go out.",
  ][Math.max(sev.wind, sev.precipitation >= 4 ? sev.precipitation : 0) - 1];
  if (flames) notes.push(flames);

  // Temperature exposure, as it reaches this creature
  const cold = temperatureExposure("cold", sev.cold, protection.cold);
  if (cold) notes.push(cold.text);
  const heat = temperatureExposure("heat", sev.heat, protection.heat);
  if (heat) notes.push(heat.text);
  if (heat && !heat.shielded) {
    contextNotes.push({
      text: "Weather: -4 on heat saves in heavy clothing or armor",
      target: "fort",
    });
  }

  // Precipitation
  if (sev.precipitation === 2 && !snowy && !stormy) {
    notes.push("Mist: 20% miss chance (concealment) against anything more than 100 ft. away.");
  }
  if (sev.precipitation === 3 && !snowy && !stormy) {
    notes.push(
      "Light rain, or fog if the caster chose it: fog blocks sight beyond 5 ft. (darkvision too); creatures 5 ft. away have concealment.",
    );
  }
  if (snowy) {
    const hours = [
      "",
      "24 hours",
      "8 hours",
      "1 hour",
      "immediately",
      "immediately",
      "immediately",
    ][sev.precipitation - 1];
    notes.push(`Snow makes squares difficult terrain (after ${hours} at this severity).`);
    if (sev.precipitation >= 5) notes.push("Snow obscures vision as fog does.");
  }
  let lightningDice = 0;
  if (stormy && sev.precipitation >= 4) {
    lightningDice = 4 + 2 * (sev.precipitation - 4);
    notes.push(
      `Storm: lightning strikes a random square once per minute for ${lightningDice}d8 electricity (Reflex half). Storm Lord lets a caster choose the square.`,
    );
  }
  if (sev.precipitation >= 6) {
    notes.push(sev.precipitation === 6 ? "Flash flooding." : "Great flood.");
  }

  // Aridity
  if (sev.aridity >= 2) {
    contextNotes.push({
      text: `Weather: -${sev.aridity} on saves against fatigue, exhaustion and thirst (aridity)`,
      target: "allSavingThrows",
    });
    notes.push(
      `Aridity: -${sev.aridity} on saves against fatigue, exhaustion and thirst.` +
        (sev.aridity >= 3 ? " Creatures need twice as much water." : ""),
    );
  }

  return { severities: sev, labels: deduped, changes, contextNotes, notes, lightningDice };
};

/** Named areas of the weather chart, most specific first; snow and storm overlap as snowstorm or thundersnow */
export type WeatherRegion =
  | "thundersnow"
  | "snowstorm"
  | "lightning"
  | "storm"
  | "flood"
  | "snow"
  | "rain"
  | "arid";

export const WEATHER_REGIONS: WeatherRegion[] = [
  "thundersnow",
  "snowstorm",
  "lightning",
  "storm",
  "flood",
  "snow",
  "rain",
  "arid",
];

/**
 * The chart area a weather falls in.
 *
 * @param effects - The weather's effects
 * @returns The region, or null for weather with no named precipitation or aridity
 */
export const weatherRegion = (effects: WeatherEffects): WeatherRegion | null => {
  const s = effects.severities;
  const snowy = s.precipitation >= 2 && s.cold >= 4;
  const stormy = s.precipitation >= 2 && s.wind >= 4;
  if (snowy && effects.lightningDice) return "thundersnow";
  if (snowy && stormy) return "snowstorm";
  if (effects.lightningDice) return "lightning";
  if (stormy) return "storm";
  if (s.precipitation >= 6 && !snowy) return "flood";
  if (snowy) return "snow";
  if (s.precipitation >= 2) return "rain";
  if (s.aridity >= 2) return "arid";
  return null;
};

/* ---------- snow on the ground (Ultimate Wilderness pg. 167-168) ---------- */

export type SnowIntensity = "light" | "medium" | "heavy";

/**
 * How hard it is snowing, if it is: the Weather sphere's snow severities read as Ultimate Wilderness's
 * light (light frost), medium (snow) and heavy snow (heavy snow and worse).
 *
 * @param state - The weather
 */
export const snowIntensity = (state: Partial<WeatherState>): SnowIntensity | null => {
  const sev = getSeverities(normaliseWeather(state));
  if (sev.precipitation < 2 || sev.cold < 4) return null;
  return sev.precipitation === 2 ? "light" : sev.precipitation === 3 ? "medium" : "heavy";
};

/**
 * Snow that falls in a stretch of time: light 1 inch per 2 hours, medium 1 inch per hour, heavy 1d4
 * inches per hour (rolled hour by hour). Time short of a whole step carries over.
 *
 * @param intensity - How hard it snows
 * @param seconds - Time passed, plus any carried over
 * @param d4 - Rolls a d4 (injected for tests)
 * @returns Inches fallen and seconds left over
 */
export const snowFall = (
  intensity: SnowIntensity,
  seconds: number,
  d4: () => number,
): { inches: number; carry: number } => {
  const step = intensity === "light" ? 7200 : 3600;
  const steps = Math.floor(Math.max(0, seconds) / step);
  let inches = 0;
  for (let i = 0; i < steps; i++) inches += intensity === "heavy" ? d4() : 1;
  return { inches, carry: Math.max(0, seconds) - steps * step };
};

/**
 * Extra squares of movement to enter a snowy square: 1 from 2 inches, 2 from a foot (Ultimate Wilderness).
 *
 * @param depth - Snow on the ground, in inches
 */
export const snowMovement = (depth: number): number => (depth >= 12 ? 2 : depth >= 2 ? 1 : 0);
