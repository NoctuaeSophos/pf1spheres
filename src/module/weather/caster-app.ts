/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 ApplicationV2 is not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID, localize } from "../util";
import { getWeatherEffects, normaliseWeather } from "./conditions";
import { DEFAULT_CAST, castCost, getWeatherCaster, validateCast } from "./caster";
import type { CastOptions } from "./caster";
import { describeChanges, getLightning, getSceneWeather, requestWeather, rollLightning, weatherSliders } from "./weather";

const fmt = (key: string, data = {}) => game.i18n.format(`PF1SPHERES.Weather.${key}`, data);

/**
 * A Weather-sphere caster's Control Weather panel: sliders bounded by the caster's limits,
 * casting options with their spell point cost, Clear Skies mantles, and their own storm's lightning.
 */
export class CasterWeatherApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["pf1spheres", "pf1spheres-weather", "pf1spheres-caster-weather"],
    window: { title: "PF1SPHERES.Weather.ControlTitle", icon: "fas fa-cloud-bolt", resizable: true },
    position: { width: 500, height: "auto" },
    form: { handler: CasterWeatherApp.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: {
      cast: CasterWeatherApp.#onCast,
      release: CasterWeatherApp.#onRelease,
      mantle: CasterWeatherApp.#onMantle,
      unmantle: CasterWeatherApp.#onUnmantle,
      lightning: CasterWeatherApp.#onLightning,
    },
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/apps/caster-weather.hbs` } };

  actor = null;
  scene = null;
  /** The weather the caster is dialling in, before casting */
  draft = null;
  /** The scene weather the draft started from; when the scene changes under it, the draft resets */
  draftBase = "";
  opts: CastOptions = { ...DEFAULT_CAST };

  get title() {
    return `${localize("Weather.ControlTitle")}: ${this.actor?.name ?? ""}`;
  }

  async _prepareContext() {
    this.scene = canvas?.scene ?? game.scenes.viewed;
    const caster = getWeatherCaster(this.actor);
    const weather = getSceneWeather(this.scene);
    const current = normaliseWeather(weather);
    // A player's cast lands after this window has re-rendered, so reset the draft only once the scene weather actually changes
    const base = JSON.stringify(current);
    if (this.draft && this.draftBase !== base) this.draft = null;
    if (!this.draft) {
      this.draft = { ...current };
      this.draftBase = base;
    }
    const max = Math.min(7, caster.maxSeverity + (this.opts.severe && caster.severeWeather ? 1 : 0));
    const effects = getWeatherEffects(this.draft);
    const cost = castCost(caster, this.opts);
    const problems = validateCast(caster, current, this.draft, this.opts);
    const sp = this.actor.system.spheres?.spellPoints ?? { value: 0, max: 0 };
    const useMythic = this.opts.mythicTalent && (caster.mythicTalent?.uses ?? 0) > 0;
    if (!useMythic && cost > sp.value) problems.push(fmt("NotEnoughSP", { cost, value: sp.value }));
    const changed = ["wind", "temperature", "humidity"].filter((k) => current[k] !== this.draft[k]).length;
    const mine = weather.controller?.actorUuid === this.actor.uuid;
    const targets = [...game.user.targets].filter((t) => t.document.parent?.id === this.scene.id);
    const maxTargets = 1 + caster.extraMantleTargets;
    const bolt = mine ? getLightning(weather) : null;
    return {
      actor: this.actor,
      scene: this.scene,
      caster,
      max,
      sliders: weatherSliders(this.draft, effects, { wind: [1, max], signed: [-(max - 1), max - 1] }),
      effects,
      conditions: effects.labels.length ? effects.labels.join(", ") : localize("Weather.Calm"),
      changes: describeChanges(effects),
      opts: this.opts,
      cost,
      sp,
      useMythic,
      problems,
      changed,
      canCast: changed > 0 && problems.length === 0,
      controller: weather.controller,
      mine,
      duration: this.opts.persist
        ? fmt(caster.lengthened ? "DurationHours" : "DurationMinutes", { cl: caster.casterLevel })
        : localize("Weather.DurationConcentration"),
      speed: caster.instant ? localize("Weather.Instant") : fmt("StepsPerRound", { steps: caster.stepsPerRound }),
      area: this.opts.climate && caster.climate
        ? localize("Weather.AreaClimate")
        : caster.grandWeather
          ? localize(caster.greaterSize ? "Weather.AreaExtreme" : "Weather.AreaLong")
          : localize(caster.greaterSize ? "Weather.AreaLong" : "Weather.AreaMedium"),
      categoriesAllowed: 1 + (caster.greaterWeather ? this.opts.greater : 0) + caster.freeExtraCategories,
      greaterChoices: [0, 1, 2],
      mantle: caster.clearSkiesSteps
        ? {
            steps: caster.clearSkiesSteps,
            targets: targets.map((t) => t.name),
            count: targets.length,
            maxTargets,
            cost: targets.length > 1 ? 2 : 1,
            tooMany: targets.length > maxTargets,
            duration: fmt(targets.length > 1 ? "MantleDurationShort" : "MantleDuration", { cl: caster.casterLevel }),
          }
        : null,
      bolt,
    };
  }

  static async #onChange(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    this.draft = normaliseWeather({ ...this.draft, ...data });
    this.opts = {
      persist: data.persist ?? this.opts.persist,
      severe: data.severe ?? this.opts.severe,
      greater: Number(data.greater ?? this.opts.greater) || 0,
      climate: data.climate ?? this.opts.climate,
      mythicTalent: data.mythicTalent ?? this.opts.mythicTalent,
    };
    this.render();
  }

  static async #onCast() {
    const ctx = await this._prepareContext();
    if (!ctx.canCast) return ui.notifications.warn(ctx.problems[0] ?? localize("Weather.NothingChanged"));
    // The GM's client validates again, takes the cost and posts the card, so a refused cast costs nothing
    const sent = await requestWeather({
      action: "control",
      sceneId: this.scene.id,
      actorUuid: this.actor.uuid,
      state: this.draft,
      opts: this.opts,
      chat:
        `<p><strong>${localize("Weather.ControlTitle")}</strong>: ${ctx.conditions}</p>` +
        `<p>${ctx.duration}. ${ctx.speed}. ${ctx.area}.</p>`,
    });
    if (!sent) return;
    this.render();
  }

  static async #onRelease() {
    await requestWeather({ action: "release", sceneId: this.scene.id, actorUuid: this.actor.uuid });
    this.draft = null;
    this.render();
  }

  static async #onMantle() {
    const caster = getWeatherCaster(this.actor);
    const targets = [...game.user.targets].filter((t) => t.document.parent?.id === this.scene.id);
    if (!targets.length) return ui.notifications.warn(localize("Weather.TargetTokens"));
    if (targets.length > 1 + caster.extraMantleTargets) {
      return ui.notifications.warn(fmt("TooManyTargets", { max: 1 + caster.extraMantleTargets }));
    }
    const cost = targets.length > 1 ? 2 : 1;
    const sp = this.actor.system.spheres.spellPoints;
    if (cost > sp.value) return ui.notifications.warn(fmt("NotEnoughSP", { cost, value: sp.value }));
    await requestWeather({
      action: "mantle",
      sceneId: this.scene.id,
      casterUuid: this.actor.uuid,
      tokenIds: targets.map((t) => t.id),
      mantle: { steps: caster.clearSkiesSteps, casterName: this.actor.name, casterUuid: this.actor.uuid },
      cost,
      chat: `<p>${fmt("MantleChat", { steps: caster.clearSkiesSteps, targets: targets.map((t) => t.name).join(", "), cost })}</p>`,
    });
  }

  static async #onUnmantle() {
    const targets = [...game.user.targets].filter((t) => t.document.parent?.id === this.scene.id);
    if (!targets.length) return ui.notifications.warn(localize("Weather.TargetTokens"));
    await requestWeather({
      action: "mantle",
      sceneId: this.scene.id,
      casterUuid: this.actor.uuid,
      tokenIds: targets.map((t) => t.id),
      mantle: null,
    });
  }

  static async #onLightning() {
    return rollLightning(this.scene);
  }
}

/**
 * Opens a caster's Control Weather panel.
 *
 * @param actor - The Weather-sphere caster
 */
export const openCasterWeather = (actor) => {
  if (!actor || !getWeatherCaster(actor)) return ui.notifications.warn(localize("Weather.NotACaster"));
  const appId = `pf1spheres-caster-weather-${actor.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(appId);
  if (existing) return existing.render({ force: true });
  const w = new CasterWeatherApp({ id: appId });
  w.actor = actor;
  return w.render({ force: true });
};
