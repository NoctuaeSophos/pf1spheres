/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import {
  addLinks,
  applySequenceRole,
  boostTotemChanges,
  phalanxBonus,
  squadronSize,
  squadronTotemBonus,
  blastDice,
  distanceFt,
  durationSeconds,
  fillNote,
  formatRemaining,
  formulaeCapacity,
  formulaeDailyUses,
  hasAutomation,
  buildGrantedAction,
  hasFailEffects,
  mergeGrantAutomation,
  parseImbuements,
  pickVariant,
  stableId,
  templateToItemData,
  parseConditions,
  saveFailed,
  inspiredBonus,
  neutralizerResistance,
  parseBlastType,
  remainingSeconds,
  salveFormula,
  sequenceMax,
  sequenceTurnStart,
  targetMsd,
  totalSpCost,
  zoneAffects,
  alignmentMatches,
  edgeCrossing,
  effectLabel,
  pinCasterLevels,
  withoutLabel,
  undeadHDLimit,
} from "../src/module/automation/logic";
import type { Grant } from "../src/module/automation/logic";
import { minionHD, readMinions, undeadPools } from "../src/module/supplements/undead-logic";
import {
  addInfluence,
  afterSave,
  defaultCorruption,
  possessedSaveDC,
  sunrise,
} from "../src/module/supplements/corruption-logic";
import {
  cohortMaxLevel,
  followersAllowed,
  leadershipScores,
  mythicFollowers,
} from "../src/module/supplements/leadership-logic";

describe("costs", () => {
  test("base plus chosen conditionals", () => {
    expect(totalSpCost(1, { a: 1, b: 2 }, ["a"])).toBe(2);
    expect(totalSpCost(1, { a: 1, b: 2 }, ["a", "b"])).toBe(4);
    expect(totalSpCost(-3, {}, [])).toBe(0);
  });

  test("empty automation is ignored", () => {
    expect(hasAutomation({})).toBe(false);
    expect(hasAutomation({ sp: "0" })).toBe(false);
    expect(hasAutomation({ sp: "1" })).toBe(true);
    expect(hasAutomation({ focus: "expend" })).toBe(true);
    expect(hasAutomation({ condSp: { x: 1 } })).toBe(true);
  });
});

describe("durations", () => {
  test("units and remaining time", () => {
    expect(durationSeconds(17, "hour")).toBe(61200);
    expect(durationSeconds(0, "round")).toBeNull();
    expect(remainingSeconds(100, 60, 130)).toBe(30);
    expect(remainingSeconds(100, 60, 200)).toBe(0);
    expect(remainingSeconds(100, null, 200)).toBeNull();
    expect(formatRemaining(12)).toBe("2 rd");
    expect(formatRemaining(600)).toBe("10 min");
    expect(formatRemaining(null)).toBe("∞");
  });
});

describe("zones", () => {
  test("disposition filters", () => {
    expect(zoneAffects("allies", 1, 1)).toBe(true);
    expect(zoneAffects("allies", 1, -1)).toBe(false);
    expect(zoneAffects("enemies", 1, -1)).toBe(true);
    expect(zoneAffects("enemies", 1, 0)).toBe(false);
    expect(zoneAffects("all", 1, -1)).toBe(true);
  });

  test("distance in feet", () => {
    expect(distanceFt({ x: 0, y: 0 }, { x: 300, y: 400 }, 100, 5)).toBe(25);
  });
});

describe("notes", () => {
  test("fills formula placeholders", () => {
    expect(fillNote("+[[1 + 3]] dodge", (f) => (f === "1 + 3" ? 4 : NaN))).toBe("+4 dodge");
    expect(fillNote("no formula", () => 0)).toBe("no formula");
  });
});

describe("sequences", () => {
  test("links, decay and the Inspired Sequence bonus", () => {
    const max = sequenceMax(7);
    expect(max).toBe(6);
    let s = addLinks({ length: 0, linked: false }, 3, max);
    expect(s).toMatchObject({ length: 3, linked: true });
    s = sequenceTurnStart(s); // linked last turn: keeps length
    expect(s).toMatchObject({ length: 3, linked: false });
    s = sequenceTurnStart(s); // no link: loses one
    expect(s.length).toBe(2);
    expect(addLinks(s, 10, max).length).toBe(6);
    expect(inspiredBonus(5)).toBe(2);
    expect(inspiredBonus(1)).toBe(1);
    expect(inspiredBonus(0)).toBe(0);
  });
});

