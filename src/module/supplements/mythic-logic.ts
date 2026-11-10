/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * NOT SPHERES CONTENT. Automation for other modules' mythic items, matched by item and action name, so
 * this module adds no copies of them: Krune's (krune-table) Deadly Dodge, Mirror Dodge and Amazing
 * Initiative carry a charge cost but nothing to charge it from; the world already applies Krune's own
 * Deadly Dodge buff on use. An item's own pf1spheres automation always wins, and items pf1 already
 * charges from another item are left alone. Pure data, no Foundry.
 */

import type { ActionAutomation, BuffTemplate } from "../automation/logic";

/** Buff templates for named items; none needed so far (Krune's Deadly Dodge brings its own buff) */
export const NAMED_TEMPLATES: Record<string, BuffTemplate> = {};

/** Item name → action name → automation */
const NAMED_AUTOMATION: Record<string, Record<string, ActionAutomation>> = {
  "Deadly Dodge": { "Deadly Dodge": { mp: "1" } },
  "Mirror Dodge": { "Mirror Dodge": { mp: "1" } },
  "Amazing Initiative": { "Extra Standard Action": { mp: "1" } },
};

/**
 * The automation this module supplies for another module's item, if any.
 *
 * @param itemName - The item's name
 * @param actionName - The action's name
 */
export const namedAutomation = (
  itemName: string | undefined,
  actionName: string | undefined,
): ActionAutomation | null =>
  (itemName && actionName && NAMED_AUTOMATION[itemName]?.[actionName]) || null;
