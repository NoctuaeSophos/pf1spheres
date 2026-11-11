/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import { clearPreparationCache, perPreparation } from "../src/module/actor-cache";

describe("Per-preparation actor cache", () => {
  test("computes once per preparation, again after it is cleared", () => {
    const actor = {};
    let runs = 0;
    const read = () => perPreparation(actor, "test.count", () => ++runs);

    expect(read()).toBe(1);
    expect(read()).toBe(1);
    clearPreparationCache(actor);
    expect(read()).toBe(2);
  });

  test("keeps actors and keys apart, including falsy values", () => {
    const a = {};
    const b = {};
    expect(perPreparation(a, "x", () => null)).toBeNull();
    expect(perPreparation(a, "x", () => "changed")).toBeNull();
    expect(perPreparation(a, "y", () => 0)).toBe(0);
    expect(perPreparation(b, "x", () => "b")).toBe("b");
  });
});
