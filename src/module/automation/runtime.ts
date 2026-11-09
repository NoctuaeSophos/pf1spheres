/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 and pf1 11 runtime APIs are not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID, localize } from "../util";
import { isGMWriter, registerSocketHandler, requestGM, serialised, userOwns } from "../socket";
import {
  SEQUENCE_BREAKERS,
  addLinks,
  distanceFt,
  durationSeconds,
  fillNote,
  hasAutomation,
  remainingSeconds,
  sequenceMax,
  sequenceTurnStart,
  totalSpCost,
  zoneAffects,
} from "./logic";
import type { ActionAutomation, SequenceState } from "./logic";

const fmt = (key: string, data = {}) => game.i18n.format(`PF1SPHERES.Auto.${key}`, data);
const loc = (key: string) => localize(`Auto.${key}`);

/* ---------- settings storage ---------- */

export const getAutomation = (item, actionId): ActionAutomation =>
  foundry.utils.deepClone(item?.flags?.[MODULE_ID]?.automation?.[actionId] ?? {});

export const setAutomation = (item, actionId, data: ActionAutomation) =>
  item.update({ [`flags.${MODULE_ID}.automation.${actionId}`]: data });

/** Evaluates a deterministic formula with roll data; 0 on anything invalid */
export const evalFormula = (formula, rollData): number => {
  if (formula === undefined || formula === null || String(formula).trim() === "") return 0;
  try {
    const v = Roll.safeEval(Roll.replaceFormulaData(String(formula), rollData ?? {}, { missing: 0 }));
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
};

const tokenCenter = (doc) => {
  const size = doc.parent?.grid?.size ?? canvas?.grid?.size ?? 100;
  return { x: doc.x + (doc.width * size) / 2, y: doc.y + (doc.height * size) / 2 };
};

/** Every actor that could hold applied buffs: world actors and unlinked token actors on all scenes */
function* allActors() {
  yield* game.actors;
  for (const scene of game.scenes) for (const t of scene.tokens) if (!t.actorLink && t.actor) yield t.actor;
}

/* ---------- spell points and martial focus ---------- */

export const spendResources = async (actor, { sp = 0, focus = "" } = {}) => {
  const upd = {};
  if (sp > 0) upd[`flags.${MODULE_ID}.spellPoints`] = Math.max(0, (actor.system.spheres?.spellPoints?.value ?? 0) - sp);
  if (focus === "expend") upd[`flags.${MODULE_ID}.martialFocus`] = false;
  if (focus === "restore") upd[`flags.${MODULE_ID}.martialFocus`] = true;
  if (Object.keys(upd).length) await actor.update(upd);
};

/* ---------- tracked sphere effects ---------- */

export interface TrackedEffect {
  id: string;
  name: string;
  img: string;
  itemUuid: string;
  actionId: string;
  startTime: number;
  combatId: string | null;
  round: number;
  units: string;
  durationValue: number;
  seconds: number | null;
  persistValue: number;
  persistSeconds: number | null;
  concentration: boolean;
}

export const getEffects = (actor): TrackedEffect[] => foundry.utils.deepClone(actor?.flags?.[MODULE_ID]?.activeEffects ?? []);

/** Seconds (or rounds in the same combat) left on an effect */
export const effectRemaining = (e: TrackedEffect): number | null => {
  if (e.concentration || e.seconds === null) return null;
  const combat = e.combatId ? game.combats.get(e.combatId) : null;
  if (combat?.started && e.units === "round") return Math.max(0, e.durationValue - (combat.round - e.round)) * 6;
  return remainingSeconds(e.startTime, e.seconds, game.time.worldTime);
};

const setEffects = (actor, list) => actor.update({ [`flags.${MODULE_ID}.activeEffects`]: list });

/** Ends an effect: removes the buffs, zones and marks it created, then the tracker entry */
export const endEffect = async (actor, effectId: string) => {
  // The GM's handler removes the tracker entry too, so only one client writes the list
  await requestGM({ action: "auto.cleanup", casterUuid: actor.uuid, effectId });
};

/** Pays 1 spell point so a concentration effect lasts its full duration without concentration */
export const persistEffect = async (actor, effectId: string) => {
  const list = getEffects(actor);
  const e = list.find((x) => x.id === effectId);
  if (!e?.concentration || !e.persistSeconds) return;
  if ((actor.system.spheres?.spellPoints?.value ?? 0) < 1) return ui.notifications.warn(fmt("NotEnoughSP", { cost: 1 }));
  await spendResources(actor, { sp: 1 });
  Object.assign(e, {
    concentration: false,
    seconds: e.persistSeconds,
    durationValue: e.persistValue,
    startTime: game.time.worldTime,
    combatId: game.combat?.id ?? null,
    round: game.combat?.round ?? 0,
  });
  await setEffects(actor, list);
};

async function cleanupEffect(msg, user) {
  const caster = fromUuidSync(msg.casterUuid);
  if (!userOwns(user, caster)) return;
  const match = (flag) => flag?.effectId === msg.effectId;
  for (const actor of allActors()) {
    const ids = actor.items.filter((i) => match(i.flags?.[MODULE_ID]?.appliedBy)).map((i) => i.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("Item", ids);
  }
  for (const scene of game.scenes) {
    const zones = getZones(scene);
    const gone = zones.filter((z) => z.effectId === msg.effectId);
    if (gone.length) await removeZones(scene, gone.map((z) => z.id));
    const tokenUpdates = [];
    for (const t of scene.tokens) {
      const marks = t.getFlag(MODULE_ID, "marks") ?? [];
      const kept = marks.filter((m) => m.effectId !== msg.effectId);
      if (kept.length !== marks.length) tokenUpdates.push({ _id: t.id, [`flags.${MODULE_ID}.marks`]: kept });
    }
    if (tokenUpdates.length) await scene.updateEmbeddedDocuments("Token", tokenUpdates);
  }
  // This runs on the GM's client, so it can also drop the caster's tracker entry
  if (caster) {
    const before = getEffects(caster);
    const left = before.filter((e) => e.id !== msg.effectId);
    if (left.length !== before.length) await setEffects(caster, left);
  }
}

/* ---------- buffs applied to targets ---------- */

async function applyBuff(msg, user) {
  const caster = fromUuidSync(msg.casterUuid);
  if (!userOwns(user, caster)) return;
  const source = fromUuidSync(msg.buffUuid);
  if (!source) return;
  for (const uuid of msg.targetUuids ?? []) {
    const target = fromUuidSync(uuid);
    if (!target) continue;
    const data = source.toObject();
    delete data._id;
    data.system.level = msg.level;
    data.system.active = true;
    data.name = target.uuid === caster.uuid ? data.name : `${data.name} (${caster.name})`;
    foundry.utils.setProperty(data, `flags.${MODULE_ID}.appliedBy`, { casterUuid: caster.uuid, effectId: msg.effectId });
    await target.createEmbeddedDocuments("Item", [data]);
  }
}

/* ---------- zones ---------- */

export interface Zone {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  who: string;
  casterDisposition: number;
  casterUuid: string;
  buffUuid: string | null;
  level: number;
  effectId: string;
  regionId: string | null;
}

export const getZones = (scene): Zone[] => foundry.utils.deepClone(scene?.getFlag(MODULE_ID, "zones") ?? []);

async function createZone(msg, user) {
  const caster = fromUuidSync(msg.casterUuid);
  const scene = game.scenes.get(msg.sceneId);
  if (!scene || !userOwns(user, caster)) return;
  const px = (msg.radius / scene.grid.distance) * scene.grid.size;
  const [region] = await scene.createEmbeddedDocuments("Region", [
    {
      name: msg.name,
      color: msg.who === "enemies" ? "#c0392b" : "#2e86c1",
      shapes: [{ type: "circle", x: msg.center.x, y: msg.center.y, radius: px, hole: false }],
      visibility: CONST.REGION_VISIBILITY?.ALWAYS ?? 2,
      flags: { [MODULE_ID]: { zoneId: msg.zoneId } },
    },
  ]);
  const zones = getZones(scene);
  zones.push({
    id: msg.zoneId,
    name: msg.name,
    x: msg.center.x,
    y: msg.center.y,
    radius: msg.radius,
    who: msg.who,
    casterDisposition: msg.casterDisposition,
    casterUuid: caster.uuid,
    buffUuid: msg.buffUuid ?? null,
    level: msg.level,
    effectId: msg.effectId,
    regionId: region?.id ?? null,
  });
  await scene.setFlag(MODULE_ID, "zones", zones);
}

async function removeZones(scene, ids: string[]) {
  const zones = getZones(scene);
  const gone = zones.filter((z) => ids.includes(z.id));
  const regions = gone.map((z) => z.regionId).filter((id) => id && scene.regions?.has(id));
  if (regions.length) await scene.deleteEmbeddedDocuments("Region", regions);
  await scene.setFlag(MODULE_ID, "zones", zones.filter((z) => !ids.includes(z.id)));
}

/** Gives each creature inside a zone that zone's buff, and takes it away when they leave */
export async function syncZones(scene) {
  if (!scene || !isGMWriter()) return;
  const zones = getZones(scene).filter((z) => z.buffUuid);
  const seen = new Set();
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor || !["character", "npc"].includes(actor.type)) continue;
    const key = token.actorLink ? actor.uuid : token.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    // A linked actor only counts as being in the active scene
    const here = !token.actorLink || scene.active || !game.scenes.active;
    const center = tokenCenter(token);
    const inside = new Set(
      (here ? zones : [])
        .filter((z) => zoneAffects(z.who, z.casterDisposition, token.disposition))
        .filter((z) => distanceFt(center, z, scene.grid.size, scene.grid.distance) <= z.radius)
        .map((z) => z.id),
    );
    const held = actor.items.filter((i) => i.type === "buff" && i.flags?.[MODULE_ID]?.zoneBuff?.sceneId === scene.id);
    const drop = held.filter((i) => !inside.has(i.flags[MODULE_ID].zoneBuff.zoneId)).map((i) => i.id);
    if (drop.length) await actor.deleteEmbeddedDocuments("Item", drop);
    const have = new Set(held.map((i) => i.flags[MODULE_ID].zoneBuff.zoneId));
    for (const z of zones.filter((z) => inside.has(z.id) && !have.has(z.id))) {
      const source = fromUuidSync(z.buffUuid);
      if (!source) continue;
      const data = source.toObject();
      delete data._id;
      data.system.level = z.level;
      data.system.active = true;
      data.name = `${data.name} (${z.name})`;
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.zoneBuff`, { sceneId: scene.id, zoneId: z.id });
      await actor.createEmbeddedDocuments("Item", [data]);
    }
  }
}

const zoneTimers = new Map();
const zoneQueues = new Map();
const queueZones = (scene) => {
  if (!scene) return;
  clearTimeout(zoneTimers.get(scene.id));
  if (!zoneQueues.has(scene.id)) zoneQueues.set(scene.id, serialised(() => syncZones(game.scenes.get(scene.id))));
  zoneTimers.set(scene.id, setTimeout(() => zoneQueues.get(scene.id)(), 300));
};

/* ---------- marks ---------- */

async function markTokens(msg, user) {
  const caster = fromUuidSync(msg.mark?.sourceUuid);
  const scene = game.scenes.get(msg.sceneId);
  if (!scene || !userOwns(user, caster)) return;
  const updates = (msg.tokenIds ?? [])
    .map((id) => scene.tokens.get(id))
    .filter(Boolean)
    .map((t) => ({ _id: t.id, [`flags.${MODULE_ID}.marks`]: [...(t.getFlag(MODULE_ID, "marks") ?? []), msg.mark] }));
  if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
}

async function clearMarks(msg, user) {
  const caster = fromUuidSync(msg.sourceUuid);
  if (!userOwns(user, caster)) return;
  for (const scene of game.scenes) {
    const updates = [];
    for (const t of scene.tokens) {
      const marks = t.getFlag(MODULE_ID, "marks") ?? [];
      const kept = marks.filter((m) => m.sourceUuid !== msg.sourceUuid);
      if (kept.length !== marks.length) updates.push({ _id: t.id, [`flags.${MODULE_ID}.marks`]: kept });
    }
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/** Marks this actor has placed on tokens in the viewed scene */
export const marksPlacedBy = (actor) => {
  const scene = canvas?.scene;
  if (!scene) return [];
  return scene.tokens.contents.flatMap((t) =>
    (t.getFlag(MODULE_ID, "marks") ?? []).filter((m) => m.sourceUuid === actor.uuid).map((m) => ({ ...m, token: t.name })),
  );
};

/* ---------- action use ---------- */

function onPreActionUse(au) {
  const actor = au.actor;
  const item = au.item;
  const action = au.shared?.action ?? au.action;
  if (!actor || !item || !action) return;
  const notes = (au.shared.templateData ??= {}).footnotes ??= [];

  // Mark reminders: on attacks against a creature you marked, and on a marked creature's attacks against you
  const targets = au.shared.targets ?? [];
  for (const t of targets) {
    for (const m of t.document?.getFlag(MODULE_ID, "marks") ?? []) {
      if (m.sourceUuid === actor.uuid && m.attackerNote) notes.push({ text: `${m.label} (${t.name}): ${m.attackerNote}` });
    }
  }
  const attacker = au.token?.document ?? au.token ?? actor.getActiveTokens?.(false, true)?.[0];
  for (const m of attacker?.getFlag?.(MODULE_ID, "marks") ?? []) {
    if (m.defenderNote && targets.some((t) => t.actor?.uuid === m.sourceUuid)) notes.push({ text: `${m.label}: ${m.defenderNote}` });
  }

  const auto = getAutomation(item, action.id);
  if (!hasAutomation(auto)) return;
  const sp = totalSpCost(evalFormula(auto.sp, au.shared.rollData), auto.condSp, au.shared.conditionals ?? []);
  const pool = actor.system.spheres?.spellPoints?.value ?? 0;
  if (sp > pool) {
    ui.notifications.warn(fmt("NotEnoughSP", { cost: sp, value: pool }));
    return false;
  }
  const focus = actor.flags?.[MODULE_ID]?.martialFocus === true;
  if ((auto.focus === "require" || auto.focus === "expend") && !focus) {
    ui.notifications.warn(loc("NeedFocus"));
    return false;
  }
  au.shared.pf1spheres = { sp, focus: auto.focus ?? "", auto };
  if (sp) notes.push({ text: fmt("SpentSP", { cost: sp }) });
  if (auto.focus === "expend") notes.push({ text: loc("ExpendsFocus") });
  if (auto.focus === "restore") notes.push({ text: loc("RestoresFocus") });
}

async function onPostActionUse(au) {
  const state = au.shared?.pf1spheres;
  if (!state) return;
  const { auto } = state;
  const actor = au.actor;
  const item = au.item;
  const action = au.shared.action ?? au.action;
  const rd = au.shared.rollData ?? actor.getRollData();
  await spendResources(actor, { sp: state.sp, focus: state.focus });

  const wantsEffect = auto.effect?.enabled || auto.buff?.itemId || auto.zone?.enabled || auto.mark?.label;
  if (!wantsEffect) return;
  const durationValue = Math.max(0, evalFormula(auto.effect?.duration, rd));
  const units = auto.effect?.units ?? "round";
  const persistSeconds = durationSeconds(durationValue, units);
  const concentration = auto.effect?.enabled ? auto.effect.concentration === true : false;
  const effect: TrackedEffect = {
    id: foundry.utils.randomID(),
    name: action.name && action.name !== item.name ? `${item.name}: ${action.name}` : item.name,
    img: item.img,
    itemUuid: item.uuid,
    actionId: action.id,
    startTime: game.time.worldTime,
    combatId: game.combat?.started ? game.combat.id : null,
    round: game.combat?.round ?? 0,
    units,
    durationValue: concentration ? 0 : durationValue,
    seconds: concentration ? null : persistSeconds,
    persistValue: durationValue,
    persistSeconds,
    concentration,
  };
  await setEffects(actor, [...getEffects(actor), effect]);

  const sphere = auto.buff?.sphere || item.flags?.[MODULE_ID]?.sphere;
  const level = auto.buff?.level?.trim()
    ? Math.max(1, evalFormula(auto.buff.level, rd))
    : Math.max(1, (sphere ? rd.spheres?.cl?.[sphere]?.total : null) ?? rd.spheres?.cl?.total ?? 1);
  const buff = auto.buff?.itemId ? actor.items.get(auto.buff.itemId) : null;
  const token = attackerDoc(au, actor);
  const targets = au.shared.targets ?? [];

  if (auto.zone?.enabled && token) {
    await requestGM({
      action: "auto.zone",
      sceneId: token.parent.id,
      zoneId: foundry.utils.randomID(),
      name: effect.name,
      center: tokenCenter(token),
      radius: Math.max(5, evalFormula(auto.zone.radius, rd)),
      who: auto.zone.who ?? "allies",
      casterDisposition: token.disposition,
      casterUuid: actor.uuid,
      buffUuid: buff?.uuid ?? null,
      level,
      effectId: effect.id,
    });
  } else if (buff) {
    const uuids = targets.map((t) => t.actor?.uuid).filter(Boolean);
    if (auto.buff.self || !uuids.length) uuids.push(actor.uuid);
    await requestGM({
      action: "auto.buff",
      casterUuid: actor.uuid,
      buffUuid: buff.uuid,
      level,
      targetUuids: [...new Set(uuids)],
      effectId: effect.id,
    });
  }

  if (auto.mark?.label && targets.length && token) {
    const evaluate = (f) => evalFormula(f, rd);
    await requestGM({
      action: "auto.mark",
      sceneId: token.parent.id,
      tokenIds: targets.map((t) => t.id),
      mark: {
        id: foundry.utils.randomID(),
        label: auto.mark.label,
        attackerNote: fillNote(auto.mark.attackerNote ?? "", evaluate),
        defenderNote: fillNote(auto.mark.defenderNote ?? "", evaluate),
        sourceUuid: actor.uuid,
        sourceName: actor.name,
        effectId: effect.id,
      },
    });
  }
}

const attackerDoc = (au, actor) => au.token?.document ?? au.token ?? actor.getActiveTokens?.(false, true)?.[0] ?? null;

/* ---------- time: expiry, turn prompts, sequences, formulae ---------- */

async function sweep() {
  if (!isGMWriter()) return;
  const now = game.time.worldTime;
  for (const actor of allActors()) {
    for (const e of getEffects(actor)) {
      if (effectRemaining(e) === 0) {
        await cleanupEffect({ casterUuid: actor.uuid, effectId: e.id }, game.user);
        await setEffects(actor, getEffects(actor).filter((x) => x.id !== e.id));
        await ChatMessage.create({
          whisper: game.users.filter((u) => actor.testUserPermission(u, "OWNER")).map((u) => u.id),
          speaker: ChatMessage.getSpeaker({ actor }),
          content: `<p>${fmt("Expired", { name: e.name })}</p>`,
        });
      }
    }
    const stale = actor.items.filter((i) => (i.flags?.[MODULE_ID]?.formulaeExpires ?? Infinity) <= now).map((i) => i.id);
    if (stale.length) await actor.deleteEmbeddedDocuments("Item", stale);
  }
}

/** Sweeps run one at a time: a round change fires both the combat and world-time hooks */
const queueSweep = serialised(sweep);

async function onTurnStart(combat) {
  if (!isGMWriter()) return;
  const actor = combat.combatant?.actor;
  if (!actor) return;
  const owners = game.users.filter((u) => actor.testUserPermission(u, "OWNER")).map((u) => u.id);
  const conc = getEffects(actor).filter((e) => e.concentration);
  if (conc.length) {
    const easy = actor.items.some((i) => i.name === "Easy Focus");
    await ChatMessage.create({
      whisper: owners,
      speaker: ChatMessage.getSpeaker({ actor }),
      content:
        `<p><strong>${loc("Concentration")}</strong>: ${conc.map((e) => e.name).join(", ")}</p>` +
        `<p>${loc(easy ? "ConcentrationEasy" : "ConcentrationHint")}</p>`,
    });
  }
  const seq = actor.flags?.[MODULE_ID]?.sequence;
  if (seq?.length > 0) {
    const next = sequenceTurnStart(seq);
    await actor.update({ [`flags.${MODULE_ID}.sequence`]: next });
    if (next.length < seq.length) {
      await ChatMessage.create({
        whisper: owners,
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<p>${fmt(next.length ? "SequenceLost" : "SequenceEnded", { length: next.length })}</p>`,
      });
    }
  }
}

