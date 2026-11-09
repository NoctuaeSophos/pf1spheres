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
