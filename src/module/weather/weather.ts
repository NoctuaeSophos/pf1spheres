/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 ApplicationV2 and scene/token documents are not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID, localize } from "../util";
import { setSpellPoints } from "../actor";
import {
  DEFAULT_WEATHER,
  getWeatherEffects,
  normaliseWeather,
  snowFall,
  snowIntensity,
  snowMovement,
} from "./conditions";
import type { WeatherEffects, WeatherState } from "./conditions";
import { castCost, getWeatherCaster, reduceWeather, validateCast } from "./caster";
import { isGMWriter, registerSocketHandler, requestGM, serialised, userOwns } from "../socket";
import { mountWeatherChart } from "./chart";
import { openCasterWeather } from "./caster-app";

/** Scene flag holding the weather sliders, whether they apply to tokens, and who controls them */
export const WEATHER_FLAG = "weather";
/** Token flag excluding a token from weather (indoors, sheltered) */
export const SHELTER_FLAG = "weatherSheltered";
/** Token flag for a Clear Skies mantle: { steps, casterName, casterUuid } */
export const MANTLE_FLAG = "weatherMantle";
/** Flag on the managed buff item; its value is the id of the scene that owns it */
export const BUFF_FLAG = "weatherBuff";

export interface WeatherController {
  actorUuid: string;
  name: string;
  dc: number;
  deadly: boolean;
  stormLord: number;
  shipSmasher: boolean;
  shipKiller: boolean;
}

export interface SceneWeather extends WeatherState {
  apply: boolean;
  lightningDC: number;
  controller: WeatherController | null;
  /** The weather before a caster took control, restored on release */
  natural: WeatherState | null;
  /** Snow on the ground, in inches (Ultimate Wilderness) */
  snowDepth: number;
  /** Seconds of snowfall toward the next inch, carried between time changes */
  snowCarry: number;
}

export const getSceneWeather = (scene): SceneWeather => {
  const raw = scene?.getFlag(MODULE_ID, WEATHER_FLAG) ?? {};
  return {
    ...normaliseWeather(raw),
    apply: raw.apply === true,
    lightningDC: Number(raw.lightningDC) || 15,
    controller: raw.controller?.actorUuid ? raw.controller : null,
    natural: raw.natural ? normaliseWeather(raw.natural) : null,
    snowDepth: Math.max(0, Number(raw.snowDepth) || 0),
    snowCarry: Math.max(0, Number(raw.snowCarry) || 0),
  };
};

/** What snow on the ground means for movement, as a sentence, or null when there is none */
export const snowLine = (depth: number): string | null => {
  if (!(depth > 0)) return null;
  const extra = snowMovement(depth);
  return extra
    ? game.i18n.format("PF1SPHERES.Weather.SnowDepthMove", { depth, extra })
    : game.i18n.format("PF1SPHERES.Weather.SnowDepth", { depth });
};

/**
 * Adds the snow that fell on a scene over a stretch of time: light frost 1 inch per 2 hours, snow 1
 * inch per hour, heavy snow and worse 1d4 inches per hour (Ultimate Wilderness). Runs on the GM's client.
 * The GM is told when the depth starts costing more movement.
 *
 * @param scene - The scene
 * @param seconds - Time passed
 */
async function accumulateSnow(scene, seconds: number) {
  const raw = scene.getFlag(MODULE_ID, WEATHER_FLAG);
  if (!raw) return;
  const w = getSceneWeather(scene);
  const intensity = snowIntensity(w);
  if (!intensity) {
    if (w.snowCarry) await scene.setFlag(MODULE_ID, WEATHER_FLAG, { snowCarry: 0 });
    return;
  }
  const { inches, carry } = snowFall(intensity, w.snowCarry + seconds, () =>
    Math.ceil(Math.random() * 4),
  );
  const depth = w.snowDepth + inches;
  await scene.setFlag(MODULE_ID, WEATHER_FLAG, { snowDepth: depth, snowCarry: carry });
  if (snowMovement(depth) > snowMovement(w.snowDepth)) {
    await ChatMessage.create({
      whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
      content: `<p><strong>${scene.name}</strong>: ${snowLine(depth)}</p>`,
    });
  }
}

