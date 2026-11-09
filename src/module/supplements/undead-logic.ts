/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * NOT ONLY SPHERES CONTENT. Undead Hit Dice pools: the Death sphere's reanimate, the animate dead spell
 * and Command Undead each cap the combined Hit Dice of the undead you control. Pure rules, no Foundry.
 */

import { undeadHDLimit } from "../automation/logic";

export interface UndeadSources {
  /** Death sphere caster level without temporary boosts, or null without the Death sphere */
  deathCL: number | null;
  /** Copies of Greater Reanimate */
  greaterReanimate: number;
  /** Highest caster level among spellbooks holding animate dead, or null */
  animateDeadCL: number | null;
  /** Channeling class level for Command Undead, or null without the feat */
  commandUndeadLevel: number | null;
}

export interface UndeadPool {
  key: string;
  /** Hit Dice limit before the manual bonus */
  limit: number;
}

/**
 * The pools an actor has. Reanimate: 2/4/5 x Death caster level. Animate dead: 4 HD per caster level
 * (Core Rulebook). Command Undead: total HD up to the channeling class level.
 */
export const undeadPools = (s: UndeadSources): UndeadPool[] => {
  const pools: UndeadPool[] = [];
  if (s.deathCL !== null)
    pools.push({ key: "reanimate", limit: undeadHDLimit(s.deathCL, s.greaterReanimate) });
  if (s.animateDeadCL !== null)
    pools.push({ key: "animateDead", limit: 4 * Math.max(0, s.animateDeadCL) });
  if (s.commandUndeadLevel !== null)
    pools.push({ key: "commandUndead", limit: Math.max(0, s.commandUndeadLevel) });
  return pools;
};

/** Hit Dice a minion counts for: half (rounded up, minimum 1) for a sustained reanimation */
export const minionHD = (hd: number, half = false): number => {
  const n = Math.max(0, Math.floor(Number(hd) || 0));
  return half ? Math.max(1, Math.ceil(n / 2)) : n;
};

export interface Minion {
  uuid: string;
  pool: string;
  half?: boolean;
}

/**
 * Reads the stored list, accepting the 0.9.11 shape (a plain list of uuids, all reanimated).
 *
 * @param stored - flags.pf1spheres.undead
 */
export const readMinions = (
  stored: unknown,
): { minions: Minion[]; bonus: Record<string, number>; notes: string } => {
  if (Array.isArray(stored))
    return {
      minions: stored
        .filter((u) => typeof u === "string")
        .map((uuid) => ({ uuid, pool: "reanimate" })),
      bonus: {},
      notes: "",
    };
  const s = (stored ?? {}) as {
    minions?: Minion[];
    bonus?: Record<string, number>;
    notes?: string;
  };
  return {
    minions: (s.minions ?? []).filter((m) => m && typeof m.uuid === "string"),
    bonus: s.bonus ?? {},
    notes: s.notes ?? "",
  };
};
