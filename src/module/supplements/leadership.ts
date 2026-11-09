/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 ApplicationV2 is not covered by the bundled v9 types.
// @ts-nocheck

/**
 * NOT SPHERES CONTENT. A tracker for the core Leadership feat: score, cohort and followers. It lives in
 * pf1spheres for now and should move to the krune-table module or a separate pf1 supplement module.
 */

import { MODULE_ID, localize } from "../util";
import {
  LEADERSHIP_MODIFIERS,
  cohortMaxLevel,
  followersAllowed,
  leadershipScores,
  mythicFollowers,
} from "./leadership-logic";

const loc = (k: string) => localize(`Leadership.${k}`);
const FLAG = "leadership";

/** True if the actor has the Leadership feat */
export const hasLeadership = (actor) =>
  actor?.items?.some((i) => i.type === "feat" && i.name === "Leadership");

export class LeadershipApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["pf1spheres", "pf1spheres-leadership"],
    window: { title: "PF1SPHERES.Leadership.Title", icon: "fas fa-flag", resizable: true },
    position: { width: 520, height: "auto" },
    form: { handler: LeadershipApp.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: { openCohort: LeadershipApp.#openCohort },
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/apps/leadership.hbs` } };

  actor = null;

  get title() {
    return `${loc("Title")}: ${this.actor?.name ?? ""}`;
  }

  async _prepareContext() {
    const a = this.actor;
    const data = a.getFlag(MODULE_ID, FLAG) ?? {};
    const mythic = a.items.some((i) => i.name === "Leadership (Mythic)");
    const tier = a.system.details?.mythicTier ?? 0;
    const level = a.system.details?.level?.value ?? 0;
    const input = {
      level,
      chaMod: a.system.abilities?.cha?.mod ?? 0,
      mythicTier: mythic ? tier : 0,
      active: data.active ?? {},
      misc: Number(data.misc) || 0,
    };
    const scores = leadershipScores(input);
    const cohort = data.cohortUuid ? fromUuidSync(data.cohortUuid) : null;
    const allowed = followersAllowed(scores.followers);
    return {
      input,
      mythic,
      scores,
      modifiers: LEADERSHIP_MODIFIERS.map((m) => ({
        ...m,
        label: loc(`Mod.${m.key}`),
        checked: !!input.active[m.key],
        sign: m.value > 0 ? `+${m.value}` : `${m.value}`,
      })),
      cohortMax: cohortMaxLevel(scores.cohort, level),
      cohortTier: mythic ? Math.floor(tier / 2) : 0,
      cohort: cohort
        ? { name: cohort.name, level: cohort.system?.details?.level?.value ?? 0, uuid: cohort.uuid }
        : null,
      cohortOptions: game.actors
        .filter(
          (x) =>
            x !== a &&
            x.testUserPermission(game.user, "OBSERVER") &&
            ["character", "npc"].includes(x.type),
        )
        .map((x) => ({ uuid: x.uuid, name: x.name, selected: x.uuid === data.cohortUuid }))
        .sort((x, y) => x.name.localeCompare(y.name)),
      followers: (() => {
        const have = allowed.map((_, i) => Number(data.followers?.[i + 1]?.count) || 0);
        // Leadership (Mythic) at tier 5+: the ten highest-level followers, from those recorded (or allowed)
        const mythicCounts =
          mythic && tier >= 5 ? mythicFollowers(have.some((n) => n > 0) ? have : allowed) : null;
        return allowed.map((n, i) => ({
          level: i + 1,
          allowed: n,
          count: have[i],
          notes: data.followers?.[i + 1]?.notes ?? "",
          over: have[i] > n,
          mythic: mythicCounts?.[i] ?? 0,
        }));
      })(),
      mythicFollowers: mythic && tier >= 5,
      notes: data.notes ?? "",
      editable: a.isOwner,
    };
  }

  static async #onChange(_event, _form, formData) {
    if (!this.actor.isOwner) return;
    const d = foundry.utils.expandObject(formData.object);
    const followers = Object.fromEntries(
      Object.entries(d.followers ?? {}).map(([lvl, v]) => [
        lvl,
        { count: Math.max(0, Number(v.count) || 0), notes: v.notes ?? "" },
      ]),
    );
    await this.actor.setFlag(MODULE_ID, FLAG, {
      active: Object.fromEntries(Object.entries(d.active ?? {}).map(([k, v]) => [k, !!v])),
      misc: Number(d.misc) || 0,
      cohortUuid: d.cohortUuid ?? "",
      followers,
      notes: d.notes ?? "",
    });
    this.render();
  }

  static #openCohort() {
    const uuid = this.actor.getFlag(MODULE_ID, FLAG)?.cohortUuid;
    fromUuidSync(uuid)?.sheet?.render(true);
  }
}

/**
 * Opens an actor's Leadership tracker.
 *
 * @param actor - The leader
 */
export const openLeadership = (actor) => {
  const id = `pf1spheres-leadership-${actor.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) return existing.render({ force: true });
  const app = new LeadershipApp({ id });
  app.actor = actor;
  return app.render({ force: true });
};