const queueSnow = serialised(async () => {
  const seconds = pendingSnowSeconds;
  pendingSnowSeconds = 0;
  for (const scene of game.scenes) await accumulateSnow(scene, seconds);
});
let pendingSnowSeconds = 0;

/** Storm lightning for a scene: dice, DC and whether the controlling caster maximizes it */
export const getLightning = (weather: SceneWeather, effects = getWeatherEffects(weather)) => {
  if (!effects.lightningDice) return null;
  const maximized = weather.controller?.deadly === true;
  return {
    dice: effects.lightningDice,
    dc: weather.controller?.dc ?? weather.lightningDC,
    maximized,
    formula: maximized ? String(effects.lightningDice * 8) : `${effects.lightningDice}d8`,
    perRound: (weather.controller?.stormLord ?? 0) >= 2,
    chosen: (weather.controller?.stormLord ?? 0) >= 1,
  };
};

/** Only one client (the active GM) writes weather, so updates never race */
export const isWeatherWriter = isGMWriter;

const hasAtmospheric = (actor) =>
  actor.items.some((i) => i.type === "feat" && i.name === "Atmospheric Imbuement");

const buffData = (
  effects: WeatherEffects,
  scene,
  extra: { mantle?; atmospheric?: boolean; controller? },
) => {
  const list = (items: string[]) =>
    items.length ? `<ul>${items.map((i) => `<li>${i}</li>`).join("")}</ul>` : "";
  const contextNotes = [...effects.contextNotes];
  const notes = [...effects.notes];
  if (extra.atmospheric) {
    const text = localize("Weather.AtmosphericNote");
    for (const target of ["rangedSpell", "meleeSpell"]) {
      if (pf1.config.contextNoteTargets[target]) contextNotes.push({ text, target });
    }
    notes.unshift(text);
  }
  const lines = [];
  const snow = snowLine(getSceneWeather(scene).snowDepth);
  if (snow) lines.push(snow);
  if (extra.controller)
    lines.push(
      game.i18n.format("PF1SPHERES.Weather.ControlledBy", { name: extra.controller.name }),
    );
  if (extra.mantle) {
    lines.push(
      game.i18n.format("PF1SPHERES.Weather.MantleLine", {
        steps: extra.mantle.steps,
        name: extra.mantle.casterName,
      }),
    );
  }
  return {
    name: localize("Weather.BuffName"),
    type: "buff",
    img: "icons/svg/windmill.svg",
    flags: { [MODULE_ID]: { [BUFF_FLAG]: scene.id } },
    system: {
      subType: "temp",
      active: true,
      changes: effects.changes.map((c, i) => ({
        _id: `pf1sweather${String(i).padStart(4, "0")}`,
        operator: "add",
        ...c,
      })),
      contextNotes,
      description: {
        value:
          `<p><strong>${effects.labels.join(", ") || localize("Weather.Calm")}</strong> (${scene.name})</p>` +
          lines.map((l) => `<p><em>${l}</em></p>`).join("") +
          list(notes) +
          `<p><em>${localize("Weather.BuffManaged")}</em></p>`,
      },
    },
  };
};

const sameBuff = (item, data) =>
  JSON.stringify(item.system.changes.map((c) => [c.formula, c.target, c.type])) ===
    JSON.stringify(data.system.changes.map((c) => [c.formula, c.target, c.type])) &&
  JSON.stringify(item.system.contextNotes.map((n) => [n.text, n.target])) ===
    JSON.stringify(data.system.contextNotes.map((n) => [n.text, n.target])) &&
  item.system.description.value === data.system.description.value &&
  item.system.active === true;

/**
 * Brings every creature token on the scene in line with the scene's weather: adds, updates or
 * removes the managed Weather buff. Mantled tokens get milder weather, sheltered tokens and scenes
 * not applying weather get none.
 *
 * @param scene - The scene to synchronise
 */
