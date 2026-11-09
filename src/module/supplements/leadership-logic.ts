/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * NOT SPHERES CONTENT. Leadership is a core Pathfinder feat; this lives here for now and should move to
 * the krune-table module or a separate pf1 supplement module.
 */

/** Leadership table (Core Rulebook): cohort level and followers of levels 1 to 6, by Leadership score */
const TABLE: [number, number[]][] = [
  [0, []],
  [0, []],
  [1, []],
  [2, []],
  [3, []],
  [3, []],
  [4, []],
  [5, []],
  [5, []],
  [6, []],
  [7, [5]],
  [7, [6]],
  [8, [8]],
  [9, [10, 1]],
  [10, [15, 1]],
  [10, [20, 2, 1]],
  [11, [25, 2, 1]],
  [12, [30, 3, 1, 1]],
  [12, [35, 3, 1, 1]],
  [13, [40, 4, 2, 1, 1]],
  [14, [50, 5, 3, 2, 1]],
  [15, [60, 6, 3, 2, 1, 1]],
  [15, [75, 7, 4, 2, 2, 1]],
  [16, [90, 9, 5, 3, 2, 1]],
  [17, [110, 11, 6, 3, 2, 1]],
  [17, [135, 13, 7, 4, 2, 2]],
];

const row = (score: number) => TABLE[Math.max(0, Math.min(TABLE.length - 1, Math.floor(score)))];

/** Reputation and situation modifiers, and whom they affect */
export const LEADERSHIP_MODIFIERS: {
  key: string;
  value: number;
  applies: "both" | "cohort" | "followers";
}[] = [
  { key: "renown", value: 2, applies: "both" },
  { key: "fairness", value: 1, applies: "both" },
  { key: "specialPower", value: 1, applies: "both" },
  { key: "failure", value: -1, applies: "both" },
  { key: "aloofness", value: -1, applies: "both" },
  { key: "cruelty", value: -2, applies: "both" },
  { key: "companion", value: -2, applies: "cohort" },
  { key: "otherAlignment", value: -1, applies: "cohort" },
  { key: "cohortDeath", value: -2, applies: "cohort" },
  { key: "stronghold", value: 2, applies: "followers" },
  { key: "movesAround", value: -1, applies: "followers" },
  { key: "followerDeaths", value: -1, applies: "followers" },
];

export interface LeadershipInput {
  level: number;
  chaMod: number;
  /** Mythic tier, counted when the character has Leadership (Mythic) */
  mythicTier: number;
  active: Record<string, boolean>;
  misc: number;
}

/**
 * Leadership scores: the base (level + Cha modifier + mythic tier + misc + shared modifiers), and the
 * scores used for the cohort and for followers, which each add their own modifiers.
 */
export const leadershipScores = (i: LeadershipInput) => {
  const sum = (applies: string) =>
    LEADERSHIP_MODIFIERS.filter((m) => m.applies === applies && i.active[m.key]).reduce(
      (n, m) => n + m.value,
      0,
    );
  const base = i.level + i.chaMod + i.mythicTier + (i.misc || 0) + sum("both");
  return { base, cohort: base + sum("cohort"), followers: base + sum("followers") };
};

/** The highest cohort level: the table's, but always at least two levels below the leader */
export const cohortMaxLevel = (cohortScore: number, leaderLevel: number) =>
  Math.max(0, Math.min(row(cohortScore)[0], leaderLevel - 2));

/** Followers allowed at each level 1 to 6 */
export const followersAllowed = (followerScore: number) =>
  [0, 1, 2, 3, 4, 5].map((n) => row(followerScore)[1][n] ?? 0);
