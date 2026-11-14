/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * Deathless (Berserker talent): pure decisions, kept free of Foundry so they can be unit tested.
 * The runtime that applies them is deathless.ts.
 */

/**
 * Death threshold as a multiple of Constitution. Table assumptions, not GM rulings yet: change them here.
 * Deathless counts only while the actor has martial focus.
 */
export const DEATH_MULTIPLIER = { hardToKill: 2, deathless: 2, both: 3 } as const;

/**
 * How long a prone request counts as part of a knock-out: after an HP change, or after we refuse an unconscious/dead
 * request. Timed from the HP change too, because when Krune's wrapper runs outside ours it strips Nevela's dead before
 * we see it, and Nevela's prone follows as a separate call. (So a trip landing with the same blow is refused too.)
 */
export const PRONE_WINDOW_MS = 3000;

export const DEATHLESS_SOURCE = "Compendium.pf1spheres.combat-talents.Item.rbfP5616p00CSwoc";
export const HARD_TO_KILL_SOURCES = [
  "Compendium.krune-table.content.Item.vncScB4NngVOPRpi",
  "Compendium.world.krune-table-content.Item.vncScB4NngVOPRpi",
];

export type DeathlessMode = "fight" | "down" | "spent" | "none";
export interface DeathlessState {
  mode: DeathlessMode;
  /** We applied staggered (so we remove it again) */
  staggered?: boolean;
  /** We applied stable (so we remove it again when Deathless ends without Hard to Kill) */
  stable?: boolean;
}

interface ItemLike {
  name?: string;
  type?: string;
  _stats?: { compendiumSource?: string | null };
  system?: { subType?: string; disabled?: boolean };
}

const enabled = (i: ItemLike | undefined) => !!i && i.system?.disabled !== true;

/** The actor's Deathless talent (by compendium source, else by name), if enabled */
export const hasDeathlessItem = (items: Iterable<ItemLike>): boolean => {
  const list = [...items];
  return enabled(
    list.find((i) => i._stats?.compendiumSource === DEATHLESS_SOURCE) ??
      list.find((i) => i.type === "feat" && i.name === "Deathless" && i.system?.subType === "combatTalent"),
  );
};

/** Mythic Hard to Kill (Krune's pack item, else a mythic feat of that name), if enabled */
export const hasHardToKillItem = (items: Iterable<ItemLike>): boolean => {
  const list = [...items];
  return enabled(
    list.find((i) => HARD_TO_KILL_SOURCES.includes(i._stats?.compendiumSource ?? "")) ??
      list.find((i) => i.type === "feat" && i.name === "Hard to Kill" && i.system?.subType === "mythic"),
  );
};

/** HP at or below which the actor dies; null when neither ability extends the normal threshold */
export const deathThreshold = (con: number, htk: boolean, deathlessReady: boolean): number | null => {
  const m =
    htk && deathlessReady
      ? DEATH_MULTIPLIER.both
      : htk
        ? DEATH_MULTIPLIER.hardToKill
        : deathlessReady
          ? DEATH_MULTIPLIER.deathless
          : null;
  return m === null ? null : -m * con;
};

export interface ActorDeathContext {
  hp: number;
  /** Has Deathless (enabled) and martial focus */
  deathlessReady: boolean;
  htk: boolean;
  con: number;
  state: DeathlessState | null;
}

/** Below 0 HP, alive, and acting through Deathless (no state yet means this is the drop itself) */
export const isActing = (c: ActorDeathContext): boolean => {
  if (!(c.hp < 0) || !c.deathlessReady) return false;
  if ((c.state?.mode ?? "fight") !== "fight") return false;
  const limit = deathThreshold(c.con, c.htk, c.deathlessReady);
  return limit === null || c.hp > limit;
};

export interface FilterResult {
  changes: Record<string, unknown>;
  /** We dropped an unconscious or dead request (starts the prone window) */
  knockedOut: boolean;
  /** We dropped a dead request */
  refusedDead: boolean;
}

/**
 * Filters a setConditions request for an actor below 0 HP. Requests forced by pf1spheres itself skip this; requests
 * forced by other modules (Krune's Hard to Kill) don't, so Krune can't kill a Deathless actor above our threshold.
 */
export const filterConditions = (
  input: Record<string, unknown>,
  c: ActorDeathContext,
  msSinceKnockout: number,
): FilterResult => {
  const changes = { ...input };
  let knockedOut = false;
  let refusedDead = false;
  if (!(c.hp < 0)) return { changes, knockedOut, refusedDead };
  const acting = isActing(c);
  if (acting) {
    if (changes.unconscious) {
      delete changes.unconscious;
      knockedOut = true;
    }
    if (changes.dying) delete changes.dying;
    if (changes.staggered === false) delete changes.staggered;
  }
  const limit = deathThreshold(c.con, c.htk, c.deathlessReady);
  if (changes.dead && c.deathlessReady && limit !== null && c.hp > limit) {
    delete changes.dead;
    refusedDead = true;
    if (acting) knockedOut = true;
  }
  if (acting && changes.prone && (knockedOut || msSinceKnockout < PRONE_WINDOW_MS)) delete changes.prone;
  return { changes, knockedOut, refusedDead };
};

export type DeathlessStep =
  | { kind: "none" }
  | { kind: "clear"; removeStaggered: boolean }
  | { kind: "startNone" }
  | { kind: "startFight"; state: DeathlessState; fix: Record<string, boolean> }
  | { kind: "focusLost" };

/** What the GM does after an HP / Con / martial focus change */
export const nextStep = (c: ActorDeathContext, statuses: ReadonlySet<string>): DeathlessStep => {
  const s = c.state;
  if (c.hp >= 0) return s ? { kind: "clear", removeStaggered: !!s.staggered && statuses.has("staggered") } : { kind: "none" };
  if (!s) {
    if (!isActing(c)) return { kind: "startNone" };
    const fix: Record<string, boolean> = {};
    if (!statuses.has("staggered")) fix.staggered = true;
    if (!statuses.has("stable")) fix.stable = true;
    if (statuses.has("unconscious")) fix.unconscious = false;
    if (statuses.has("dying")) fix.dying = false;
    return {
      kind: "startFight",
      state: { mode: "fight", staggered: !statuses.has("staggered"), stable: !statuses.has("stable") },
      fix,
    };
  }
  if (s.mode === "fight" && !c.deathlessReady) return { kind: "focusLost" };
  return { kind: "none" };
};

/** Conditions to apply when Deathless ends below 0 HP (declined or focus lost) */
export const fallDownChanges = (
  state: DeathlessState | null,
  statuses: ReadonlySet<string>,
  htk: boolean,
): { undo: Record<string, boolean>; apply: Record<string, boolean> } => {
  const undo: Record<string, boolean> = {};
  if (state?.staggered && statuses.has("staggered")) undo.staggered = false;
  if (state?.stable && statuses.has("stable") && !htk) undo.stable = false;
  return { undo, apply: { unconscious: true, prone: true, dying: true } };
};