export async function syncSceneWeather(scene) {
  if (!scene || !isWeatherWriter()) return;
  const weather = getSceneWeather(scene);
  const sceneEffects = getWeatherEffects(weather);
  const storm = sceneEffects.severities.precipitation >= 4 && sceneEffects.severities.wind >= 4;
  const byMantle = new Map([[0, sceneEffects]]);
  const effectsFor = (steps: number) => {
    if (!byMantle.has(steps)) byMantle.set(steps, getWeatherEffects(reduceWeather(weather, steps)));
    return byMantle.get(steps);
  };
  const seen = new Set();
  for (const token of scene.tokens) {
    const actor = token.actor;
    if (!actor || !["character", "npc"].includes(actor.type)) continue;
    // A linked actor with several tokens is handled once
    const key = token.actorLink ? actor.uuid : token.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    const existing = actor.items.filter(
      (i) => i.type === "buff" && i.getFlag(MODULE_ID, BUFF_FLAG) === scene.id,
    );
    // A linked actor is only "in" the active scene; tokens left on other maps don't bring their weather along
    const here = !token.actorLink || scene.active || !game.scenes.active;
    const mantle = token.getFlag(MODULE_ID, MANTLE_FLAG);
    const effects = effectsFor(Math.max(0, Number(mantle?.steps) || 0));
    const atmospheric = storm && hasAtmospheric(actor);
    const hasEffects =
      atmospheric ||
      effects.changes.length + effects.contextNotes.length + effects.notes.length > 0;
    const wanted = here && weather.apply && hasEffects && !token.getFlag(MODULE_ID, SHELTER_FLAG);
    if (!wanted) {
      if (existing.length)
        await actor.deleteEmbeddedDocuments(
          "Item",
          existing.map((i) => i.id),
        );
      continue;
    }
    const data = buffData(effects, scene, { mantle, atmospheric, controller: weather.controller });
    const [first, ...extra] = existing;
    if (extra.length)
      await actor.deleteEmbeddedDocuments(
        "Item",
        extra.map((i) => i.id),
      );
    if (!first) await actor.createEmbeddedDocuments("Item", [data]);
    else if (!sameBuff(first, data)) {
      await first.update({
        "system.changes": data.system.changes,
        "system.contextNotes": data.system.contextNotes,
        "system.description.value": data.system.description.value,
        "system.active": true,
      });
    }
  }
}

/** Removes the managed buff a token's actor carries for this scene (token left the scene) */
async function clearTokenWeather(token) {
  if (!isWeatherWriter()) return;
  // An unlinked token's actor delta goes with the token
  if (!token.actorLink) return;
  const actor = token.actor;
  if (!actor) return;
  const sceneId = token.parent?.id;
  // A linked actor may still have other tokens on the scene
  if (
    token.actorLink &&
    token.parent?.tokens.some((t) => t.id !== token.id && t.actorId === token.actorId)
  )
    return;
  const existing = actor.items.filter(
    (i) => i.type === "buff" && i.getFlag(MODULE_ID, BUFF_FLAG) === sceneId,
  );
  if (existing.length)
    await actor.deleteEmbeddedDocuments(
      "Item",
      existing.map((i) => i.id),
    );
}

const pending = new Map();
/** Debounced sync, so dragging several sliders or dropping many tokens writes once */
export const queueSceneWeather = (scene) => {
  if (!scene) return;
  clearTimeout(pending.get(scene.id));
  pending.set(
    scene.id,
    setTimeout(() => {
      pending.delete(scene.id);
      syncSceneWeather(scene).catch((err) => console.error(`${MODULE_ID} | weather sync`, err));
    }, 300),
  );
};

/* -------------------------------------------- */
/*  Requests from players, carried out by the GM */
/* -------------------------------------------- */

const ownsActor = userOwns;

