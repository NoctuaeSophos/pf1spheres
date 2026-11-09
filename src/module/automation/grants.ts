/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 and pf1 11 runtime APIs are not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID } from "../util";
import { isGMWriter } from "../socket";
import { buildGrantedAction, mergeGrantAutomation, pickVariant, stableId, templateToItemData } from "./logic";
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

async function runSync(actor) {
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
    const ownAuto = Object.fromEntries(Object.entries(flags.automation ?? {}).filter(([id]) => !(id in granted)));
    const base = own[0];
    const baseAuto = base ? ownAuto[base._id] : undefined;
    const built = want.map((w) => {
      const action = buildGrantedAction(base, w.variant, w.key);
      return { key: w.key, action, automation: mergeGrantAutomation(baseAuto, w.variant.automation), templates: w.templates };
    });
    const sig = signature([base ?? null, baseAuto ?? null, built]);
    if (flags.grantSignature === sig) continue;
    const templates = Object.assign({}, flags.buffTemplates ?? {}, ...built.map((b) => b.templates));
    const automation = { ...ownAuto, ...Object.fromEntries(built.map((b) => [b.action._id, b.automation])) };
    const options = { [SKIP]: true };
    // Replace the flag objects outright, so removed actions leave no settings behind
    await target.update(
      { [`flags.${MODULE_ID}.-=automation`]: null, [`flags.${MODULE_ID}.-=granted`]: null, [`flags.${MODULE_ID}.-=buffTemplates`]: null },
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
  const held = new Map(items.filter((i) => i.flags?.[MODULE_ID]?.grantedItem).map((i) => [i.flags[MODULE_ID].grantedItem, i]));
  const drop = [...held].filter(([key]) => !wanted.has(key)).map(([, i]) => i.id);
  if (drop.length) await actor.deleteEmbeddedDocuments("Item", drop, options);
  const create = [];
  for (const [key, t] of wanted) {
    if (held.has(key)) continue;
    const same = items.find((i) => i.type === "buff" && i.name === t.name && !i.flags?.[MODULE_ID]?.grantedItem);
    if (same) await same.update({ [`flags.${MODULE_ID}.grantedItem`]: key }, options);
    else create.push(foundry.utils.mergeObject(templateToItemData(t), { flags: { [MODULE_ID]: { grantedItem: key } } }));
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
  if (options?.[SKIP] || userId !== game.user.id) return;
  queueGrants(item.parent);
};

export const registerGrants = () => {
  Hooks.on("createItem", (item, options, userId) => onItemChange(item, options, userId));
  Hooks.on("deleteItem", (item, options, userId) => onItemChange(item, options, userId));
  Hooks.on("updateItem", (item, changed, options, userId) => {
    if (!("name" in changed) && !changed.system?.actions && !changed.flags?.[MODULE_ID]) return;
    onItemChange(item, options, userId);
  });
  // Actors that already had granting items before this existed, or changed while nobody was syncing
  Hooks.once("ready", () => {
    if (!isGMWriter()) return;
    for (const actor of game.actors) {
      const f = (i) => i.flags?.[MODULE_ID] ?? {};
      if (actor.items.some((i) => f(i).grants?.length || f(i).granted || f(i).grantItems?.length || f(i).grantedItem)) queueGrants(actor);
    }
  });
};
