/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * Pure rules logic for the Spheres automation (no Foundry calls), so it can be unit-tested.
 */

/** Per-action automation settings, stored on the item as flags.pf1spheres.automation[actionId] */
export interface ActionAutomation {
  /** Spell point cost formula */
  sp?: string;
  /** Extra spell points per selected conditional id */
  condSp?: Record<string, number>;
  /** Martial focus: required, expended, or restored by this action */
  focus?: "" | "require" | "expend" | "restore";
  /** Track the result as a sphere effect */
  effect?: { enabled?: boolean; duration?: string; units?: DurationUnit; concentration?: boolean };
  /** Apply one of the actor's buffs to the targets at the caster's level */
  buff?: { itemId?: string; sphere?: string; self?: boolean; level?: string };
  /** Create an area centred on the user that applies the buff to creatures inside */
  zone?: { enabled?: boolean; radius?: string; who?: ZoneWho };
  /** Mark the targets */
  mark?: { label?: string; attackerNote?: string; defenderNote?: string };
  /** When a creature fails a save rolled from this action's chat card */
  onFail?: FailEffects;
}

export interface FailEffects {
  /** pf1 condition ids, separated by commas or spaces */
  conditions?: string;
  /** How many rounds the conditions last (dice allowed, rolled per creature) */
  conditionRounds?: string;
  /** One of the caster's buffs, copied onto the creature */
  buffId?: string;
  /** The buff's level; the caster's sphere caster level when blank */
  buffLevel?: string;
  /** How many rounds the buff lasts (dice allowed) */
  buffRounds?: string;
  /** Posted with the result; [[formula]] is rolled once */
  note?: string;
  /** Offer the caster a button to regain martial focus */
  regainFocus?: boolean;
  /** More conditions with their own duration */
  more?: { conditions?: string; rounds?: string }[];
}

/** True when a failed save has anything to do */
export const hasFailEffects = (f: FailEffects | undefined | null): boolean =>
  Boolean(f && (f.conditions?.trim() || f.buffId || f.note?.trim() || f.regainFocus || f.more?.some((g) => g.conditions?.trim())));

/** Condition ids from "blind, deaf" or "blind deaf" */
export const parseConditions = (text: string | undefined): string[] =>
  [...new Set((text ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean))];

/**
 * Whether a saving throw failed: a natural 1 always fails and a natural 20 always succeeds.
 *
 * @param total - The save's total
 * @param natural - The d20's face, if known
 * @param dc - The DC
 */
export const saveFailed = (total: number, natural: number | undefined, dc: number): boolean => {
  if (natural === 1) return true;
  if (natural === 20) return false;
  return total < dc;
};

export type DurationUnit = "round" | "minute" | "hour";
export type ZoneWho = "allies" | "enemies" | "all";

export const UNIT_SECONDS: Record<DurationUnit, number> = { round: 6, minute: 60, hour: 3600 };

/** True when an automation entry does anything */
export const hasAutomation = (a: ActionAutomation | undefined | null): boolean =>
  Boolean(
    a &&
      ((a.sp && a.sp.trim() !== "" && a.sp.trim() !== "0") ||
        Object.values(a.condSp ?? {}).some((n) => Number(n) > 0) ||
        a.focus ||
        a.effect?.enabled ||
        a.buff?.itemId ||
        a.zone?.enabled ||
        a.mark?.label ||
        hasFailEffects(a.onFail)),
  );

/**
 * Total spell point cost: the base formula's value plus the cost of each chosen conditional.
 *
 * @param base - The evaluated base cost
 * @param condSp - Cost per conditional id
 * @param selected - Chosen conditional ids
 * @returns The cost, never negative
 */
export const totalSpCost = (base: number, condSp: Record<string, number> | undefined, selected: string[]): number =>
  Math.max(0, Math.floor((Number(base) || 0) + selected.reduce((s, id) => s + (Number(condSp?.[id]) || 0), 0)));

/** Duration in seconds, or null for "until ended" */
export const durationSeconds = (value: number, units: DurationUnit | undefined): number | null =>
  value > 0 && units ? value * UNIT_SECONDS[units] : null;