describe("alchemy", () => {
  test("capacity, salve and neutralizer", () => {
    expect(formulaeCapacity(13, 5)).toEqual({ max: 11, perBatch: 4 });
    expect(salveFormula(13, 6)).toBe("6d8 + 6");
    expect(salveFormula(1, 0)).toBe("1d8");
    expect(salveFormula(13, 6, 1)).toBe("6d8 + 11");
    expect(formulaeDailyUses(13, 6)).toBe(12);
    expect(neutralizerResistance(13)).toBe(15);
  });
});

describe("destructive blast", () => {
  test("parses a blast type", () => {
    const shock = parseBlastType(
      "Shock Blast",
      "You may spend a spell point to have your destructive blast deal electricity damage. A shock blast uses d4 instead of d6 as its damage die. Any creature struck by the attack or that failed their Reflex saving throw if one was required must succeed at a Fortitude save or be dazed for 1 round.",
    );
    expect(shock).toMatchObject({ die: 4, damageType: "electric", sp: 1 });
    expect(shock.rider).toMatch(/dazed/);
    expect(blastDice(17)).toBe(9);
    expect(blastDice(1)).toBe(1);
  });
});

describe("magic skill defense", () => {
  test("falls back for non-spherecasters", () => {
    expect(targetMsd(10, 21, 0, 12)).toEqual({ value: 21, estimate: false });
    expect(targetMsd(0, 11, 9, 12)).toEqual({ value: 20, estimate: true });
    expect(targetMsd(0, 11, 0, 12)).toEqual({ value: 23, estimate: true });
  });
});

describe("failed saves", () => {
  it("fails below the DC and on a natural 1, succeeds on a natural 20", () => {
    expect(saveFailed(14, 9, 15)).toBe(true);
    expect(saveFailed(15, 10, 15)).toBe(false);
    expect(saveFailed(30, 1, 15)).toBe(true);
    expect(saveFailed(10, 20, 25)).toBe(false);
    expect(saveFailed(10, undefined, 15)).toBe(true);
  });

  it("parses condition lists with commas or spaces", () => {
    expect(parseConditions("blind, deaf")).toEqual(["blind", "deaf"]);
    expect(parseConditions(" dazzled  staggered,dazzled ")).toEqual(["dazzled", "staggered"]);
    expect(parseConditions(undefined)).toEqual([]);
  });

  it("only counts on-fail settings that do something", () => {
    expect(hasFailEffects(undefined)).toBe(false);
    expect(hasFailEffects({ conditions: "  ", conditionRounds: "1d4" })).toBe(false);
    expect(hasFailEffects({ regainFocus: true })).toBe(true);
    expect(hasAutomation({ onFail: { buffId: "abc" } })).toBe(true);
  });
});

