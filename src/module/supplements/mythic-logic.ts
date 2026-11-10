/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * NOT SPHERES CONTENT. Automation for other modules' mythic items, matched by item and action name, so
 * this module adds no copies of them: Krune's (krune-table) Deadly Dodge, Mirror Dodge and Amazing
 * Initiative carry a charge cost but nothing to charge it from, and nothing applies Deadly Dodge's
 * bonus. An item's own pf1spheres automation always wins, and items pf1 already charges from another
 * item are left alone. Pure data, no Foundry.
 */

import type { ActionAutomation, BuffTemplate } from "../automation/logic";

export const NAMED_TEMPLATES: Record<string, BuffTemplate> = {
  "deadly-dodge": {
    name: "Deadly Dodge",
    img: "icons/svg/aura.svg",
    description:
      "<p>+4 dodge bonus to AC until your next turn starts. A creature that misses you in melee provokes an attack of opportunity from you; instead of that attack you may have it reroll the attack against another creature adjacent to you and within its reach.</p>",
    changes: [{ formula: "4", target: "ac", type: "dodge" }],
    contextNotes: [
      {
        text: "Deadly Dodge: a melee miss against you provokes, or is redirected at an adjacent creature",
        target: "ac",
      },
    ],
  },
};

/** Item name → action name → automation */
const NAMED_AUTOMATION: Record<string, Record<string, ActionAutomation>> = {
  "Deadly Dodge": {
    "Deadly Dodge": {
      mp: "1",
      effect: { enabled: true, duration: "1", units: "round" },
      buff: { itemId: "tpl:deadly-dodge", self: true },
    },
  },
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
