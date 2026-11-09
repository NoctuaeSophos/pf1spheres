/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import {
  addLinks,
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
} from "../src/module/automation/logic";
import type { Grant } from "../src/module/automation/logic";

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