async function handleRequest(msg, user) {
  const scene = game.scenes.get(msg.sceneId);
  if (!user || !scene) return;
  const weather = getSceneWeather(scene);
  if (msg.weatherAction === "control") {
    const actor = fromUuidSync(msg.actorUuid);
    if (!ownsActor(user, actor)) return;
    const caster = getWeatherCaster(actor);
    if (!caster) return;
    const next = normaliseWeather(msg.state);
    const refuse = (reason) =>
      ChatMessage.create({
        whisper: [user.id],
        content: `<p>${localize("Weather.Refused")}: ${reason}</p>`,
      });
    const problems = validateCast(caster, weather, next, msg.opts);
    if (problems.length) return refuse(problems[0]);
    const cost = castCost(caster, msg.opts);
    const mythic =
      msg.opts?.mythicTalent && caster.mythicTalent?.uses > 0
        ? actor.items.get(caster.mythicTalent.id)
        : null;
    const pool = actor.system.spheres?.spellPoints?.value ?? 0;
    if (!mythic && cost > pool)
      return refuse(game.i18n.format("PF1SPHERES.Weather.NotEnoughSP", { cost, value: pool }));
    if (mythic) await mythic.update({ "system.uses.value": mythic.system.uses.value - 1 });
    else if (cost) await setSpellPoints(actor, pool - cost);
    if (msg.chat) {
      await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content:
          msg.chat +
          `<p>${mythic ? localize("Weather.PaidMythic") : game.i18n.format("PF1SPHERES.Weather.PaidSP", { cost })}</p>`,
      });
    }
    await scene.setFlag(MODULE_ID, WEATHER_FLAG, {
      ...next,
      apply: true,
      lightningDC: weather.lightningDC,
      natural: weather.controller ? weather.natural : normaliseWeather(weather),
      controller: {
        actorUuid: actor.uuid,
        name: actor.name,
        dc: caster.dc,
        deadly: caster.deadly,
        stormLord: caster.stormLord,
        shipSmasher: caster.shipSmasher,
        shipKiller: caster.shipKiller,
      },
    });
  } else if (msg.weatherAction === "release") {
    if (!weather.controller) return;
    if (!user.isGM && weather.controller.actorUuid !== msg.actorUuid) return;
    if (!user.isGM && !ownsActor(user, fromUuidSync(msg.actorUuid))) return;
    await scene.setFlag(MODULE_ID, WEATHER_FLAG, {
      ...(weather.natural ?? DEFAULT_WEATHER),
      apply: weather.apply,
      lightningDC: weather.lightningDC,
      natural: null,
      controller: null,
    });
  } else if (msg.weatherAction === "mantle") {
    const caster = msg.casterUuid ? fromUuidSync(msg.casterUuid) : null;
    if (!user.isGM && !ownsActor(user, caster)) return;
    if (msg.mantle && msg.cost && caster) {
      const pool = caster.system.spheres?.spellPoints?.value ?? 0;
      if (msg.cost > pool) {
        return ChatMessage.create({
          whisper: [user.id],
          content: `<p>${game.i18n.format("PF1SPHERES.Weather.NotEnoughSP", { cost: msg.cost, value: pool })}</p>`,
        });
      }
      await setSpellPoints(caster, pool - msg.cost);
      if (msg.chat)
        await ChatMessage.create({
          speaker: ChatMessage.getSpeaker({ actor: caster }),
          content: msg.chat,
        });
    }
    const updates = (msg.tokenIds ?? [])
      .filter((id) => scene.tokens.has(id))
      .map((id) =>
        msg.mantle
          ? { _id: id, [`flags.${MODULE_ID}.${MANTLE_FLAG}`]: msg.mantle }
          : { _id: id, [`flags.${MODULE_ID}.-=${MANTLE_FLAG}`]: null },
      );
    if (updates.length) await scene.updateEmbeddedDocuments("Token", updates);
  }
}

/**
 * Sends a weather request to the active GM (or carries it out directly on the GM's own client).
 *
 * @param msg - The request: action "control", "release" or "mantle"
 * @returns Whether it could be sent
 */
export const requestWeather = (msg) =>
  requestGM({ ...msg, action: "weather", weatherAction: msg.action });

/* -------------------------------------------- */
/*  GM panel                                    */
/* -------------------------------------------- */

/**
 * The GM's weather panel: three sliders per scene, the resulting conditions, and controls for
 * applying them to tokens, sheltering tokens, releasing a caster's control and rolling lightning.
 */
