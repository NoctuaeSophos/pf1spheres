/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * A Weather-sphere caster's control weather limits and costs, read from their talents and class
 * features (Weather sphere, Ultimate Spheres of Power; tempestarii; Mythic Spheres).
 */

import type { WeatherState } from "./conditions";
import { normaliseWeather } from "./conditions";

/** The minimal actor shape these helpers read */
export interface WeatherCasterSource {
  items: Iterable<{
    type: string;
    name: string | null;
    system?: { uses?: { value?: number; max?: number } };
    id?: string | null;
  }>;
  system: {
    spheres?: { cl?: { weather?: { total?: number } }; cam?: number };
  };
  classes?: Record<string, { level?: number } | undefined>;
}

export interface WeatherCaster {
  casterLevel: number;
  dc: number;
  /** Highest severity control weather can create or alter without Severe Weather */
  maxSeverity: number;
  severeWeather: boolean;
  greaterWeather: boolean;
  /** Extra categories Mythic Rapid Weather adds for free */
  freeExtraCategories: number;
  lengthened: boolean;
  climate: boolean;
  greaterSize: boolean;
  grandWeather: boolean;
  instant: boolean;
  /** Severity steps per round when changes aren't instant */
  stepsPerRound: number;
  deadly: boolean;
  stormLord: number;
  shipSmasher: boolean;
  shipKiller: boolean;
  /** Steps less severe for creatures bearing this caster's mantle (0 without Clear Skies) */
  clearSkiesSteps: number;
  encompassing: boolean;
  /** Extra mantle targets Encompassing Weather allows */
  extraMantleTargets: number;
  mythicTalent: { id: string; uses: number } | null;
}

const norm = (s: string | null | undefined) =>
  (s ?? "").toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ").trim();

/**
 * Reads a caster's weather abilities, or null when they don't have the Weather sphere.
 *
 * @param actor - The actor
 * @returns Their control weather profile
 */
export const getWeatherCaster = (actor: WeatherCasterSource): WeatherCaster | null => {
  const feats = [...actor.items].filter((i) => i.type === "feat");
  const count = (name: string) => feats.filter((i) => norm(i.name) === norm(name)).length;
  const starts = (prefix: string) => feats.find((i) => norm(i.name).startsWith(norm(prefix)));
  if (!count("Weather Sphere") && !count("Control Weather")) return null;

  const casterLevel = actor.system.spheres?.cl?.weather?.total ?? 0;
  const cam = actor.system.spheres?.cam ?? 0;
  const clearSkies = Math.min(3, count("Clear Skies"));
  const tempestarii = actor.classes?.tempestarii?.level ?? 0;
  const mythic = feats.find((i) => /^mythic talent \(control weather\)/.test(norm(i.name)));
  return {
    casterLevel,
    dc: 10 + Math.floor(casterLevel / 2) + cam,
    maxSeverity: Math.min(7, 3 + Math.floor(casterLevel / 7)),
    severeWeather: count("Severe Weather") > 0,
    greaterWeather: count("Greater Weather") > 0,
    freeExtraCategories: starts("Mythic Rapid Weather") ? 1 : 0,
    lengthened: count("Lengthened Weather") > 0,
    climate: count("Climate") > 0,
    greaterSize: count("Greater Size") > 0,
    grandWeather: count("Grand Weather") > 0,
    instant: count("Instant Weather") > 0,
    stepsPerRound: 1 + (count("Rapid Weather") ? tempestarii : 0),
    deadly: count("Deadly Weather") > 0,
    stormLord: Math.min(2, count("Storm Lord")),
    shipSmasher: count("Ship Smasher") > 0,
    shipKiller: count("Ship Killer") > 0,
    clearSkiesSteps: clearSkies ? clearSkies + Math.floor(casterLevel / 10) : 0,
    encompassing: count("Encompassing Weather") > 0,
    extraMantleTargets: count("Encompassing Weather")
      ? Math.max(1, Math.floor(casterLevel / 2))
      : 0,
    mythicTalent: mythic?.id ? { id: mythic.id, uses: mythic.system?.uses?.value ?? 0 } : null,
  };
};

export interface CastOptions {
  /** Spend a spell point so the change persists without concentration */
  persist: boolean;
  /** Severe Weather: +1 severity for a spell point */
  severe: boolean;
  /** Greater Weather: 0, 1 or 2 extra categories for that many spell points */
  greater: number;
  /** Climate: 2-mile radius for a spell point */
  climate: boolean;
  /** Pay with a Mythic Talent use instead of spell points */
  mythicTalent: boolean;
}

export const DEFAULT_CAST: CastOptions = {
  persist: true,
  severe: false,
  greater: 0,
  climate: false,
  mythicTalent: false,
};

/** Spell points a control weather casting costs with these options */
export const castCost = (caster: WeatherCaster, opts: CastOptions): number =>
  (opts.persist ? 1 : 0) +
  (opts.severe && caster.severeWeather ? 1 : 0) +
  (caster.greaterWeather ? Math.max(0, Math.min(2, opts.greater)) : 0) +
  (opts.climate && caster.climate ? 1 : 0);

const severityOf = (key: keyof WeatherState, value: number) =>
  key === "wind" ? value : Math.abs(value) + 1;

/**
 * Checks a control weather casting against the caster's limits.
 *
 * @param caster - The caster's profile
 * @param current - The weather before the casting
 * @param next - The weather the caster wants
 * @param opts - Casting options
 * @returns Problems, empty when the casting is allowed
 */
export const validateCast = (
  caster: WeatherCaster,
  current: WeatherState,
  next: WeatherState,
  opts: CastOptions,
): string[] => {
  const problems: string[] = [];
  const max = Math.min(7, caster.maxSeverity + (opts.severe && caster.severeWeather ? 1 : 0));
  const keys = (["wind", "temperature", "humidity"] as const).filter((k) => current[k] !== next[k]);
  const allowed =
    1 +
    (caster.greaterWeather ? Math.max(0, Math.min(2, opts.greater)) : 0) +
    caster.freeExtraCategories;
  if (keys.length > allowed) {
    problems.push(
      `Changes ${keys.length} weather categories, but this casting can affect ${allowed}.`,
    );
  }
  for (const k of keys) {
    if (severityOf(k, next[k]) > max)
      problems.push(`${k} severity ${severityOf(k, next[k])} is above your limit of ${max}.`);
    if (severityOf(k, current[k]) > max) {
      problems.push(
        `The current ${k} (severity ${severityOf(k, current[k])}) is beyond your control (limit ${max}).`,
      );
    }
  }
  return problems;
};

/**
 * The weather as a creature bearing a Clear Skies mantle experiences it: every category a number
 * of steps closer to normal.
 *
 * @param state - The scene's weather
 * @param steps - Steps less severe
 * @returns The milder weather
 */
export const reduceWeather = (state: WeatherState, steps: number): WeatherState => {
  if (!steps) return normaliseWeather(state);
  const toward = (v: number) => Math.sign(v) * Math.max(0, Math.abs(v) - steps);
  return normaliseWeather({
    wind: Math.max(1, state.wind - steps),
    temperature: toward(state.temperature),
    humidity: toward(state.humidity),
  });
};
