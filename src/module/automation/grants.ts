/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 and pf1 11 runtime APIs are not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID, localize } from "../util";
import { spellPoolItem } from "../actor";
import { isGMWriter } from "../socket";
import {
  buildGrantedAction,
  mergeGrantAutomation,
  pickVariant,
  stableId,
  templateToItemData,
} from "./logic";
import type { Grant } from "./logic";

/**
 * Granted actions: an item's flags.pf1spheres.grants add actions to another item on the same actor
 * (a material imposition's [explosive] throw on Flashbangs). They follow the actor's items: adding the
 * granting item adds the action, removing it takes the action away, and variants switch as their
 * required items come and go. The target remembers what it was given in flags.pf1spheres.granted.
 */

const SKIP = "pf1spheresGrants";

/** A signature of what a sync would write, so an unchanged target is left alone */
const signature = (value) => stableId(JSON.stringify(value));

/** One sync chain per actor: a sync reads the items, then writes, so two must never overlap */
const chains = new Map<string, Promise<void>>();

/**
 * Brings every item that receives granted actions in line with the actor's granting items. Calls for
 * the same actor run one after another.
 *
 * @param actor - The actor to synchronise
 */
export const syncGrants = (actor): Promise<void> => {
  if (!actor?.isOwner) return Promise.resolve();
  const key = actor.uuid;
  const next = (chains.get(key) ?? Promise.resolve())
    .then(() => runSync(actor))
    .catch((err) => console.error(`${MODULE_ID} | granted actions`, err));
  chains.set(key, next);
  // Forget the chain once it is idle, so the map doesn't grow with every actor ever synced
  next.then(() => {
    if (chains.get(key) === next) chains.delete(key);
  });
  return next;
};

/** Spell point costs in an automation entry: the base formula or any per-conditional cost */
const spCost = (auto) =>
  Boolean(
    (auto?.sp && String(auto.sp).trim() !== "" && String(auto.sp).trim() !== "0") ||
      Object.values(auto?.condSp ?? {}).some((n) => Number(n) > 0),
  );

/**
 * Makes the spell pool a pf1 resource: a daily-use "Spell Points" item whose maximum is the pool, and
 * abilities with a spell point cost linked to it as charges. pf1 then shows the cost in the Charges
 * column, deducts it, refuses when short and refills it on rest. Abilities with uses of their own keep
 * the module's own spending, since linking would replace their uses.
 */