/* ---------- prodigy sequences ---------- */

export const getSequence = (actor): SequenceState => ({
  length: 0,
  linked: false,
  imbue: "",
  ...(actor?.flags?.[MODULE_ID]?.sequence ?? {}),
});

export const prodigyLevel = (actor) => actor?.classes?.prodigy?.level ?? 0;

export const changeSequence = async (actor, n: number) => {
  const next = addLinks(getSequence(actor), n, sequenceMax(prodigyLevel(actor)));
  await actor.update({ [`flags.${MODULE_ID}.sequence`]: next });
};

export const endSequence = (actor) => actor.update({ [`flags.${MODULE_ID}.sequence`]: { length: 0, linked: false, imbue: "" } });

export const setImbue = (actor, imbue: string) => actor.update({ [`flags.${MODULE_ID}.sequence.imbue`]: imbue });

/** Dazed, stunned, unconscious and the like end a sequence, unless Unbroken Sequence is holding it */
function onConditionAdded(effect) {
  if (!isGMWriter()) return;
  const actor = effect.parent;
  if (!(actor instanceof Actor)) return;
  const statuses = [...(effect.statuses ?? [])];
  if (!statuses.some((s) => SEQUENCE_BREAKERS.includes(s))) return;
  const seq = getSequence(actor);
  if (seq.length <= 0 || actor.flags?.[MODULE_ID]?.sequenceUnbroken) return;
  endSequence(actor);
}