/**
 * Seconds left on an effect.
 *
 * @param startTime - World time when it began
 * @param seconds - Its length, or null for no limit
 * @param now - Current world time
 * @returns Seconds left (0 when expired), or null for no limit
 */
export const remainingSeconds = (startTime: number, seconds: number | null, now: number): number | null =>
  seconds === null ? null : Math.max(0, startTime + seconds - now);

/** Short human text for a remaining duration */
export const formatRemaining = (secs: number | null): string => {
  if (secs === null) return "∞";
  if (secs < 60) return `${Math.ceil(secs / 6)} rd`;
  if (secs < 3600) return `${Math.ceil(secs / 60)} min`;
  return `${Math.round((secs / 3600) * 10) / 10} h`;
};

/**
 * Whether a creature with this disposition is affected by a zone.
 *
 * @param who - Who the zone affects
 * @param casterDisposition - The caster's token disposition (1 friendly, 0 neutral, -1 hostile)
 * @param disposition - The creature's token disposition
 */
export const zoneAffects = (who: ZoneWho | undefined, casterDisposition: number, disposition: number): boolean => {
  if (!who || who === "all") return true;
  const same = disposition === casterDisposition;
  return who === "allies" ? same : !same && disposition !== 0;
};

/** Distance between two points in grid units (ft.), given pixels per grid square and feet per square */
export const distanceFt = (
  a: { x: number; y: number },
  b: { x: number; y: number },
  gridSize: number,
  gridDistance: number,
): number => (Math.hypot(a.x - b.x, a.y - b.y) / gridSize) * gridDistance;

/**
 * Fills [[formula]] placeholders in a note with values computed by `evaluate`.
 *
 * @param text - Note text
 * @param evaluate - Turns a formula into a number
 */
export const fillNote = (text: string, evaluate: (formula: string) => number): string =>
  (text ?? "").replace(/\[\[(.+?)\]\]/g, (_m, f) => {
    const v = evaluate(f);
    return Number.isFinite(v) ? String(v) : "?";
  });

/* ---------- Prodigy sequences ---------- */

export interface SequenceState {
  length: number;
  /** A link was added since the start of the prodigy's last turn */
  linked: boolean;
  imbue?: string | undefined;
}

export const sequenceMax = (prodigyLevel: number) => 4 + Math.floor(prodigyLevel / 3);

/** Adds links (or removes with a negative count), within 0..max */
export const addLinks = (s: SequenceState, n: number, max: number): SequenceState => {
  const length = Math.max(0, Math.min(max, s.length + n));
  return { ...s, length, linked: n > 0 ? true : s.linked, imbue: length === 0 ? "" : s.imbue };
};

/** Start of the prodigy's turn: lose a link if none was added since the last turn */
export const sequenceTurnStart = (s: SequenceState): SequenceState => {
  if (s.length <= 0) return { length: 0, linked: false, imbue: "" };
  if (s.linked) return { ...s, linked: false };
  const length = s.length - 1;
  return { length, linked: false, imbue: length === 0 ? "" : s.imbue };
};

/** Inspired Sequence insight bonus: half the length (minimum 1) while a sequence is active */
export const inspiredBonus = (length: number) => (length > 0 ? Math.max(1, Math.floor(length / 2)) : 0);

/** Conditions that end a sequence at once */
export const SEQUENCE_BREAKERS = ["dazed", "dead", "helpless", "paralyzed", "stunned", "unconscious"];

/* ---------- Alchemy formulae ---------- */

/** How many formulae can be held prepared, and made per 30-minute batch */
export const formulaeCapacity = (craftRanks: number, formulaeTalents: number) => ({
  max: Math.max(1, Math.floor(craftRanks / 2)) + formulaeTalents,
  perBatch: 1 + Math.floor(craftRanks / 4),
});