async function syncSpellPool(actor) {
  const max = actor.system.spheres?.spellPoints?.max ?? 0;
  const options = { [SKIP]: true };
  let pool = spellPoolItem(actor);
  if (!pool) {
    // A spell point feat the user made by hand (tagged spellPoints) becomes the pool, not a second one
    const own = actor.items.find(
      (i) => i.type === "feat" && i.system.tag === "spellPoints" && i._source.system?.uses?.per,
    );
    if (own) {
      const upd = { [`flags.${MODULE_ID}.spellPool`]: true };
      if (!own._source.system.uses.maxFormula)
        upd["system.uses.maxFormula"] = "@spheres.spellPoints.max";
      await own.update(upd, options);
      pool = own;
    }
  }
  if (!pool) {
    // Only the active GM creates it, so two clients syncing the same actor can't make two
    if (max <= 0 || !isGMWriter()) return;
    const stored = actor.flags?.[MODULE_ID]?.spellPoints;
    [pool] = await actor.createEmbeddedDocuments(
      "Item",
      [
        {
          name: localize("SpellPoints"),
          type: "feat",
          img: "icons/magic/symbols/rune-sigil-black-pink.webp",
          system: {
            subType: "misc",
            tag: "spellPoints",
            useCustomTag: true,
            description: { value: `<p>${localize("SpellPoolItemHint")}</p>` },
            uses: {
              per: "day",
              maxFormula: "@spheres.spellPoints.max",
              value: typeof stored === "number" ? stored : max,
              autoDeductChargesCost: "1",
            },
          },
          flags: { [MODULE_ID]: { spellPool: true } },
        },
      ],
      options,
    );
  }
  // Own uses come from the saved data: once linked, pf1 prepares an item with the pool's uses, and
  // reading those would unlink it on the next sync and relink it on the one after. Spells draw on
  // their spellbook, and an item already drawing on another pool can't have two.
  const canLink = (i) => {
    if (i === pool || i.type === "spell" || i._source.system?.uses?.per) return false;
    const parent = i.links?.charges;
    return !parent || parent === pool;
  };
  const linkable = actor.items.filter((i) => {
    if (!canLink(i)) return false;
    const f = i.flags?.[MODULE_ID] ?? {};
    return f.spellPointItem || Object.values(f.automation ?? {}).some(spCost);
  });
  const updates = [];
  // Converted abilities that can't draw on the pool any more go back to the module's spending, so their
  // cost isn't taken from their own uses instead
  const reverted = actor.items.filter(
    (i) => i.flags?.[MODULE_ID]?.spellPointItem && !linkable.includes(i),
  );
  for (const item of reverted) {
    const u = {
      _id: item.id,
      [`flags.${MODULE_ID}.-=spellPointItem`]: null,
      "system.uses.autoDeductChargesCost": "1",
    };
    u["system.actions"] = (item.toObject().system.actions ?? []).map((a) => {
      const cost = a.uses?.autoDeductChargesCost;
      if (cost && cost !== "0") u[`flags.${MODULE_ID}.automation.${a._id}.sp`] = cost;
      const conditionals = (a.conditionals ?? []).map((c) => {
        const mine = (c.modifiers ?? []).find((m) => m._id === stableId(`${c._id}:sp`));
        if (!mine) return c;
        u[`flags.${MODULE_ID}.automation.${a._id}.condSp.${c._id}`] = Number(mine.formula) || 0;
        return { ...c, modifiers: c.modifiers.filter((m) => m !== mine) };
      });
      return { ...a, uses: { ...(a.uses ?? {}), autoDeductChargesCost: "" }, conditionals };
    });
    updates.push(u);
  }
  // Move each cost into pf1's own fields: the action's charge cost, and a charges modifier per conditional
  for (const item of linkable) {
    const auto = item.flags?.[MODULE_ID]?.automation ?? {};
    if (!Object.values(auto).some(spCost) && item.flags[MODULE_ID].spellPointItem) continue;
    const actions = (item.toObject().system.actions ?? []).map((a) => {
      const entry = auto[a._id] ?? {};
      const cost =
        entry.sp && String(entry.sp).trim()
          ? String(entry.sp)
          : a.uses?.autoDeductChargesCost || "0";
      const conditionals = (a.conditionals ?? []).map((c) => {
        const n = Number(entry.condSp?.[c._id]) || 0;
        if (!n || (c.modifiers ?? []).some((m) => m.target === "charges")) return c;
        return {
          ...c,
          modifiers: [
            ...(c.modifiers ?? []),
            {
              _id: stableId(`${c._id}:sp`),
              formula: String(n),
              target: "charges",
              subTarget: "",
              type: "",
              critical: "normal",
            },
          ],
        };
      });
      return { ...a, uses: { ...(a.uses ?? {}), autoDeductChargesCost: cost }, conditionals };
    });
    const u = {
      _id: item.id,
      "system.actions": actions,
      "system.uses.autoDeductChargesCost": "0",
      [`flags.${MODULE_ID}.spellPointItem`]: true,
    };
    for (const [id, entry] of Object.entries(auto)) {
      if (entry.sp !== undefined) u[`flags.${MODULE_ID}.automation.${id}.-=sp`] = null;
      if (entry.condSp !== undefined) u[`flags.${MODULE_ID}.automation.${id}.-=condSp`] = null;
    }
    updates.push(u);
  }
  if (updates.length) await actor.updateEmbeddedDocuments("Item", updates, options);
  // Links the user added stay; links to deleted or reverted items go
  const idOf = (uuid) => foundry.utils.parseUuid(uuid, { relative: actor })?.id;
  const kept = (pool._source.system.links?.charges ?? []).filter((l) => {
    const item = actor.items.get(idOf(l.uuid));
    return item && !reverted.includes(item);
  });
  const have = new Set(kept.map((l) => idOf(l.uuid)));
  const links = [
    ...kept,
    ...linkable.filter((i) => !have.has(i.id)).map((i) => ({ uuid: i.getRelativeUUID(actor) })),
  ];
  const sig = (list) =>
    list
      .map((l) => idOf(l.uuid))
      .sort()
      .join();
  if (sig(pool._source.system.links?.charges ?? []) !== sig(links))
    await pool.update({ "system.links.charges": links }, options);
}

