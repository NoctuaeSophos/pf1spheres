/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 ApplicationV2 is not covered by the bundled v9 types.
// @ts-nocheck

/**
 * NOT ONLY SPHERES CONTENT. A tracker for controlled undead, by Hit Dice pool: the Death sphere's
 * reanimate, the animate dead spell and Command Undead. Like the Leadership tracker it lives in
 * pf1spheres for now and should move to the krune-table module or a separate pf1 supplement module.
 */

import { MODULE_ID, localize } from "../util";
import { minionHD, readMinions, undeadPools } from "./undead-logic";

const loc = (k: string) => localize(`Undead.${k}`);
const FLAG = "undead";
const CHANNEL_CLASSES = ["cleric", "oracle", "warpriest", "antipaladin", "necromancer"];

/** The actor's pool sources: Death sphere, animate dead in a spellbook, Command Undead */
const sources = (a) => {
  // Necromantic Limit taken as "no reanimate" (Ghastly Powers flags it) leaves no reanimate pool
  const hasDeath =
    a.items.some((i) => i.name === "Death Sphere") &&
    !a.items.some((i) => i.flags?.[MODULE_ID]?.noReanimate);
  // Temporary caster level boosts (buffs such as Draw Magic) don't raise the limit
  const temp = [...(a.changes ?? [])]
    .filter((c) => c.parent?.type === "buff" && ["spherecl", "sphereclDeath"].includes(c.target))
    .reduce((sum, c) => sum + (Number(c.value) || 0), 0);
  const books = a.system.attributes?.spells?.spellbooks ?? {};
  const animate = a.items
    .filter((i) => i.type === "spell" && /^animate dead$/i.test(i.name))
    .map((i) => Number(books[i.system.spellbook]?.cl?.total) || 0);
  const command = a.items.some((i) => i.type === "feat" && /^command undead$/i.test(i.name));
  const channel = Math.max(0, ...CHANNEL_CLASSES.map((t) => a.classes?.[t]?.level ?? 0));
  return {
    deathCL: hasDeath ? (a.system.spheres?.cl?.death?.total ?? 0) - temp : null,
    greaterReanimate: a.items.filter((i) => i.name === "Greater Reanimate").length,
    animateDeadCL: animate.length ? Math.max(...animate) : null,
    commandUndeadLevel: command ? channel || (a.system.details?.level?.value ?? 0) : null,
  };
};

/** True if the actor controls undead or can */
export const hasUndeadPools = (actor) =>
  !!actor &&
  (undeadPools(sources(actor)).length > 0 ||
    readMinions(actor.getFlag(MODULE_ID, FLAG)).minions.length > 0);

export class UndeadApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["pf1spheres", "pf1spheres-undead"],
    window: { title: "PF1SPHERES.Undead.Title", icon: "fas fa-skull", resizable: true },
    position: { width: 480, height: "auto" },
    form: { handler: UndeadApp.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: {
      addTargets: UndeadApp.#addTargets,
      remove: UndeadApp.#remove,
      open: UndeadApp.#open,
    },
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/apps/undead.hbs` } };

  actor = null;

  get title() {
    return `${loc("Title")}: ${this.actor?.name ?? ""}`;
  }

  get stored() {
    return readMinions(this.actor.getFlag(MODULE_ID, FLAG));
  }

  async save(data) {
    await this.actor.setFlag(MODULE_ID, FLAG, data);
    this.render();
  }

  async _prepareContext() {
    const { minions, bonus, notes } = this.stored;
    const pools = undeadPools(sources(this.actor));
    // A pool the actor no longer has still shows while undead are listed in it
    for (const m of minions)
      if (!pools.some((p) => p.key === m.pool)) pools.push({ key: m.pool, limit: 0 });
    return {
      pools: pools.map((p) => {
        const list = minions
          .map((m, index) => ({ m, index }))
          .filter(({ m }) => m.pool === p.key)
          .map(({ m, index }) => {
            const doc = fromUuidSync(m.uuid);
            const hd = Number(doc?.system?.attributes?.hd?.total) || 0;
            return {
              index,
              name: doc?.name ?? loc("Missing"),
              missing: !doc,
              hd,
              counted: minionHD(hd, m.half),
              half: !!m.half,
            };
          });
        const limit = p.limit + (Number(bonus[p.key]) || 0);
        const used = list.reduce((s, x) => s + x.counted, 0);
        return {
          key: p.key,
          label: loc(`Pool.${p.key}`),
          hint: loc(`PoolHint.${p.key}`),
          base: p.limit,
          bonus: Number(bonus[p.key]) || 0,
          limit,
          used,
          over: used > limit,
          canHalve: p.key === "reanimate",
          minions: list,
        };
      }),
      notes,
      editable: this.actor.isOwner,
    };
  }

  static async #onChange(_event, _form, formData) {
    if (!this.actor.isOwner) return;
    const d = foundry.utils.expandObject(formData.object);
    const s = this.stored;
    s.minions = s.minions.map((m, i) => ({ ...m, half: !!d.half?.[i] }));
    s.bonus = Object.fromEntries(
      Object.entries(d.bonus ?? {}).map(([k, v]) => [k, Number(v) || 0]),
    );
    s.notes = d.notes ?? "";
    await this.save(s);
  }

  /** Adds the user's targeted tokens to a pool (moving them from another pool if listed there) */
  static async #addTargets(_event, target) {
    const pool = target.dataset.pool;
    const uuids = [...game.user.targets]
      .map((t) => t.actor?.uuid)
      .filter((u) => u && u !== this.actor.uuid);
    if (!uuids.length) return ui.notifications.warn(loc("NoTargets"));
    const s = this.stored;
    s.minions = [
      ...s.minions.filter((m) => !uuids.includes(m.uuid)),
      ...uuids.map((uuid) => ({ uuid, pool })),
    ];
    await this.save(s);
  }

  static async #remove(_event, target) {
    const s = this.stored;
    s.minions.splice(Number(target.dataset.index), 1);
    await this.save(s);
  }

  static #open(_event, target) {
    fromUuidSync(this.stored.minions[Number(target.dataset.index)]?.uuid)?.sheet?.render(true);
  }
}

/**
 * Opens an actor's undead tracker.
 *
 * @param actor - The necromancer
 */
export const openUndead = (actor) => {
  const id = `pf1spheres-undead-${actor.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) return existing.render({ force: true });
  const app = new UndeadApp({ id });
  app.actor = actor;
  return app.render({ force: true });
};
