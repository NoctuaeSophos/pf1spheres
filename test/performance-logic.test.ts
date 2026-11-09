/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import { describe, expect, it } from "vitest";
import { pickVariant } from "../src/module/automation/logic";
import {
  PERFORMANCE_GRANTS,
  PERFORMANCE_ITEM,
  PERFORMANCE_TEMPLATES,
} from "../src/module/supplements/performance-logic";

const names = (...n: string[]) => new Set(n.map((x) => x.toLowerCase()));
const byKey = (k: string) => PERFORMANCE_GRANTS.find((g) => g.key === `perf:${k}`)!;

describe("bardic performances", () => {
  it("only gives a bard the performances he has", () => {
    const has = names(PERFORMANCE_ITEM, "Inspire Courage", "Fascinate");
    const got = PERFORMANCE_GRANTS.filter((g) => pickVariant(g, has)).map((g) => g.key);
    expect(got).toEqual(["perf:fascinate", "perf:inspire-courage"]);
  });
  it("uses Inspired Defense's version of inspire courage when the marshal has it", () => {
    const plain = pickVariant(byKey("inspire-courage"), names("Inspire Courage"));
    const marshal = pickVariant(
      byKey("inspire-courage"),
      names("Inspire Courage", "Inspired Defense"),
    );
    expect(plain?.automation?.buff?.itemId).toBe("tpl:inspire-courage");
    expect(marshal?.automation?.buff?.itemId).toBe("tpl:inspire-courage-defense");
    expect(pickVariant(byKey("inspire-courage-mythic"), names("Inspire Courage"))).toBeNull();
  });
  it("refers only to templates that exist", () => {
    for (const g of PERFORMANCE_GRANTS)
      for (const v of g.variants)
        for (const ref of [v.automation?.buff?.itemId, v.automation?.onFail?.buffId])
          if (ref) expect(PERFORMANCE_TEMPLATES[ref.slice(4)], `${g.key} ${ref}`).toBeTruthy();
  });
  it("keeps competence and the dirge off the bard himself", () => {
    expect(byKey("inspire-competence").variants[0].automation?.buff?.others).toBe(true);
    expect(byKey("dirge-of-doom").variants[0].automation?.buff?.others).toBe(true);
  });
  it("ends fascination and fear with the performance", () => {
    expect(byKey("fascinate").variants[0].automation?.onFail?.whileEffect).toBe(true);
    expect(byKey("frightening-tune").variants[0].automation?.onFail?.whileEffect).toBe(true);
  });
});