async function runSync(actor) {
  await syncSpellPool(actor);
  await syncGrantedActions(actor);
  // A granted action can bring a spell point cost; convert it now rather than on the next sync
  await syncSpellPool(actor);
}

async function syncGrantedActions(actor) {
  const items = actor.items.contents;
  const names = new Set(items.map((i) => i.name.toLowerCase()));
  const wanted = new Map();
  for (const item of items) {
    const grants: Grant[] = item.flags?.[MODULE_ID]?.grants ?? [];
    for (const grant of grants) {
      const variant = pickVariant(grant, names);
      if (!variant || !grant.target) continue;
      const list = wanted.get(grant.target.toLowerCase()) ?? [];
      if (list.some((w) => w.key === grant.key)) continue;
      list.push({ key: grant.key, variant, templates: item.flags[MODULE_ID].buffTemplates ?? {} });
      wanted.set(grant.target.toLowerCase(), list);
    }
  }
  await syncGrantedItems(actor);
  for (const target of items) {
    const want = wanted.get(target.name.toLowerCase()) ?? [];
    const flags = target.flags?.[MODULE_ID] ?? {};
    const granted = flags.granted ?? {};
    if (!want.length && !Object.keys(granted).length) continue;
    const own = (target.toObject().system.actions ?? []).filter((a) => !(a._id in granted));
    const ownAuto = Object.fromEntries(
      Object.entries(flags.automation ?? {}).filter(([id]) => !(id in granted)),
    );
    const base = own[0];
    const baseAuto = base ? ownAuto[base._id] : undefined;
    const built = want.map((w) => {
      const action = buildGrantedAction(base, w.variant, w.key);
      return {
        key: w.key,
        action,
        automation: mergeGrantAutomation(baseAuto, w.variant.automation),
        templates: w.templates,
      };
    });
    const sig = signature([base ?? null, baseAuto ?? null, built]);
    if (flags.grantSignature === sig) continue;
    const templates = Object.assign(
      {},
      flags.buffTemplates ?? {},
      ...built.map((b) => b.templates),
    );
    const automation = {
      ...ownAuto,
      ...Object.fromEntries(built.map((b) => [b.action._id, b.automation])),
    };
    const options = { [SKIP]: true };
    // Replace the flag objects outright, so removed actions leave no settings behind
    await target.update(
      {
        [`flags.${MODULE_ID}.-=automation`]: null,
        [`flags.${MODULE_ID}.-=granted`]: null,
        [`flags.${MODULE_ID}.-=buffTemplates`]: null,
      },
      options,
    );
    await target.update(
      {
        "system.actions": [...own, ...built.map((b) => b.action)],
        [`flags.${MODULE_ID}.automation`]: automation,
        [`flags.${MODULE_ID}.buffTemplates`]: templates,
        [`flags.${MODULE_ID}.granted`]: Object.fromEntries(built.map((b) => [b.action._id, b.key])),
        [`flags.${MODULE_ID}.grantSignature`]: sig,
      },
      options,
    );
  }
}

