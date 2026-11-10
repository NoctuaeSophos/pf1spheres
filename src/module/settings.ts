/*
 * SPDX-FileCopyrightText: 2022 Ethaks <ethaks@pm.me>
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

export function registerSettings(): void {
  // Talents listed on a character's Spheres tab are left off its Features tab (per user)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (game as any).settings.register("pf1spheres", "talentsOnSpheresTab", {
    name: "PF1SPHERES.Settings.TalentsOnSpheresTab",
    hint: "PF1SPHERES.Settings.TalentsOnSpheresTabHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
  });
}