/* ---------- registration ---------- */

export const registerAutomation = () => {
  registerSocketHandler("auto.cleanup", cleanupEffect);
  registerSocketHandler("auto.buff", applyBuff);
  registerSocketHandler("auto.zone", async (msg, user) => {
    await createZone(msg, user);
    queueZones(game.scenes.get(msg.sceneId));
  });
  registerSocketHandler("auto.mark", markTokens);
  registerSocketHandler("auto.clearMarks", clearMarks);

  Hooks.on("pf1PreActionUse", onPreActionUse);
  Hooks.on("pf1PostActionUse", (au) => {
    onPostActionUse(au).catch((err) => console.error(`${MODULE_ID} | action automation`, err));
  });
  Hooks.on("pf1GetRollData", (doc, result) => {
    if (!(doc instanceof Actor)) return;
    const seq = getSequence(doc);
    result.spheres ??= {};
    result.spheres.sequence = { length: seq.length, active: seq.length > 0 ? 1 : 0, max: sequenceMax(prodigyLevel(doc)) };
  });
  Hooks.on("updateWorldTime", () => queueSweep());
  Hooks.on("updateCombat", (combat, changed) => {
    if (!("turn" in changed || "round" in changed)) return;
    queueSweep();
    onTurnStart(combat).catch((err) => console.error(`${MODULE_ID} | turn start`, err));
  });
  Hooks.on("createActiveEffect", onConditionAdded);
  Hooks.on("createToken", (t) => queueZones(t.parent));
  Hooks.on("deleteToken", (t) => queueZones(t.parent));
  Hooks.on("updateToken", (t, changed) => {
    if ("x" in changed || "y" in changed || "disposition" in changed) queueZones(t.parent);
  });
  Hooks.on("updateScene", (scene, changed) => {
    if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.zones`)) queueZones(scene);
  });
};

export const clearMyMarks = (actor) => requestGM({ action: "auto.clearMarks", sourceUuid: actor.uuid });