/**
 * Whole items an item brings along (flags.pf1spheres.grantItems lists keys of its buffTemplates): a
 * feature's own buffs appear when it is added and go when it is removed. A buff of the same name the
 * actor already has is adopted instead of duplicated.
 */
async function syncGrantedItems(actor) {
  const items = actor.items.contents;
  const wanted = new Map();
  for (const item of items) {
    const f = item.flags?.[MODULE_ID];
    for (const key of f?.grantItems ?? []) {
      const t = f.buffTemplates?.[key];
      if (t) wanted.set(`${item.name}:${key}`.toLowerCase(), t);
    }
  }
  const options = { [SKIP]: true };
  const held = new Map(
    items
      .filter((i) => i.flags?.[MODULE_ID]?.grantedItem)
      .map((i) => [i.flags[MODULE_ID].grantedItem, i]),
  );
  const drop = [...held].filter(([key]) => !wanted.has(key)).map(([, i]) => i.id);
  if (drop.length) await actor.deleteEmbeddedDocuments("Item", drop, options);
  const create = [];
  for (const [key, t] of wanted) {
    if (held.has(key)) continue;
    const same = items.find(
      (i) => i.type === "buff" && i.name === t.name && !i.flags?.[MODULE_ID]?.grantedItem,
    );
    if (same) await same.update({ [`flags.${MODULE_ID}.grantedItem`]: key }, options);
    else
      create.push(
        foundry.utils.mergeObject(templateToItemData(t), {
          flags: { [MODULE_ID]: { grantedItem: key } },
        }),
      );
  }
  if (create.length) await actor.createEmbeddedDocuments("Item", create, options);
}

const timers = new Map();
const queueGrants = (actor) => {
  if (!(actor instanceof Actor)) return;
  const key = actor.uuid;
  clearTimeout(timers.get(key));
  timers.set(
    key,
    setTimeout(() => {
      timers.delete(key);
      syncGrants(actor);
    }, 150),
  );
};

/** Only the client that changed the item syncs, so each change is written once */
const onItemChange = (item, options, userId) => {
  if (options?.[SKIP]) return;
  const actor = item.parent;
  if (userId === game.user.id) return queueGrants(actor);
  // A player's change can't create the pool (only the GM does), so the GM checks for a missing one
  if (
    isGMWriter() &&
    actor instanceof Actor &&
    !spellPoolItem(actor) &&
    (actor.system.spheres?.spellPoints?.max ?? 0) > 0
  )
    queueGrants(actor);
};

/** Deleting the Spell Points item keeps its value for when the pool comes back, rather than refilling */
const onItemDeleted = (item, options, userId) => {
  if (
    userId === game.user.id &&
    item.flags?.[MODULE_ID]?.spellPool &&
    item.parent instanceof Actor &&
    item.parent.isOwner
  ) {
    item.parent.update(
      { [`flags.${MODULE_ID}.spellPoints`]: item._source.system?.uses?.value ?? 0 },
      { [SKIP]: true },
    );
  }
  onItemChange(item, options, userId);
};

export const registerGrants = () => {
  Hooks.on("createItem", (item, options, userId) => onItemChange(item, options, userId));
  Hooks.on("deleteItem", onItemDeleted);
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if (!("name" in changed) && !changed.system?.actions && !changed.flags?.[MODULE_ID]) return;
    onItemChange(item, options, userId);
  });
  // Actors that already had granting items before this existed, or changed while nobody was syncing
  Hooks.once("ready", () => {
    if (!isGMWriter()) return;
    for (const actor of game.actors) {
      const f = (i) => i.flags?.[MODULE_ID] ?? {};
      const grants = actor.items.some(
        (i) => f(i).grants?.length || f(i).granted || f(i).grantItems?.length || f(i).grantedItem,
      );
      const pool = (actor.system.spheres?.spellPoints?.max ?? 0) > 0 || spellPoolItem(actor);
      if (grants || pool) queueGrants(actor);
    }
  });
};
