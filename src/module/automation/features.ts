/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 and pf1 11 runtime APIs are not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID, localize } from "../util";
import {
  blastDice,
  formulaeCapacity,
  formulaeDailyUses,
  neutralizerResistance,
  parseBlastType,
  salveFormula,
  targetMsd,
} from "./logic";

const fmt = (key: string, data = {}) => game.i18n.format(`PF1SPHERES.Auto.${key}`, data);
const loc = (key: string) => localize(`Auto.${key}`);
const plain = (html) => (html ?? "").replace(/<[^>]+>/g, " ").replace(/&#8217;|&rsquo;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const hasTag = (item, tag) => (item.system?.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase());
const rid = () => foundry.utils.randomID(16);

/* ---------- destructive blast builder ---------- */

const CL = "@spheres.cl.destruction.total";
const SAVE_TYPE = [
  [/fortitude/i, "fort"],
  [/reflex/i, "ref"],
  [/will/i, "will"],
];

/** True for actors with the Destruction sphere */
export const isBlaster = (actor) => actor.items.some((i) => i.type === "feat" && i.name === "Destruction Sphere");

/**
 * Builds destructive blast actions on the actor's Destruction Sphere item: a basic blast plus one
 * per (blast type) talent, each with its die, damage type, spell point cost and save rider, an
 * extra-spell-point option for full dice, and their (blast shape) talents listed. Rebuilding
 * replaces the actions it made last time and leaves hand-made actions alone.
 *
 * @param actor - The caster
 */
export async function buildBlastActions(actor) {
  const sphere = actor.items.find((i) => i.type === "feat" && i.name === "Destruction Sphere");
  if (!sphere) return ui.notifications.warn(loc("NoDestruction"));
  const feats = actor.items.filter((i) => i.type === "feat" && i.flags?.[MODULE_ID]?.sphere === "destruction");
  const types = feats.filter((i) => hasTag(i, "Blast Type")).map((i) => parseBlastType(i.name, plain(i.system.description.value)));
  const shapes = feats.filter((i) => hasTag(i, "Blast Shape")).map((i) => i.name);
  const basic = { name: loc("BasicBlast"), die: 6, damageType: "bludgeoning", sp: 0, rider: "" };

  const prior = sphere.flags?.[MODULE_ID]?.generatedBlasts ?? [];
  const kept = sphere.toObject().system.actions.filter((a) => !prior.includes(a._id));
  const automation = foundry.utils.deepClone(sphere.flags?.[MODULE_ID]?.automation ?? {});
  for (const id of prior) delete automation[id];

  const made = [];
  for (const t of [basic, ...types]) {
    const id = rid();
    const condId = rid();
    const saveType = SAVE_TYPE.find(([re]) => re.test(t.rider))?.[1];
    made.push({
      _id: id,
      name: t === basic ? loc("BasicBlast") : t.name,
      actionType: "rsak",
      touch: true,
      img: sphere.img,
      activation: { type: "standard", unchained: { type: "action", cost: 2 } },
      range: { units: "close" },
      duration: { units: "inst" },
      ability: { attack: "dex", damage: "", critRange: 20, critMult: 2 },
      damage: { parts: [{ formula: `(ceil(${CL} / 2))d${t.die}`, types: [t.damageType] }] },
      ...(saveType ? { save: { type: saveType, dc: `10 + floor(${CL} / 2) + @spheres.cam`, description: t.rider } } : {}),
      conditionals: [
        {
          _id: condId,
          name: loc("FullDice"),
          default: false,
          modifiers: [
            {
              _id: rid(),
              formula: `(${CL} - ceil(${CL} / 2))d${t.die}`,
              target: "damage",
              subTarget: "allDamage",
              type: "untyped",
              critical: "normal",
              damageType: [t.damageType],
            },
          ],
        },
      ],
      notes: {
        footer: [
          loc("BlastNote"),
          ...(t.rider ? [t.rider] : []),
          ...(shapes.length ? [fmt("BlastShapes", { shapes: shapes.join(", ") })] : []),
        ],
      },
    });
    automation[id] = { sp: String(t.sp), condSp: { [condId]: 1 } };
  }
  await sphere.update({
    "system.actions": [...kept, ...made],
    [`flags.${MODULE_ID}.generatedBlasts`]: made.map((a) => a._id),
    [`flags.${MODULE_ID}.automation`]: automation,
  });
  ui.notifications.info(fmt("BlastsBuilt", { count: made.length, dice: blastDice(actor.system.spheres?.cl?.destruction?.total ?? 1) }));
}

/* ---------- magic skill checks ---------- */

/**
 * Rolls a magic skill check (d20 + MSB) against each targeted creature's MSD, for counterspelling,
 * dispelling and similar contests.
 *
 * @param actor - The caster
 */
export async function rollMsbVsTargets(actor) {
  const msb = actor.system.spheres?.msb?.total ?? 0;
  const targets = [...game.user.targets].filter((t) => t.actor);
  const roll = await new Roll(`1d20 + ${msb}`).evaluate();
  const rows = targets.map((t) => {
    const a = t.actor;
    const books = Object.values(a.system.attributes?.spells?.spellbooks ?? {}).filter((b) => b.inUse);
    const spellCl = Math.max(0, ...books.map((b) => b.cl?.total ?? 0));
    const m = targetMsd(a.system.spheres?.msb?.total ?? 0, a.system.spheres?.msd?.total ?? 11, spellCl, a.system.attributes?.hd?.total ?? 0);
    const ok = roll.total >= m.value;
    return `<li>${t.name}: MSD ${m.value}${m.estimate ? "*" : ""} — <strong>${loc(ok ? "Success" : "Failure")}</strong></li>`;
  });
  await roll.toMessage({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor:
      `${loc("MagicSkillCheck")}` +
      (rows.length ? `<ul>${rows.join("")}</ul>` : `<p>${loc("NoTargetsMsd")}</p>`) +
      (rows.some((r) => r.includes("*")) ? `<p><em>${loc("MsdEstimate")}</em></p>` : ""),
  });
}

/* ---------- alchemy formulae ---------- */

/** Craft (alchemy) ranks: a Craft subskill named like "alchemy" */
export const alchemyRanks = (actor) => {
  const subs = actor.system.skills?.crf?.subSkills ?? {};
  return Object.values(subs).find((s) => /alchem/i.test(s.name ?? ""))?.rank ?? 0;
};

export const formulaeTalents = (actor) =>
  actor.items.filter((i) => i.type === "feat" && i.flags?.[MODULE_ID]?.sphere === "alchemy" && hasTag(i, "Formulae"));

export const isAlchemist = (actor) => formulaeTalents(actor).length > 0;

const PANACEA = { 20: "Deafened, fatigued, shaken, sickened", 30: "Diseased, exhausted, nauseated, poisoned, staggered", 40: "Frightened, blinded, paralyzed, stunned" };
const AMBROSIA = { 25: "One curse", 35: "All temporary negative levels, or one permanent", 40: "Broken bones, severed parts, ruined organs, lost senses (10 minutes)", 50: "All negative levels and more (see talent)" };

/** Consumable data for one prepared formulae */
const formulaeItem = (talent, actor, opts) => {
  const ranks = alchemyRanks(actor);
  const pam = actor.system.spheres?.pam ?? 0;
  const expires = game.time.worldTime + 86400;
  const base = {
    name: `${talent.name} (${loc("Formulae")})`,
    type: "consumable",
    img: talent.img,
    flags: { [MODULE_ID]: { formulaeExpires: expires, formula: talent.name } },
    system: {
      subType: "potion",
      quantity: opts.quantity,
      uses: { per: "single" },
      description: { value: `<p><em>${fmt("FormulaeExpires", { hours: 24 })}</em></p>${talent.system.description.value}` },
      actions: [],
    },
  };
  const action = (name, extra = {}) => ({
    _id: rid(),
    name,
    actionType: "other",
    activation: { type: "standard", unchained: { type: "action", cost: 2 } },
    range: { units: "touch" },
    ...extra,
  });
  const automation = {};
  switch (talent.name) {
    case "Salve":
      base.system.subType = "misc";
      base.system.actions.push(
        action(loc("Apply"), {
          actionType: "heal",
          damage: { parts: [{ formula: salveFormula(ranks, pam, opts.upgrades), types: [] }] },
          notes: { footer: [fmt("PerCreature", { uses: formulaeDailyUses(ranks, pam) }), loc("SalveBleed")] },
        }),
      );
      break;
    case "Elixir": {
      const die = Math.min(12, 4 + 2 * opts.upgrades);
      base.system.actions.push(
        action(loc("Drink"), {
          activation: { type: "standard", unchained: { type: "action", cost: 2 } },
          notes: { footer: [fmt("ElixirNote", { die }), fmt("PerCreature", { uses: formulaeDailyUses(ranks, pam) })] },
        }),
      );
      break;
    }
    case "Panacea":
      base.name = `${talent.name} DC ${opts.dc} (${loc("Formulae")})`;
      base.system.actions.push(action(loc("Drink"), { notes: { footer: [fmt("Removes", { list: PANACEA[opts.dc] ?? PANACEA[20] })] } }));
      break;
    case "Ambrosia":
      base.name = `${talent.name} DC ${opts.dc} (${loc("Formulae")})`;
      base.system.actions.push(action(loc("Drink"), { notes: { footer: [fmt("Cures", { list: AMBROSIA[opts.dc] ?? AMBROSIA[25] })] } }));
      break;
    case "Neutralizer":
      base.system.subType = "misc";
      base.system.actions.push(
        action(loc("Apply"), {
          notes: { footer: [fmt("NeutralizerNote", { er: neutralizerResistance(ranks), energy: opts.energy || loc("ChooseEnergy") })] },
        }),
      );
      break;
    case "Focusing Formula": {
      const a = action(loc("Drink"), { activation: { type: "move", unchained: { type: "action", cost: 1 } }, range: { units: "personal" } });
      base.system.uses = { per: "charges", maxFormula: String(1 + opts.upgrades), value: 1 + opts.upgrades, autoDeductChargesCost: "1" };
      base.system.actions.push(a);
      automation[a._id] = { focus: "restore" };
      break;
    }
    default:
      base.system.actions.push(action(loc("Use")));
  }
  if (Object.keys(automation).length) base.flags[MODULE_ID].automation = automation;
  return base;
};

/**
 * Alchemy formulae preparation: pick formulae talents and how many of each, within the number that
 * can be held prepared; makes consumables that expire after 24 hours.
 */
export class FormulaeApp extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["pf1spheres", "pf1spheres-formulae"],
    window: { title: "PF1SPHERES.Auto.PrepareFormulae", icon: "fas fa-flask", resizable: true },
    position: { width: 460, height: "auto" },
    form: { handler: FormulaeApp.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: { prepare: FormulaeApp.#onPrepare },
  };

  static PARTS = { main: { template: `modules/${MODULE_ID}/templates/apps/formulae.hbs` } };

  actor = null;
  choices = {};

  get title() {
    return `${loc("PrepareFormulae")}: ${this.actor?.name ?? ""}`;
  }

  async _prepareContext() {
    const talents = formulaeTalents(this.actor);
    const ranks = alchemyRanks(this.actor);
    const cap = formulaeCapacity(ranks, talents.length);
    const now = game.time.worldTime;
    const prepared = this.actor.items
      .filter((i) => (i.flags?.[MODULE_ID]?.formulaeExpires ?? 0) > now)
      .reduce((n, i) => n + (i.system.quantity ?? 1), 0);
    const rows = talents.map((t) => {
      const c = (this.choices[t.id] ??= { quantity: 0, upgrades: 0, dc: t.name === "Ambrosia" ? 25 : 20, energy: "" });
      return {
        id: t.id,
        name: t.name,
        ...c,
        dcChoices: t.name === "Panacea" ? [20, 30, 40] : t.name === "Ambrosia" ? [25, 35, 40, 50] : null,
        upgradable: ["Salve", "Elixir", "Focusing Formula"].includes(t.name),
        hasEnergy: t.name === "Neutralizer",
      };
    });
    const wanted = rows.reduce((n, r) => n + r.quantity, 0);
    return {
      ranks,
      cap,
      prepared,
      wanted,
      left: cap.max - prepared,
      rows,
      over: prepared + wanted > cap.max,
      batches: Math.ceil(wanted / cap.perBatch),
      energies: ["acid", "cold", "electricity", "fire"],
    };
  }

  static async #onChange(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    for (const [id, v] of Object.entries(data.f ?? {})) {
      this.choices[id] = {
        ...this.choices[id],
        quantity: Math.max(0, Number(v.quantity) || 0),
        upgrades: Math.max(0, Number(v.upgrades) || 0),
        dc: Number(v.dc) || this.choices[id]?.dc,
        energy: v.energy ?? this.choices[id]?.energy ?? "",
      };
    }
    this.render();
  }

  static async #onPrepare() {
    const ctx = await this._prepareContext();
    if (!ctx.wanted) return ui.notifications.warn(loc("NothingToPrepare"));
    if (ctx.over) return ui.notifications.warn(fmt("TooManyFormulae", { max: ctx.cap.max, prepared: ctx.prepared }));
    const items = ctx.rows
      .filter((r) => r.quantity > 0)
      .map((r) => formulaeItem(this.actor.items.get(r.id), this.actor, this.choices[r.id]));
    await this.actor.createEmbeddedDocuments("Item", items);
    await ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor: this.actor }),
      content: `<p>${fmt("PreparedChat", { count: ctx.wanted, batches: ctx.batches, minutes: ctx.batches * 30, lab: ctx.batches * 15 })}</p><ul>${items
        .map((i) => `<li>${i.system.quantity} × ${i.name}</li>`)
        .join("")}</ul>`,
    });
    this.choices = {};
    this.render();
  }
}

export const openFormulae = (actor) => {
  if (!isAlchemist(actor)) return ui.notifications.warn(loc("NoFormulae"));
  const id = `pf1spheres-formulae-${actor.uuid.replaceAll(".", "-")}`;
  const existing = foundry.applications.instances.get(id);
  if (existing) return existing.render({ force: true });
  const app = new FormulaeApp({ id });
  app.actor = actor;
  return app.render({ force: true });
};
