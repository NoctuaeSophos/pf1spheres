/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * NOT SPHERES CONTENT. Horror Adventures corruptions, starting with Possessed. Pure rules, no Foundry.
 */

export interface CorruptionState {
  influence: number;
  manifestationLevel: number;
  stage: number;
  /** Will saves already attempted today */
  attempts: number;
}

export const POSSESSED_MAX_INFLUENCE = 5;
/** Gaining one of these feeds the spirit, and a possessed character loses any immunity to them */
export const POSSESSED_TRIGGERS = ["confused", "dazed", "frightened", "panicked", "stunned"];

export const defaultCorruption = (): CorruptionState => ({
  influence: 1,
  manifestationLevel: 1,
  stage: 0,
  attempts: 0,
});

/** The Will save against the spirit: 15 + manifestation level, +2 for each earlier attempt today */
export const possessedSaveDC = (s: CorruptionState): number =>
  15 + Math.max(0, s.manifestationLevel) + 2 * Math.max(0, s.attempts);

/** Influence after the spirit gains some, capped at 5 */
export const addInfluence = (s: CorruptionState, n = 1): CorruptionState => ({
  ...s,
  influence: Math.min(POSSESSED_MAX_INFLUENCE, Math.max(0, s.influence + n)),
});

/** Sunrise: the spirit starts the day with 1 influence and the save count resets */
export const sunrise = (s: CorruptionState): CorruptionState => ({
  ...s,
  influence: 1,
  attempts: 0,
});

/** After a Will save at full influence: a failure advances the corruption a stage (at most 3) */
export const afterSave = (s: CorruptionState, failed: boolean): CorruptionState => ({
  ...s,
  attempts: s.attempts + 1,
  stage: failed ? Math.min(3, s.stage + 1) : s.stage,
});
