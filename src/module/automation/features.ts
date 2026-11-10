/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 and pf1 11 runtime APIs are not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID, localize } from "../util";
import {
  formulaeCapacity,
  formulaeCraftDC,
  formulaeDailyUses,
  neutralizerLimits,
  neutralizerResistance,
  salveFormula,
  targetMsd,
} from "./logic";

const fmt = (key: string, data = {}) => game.i18n.format(`PF1SPHERES.Auto.${key}`, data);
const loc = (key: string) => localize(`Auto.${key}`);
const plain = (html) =>
  (html ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const hasTag = (item, tag) =>
  (item.system?.tags ?? []).some((t) => t.toLowerCase() === tag.toLowerCase());
const rid = () => foundry.utils.randomID(16);

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
    const books = Object.values(a.system.attributes?.spells?.spellbooks ?? {}).filter(
      (b) => b.inUse,
    );
    const spellCl = Math.max(0, ...books.map((b) => b.cl?.total ?? 0));
    const m = targetMsd(
      a.system.spheres?.msb?.total ?? 0,
      a.system.spheres?.msd?.total ?? 11,
      spellCl,
      a.system.attributes?.hd?.total ?? 0,
    );
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
  actor.items.filter(
    (i) => i.type === "feat" && i.flags?.[MODULE_ID]?.sphere === "alchemy" && hasTag(i, "Formulae"),
  );

export const isAlchemist = (actor) => formulaeTalents(actor).length > 0;

/** What a formulae does and what its upgrades add, for the prepare window */
const formulaeDetails = (name, c, ranks, pam) => {
  switch (name) {
    case "Salve":
      return {
        effect: fmt("SalveEffect", { heal: salveFormula(ranks, pam, c.upgrades) }),
        upgrade: loc("SalveUpgrade"),
      };
    case "Elixir":
      return {
        effect: fmt("ElixirNote", { die: Math.min(12, 4 + 2 * c.upgrades) }),
        upgrade: loc("ElixirUpgrade"),
      };
    case "Panacea":
      return {
        effect: fmt("Removes", { list: panaceaList(c.dc) }),
        upgrade: loc("PanaceaUpgrade"),
      };
    case "Ambrosia":
      return {
        effect: fmt("Cures", { list: AMBROSIA[c.dc] ?? AMBROSIA[25] }),
        upgrade: loc("AmbrosiaUpgrade"),
      };
    case "Neutralizer": {
      const { attacks, minutes } = neutralizerLimits(c.upgrades);
      const energy = c.energy || loc("ChooseEnergy");
      return {
        effect: fmt("NeutralizerNote", {
          er: neutralizerResistance(ranks),
          energy,
          attacks,
          minutes,
        }),
        upgrade: loc("NeutralizerUpgrade"),
      };
    }
    case "Focusing Formula":
      return {
        effect: fmt("FocusingEffect", { uses: 1 + c.upgrades }),
        upgrade: loc("FocusingUpgrade"),
      };
    default:
      return { effect: "", upgrade: "" };
  }
};

/** A Panacea removes the conditions of its DC and every lower one */
const panaceaList = (dc) =>
  Object.entries(PANACEA)
    .filter(([k]) => Number(k) <= (dc ?? 20))
    .map(([, v]) => v)
    .join("; ");

const PANACEA = {
  20: "Deafened, fatigued, shaken, sickened",
  30: "Diseased, exhausted, nauseated, poisoned, staggered",
  40: "Frightened, blinded, paralyzed, stunned",
};
const AMBROSIA = {
  25: "One curse",
  35: "All temporary negative levels, or one permanent",
  40: "Broken bones, severed parts, ruined organs, lost senses (10 minutes)",
  50: "All negative levels and more (see talent)",
};

/** Consumable data for one prepared formulae */
const formulaeItem = (talent, actor, opts) => {
  const ranks = alchemyRanks(actor);
  const pam = actor.system.spheres?.pam ?? 0;
  const expires = game.time.worldTime + 86400;
  const base = {
    name: `${talent.name} (${loc("Formulae")})`,
    type: "consumable",
    img: talent.img,
    // Alchemical, so a scholar's inoculations cover them
    flags: {
      [MODULE_ID]: {
        formulaeExpires: expires,
        formula: talent.name,
        alchemical: true,
        sphere: "alchemy",
      },
    },
    system: {
      subType: "potion",
      quantity: opts.quantity,
      uses: { per: "single" },
      description: {
        value: `<p><em>${fmt("FormulaeExpires", { hours: 24 })}</em></p>${talent.system.description.value}`,
      },
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
          notes: {
            footer: [
              fmt("PerCreature", { uses: formulaeDailyUses(ranks, pam) }),
              loc("SalveBleed"),
            ],
          },
        }),
      );
      break;
    case "Elixir": {
      const die = Math.min(12, 4 + 2 * opts.upgrades);
      base.system.actions.push(
        action(loc("Drink"), {
          activation: { type: "standard", unchained: { type: "action", cost: 2 } },
          notes: {
            footer: [
              fmt("ElixirNote", { die }),
              fmt("PerCreature", { uses: formulaeDailyUses(ranks, pam) }),
            ],
          },
        }),
      );
      break;
    }
    case "Panacea":
      base.name = `${talent.name} DC ${opts.dc} (${loc("Formulae")})`;
      base.system.actions.push(
        action(loc("Drink"), {
          notes: { footer: [fmt("Removes", { list: panaceaList(opts.dc) })] },
        }),
      );
      break;
    case "Ambrosia":
      base.name = `${talent.name} DC ${opts.dc} (${loc("Formulae")})`;
      base.system.actions.push(
        action(loc("Drink"), {
          notes: { footer: [fmt("Cures", { list: AMBROSIA[opts.dc] ?? AMBROSIA[25] })] },
        }),
      );
      break;
    case "Neutralizer": {
      base.system.subType = "misc";
      const limits = neutralizerLimits(opts.upgrades);
      const note = fmt("NeutralizerNote", {
        er: neutralizerResistance(ranks),
        energy: opts.energy || loc("ChooseEnergy"),
        ...limits,
      });
      const a = action(loc("Apply"), { notes: { footer: [note] } });
      base.system.actions.push(a);
      // The resistance goes on the treated creature as a buff (its level is the amount) that ends with the paste
      base.flags[MODULE_ID].buffTemplates = {
        neutralizer: {
          name: `${talent.name} (${opts.energy || loc("ChooseEnergy")})`,
          img: talent.img,
          description: `<p>${note}</p>`,
          changes: [],
          contextNotes: [],
        },
      };
      automation[a._id] = {
        effect: { enabled: true, duration: String(limits.minutes), units: "minute" },
        buff: { itemId: "tpl:neutralizer", level: String(neutralizerResistance(ranks)) },
      };
      break;
    }
    case "Focusing Formula": {
      const a = action(loc("Drink"), {
        activation: { type: "move", unchained: { type: "action", cost: 1 } },
        range: { units: "personal" },
      });
      base.system.uses = {
        per: "charges",
        maxFormula: String(1 + opts.upgrades),
        value: 1 + opts.upgrades,
        autoDeductChargesCost: "1",
      };
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
export class FormulaeApp extends foundry.applications.api.HandlebarsApplicationMixin(
  foundry.applications.api.ApplicationV2,
) {
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
      const c = (this.choices[t.id] ??= {
        quantity: 0,
        upgrades: 0,
        dc: t.name === "Ambrosia" ? 25 : 20,
        energy: "",
      });
      return {
        id: t.id,
        name: t.name,
        ...c,
        dcChoices:
          t.name === "Panacea" ? [20, 30, 40] : t.name === "Ambrosia" ? [25, 35, 40, 50] : null,
        upgradable: ["Salve", "Elixir", "Neutralizer", "Focusing Formula"].includes(t.name),
        craftDC: formulaeCraftDC(t.name, c),
        ...formulaeDetails(t.name, c, ranks, this.actor.system.spheres?.pam ?? 0),
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
    if (ctx.over)
      return ui.notifications.warn(
        fmt("TooManyFormulae", { max: ctx.cap.max, prepared: ctx.prepared }),
      );
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