describe("granted actions", () => {
  const throwAction = {
    _id: "base0000base0000",
    name: "Throw",
    damage: { parts: [{ formula: "1d8", types: ["bludgeoning"] }] },
    save: { type: "fort", dc: "10 + @abilities.int.mod" },
    notes: { effect: ["Failed save: blinded and deafened."] },
  };
  const dispel: Grant = {
    key: "explosive:dispelling-detonations",
    target: "Flashbangs",
    variants: [
      {
        requires: ["Silver", "Circle of Salt"],
        name: "Greater",
        automation: { onFail: { note: "greater" } },
      },
      { name: "Plain", automation: { onFail: { note: "plain" } } },
    ],
  };

  it("picks the first variant whose required items are present", () => {
    expect(pickVariant(dispel, new Set(["silver", "circle of salt"]))?.name).toBe("Greater");
    expect(pickVariant(dispel, new Set(["silver"]))?.name).toBe("Plain");
  });

  it("gives an action the same id every time, and different keys different ids", () => {
    expect(stableId("explosive:a")).toBe(stableId("explosive:a"));
    expect(stableId("explosive:a")).not.toBe(stableId("explosive:b"));
    expect(stableId("explosive:a")).toMatch(/^[A-Za-z0-9]{16}$/);
  });

  it("builds on the base action: extra damage, DC bonus and notes", () => {
    const a = buildGrantedAction(
      throwAction,
      {
        name: "Sonic",
        addDamage: [{ formula: "(@classes.scholar.level)d6", types: ["sonic"] }],
        dcBonus: "1",
        notes: ["Sonic."],
      },
      "explosive:sonic",
    );
    expect(a._id).toBe(stableId("explosive:sonic"));
    expect(a.name).toBe("Sonic");
    expect(a.damage.parts.map((p) => p.formula)).toEqual(["1d8", "(@classes.scholar.level)d6"]);
    expect(a.save.dc).toBe("10 + @abilities.int.mod + 1");
    expect(a.notes.effect).toEqual(["Failed save: blinded and deafened.", "Sonic."]);
    expect(throwAction.damage.parts).toHaveLength(1);
  });

  it("merges automation: keeps the base's on-fail, adds a condition group and a template buff", () => {
    const base = {
      onFail: { conditions: "blind, deaf", conditionRounds: "1d4+1", regainFocus: true },
    };
    const merged = mergeGrantAutomation(base, {
      focus: "expend",
      onFail: {
        conditions: "staggered",
        conditionRounds: "1",
        buffTemplate: "inhibited",
        buffRounds: "1d4",
      },
    });
    expect(merged.focus).toBe("expend");
    expect(merged.onFail).toEqual({
      conditions: "blind, deaf",
      conditionRounds: "1d4+1",
      regainFocus: true,
      buffId: "tpl:inhibited",
      buffRounds: "1d4",
      more: [{ conditions: "staggered", rounds: "1" }],
    });
    expect(base.onFail).not.toHaveProperty("buffId");
  });

  it("turns a buff template into buff item data", () => {
    const data = templateToItemData({
      name: "Inhibited",
      changes: [{ formula: "-2", target: "cl" }],
    });
    expect(data.type).toBe("buff");
    expect(data.system.changes[0]).toMatchObject({
      formula: "-2",
      target: "cl",
      type: "untyped",
      operator: "add",
    });
  });
});

describe("prodigy imbuements", () => {
  const html =
    "<p>Intro.</p><h3 id='a'>Creation</h3><p><strong>Breaker (imbue) (requires alter):</strong> Ignore hardness.</p>" +
    "<p><strong>Shatter (finish):</strong> Break things.</p><h3>Fallen Fey</h3><p><strong>Fey Step (imbue):</strong> Teleport&#8217;s cousin.</p>";

  it("reads each sphere's imbue and finish entries", () => {
    const groups = parseImbuements(html);
    expect(groups.map((g) => g.sphere)).toEqual(["Creation", "Fallen Fey"]);
    expect(groups[0].entries).toEqual([
      { name: "Breaker", kind: "imbue", requires: "alter", text: "Ignore hardness." },
      { name: "Shatter", kind: "finish", requires: null, text: "Break things." },
    ]);
    expect(groups[1].entries[0].text).toBe("Teleport\u2019s cousin.");
  });
});

describe("sequence parts", () => {
  const none = { length: 0, linked: false, imbue: "" };
  it("an opener starts a sequence at 1, or adds a link to a running one", () => {
    expect(applySequenceRole(none, "opener", 6).length).toBe(1);
    expect(applySequenceRole({ length: 3, linked: false, imbue: "x" }, "opener", 6).length).toBe(4);
  });
  it("a link only extends a running sequence, up to the maximum", () => {
    expect(applySequenceRole(none, "link", 6).length).toBe(0);
    expect(applySequenceRole({ length: 6, linked: false, imbue: "" }, "link", 6).length).toBe(6);
  });
  it("a finisher ends the sequence", () => {
    expect(
      applySequenceRole({ length: 5, linked: true, imbue: "Life: Regenerate" }, "finisher", 6),
    ).toEqual(none);
  });
});

