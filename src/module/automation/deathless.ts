/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry/pf1 globals are untyped in this project (as in runtime.ts); the pure logic is typed in deathless-logic.ts
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
/**
 * Deathless (Spheres of Might, Berserker talent): "As long as you have martial focus, the number of hit points you can
 * be reduced to below 0 without dying is doubled and you may choose to act as if you were disabled, rather than dying.
 * You must make this decision as soon as you are reduced to negative hit points ... If you do not choose to act as if
 * you were disabled, you immediately fall unconscious." While using it you are staggered, and a standard (or other
 * strenuous) action costs 1 HP.
 *
 * - Acting is the default choice. On the drop below 0 with martial focus the actor stays conscious, staggered and
 *   stable (stable stops Nevela's turn-start Con roll: disabled, not dying), and a whispered card offers "Fall
 *   unconscious instead" and reminds of the HP cost (not automated).
 * - While acting, requests to set unconscious or dying, or to clear staggered, are dropped, and so is a prone sent
 *   within a few seconds of an HP change or a dropped knock-out (Nevela sends them as separate calls).
 * - Losing martial focus (or disabling the talent) below 0 ends it and applies unconscious, prone and dying (Krune's
 *   Hard to Kill turns that dying into stable). Regaining focus later doesn't bring the actor back.
 * - Death threshold: deathless-logic.ts DEATH_MULTIPLIER. Dead is refused above it, also when Krune forces it (Krune
 *   kills at -2 x Con for Hard to Kill; with Deathless the threshold is -3 x Con), and Krune's then-wrong "dead at" and
 *   "dies at" notes for that actor are dropped. Without Krune we mark dead at the threshold ourselves.
 * - Actors without Deathless pass straight through: nothing changes for them, with or without Krune.
 *
 * Krune and pf1spheres both wrap ActorPF#setConditions (libWrapper WRAPPER). Each wrapper only removes keys, so the
 * order between them doesn't matter. Our own writes carry { pf1spheres: { force: true } } and skip our filter.
 */
import { MODULE_ID } from "../util";
import { isGMWriter } from "../socket";
import {
  type ActorDeathContext,
  type DeathlessState,
  DEATH_MULTIPLIER,
  deathThreshold,
  fallDownChanges,
  filterConditions,
  hasDeathlessItem,
  hasHardToKillItem,
  nextStep,
} from "./deathless-logic";

const FORCE = { [MODULE_ID]: { force: true } };
const NOTE_WINDOW_MS = 3000;
const fmt = (key: string, data = {}) => game.i18n.format(`PF1SPHERES.Auto.${key}`, data);
const loc = (key: string) => game.i18n.localize(`PF1SPHERES.Auto.${key}`);

const usesWoundsAndVigor = (actor) => {
  try {
    return !!game.settings.get("pf1", "healthConfig")?.getActorConfig?.(actor)?.rules?.useWoundsAndVigor;
  } catch {
    return false;
  }
};

const state = (actor): DeathlessState | null => actor?.flags?.[MODULE_ID]?.deathless ?? null;

const context = (actor): ActorDeathContext | null => {
  const hp = actor?.system?.attributes?.hp;
  if (!hp || usesWoundsAndVigor(actor)) return null;
  const items = actor.items ?? [];
  return {
    hp: Number(hp.value),
    deathlessReady: hasDeathlessItem(items) && actor.flags?.[MODULE_ID]?.martialFocus === true,
    htk: hasHardToKillItem(items),
    con: Number(actor.system?.abilities?.con?.total ?? 10) || 0,
    state: state(actor),
  };
};

const limitOf = (c: ActorDeathContext) => deathThreshold(c.con, c.htk, c.deathlessReady);

const owners = (actor) => game.users.filter((u) => u.isGM || actor.testUserPermission(u, "OWNER")).map((u) => u.id);
const note = (actor, html) =>
  ChatMessage.create({
    whisper: owners(actor),
    speaker: ChatMessage.getSpeaker({ actor }),
    content: html,
  });

/* ---------- condition filter ---------- */

const knockedOutAt = new WeakMap<object, number>();
/** Actor id -> time we last refused a dead that Krune forced (its "dead at -2 x Con" note follows) */
const kruneDeadRefused = new Map<string, number>();

function filter(wrapped, changes = {}, opts = {}) {
  try {
    if (!opts?.[MODULE_ID]?.force && changes && typeof changes === "object") {
      const c = context(this);
      if (c && c.hp < 0 && (c.deathlessReady || c.state)) {
        const since = Date.now() - (knockedOutAt.get(this) ?? 0);
        const r = filterConditions(changes, c, since);
        if (r.knockedOut) knockedOutAt.set(this, Date.now());
        if (r.refusedDead && opts?.["krune-table"]?.force) kruneDeadRefused.set(this.id, Date.now());
        changes = r.changes;
      }
    }
  } catch (err) {
    console.error(`${MODULE_ID} | Deathless condition filter`, err);
  }
  return wrapped(changes, opts);
}

function installFilter() {
  const target = "pf1.documents.actor.ActorPF.prototype.setConditions";
  if (game.modules.get("lib-wrapper")?.active && globalThis.libWrapper) {
    libWrapper.register(
      MODULE_ID,
      target,
      function (wrapped, ...args) {
        return filter.call(this, wrapped, ...args);
      },
      libWrapper.WRAPPER,
    );
    return;
  }
  const proto = pf1.documents.actor.ActorPF.prototype;
  const original = proto.setConditions;
  proto.setConditions = function (...args) {
    return filter.call(this, original.bind(this), ...args);
  };
}