/** Salve healing: 1d8 per 2 Craft (alchemy) ranks (minimum 1d8) + practitioner modifier, +5 per DC upgrade */
export const salveFormula = (craftRanks: number, pam: number, upgrades = 0) => {
  const dice = Math.max(1, Math.floor(craftRanks / 2));
  const flat = pam + 5 * upgrades;
  return `${dice}d8${flat ? ` + ${flat}` : ""}`;
};

/** Uses per creature per day for Salve and Elixir: half ranks (minimum 1) + practitioner modifier */
export const formulaeDailyUses = (craftRanks: number, pam: number) => Math.max(1, Math.floor(craftRanks / 2)) + pam;

/** Neutralizer energy resistance: 5 + 5 per 5 ranks */
export const neutralizerResistance = (craftRanks: number) => 5 + 5 * Math.floor(craftRanks / 5);

/* ---------- Destructive blast ---------- */

export interface BlastType {
  name: string;
  die: number;
  damageType: string;
  sp: number;
  rider: string;
}

const DAMAGE_WORDS: [RegExp, string][] = [
  [/\belectricity\b/i, "electric"],
  [/\bfire\b/i, "fire"],
  [/\bcold\b/i, "cold"],
  [/\bacid\b/i, "acid"],
  [/\bsonic\b/i, "sonic"],
  [/\bforce\b/i, "force"],
  [/\bnegative energy\b/i, "negative"],
  [/\bpositive energy\b/i, "positive"],
  [/\bpiercing\b/i, "piercing"],
  [/\bslashing\b/i, "slashing"],
  [/\bnonlethal\b/i, "nonlethal"],
];

/**
 * Reads a (blast type) talent's description: damage die, damage type, spell point cost and rider.
 *
 * @param name - Talent name
 * @param text - Plain-text description
 */
export const parseBlastType = (name: string, text: string): BlastType => {
  const die = Number(/uses?\s+d(\d+)\s+instead of\s+d6/i.exec(text)?.[1] ?? 6);
  const first = text.split(/(?<=\.)\s/)[0] ?? "";
  const damageType = DAMAGE_WORDS.find(([re]) => re.test(first))?.[1] ?? DAMAGE_WORDS.find(([re]) => re.test(text))?.[1] ?? "bludgeoning";
  const sp = /spend (a|one|1) spell point/i.test(first) ? 1 : /spend (two|2) spell points/i.test(first) ? 2 : 0;
  const rider = text.split(/(?<=\.)\s/).filter((s) => /save|saving throw/i.test(s)).join(" ");
  return { name, die, damageType, sp, rider };
};

/** Basic destructive blast dice: one per odd caster level */
export const blastDice = (casterLevel: number) => Math.max(1, Math.ceil(casterLevel / 2));

/* ---------- Magic skill checks ---------- */

/**
 * A target's magic skill defense: its own MSD when it's a spherecaster, else 11 + its spellcasting
 * caster level, else 11 + Hit Dice (an estimate for magic from other sources).
 */
export const targetMsd = (msb: number, msd: number, spellCl: number, hd: number) => {
  if (msb > 0) return { value: msd, estimate: false };
  if (spellCl > 0) return { value: 11 + spellCl, estimate: true };
  return { value: 11 + hd, estimate: true };
};

/* ---------- buff templates ---------- */

/** A buff carried in an item's flags.pf1spheres.buffTemplates */
export interface BuffTemplate {
  name: string;
  img?: string;
  description?: string;
  changes?: { formula: string; target: string; type?: string; operator?: string }[];
  contextNotes?: { text: string; target: string }[];
}

/**
 * Item data for a buff template, ready to be copied onto a creature.
 *
 * @param t - The template
 * @returns pf1 buff item source data
 */
export const templateToItemData = (t: BuffTemplate) => ({
  name: t.name,
  type: "buff",
  img: t.img || "icons/svg/aura.svg",
  system: {
    subType: "temp",
    active: false,
    description: { value: t.description ?? "" },
    changes: (t.changes ?? []).map((c, i) => ({
      _id: `pf1stpl${String(i).padStart(9, "0")}`,
      operator: "add",
      type: "untyped",
      ...c,
    })),
    contextNotes: t.contextNotes ?? [],
  },
});

/* ---------- granted actions ---------- */