describe("leadership", () => {
  const aridan = { level: 16, chaMod: 9, mythicTier: 5, active: {}, misc: 0 };
  it("adds level, Charisma, mythic tier and the modifiers for each audience", () => {
    expect(leadershipScores(aridan)).toEqual({ base: 30, cohort: 30, followers: 30 });
    expect(
      leadershipScores({ ...aridan, active: { renown: true, stronghold: true, companion: true } }),
    ).toEqual({ base: 32, cohort: 30, followers: 34 });
  });
  it("caps the cohort two levels below the leader", () => {
    expect(cohortMaxLevel(30, 16)).toBe(14);
    expect(cohortMaxLevel(10, 16)).toBe(7);
  });
  it("reads followers from the table, capped at its last row", () => {
    expect(followersAllowed(25)).toEqual([135, 13, 7, 4, 2, 2]);
    expect(followersAllowed(13)).toEqual([10, 1, 0, 0, 0, 0]);
    expect(followersAllowed(5)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});

describe("high leadership scores (Ultimate Intrigue)", () => {
  it("matches the rule's worked scores of 26 and 27", () => {
    expect(followersAllowed(26)).toEqual([168, 16, 8, 4, 2, 2]);
    expect(followersAllowed(27)).toEqual([202, 20, 10, 5, 3, 2]);
  });
  it("keeps multiplying past 27", () => {
    expect(followersAllowed(30)).toEqual([378, 37, 19, 10, 5, 3]);
    expect(followersAllowed(29)).toEqual([303, 30, 15, 8, 4, 2]);
  });
});

describe("squadrons", () => {
  it("sizes the squadron from War CL or Diplomacy, or by Platoon Commander", () => {
    expect(squadronSize(8, 0)).toBe(4);
    expect(squadronSize(8, 16)).toBe(6);
    expect(squadronSize(8, 16, true)).toBe(12);
  });
  it("raises a totem's d20 bonuses for members, not its penalties or damage", () => {
    expect(squadronTotemBonus(8)).toBe(1);
    expect(squadronTotemBonus(10)).toBe(2);
    const out = boostTotemChanges(
      [
        { formula: "1 + floor(@item.level / 5)", target: "attack" },
        { formula: "2", target: "damage" },
        { formula: "-2", target: "ac" },
        { formula: "1", target: "skill.per" },
      ],
      2,
    );
    expect(out.map((c) => c.formula)).toEqual([
      "(1 + floor(@item.level / 5)) + 2",
      "2",
      "-2",
      "(1) + 2",
    ]);
  });
  it("gives Phalanx Formation +2 for one neighbour and +1 for each more", () => {
    expect([0, 1, 2, 3].map(phalanxBonus)).toEqual([0, 2, 3, 4]);
  });
});

describe("mythic followers", () => {
  it("makes the ten highest-level followers mythic", () => {
    expect(mythicFollowers(followersAllowed(33))).toEqual([0, 0, 0, 0, 5, 5]);
    expect(mythicFollowers(followersAllowed(30))).toEqual([0, 0, 0, 2, 5, 3]);
    expect(mythicFollowers([3, 0, 0, 0, 0, 0])).toEqual([3, 0, 0, 0, 0, 0]);
  });
});

describe("wards and totems", () => {
  it("matches alignments, neutral meaning true neutral", () => {
    expect(alignmentMatches("good", "ng")).toBe(true);
    expect(alignmentMatches("good", "le")).toBe(false);
    expect(alignmentMatches("lawful", "le")).toBe(true);
    expect(alignmentMatches("chaotic", "cn")).toBe(true);
    expect(alignmentMatches("neutral", "tn")).toBe(true);
    expect(alignmentMatches("neutral", "ln")).toBe(false);
    expect(alignmentMatches("", "ce")).toBe(true);
  });
  it("sees a ward's edge crossed in the watched directions", () => {
    expect(edgeCrossing(false, true, "enter")).toBe("enter");
    expect(edgeCrossing(true, false, "enter")).toBe(null);
    expect(edgeCrossing(true, false, "both")).toBe("leave");
    expect(edgeCrossing(true, true, "both")).toBe(null);
    expect(edgeCrossing(false, true, "")).toBe(null);
  });
  it("drops a mark note's repeated label", () => {
    expect(withoutLabel("Focused fire: +1 per hit", "Focused fire")).toBe("+1 per hit");
    expect(withoutLabel("+1 per hit", "Focused fire")).toBe("+1 per hit");
  });
  it("names effects without repeating the talent", () => {
    expect(effectLabel("Totem Of Stability", "Totem of Stability")).toBe("Totem of Stability");
    expect(effectLabel("Totem Of Allegiance", "Totem of Allegiance (Lawful)")).toBe(
      "Totem of Allegiance (Lawful)",
    );
    expect(effectLabel("Repel Chaos/Evil/Good/Law", "Repel Chaos")).toBe("Repel Chaos");
    expect(effectLabel("Resistance", "Resistance Aegis")).toBe("Resistance Aegis");
    expect(effectLabel("War Sphere", "Totem of War")).toBe("War Sphere: Totem of War");
    expect(effectLabel("Flashbangs", "Throw")).toBe("Flashbangs: Throw");
    expect(effectLabel("Flashbangs", undefined)).toBe("Flashbangs");
  });
  it("pins the caster's sphere values", () => {
    const v = { "cl.protection.total": 9, "cl.total": 12, cam: 4, "msd.total": 20 };
    const look = (p) => v[p] ?? 0;
    expect(pinCasterLevels("1 + floor(@spheres.cl.protection.total / 5)", look)).toBe(
      "1 + floor(9 / 5)",
    );
    expect(pinCasterLevels("+[[@spheres.cl.total]] and @item.level", look)).toBe(
      "+[[12]] and @item.level",
    );
    expect(pinCasterLevels("DC [[10 + @spheres.cam]] MSD [[@spheres.msd.total]]", look)).toBe(
      "DC [[10 + 4]] MSD [[20]]",
    );
    expect(pinCasterLevels("@spheres.sequence.length", look)).toBe("@spheres.sequence.length");
  });
});

describe("death sphere", () => {
  it("limits reanimated Hit Dice by Greater Reanimate", () => {
    expect(undeadHDLimit(10, 0)).toBe(20);
    expect(undeadHDLimit(10, 1)).toBe(40);
    expect(undeadHDLimit(15, 2)).toBe(75);
  });
});

describe("undead pools", () => {
  it("lists the pools an actor has", () => {
    const pools = undeadPools({
      deathCL: 15,
      greaterReanimate: 2,
      animateDeadCL: 9,
      commandUndeadLevel: 7,
    });
    expect(pools).toEqual([
      { key: "reanimate", limit: 75 },
      { key: "animateDead", limit: 36 },
      { key: "commandUndead", limit: 7 },
    ]);
    expect(
      undeadPools({
        deathCL: null,
        greaterReanimate: 0,
        animateDeadCL: null,
        commandUndeadLevel: null,
      }),
    ).toEqual([]);
  });
  it("counts a sustained undead at half its Hit Dice", () => {
    expect(minionHD(10)).toBe(10);
    expect(minionHD(7, true)).toBe(4);
    expect(minionHD(1, true)).toBe(1);
  });
  it("reads the 0.9.11 list", () => {
    expect(readMinions(["A", "B"]).minions).toEqual([
      { uuid: "A", pool: "reanimate" },
      { uuid: "B", pool: "reanimate" },
    ]);
  });
});

describe("possessed corruption", () => {
  it("raises the save DC with each attempt and caps influence", () => {
    const s = { ...defaultCorruption(), manifestationLevel: 2 };
    expect(possessedSaveDC(s)).toBe(17);
    expect(possessedSaveDC(afterSave(s, false))).toBe(19);
    expect(addInfluence({ ...s, influence: 5 }).influence).toBe(5);
    expect(afterSave(s, true).stage).toBe(1);
    expect(sunrise({ ...s, influence: 4, attempts: 2 })).toMatchObject({
      influence: 1,
      attempts: 0,
    });
  });
});