/* ---------- Krune notes that would be wrong for a Deathless actor ---------- */

function dropWrongKruneNote(message, data) {
  const content = String(data?.content ?? message?.content ?? "");
  if (!content.includes("krune-note")) return true;
  const actor = game.actors.get(data?.speaker?.actor ?? message?.speaker?.actor);
  if (!actor) return true;
  const c = context(actor);
  if (!c?.deathlessReady || !c.htk) return true;
  const name = foundry.utils.escapeHTML(String(actor.name ?? ""));
  const kruneLimit = -DEATH_MULTIPLIER.hardToKill * c.con;
  const wrong = (key) => content.includes(game.i18n.format(key, { name, limit: kruneLimit }));
  if (wrong("KRUNE.HTK.Dead") && Date.now() - (kruneDeadRefused.get(actor.id) ?? 0) < NOTE_WINDOW_MS) return false;
  if (wrong("KRUNE.HTK.Stable")) return false;
  return true;
}

/* ---------- GM side: the drop, focus loss, recovery, death ---------- */

async function fallDown(actor) {
  const c = context(actor);
  const { undo, apply } = fallDownChanges(state(actor), actor.statuses, !!c?.htk);
  if (Object.keys(undo).length) await actor.setConditions(undo, FORCE);
  // Not forced: Krune's Hard to Kill still turns dying into stable
  await actor.setConditions(apply);
}

async function onActorChange(actor) {
  const c = context(actor);
  if (!c) return;
  const st = actor.statuses;
  const step = nextStep(c, st);
  switch (step.kind) {
    case "clear":
      if (step.removeStaggered) await actor.setConditions({ staggered: false }, FORCE);
      await actor.unsetFlag(MODULE_ID, "deathless");
      return;
    case "startNone":
      await actor.setFlag(MODULE_ID, "deathless", { mode: "none" });
      break;
    case "startFight":
      await actor.setFlag(MODULE_ID, "deathless", step.state);
      if (Object.keys(step.fix).length) await actor.setConditions(step.fix, FORCE);
      await note(
        actor,
        `<p>${fmt("DeathlessActing", { name: foundry.utils.escapeHTML(actor.name), limit: limitOf(c) })}</p>` +
          `<button type="button" data-pf1s-deathless-down="${actor.uuid}">${loc("DeathlessFallUnconscious")}</button>`,
      );
      return;
    case "focusLost":
      await actor.setFlag(MODULE_ID, "deathless", { ...c.state, mode: "spent" });
      await fallDown(actor);
      await note(actor, `<p>${fmt("DeathlessFocusLost", { name: foundry.utils.escapeHTML(actor.name) })}</p>`);
      return;
  }
  // Death at the extended threshold (Krune applies its own -2 x Con; without Krune nobody else would)
  const now = context(actor);
  const limit = now ? limitOf(now) : null;
  if (now?.deathlessReady && limit !== null && now.hp <= limit && !st.has("dead")) {
    const s = state(actor);
    const off = s?.staggered && st.has("staggered") ? { staggered: false } : {};
    await actor.setConditions({ ...off, dead: { overlay: true }, unconscious: true, prone: true }, FORCE);
    await actor.setFlag(MODULE_ID, "deathless", { ...(s ?? {}), mode: "spent" });
    await note(actor, `<p>${fmt("DeathlessDead", { name: foundry.utils.escapeHTML(actor.name), limit })}</p>`);
  }
}

function onUpdateActor(actor, changed) {
  // Every client: start the prone window on any HP change (Nevela's prone follows as a separate call)
  if (foundry.utils.hasProperty(changed, "system.attributes.hp")) knockedOutAt.set(actor, Date.now());
  if (!isGMWriter()) return;
  const touched =
    foundry.utils.hasProperty(changed, "system.attributes.hp") ||
    foundry.utils.hasProperty(changed, "system.abilities.con") ||
    foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.martialFocus`);
  if (!touched) return;
  if (!hasDeathlessItem(actor.items ?? []) && !state(actor)) return;
  onActorChange(actor).catch((err) => console.error(`${MODULE_ID} | Deathless`, err));
}

/* ---------- "Fall unconscious instead" ---------- */

function onRenderChatMessage(message, html) {
  const root = html instanceof HTMLElement ? html : html?.[0];
  for (const button of root?.querySelectorAll?.("[data-pf1s-deathless-down]") ?? []) {
    const actor = fromUuidSync(button.dataset.pf1sDeathlessDown);
    if (!actor?.isOwner) {
      button.remove();
      continue;
    }
    if (state(actor)?.mode !== "fight") button.disabled = true;
    button.addEventListener("click", async () => {
      button.disabled = true;
      const s = state(actor);
      if (s?.mode !== "fight" || !(actor.system.attributes.hp.value < 0)) {
        ui.notifications.info(fmt("DeathlessNotActing", { name: actor.name }));
        return;
      }
      await actor.setFlag(MODULE_ID, "deathless", { ...s, mode: "down" });
      await fallDown(actor);
      await note(actor, `<p>${fmt("DeathlessDown", { name: foundry.utils.escapeHTML(actor.name) })}</p>`);
    });
  }
}

export function registerDeathless() {
  installFilter();
  Hooks.on("updateActor", onUpdateActor);
  Hooks.on("renderChatMessageHTML", onRenderChatMessage);
  Hooks.on("preCreateChatMessage", dropWrongKruneNote);
}
