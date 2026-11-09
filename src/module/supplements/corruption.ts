/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 ApplicationV2 is not covered by the bundled v9 types.
// @ts-nocheck

/**
 * NOT SPHERES CONTENT. A tracker for Horror Adventures corruptions, starting with Possessed: the
 * spirit's influence, the manifestation level, the corruption's stage and the day's Will saves. Like
 * the Leadership tracker it lives in pf1spheres for now and should move to another module.
 */

import { MODULE_ID, localize } from "../util";
import {
  POSSESSED_MAX_INFLUENCE,
  POSSESSED_TRIGGERS,
  addInfluence,
  afterSave,
  defaultCorruption,
  possessedSaveDC,
  sunrise,
} from "./corruption-logic";

const loc = (k: string) => localize(`Corruption.${k}`);
const fmt = (k: string, data = {}) => game.i18n.format(`PF1SPHERES.Corruption.${k}`, data);
const STATE = "corruptionState";

/** The actor's corruption item (flagged pf1spheres.corruption, e.g. "possessed") */
export const corruptionItem = (actor) =>
  actor?.items?.find((i) => i.flags?.[MODULE_ID]?.corruption) ?? null;

const stateOf = (item) => ({ ...defaultCorruption(), ...(item.getFlag(MODULE_ID, STATE) ?? {}) });

/** Whispers a line to the actor's owners and the GMs */
const tell = (actor, text) =>
  ChatMessage.create({
    content: `<p>${foundry.utils.escapeHTML(text)}</p>`,
    speaker: ChatMessage.getSpeaker({ actor }),
    whisper: game.users
      .filter((u) => u.isGM || actor.testUserPermission(u, "OWNER"))
      .map((u) => u.id),
  }).catch(() => {});

/** The spirit gains influence; at 5 the owner is told the Will save's DC */
const feed = async (actor, reason) => {
  const item = corruptionItem(actor);
  if (!item || item.flags[MODULE_ID].corruption !== "possessed") return;
  const before = stateOf(item);
  const next = addInfluence(before);
  if (next.influence === before.influence) return;
  await item.setFlag(MODULE_ID, STATE, next);
  tell(actor, fmt("Fed", { name: actor.name, reason, influence: next.influence }));
  if (next.influence >= POSSESSED_MAX_INFLUENCE)
    tell(actor, fmt("SaveDue", { name: actor.name, dc: possessedSaveDC(next) }));
};

export class CorruptionApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["pf1spheres", "pf1spheres-corruption"],
    window: { title: "PF1SPHERES.Corruption.Title", icon: "fas fa-ghost", resizable: true },
    position: { width: 420, height: "auto" },
    form: { handler: CorruptionApp.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: {
      more: CorruptionApp.#more,
      less: CorruptionApp.#less,
      rollSave: CorruptionApp.#rollSave,
      sunrise: CorruptionApp.#sunrise,
    },
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/apps/corruption.hbs` } };

  actor = null;

  get title() {
    return `${corruptionItem(this.actor)?.name ?? loc("Title")}: ${this.actor?.name ?? ""}`;
  }

  get item() {
    return corruptionItem(this.actor);
  }

  async setState(s) {
    await this.item.setFlag(MODULE_ID, STATE, s);
    this.render();
  }

  async _prepareContext() {
    const item = this.item;
    const s = stateOf(item);
    return {
      name: item?.name,
      s,
      max: POSSESSED_MAX_INFLUENCE,
      pips: Array.from({ length: POSSESSED_MAX_INFLUENCE }, (_, i) => i < s.influence),
      dc: possessedSaveDC(s),
      full: s.influence >= POSSESSED_MAX_INFLUENCE,
      stages: [0, 1, 2, 3].map((n) => ({ n, label: loc(`Stage${n}`), selected: n === s.stage })),
      manifestations: this.actor.items
        .filter((i) => (i.system.tags ?? []).includes("Corruption Manifestation"))
        .map((i) => i.name),
      triggers: POSSESSED_TRIGGERS.map((id) => pf1.registry.conditions.get(id)?.name ?? id).join(
        ", ",
      ),
      notes: item?.getFlag(MODULE_ID, "corruptionNotes") ?? "",
      editable: this.actor.isOwner,
    };
  }

  static async #onChange(_event, _form, formData) {
    if (!this.actor.isOwner) return;
    const d = foundry.utils.expandObject(formData.object);
    const s = stateOf(this.item);
    s.manifestationLevel = Math.max(0, Number(d.manifestationLevel) || 0);
    s.stage = Math.min(3, Math.max(0, Number(d.stage) || 0));
    s.attempts = Math.max(0, Number(d.attempts) || 0);
    await this.item.setFlag(MODULE_ID, "corruptionNotes", d.notes ?? "");
    await this.setState(s);
  }

  static async #more() {
    await this.setState(addInfluence(stateOf(this.item), 1));
  }

  static async #less() {
    await this.setState(addInfluence(stateOf(this.item), -1));
  }

  static async #sunrise() {
    await this.setState(sunrise(stateOf(this.item)));
  }

  /** Rolls the Will save against the spirit; a failure advances the corruption a stage */
  static async #rollSave() {
    const s = stateOf(this.item);
    const dc = possessedSaveDC(s);
    const result = await this.actor.rollSavingThrow("will", { dc, reference: null });
    const roll = result?.rolls?.[0] ?? result;
    if (!Number.isFinite(roll?.total)) return;
    const failed = roll.total < dc;
    const next = afterSave(s, failed);
    await this.setState(next);
    tell(
      this.actor,
      fmt(failed ? "SaveFailed" : "SaveMade", {
        name: this.actor.name,
        stage: loc(`Stage${next.stage}`),
      }),
    );
  }
}

/**
 * Opens an actor's corruption tracker.
 *
 * @param actor - The corrupted character
 */
export const openCorruption = (actor) => {
  const id = `pf1spheres-corruption-${actor.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) return existing.render({ force: true });
  const app = new CorruptionApp({ id });
  app.actor = actor;
  return app.render({ force: true });
};

/** The spirit feeds when its host rests or gains one of the listed conditions */
export const registerCorruption = () => {
  // @corruption.manifestationLevel and the rest, for manifestations that grow with it (Unrestrained)
  Hooks.on("pf1GetRollData", (doc, result) => {
    if (!(doc instanceof Actor)) return;
    const item = corruptionItem(doc);
    if (item) result.corruption = stateOf(item);
  });
  Hooks.on("pf1ActorRest", (actor) => {
    if (actor?.isOwner) feed(actor, loc("ReasonRest")).catch(() => {});
  });
  Hooks.on("createActiveEffect", (effect, _options, userId) => {
    if (userId !== game.user.id) return;
    const actor = effect.parent;
    const hit = POSSESSED_TRIGGERS.find((id) => effect.statuses?.has?.(id));
    if (actor instanceof Actor && hit)
      feed(actor, pf1.registry.conditions.get(hit)?.name ?? hit).catch(() => {});
  });
};