export class WeatherApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
  static DEFAULT_OPTIONS = {
    id: "pf1spheres-weather",
    tag: "form",
    classes: ["pf1spheres", "pf1spheres-weather"],
    window: { title: "PF1SPHERES.Weather.Title", icon: "fas fa-cloud-sun-rain", resizable: true },
    position: { width: 480, height: "auto" },
    form: { handler: WeatherApp.#onSubmit, submitOnChange: true, closeOnSubmit: false },
    actions: {
      shelter: WeatherApp.#onShelter,
      unshelter: WeatherApp.#onUnshelter,
      lightning: WeatherApp.#onLightning,
      release: WeatherApp.#onRelease,
      reset: WeatherApp.#onReset,
      openCaster: WeatherApp.#onOpenCaster,
      clearSnow: WeatherApp.#onClearSnow,
    },
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/apps/weather.hbs` } };

  /** The scene being edited; defaults to the scene on the canvas */
  scene = null;

  get title() {
    return `${localize("Weather.Title")}: ${this.scene?.name ?? ""}`;
  }

  async _prepareContext() {
    this.scene ??= canvas?.scene ?? game.scenes.viewed;
    const weather = getSceneWeather(this.scene);
    const effects = getWeatherEffects(weather);
    // Players see the scene's weather; only the GM edits it here. Players who own a Control Weather
    // caster get a button to that caster's panel, which changes it by the spell's rules.
    const readonly = !game.user.isGM;
    const casters = readonly
      ? game.actors
          .filter((a) => a.isOwner && a.type === "character" && getWeatherCaster(a))
          .map((a) => ({ uuid: a.uuid, name: a.name }))
      : [];
    return {
      scene: this.scene,
      readonly,
      casters,
      snow: {
        depth: weather.snowDepth,
        line: snowLine(weather.snowDepth),
        falling: snowIntensity(weather),
      },
      weather,
      sliders: weatherSliders(weather, effects, { wind: [1, 7], signed: [-6, 6] }),
      effects,
      conditions: effects.labels.length ? effects.labels.join(", ") : localize("Weather.Calm"),
      changes: describeChanges(effects),
      sheltered:
        this.scene?.tokens.filter((t) => t.getFlag(MODULE_ID, SHELTER_FLAG)).map((t) => t.name) ??
        [],
      mantled:
        this.scene?.tokens
          .filter((t) => t.getFlag(MODULE_ID, MANTLE_FLAG))
          .map((t) => `${t.name} (−${t.getFlag(MODULE_ID, MANTLE_FLAG).steps})`) ?? [],
      lightning: getLightning(weather, effects),
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const w = context.weather;
    mountWeatherChart(this.element, {
      temperature: w.temperature,
      humidity: w.humidity,
      wind: w.wind,
      max: 7,
      readonly: context.readonly,
    });
  }

  static async #onOpenCaster(_event, target) {
    const actor = fromUuidSync(target.dataset.actorUuid);
    if (actor) openCasterWeather(actor);
  }

  static async #onSubmit(_event, _form, formData) {
    if (!game.user.isGM) return;
    const data = foundry.utils.expandObject(formData.object);
    const current = getSceneWeather(this.scene);
    await this.scene.setFlag(MODULE_ID, WEATHER_FLAG, {
      ...current,
      ...normaliseWeather({ ...current, ...data }),
      apply: data.apply ?? current.apply,
      lightningDC: Number(data.lightningDC ?? current.lightningDC) || 15,
      snowDepth:
        data.snowDepth !== undefined ? Math.max(0, Number(data.snowDepth) || 0) : current.snowDepth,
    });
    this.render();
  }

  static async #onClearSnow() {
    await this.scene.setFlag(MODULE_ID, WEATHER_FLAG, { snowDepth: 0, snowCarry: 0 });
    this.render();
  }

  static async #onReset() {
    await this.scene.setFlag(MODULE_ID, WEATHER_FLAG, {
      ...DEFAULT_WEATHER,
      apply: false,
      lightningDC: 15,
      controller: null,
      natural: null,
    });
    this.render();
  }

  static async #onRelease() {
    await requestWeather({ action: "release", sceneId: this.scene.id });
    this.render();
  }

  static async #setShelter(value: boolean) {
    const tokens = canvas.tokens.controlled.filter((t) => t.document.parent?.id === this.scene.id);
    if (!tokens.length) return ui.notifications.warn(localize("Weather.SelectTokens"));
    await this.scene.updateEmbeddedDocuments(
      "Token",
      tokens.map((t) => ({ _id: t.id, [`flags.${MODULE_ID}.${SHELTER_FLAG}`]: value })),
    );
    this.render();
  }

  static async #onShelter() {
    return WeatherApp.#setShelter.call(this, true);
  }

  static async #onUnshelter() {
    return WeatherApp.#setShelter.call(this, false);
  }

  static async #onLightning() {
    return rollLightning(this.scene);
  }
}

/** Slider rows for a weather state, bounded per category */
export const weatherSliders = (weather: WeatherState, effects: WeatherEffects, bounds) => {
  const sev = effects.severities;
  const signed = (value: number, neg: string, pos: string) =>
    value === 0 ? localize("Weather.Normal") : `${value < 0 ? neg : pos} ${Math.abs(value) + 1}`;
  return [
    {
      name: "wind",
      label: localize("Weather.Wind"),
      min: bounds.wind[0],
      max: bounds.wind[1],
      value: weather.wind,
      display: `${sev.wind}`,
    },
    {
      name: "temperature",
      label: localize("Weather.Temperature"),
      min: bounds.signed[0],
      max: bounds.signed[1],
      value: weather.temperature,
      display: signed(weather.temperature, localize("Weather.Cold"), localize("Weather.Heat")),
    },
    {
      name: "humidity",
      label: localize("Weather.Humidity"),
      min: bounds.signed[0],
      max: bounds.signed[1],
      value: weather.humidity,
      display: signed(
        weather.humidity,
        localize("Weather.Aridity"),
        localize("Weather.Precipitation"),
      ),
    },
  ];
};

export const describeChanges = (effects: WeatherEffects) =>
  effects.changes.map((c) => {
    const label = pf1.config.buffTargets[c.target]?.label;
    return `${c.formula} ${label ? game.i18n.localize(label) : c.target.replace(/^skill\./, "")}`;
  });

/**
 * Rolls a storm bolt for each targeted token: one damage roll (maximized for a Deadly Weather
 * caster's storm) and each target's Reflex save.
 *
 * @param scene - The scene with the storm
 */
export async function rollLightning(scene) {
  const weather = getSceneWeather(scene);
  const bolt = getLightning(weather);
  if (!bolt) return ui.notifications.warn(localize("Weather.NoStorm"));
  const targets = [...game.user.targets].filter((t) => t.actor);
  if (!targets.length) return ui.notifications.warn(localize("Weather.TargetTokens"));
  const roll = await new Roll(bolt.formula).evaluate();
  const extras = [];
  if (bolt.maximized) extras.push(localize("Weather.Maximized"));
  if (weather.controller?.shipKiller) extras.push(localize("Weather.ShipKiller"));
  else if (weather.controller?.shipSmasher) extras.push(localize("Weather.ShipSmasher"));
  await roll.toMessage({
    speaker: weather.controller
      ? { alias: weather.controller.name }
      : { alias: localize("Weather.Title") },
    flavor:
      `${localize("Weather.Lightning")} (${pf1.registry.damageTypes.get("electric")?.name ?? "electric"}), ` +
      `${localize("Weather.ReflexHalf")} DC ${bolt.dc}: ${targets.map((t) => t.name).join(", ")}` +
      (extras.length ? `<br>${extras.join(" ")}` : ""),
  });
  const mine = targets.filter((t) => t.actor.isOwner);
  for (const t of mine) await t.actor.rollSavingThrow("ref", { skipDialog: true, dc: bolt.dc });
  const others = targets.filter((t) => !t.actor.isOwner);
  if (others.length)
    await requestGM({
      action: "weather.saves",
      sceneId: scene.id,
      tokenIds: others.map((t) => t.id),
      dc: bolt.dc,
    });
}

/** The GM rolls Reflex saves against lightning for tokens the striking player doesn't own */
async function rollSavesForUser(msg) {
  const scene = game.scenes.get(msg.sceneId);
  for (const id of msg.tokenIds ?? []) {
    const actor = scene?.tokens.get(id)?.actor;
    if (actor) await actor.rollSavingThrow("ref", { skipDialog: true, dc: msg.dc });
  }
}

let app = null;
/** Opens (or brings forward) the GM weather panel for the viewed scene */
export const openWeather = (scene: unknown = null) => {
  if (!game.user?.isGM) return ui.notifications.warn(localize("Weather.GMOnly"));
  app ??= new WeatherApp();
  app.scene = scene ?? canvas?.scene ?? game.scenes.viewed;
  return app.render({ force: true });
};

/** Re-renders open weather windows for a scene */
const refreshWindows = (scene) => {
  for (const w of foundry.applications.instances.values()) {
    if (
      (w instanceof WeatherApp || w.constructor?.name === "CasterWeatherApp") &&
      w.rendered &&
      w.scene?.id === scene.id
    )
      w.render();
  }
};

/**
 * Adds the token's scene weather to an actor's roll data as @spheres.weather: the severities,
 * whether there is a storm, and the lightning formula (maximized when the caster is the controller).
 */
/**
 * The scene whose weather an actor is in: an unlinked actor's own token's scene, otherwise the active
 * scene when the actor has a token there (the scene the Weather buff follows), otherwise the viewed one.
 */
const actorWeatherScene = (actor) => {
  if (actor.token) return actor.token.parent;
  const onScene = (scene) => scene?.tokens.some((t) => t.actorLink && t.actorId === actor.id);
  const active = game.scenes?.active;
  if (onScene(active)) return active;
  const viewed = canvas?.scene ?? game.scenes?.viewed;
  if (onScene(viewed)) return viewed;
  return active ?? viewed;
};

const weatherRollData = (actor) => {
  const scene = actorWeatherScene(actor);
  const weather = getSceneWeather(scene);
  const effects = getWeatherEffects(weather);
  const bolt = getLightning(weather, effects);
  return {
    ...effects.severities,
    storm: bolt ? 1 : 0,
    lightningDice: effects.lightningDice,
    lightning: bolt ? bolt.formula : "0",
    mine: weather.controller?.actorUuid === actor.uuid ? 1 : 0,
    dc: bolt?.dc ?? 0,
  };
};

// pf1 caches roll data at data prep and skips this hook on cached reads, so a snapshot would miss
// weather set later (or a canvas that wasn't ready at load); a getter reads the scene on each use
const onGetRollData = (doc, result) => {
  if (!(doc instanceof Actor)) return;
  result.spheres ??= {};
  Object.defineProperty(result.spheres, "weather", {
    get: () => weatherRollData(doc),
    enumerable: true,
    configurable: true,
  });
};

/** Registers the token-tools button, roll data, the GM socket and the sync hooks */
export const registerWeather = () => {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens ?? controls.token;
    if (!tokens?.tools) return;
    tokens.tools.pf1spheresWeather = {
      name: "pf1spheresWeather",
      title: "PF1SPHERES.Weather.Title",
      icon: "fas fa-cloud-sun-rain",
      order: Object.keys(tokens.tools).length,
      button: true,
      // Everyone can open it to see the weather; editing is the GM's (see WeatherApp)
      visible: true,
      onChange: () => openWeather(),
    };
  });
  Hooks.on("pf1GetRollData", onGetRollData);
  // Snow piles up on scenes as in-game time passes
  Hooks.on("updateWorldTime", (_worldTime, delta) => {
    if (!isGMWriter() || !(delta > 0)) return;
    pendingSnowSeconds += delta;
    queueSnow();
  });
  registerSocketHandler("weather", handleRequest);
  registerSocketHandler("weather.saves", rollSavesForUser);
  Hooks.on("updateScene", (scene, changed) => {
    // The active scene changed: linked actors swap which scene's weather they carry
    if ("active" in changed)
      for (const s of game.scenes) if (s.getFlag(MODULE_ID, WEATHER_FLAG)) queueSceneWeather(s);
  });
  Hooks.on("updateScene", (scene, changed) => {
    if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.${WEATHER_FLAG}`))
      queueSceneWeather(scene);
    refreshWindows(scene);
  });
  Hooks.on("createToken", (token) => queueSceneWeather(token.parent));
  Hooks.on("updateToken", (token, changed) => {
    const flags = changed.flags?.[MODULE_ID] ?? {};
    if (SHELTER_FLAG in flags || MANTLE_FLAG in flags || `-=${MANTLE_FLAG}` in flags) {
      queueSceneWeather(token.parent);
      refreshWindows(token.parent);
    }
  });
  Hooks.on("deleteToken", (token) => {
    clearTokenWeather(token).catch((err) => console.error(`${MODULE_ID} | weather cleanup`, err));
  });
};