/** One version of a granted action; the first whose required items are all present is used */
export interface GrantVariant {
  /** Names of other items the actor must have */
  requires?: string[];
  name: string;
  /** Merged over a copy of the target item's first own action */
  action?: Record<string, unknown>;
  addDamage?: { formula: string; types: string[] }[];
  /** Added to the base action's save DC */
  dcBonus?: string;
  /** Appended to the action's effect notes */
  notes?: string[];
  /** Merged over the base action's automation; onFail.buffTemplate names a template on the granting item */
  automation?: ActionAutomation & { onFail?: FailEffects & { buffTemplate?: string } };
}

/** An action an item adds to another item on the same actor (an imposition's [explosive] on Flashbangs) */
export interface Grant {
  /** Unique per granted action; two items granting the same key add it once */
  key: string;
  /** Name of the item that receives the action */
  target: string;
  variants: GrantVariant[];
}

/**
 * The variant to use given the names of the items an actor has.
 *
 * @param grant - The grant
 * @param names - Lower-cased item names on the actor
 */
export const pickVariant = (grant: Grant, names: Set<string>): GrantVariant | null =>
  grant.variants?.find((v) => (v.requires ?? []).every((n) => names.has(n.toLowerCase()))) ?? null;

const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

/**
 * A stable 16-character id for a string, so a granted action keeps its id (and its settings) across syncs.
 *
 * @param text - The grant key
 */
export const stableId = (text: string): string => {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  let out = "";
  for (let round = 0; out.length < 16; round++) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i) + round;
      h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
      h2 = Math.imul(h2 + c, 0x5bd1e995) >>> 0;
    }
    out += ID_CHARS[h1 % 62] + ID_CHARS[h2 % 62] + ID_CHARS[(h1 >>> 8) % 62] + ID_CHARS[(h2 >>> 8) % 62];
  }
  return out.slice(0, 16);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const merge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = isObject(v) && isObject(out[k]) ? merge(out[k] as Record<string, unknown>, v) : v;
  return out;
};

/**
 * Builds a granted action from the target's base action and a variant.
 *
 * @param base - Source data of the target item's first own action (may be undefined)
 * @param variant - The chosen variant
 * @param key - The grant key, which fixes the action id
 */
export const buildGrantedAction = (base: Record<string, any> | undefined, variant: GrantVariant, key: string) => {
  const a: Record<string, any> = merge(JSON.parse(JSON.stringify(base ?? {})), variant.action ?? {});
  a._id = stableId(key);
  a.name = variant.name;
  if (variant.addDamage?.length) a.damage = { ...(a.damage ?? {}), parts: [...(a.damage?.parts ?? []), ...variant.addDamage] };
  if (variant.dcBonus && a.save?.dc) a.save = { ...a.save, dc: `${a.save.dc} + ${variant.dcBonus}` };
  if (variant.notes?.length) a.notes = { ...(a.notes ?? {}), effect: [...(a.notes?.effect ?? []), ...variant.notes] };
  return a;
};

/**
 * The automation for a granted action: the base action's, with the variant's merged over it. Extra
 * conditions keep the base ones and get their own duration; a buff template becomes a "tpl:" reference.
 *
 * @param base - The base action's automation
 * @param variant - The variant's automation
 */
export const mergeGrantAutomation = (base: ActionAutomation = {}, variant: GrantVariant["automation"] = {}): ActionAutomation => {
  const { onFail: vFail, ...rest } = variant ?? {};
  const out: ActionAutomation = { ...JSON.parse(JSON.stringify(base)), ...rest };
  if (vFail) {
    const { buffTemplate, conditions, conditionRounds, ...failRest } = vFail;
    const onFail: FailEffects = { ...(base.onFail ?? {}), ...failRest };
    if (buffTemplate) onFail.buffId = `tpl:${buffTemplate}`;
    if (conditions?.trim()) onFail.more = [...(onFail.more ?? []), { conditions, rounds: conditionRounds || base.onFail?.conditionRounds || "1" }];
    out.onFail = onFail;
  }
  return out;
};
