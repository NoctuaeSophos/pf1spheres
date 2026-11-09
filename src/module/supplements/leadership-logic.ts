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

/**
 * 1st-level followers above a score of 25, by the "High Leadership Scores and Followers" rule (Ultimate
 * Intrigue p. 130, used at this table): each 2 points multiplies the count by 1.5, rounded down, and an
 * even score averages its odd neighbours.
 */
const highFirst = (score: number): number => {
  if (score <= 25) return 135;
  if (score % 2 === 1) return Math.floor(highFirst(score - 2) * 1.5);
  return Math.floor((highFirst(score - 1) + highFirst(score + 1)) / 2);
};

/** Followers allowed at each level 1 to 6 */
export const followersAllowed = (followerScore: number): number[] => {
  const score = Math.floor(followerScore);
  if (score <= 25) return [0, 1, 2, 3, 4, 5].map((n) => row(score)[1][n] ?? 0);
  // Above 25: 2nd level is a tenth of 1st, and each level after is half the one before, rounded up
  const first = highFirst(score);
  const counts = [first, Math.floor(first / 10)];
  for (let n = 2; n < 6; n++) counts.push(Math.ceil(counts[n - 1] / 2));
  if (score === 26) counts[5] = 2;
  return counts;
};

/**
 * Leadership (Mythic) at tier 5+: the leader's ten highest-level followers are 1st-tier mythic. Fills
 * from 6th level down.
 *
 * @param counts - Followers at each level 1 to 6 (the ones recorded, or the ones allowed)
 * @param total - How many are mythic (10)
 * @returns Mythic followers at each level 1 to 6
 */
export const mythicFollowers = (counts: number[], total = 10): number[] => {
  const out = [0, 0, 0, 0, 0, 0];
  let left = total;
  for (let lvl = 5; lvl >= 0 && left > 0; lvl--) {
    out[lvl] = Math.min(left, Math.max(0, counts[lvl] ?? 0));
    left -= out[lvl];
  }
  return out;
};
