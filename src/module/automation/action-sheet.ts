/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// pf1's ItemActionSheet is not covered by the bundled types.
// @ts-nocheck

import { MODULE_ID, localize } from "../util";
import { getAutomation, setAutomation } from "./runtime";

const TAB = "pf1spheres";
const esc = (s) =>
  foundry.utils.escapeHTML?.(String(s ?? "")) ??
  String(s ?? "").replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const loc = (k) => localize(`Auto.${k}`);
const opt = (value, label, current) =>
  `<option value="${value}" ${value === (current ?? "") ? "selected" : ""}>${label}</option>`;

/**
 * Adds a "Spheres" tab to pf1's action editor with this action's automation: spell point and
 * martial focus costs, effect tracking, buffs for targets, areas and marks.
 */
export const onRenderActionSheet = (app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  const action = app.action;
  const item = app.item;
  if (!root || !action || !item) return;
  const nav =
    root.querySelector("nav.tabs[data-group='primary']") ?? root.querySelector("nav.tabs");
  const body = root.querySelector("section.primary-body");
  if (!nav || !body || nav.querySelector(`[data-tab='${TAB}']`)) return;

  const a = getAutomation(item, action.id);
  // Buffs on the actor, plus templates the item carries itself ("tpl:<key>"), which work from the compendium
  const templates = Object.entries(item.flags?.[MODULE_ID]?.buffTemplates ?? {}).map(([k, t]) => ({
    id: `tpl:${k}`,
    name: `${t.name} (${loc("Template")})`,
  }));
  const buffs = [
    ...templates,
    ...(item.actor ? item.actor.items.filter((i) => i.type === "buff") : []),
  ];
  const spheres = Object.entries(pf1s.config.magicSpheres)
    .map(([k, v]) => [k, game.i18n.localize(v.label)])
    .sort((x, y) => x[1].localeCompare(y[1]));
  const conds = [...(action.conditionals ?? [])];

  nav.insertAdjacentHTML(
    "beforeend",
    `<a class="item" data-tab="${TAB}" data-group="primary">${localize("SpherePlural")}</a>`,
  );
  body.insertAdjacentHTML(
    "beforeend",
    `<div class="tab ${TAB}" data-group="primary" data-tab="${TAB}">
      <h3 class="form-header">${loc("Costs")}</h3>
      <div class="form-group"><label>${loc("SpCost")}</label>
        <div class="form-fields"><input type="text" data-pf1s="sp" value="${esc(a.sp)}" placeholder="0"></div>
        <p class="hint">${loc("SpCostHint")}</p></div>
      ${conds
        .map(
          (c) => `<div class="form-group"><label>${loc("CondSp")}: ${esc(c.name)}</label>
        <div class="form-fields"><input type="number" min="0" step="1" data-pf1s="condSp.${c.id}" value="${a.condSp?.[c.id] ?? 0}"></div></div>`,
        )
        .join("")}
      <div class="form-group"><label>${loc("Focus")}</label>
        <div class="form-fields"><select data-pf1s="focus">
          ${opt("", loc("FocusNone"), a.focus)}${opt("require", loc("FocusRequire"), a.focus)}${opt("expend", loc("FocusExpend"), a.focus)}${opt("restore", loc("FocusRestore"), a.focus)}
        </select></div></div>

      <h3 class="form-header">${loc("Effect")}</h3>
      <div class="form-group"><label>${loc("Track")}</label>
        <div class="form-fields"><input type="checkbox" data-pf1s="effect.enabled" ${a.effect?.enabled ? "checked" : ""}></div>
        <p class="hint">${loc("TrackHint")}</p></div>
      <div class="form-group"><label>${loc("Duration")}</label>
        <div class="form-fields">
          <input type="text" data-pf1s="effect.duration" value="${esc(a.effect?.duration)}" placeholder="@spheres.cl.total">
          <select data-pf1s="effect.units">${opt("round", loc("Rounds"), a.effect?.units ?? "round")}${opt("minute", loc("Minutes"), a.effect?.units)}${opt("hour", loc("Hours"), a.effect?.units)}</select>
        </div></div>
      <div class="form-group"><label>${loc("Concentration")}</label>
        <div class="form-fields"><input type="checkbox" data-pf1s="effect.concentration" ${a.effect?.concentration ? "checked" : ""}></div>
        <p class="hint">${loc("ConcentrationField")}</p></div>

      <h3 class="form-header">${loc("Buff")}</h3>
      <div class="form-group"><label>${loc("BuffItem")}</label>
        <div class="form-fields"><select data-pf1s="buff.itemId">${opt("", "—", a.buff?.itemId)}${buffs.map((b) => opt(b.id, esc(b.name), a.buff?.itemId)).join("")}</select></div>
        <p class="hint">${item.actor ? loc("BuffHint") : loc("BuffNeedsActor")}</p></div>
      <div class="form-group"><label>${loc("BuffSphere")}</label>
        <div class="form-fields"><select data-pf1s="buff.sphere">${opt("", loc("TalentSphere"), a.buff?.sphere)}${spheres.map(([k, l]) => opt(k, l, a.buff?.sphere)).join("")}</select></div></div>
      <div class="form-group"><label>${loc("BuffLevel")}</label>
        <div class="form-fields"><input type="text" data-pf1s="buff.level" value="${esc(a.buff?.level)}" placeholder="${loc("BuffLevelPlaceholder")}"></div></div>
      <div class="form-group"><label>${loc("BuffSelf")}</label>
        <div class="form-fields"><input type="checkbox" data-pf1s="buff.self" ${a.buff?.self ? "checked" : ""}></div></div>

      <h3 class="form-header">${loc("Zone")}</h3>
      <div class="form-group"><label>${loc("ZoneEnabled")}</label>
        <div class="form-fields"><input type="checkbox" data-pf1s="zone.enabled" ${a.zone?.enabled ? "checked" : ""}></div>
        <p class="hint">${loc("ZoneHint")}</p></div>
      <div class="form-group"><label>${loc("ZoneRadius")}</label>
        <div class="form-fields"><input type="text" data-pf1s="zone.radius" value="${esc(a.zone?.radius)}" placeholder="50 + 5 * floor(@spheres.cl.war.total / 2)">
        <select data-pf1s="zone.who">${opt("allies", loc("Allies"), a.zone?.who ?? "allies")}${opt("enemies", loc("Enemies"), a.zone?.who)}${opt("all", loc("Everyone"), a.zone?.who)}${opt("inoculated", loc("Inoculated"), a.zone?.who)}</select></div></div>
      <div class="form-group"><label>${loc("ZoneAt")}</label>
        <div class="form-fields"><select data-pf1s="zone.at">${opt("", loc("ZoneAtSelf"), a.zone?.at)}${opt("template", loc("ZoneAtTemplate"), a.zone?.at)}</select></div>
        <p class="hint">${loc("ZoneAtHint")}</p></div>

      <h3 class="form-header">${loc("Mark")}</h3>
      <div class="form-group"><label>${loc("MarkLabel")}</label>
        <div class="form-fields"><input type="text" data-pf1s="mark.label" value="${esc(a.mark?.label)}" placeholder="${loc("MarkPlaceholder")}"></div></div>
      <div class="form-group"><label>${loc("MarkAttacker")}</label>
        <div class="form-fields"><input type="text" data-pf1s="mark.attackerNote" value="${esc(a.mark?.attackerNote)}"></div></div>
      <div class="form-group"><label>${loc("MarkDefender")}</label>
        <div class="form-fields"><input type="text" data-pf1s="mark.defenderNote" value="${esc(a.mark?.defenderNote)}"></div>
        <p class="hint">${loc("MarkHint")}</p></div>

      <h3 class="form-header">${loc("SequencePart")}</h3>
      <div class="form-group"><label>${loc("SequencePart")}</label>
        <div class="form-fields"><select data-pf1s="sequence.role">${opt("", loc("SequenceNone"), a.sequence?.role)}${opt("opener", loc("SequenceOpener"), a.sequence?.role)}${opt("link", loc("SequenceLink"), a.sequence?.role)}${opt("finisher", loc("SequenceFinisher"), a.sequence?.role)}</select></div></div>
      <div class="form-group"><label>${loc("SequenceMin")}</label>
        <div class="form-fields"><input type="number" min="1" step="1" data-pf1s="sequence.min" value="${a.sequence?.min ?? 1}"></div></div>
      <div class="form-group"><label>${loc("ThreatNext")}</label>
        <div class="form-fields"><input type="checkbox" data-pf1s="threatNext" ${a.threatNext ? "checked" : ""}></div></div>

      <h3 class="form-header">${loc("OnFail")}</h3>
      <p class="hint">${loc("OnFailHint")}</p>
      <div class="form-group"><label>${loc("FailConditions")}</label>
        <div class="form-fields"><input type="text" data-pf1s="onFail.conditions" value="${esc(a.onFail?.conditions)}" placeholder="blind, deaf"></div>
        <p class="hint">${loc("FailConditionsHint")}</p></div>
      <div class="form-group"><label>${loc("FailConditionRounds")}</label>
        <div class="form-fields"><input type="text" data-pf1s="onFail.conditionRounds" value="${esc(a.onFail?.conditionRounds)}" placeholder="1d4+1"></div></div>
      <div class="form-group"><label>${loc("FailBuff")}</label>
        <div class="form-fields"><select data-pf1s="onFail.buffId">${opt("", "—", a.onFail?.buffId)}${buffs.map((b) => opt(b.id, esc(b.name), a.onFail?.buffId)).join("")}</select></div></div>
      <div class="form-group"><label>${loc("FailBuffLevel")}</label>
        <div class="form-fields"><input type="text" data-pf1s="onFail.buffLevel" value="${esc(a.onFail?.buffLevel)}" placeholder="${loc("FailBuffLevelPlaceholder")}"></div></div>
      <div class="form-group"><label>${loc("FailBuffRounds")}</label>
        <div class="form-fields"><input type="text" data-pf1s="onFail.buffRounds" value="${esc(a.onFail?.buffRounds)}" placeholder="1d4"></div></div>
      <div class="form-group"><label>${loc("FailNote")}</label>
        <div class="form-fields"><input type="text" data-pf1s="onFail.note" value="${esc(a.onFail?.note)}"></div>
        <p class="hint">${loc("FailNoteHint")}</p></div>
      <div class="form-group"><label>${loc("FailRegainFocus")}</label>
        <div class="form-fields"><input type="checkbox" data-pf1s="onFail.regainFocus" ${a.onFail?.regainFocus ? "checked" : ""}></div></div>
    </div>`,
  );

  const tab = body.querySelector(`.tab.${TAB}`);
  tab.addEventListener("change", (ev) => {
    ev.stopPropagation();
    const data = getAutomation(item, action.id);
    for (const el of tab.querySelectorAll("[data-pf1s]")) {
      const v =
        el.type === "checkbox"
          ? el.checked
          : el.type === "number"
            ? Number(el.value) || 0
            : el.value;
      foundry.utils.setProperty(data, el.dataset.pf1s, v);
    }
    setAutomation(item, action.id, data);
  });
  // Keep the tab open across re-renders: pf1 rebinds its tabs before this tab exists, so remember it here
  nav.addEventListener("click", (ev) => {
    const link = ev.target.closest?.("[data-tab]");
    if (link) app._pf1sTabOpen = link.dataset.tab === TAB;
  });
  if (app._pf1sTabOpen) app._tabs?.[0]?.activate(TAB);
};
