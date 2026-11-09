/*
 * SPDX-FileCopyrightText: 2022 Ethaks <ethaks@pm.me>
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import type { ActorPF, PF1ActorSpheresData, SpheresTalentsRecord } from "./actor-data";
import { SpheresActorSettings } from "./apps/SpheresActorSettings";
import type { CombatSphere, ItemPF, MagicSphere, Sphere } from "./item-data";
import { enforce, getGame, localize } from "./util";
import { setSpellPoints } from "./actor";
import { renderPf1sTemplate } from "./preloadTemplates";
import { activateSphereTooltip } from "./sphere-tooltip";
import { getWeatherCaster } from "./weather/caster";
import { openCasterWeather } from "./weather/caster-app";
import {
  changeSequence,
  clearMyMarks,
  effectRemaining,
  endEffect,
  endSequence,
  getEffects,
  getSequence,
  marksPlacedBy,
  persistEffect,
  prodigyLevel,
  setImbue,
} from "./automation/runtime";
import {
  buildBlastActions,
  isAlchemist,
  isBlaster,
  openFormulae,
  rollMsbVsTargets,
} from "./automation/features";
import { formatRemaining, inspiredBonus, parseImbuements, sequenceMax } from "./automation/logic";

const effectIdOf = (ev: JQuery.ClickEvent) =>
  (ev.currentTarget as HTMLElement).closest<HTMLElement>("[data-effect-id]")?.dataset.effectId ??
  "";

export const onActorSheetHeaderButtons = (
  sheet: ActorSheetPF,
  buttons: Application.HeaderButton[],
) => {
  if (sheet.isEditable) {
    const actor = sheet.actor;
    buttons.unshift({
      class: "pf1spheres-actor-settings",
      icon: "fas fa-spinner",
      label: localize("SpherePlural"),
      onclick: (_) => new SpheresActorSettings(actor).render(true),
    });
  }
};

export const onActorSheetRender: (
  app: ActorSheetPF,
  html: JQuery,
  options: ActorSheetPFData,
) => boolean = (app, html, _options) => {
  if (app.spheresTab == null) {
    app.spheresTab = { activateTab: false, expandedSpheres: {} };
  }

  const actor = app.actor as ActorPF;

  // The tab is opt-in per actor, toggled in the Spheres settings window
  if (actor.flags.pf1spheres?.showSpheresTab !== true) {
    app.spheresTab.activateTab = false;
    return true;
  }

  addNavTab(app, html);

  const body = html.find("section.primary-body").first();

  const renderData = getSpheresData(app, actor);
  const renderedTemplate = getRenderedSpheresTab(renderData);
  const spheresBody = body.append($(renderedTemplate));
  activateListeners(app, spheresBody, actor);
  // Traditions and their members are shown on the Spheres tab instead of crowding the Features list
  for (const t of renderData.traditions) {
    for (const id of [t.id, ...t.members.map((m: { id: string }) => m.id)]) {
      html.find(`.tab[data-tab='feats'] .item[data-item-id='${id}']`).remove();
    }
  }

  // Re-focus spheres tab
  // NOTE: Can be expanded for multiple tabs
  if (app.spheresTab.activateTab === "spheres") {
    // @ts-expect-error Accessing tabs is necessary
    app._tabs[0].activate("spheres");
    app.setPosition();
  }

  return true;
};

const addNavTab = (app: ActorSheetPF, html: JQuery<HTMLElement>) => {
  // Handle tab in navigation TODO: Pure JS?
  const tabSelector = html.find("nav.sheet-navigation.tabs").first();
  const spheresTabTitle = $(`<a class="item" data-tab="spheres">${localize("SpherePlural")}</a>`);
  // Between Spells and Buffs; at the end if the sheet has no Buffs tab
  const buffs = tabSelector.children("[data-tab='buffs']").first();
  if (buffs.length) buffs.before(spheresTabTitle);
  else tabSelector.append(spheresTabTitle);
  const newTab = tabSelector;
  newTab.on("click", (ev: JQuery.ClickEvent<HTMLElement>) => {
    const isSpheresTab = ev.target.dataset?.tab === "spheres";
    app.spheresTab.activateTab = isSpheresTab ? "spheres" : false;
  });
};

/**
 * Martial and casting traditions: features flagged pf1spheres.tradition, whose members are their pf1
 * "children" links (added by dragging items into the tradition's Links tab).
 *
 * @param actor - The actor
 */
const getTraditions = (actor: ActorPF) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (actor as any).items.contents as any[];
  const traditions = items.filter((i) =>
    ["martial", "casting"].includes(i.flags?.pf1spheres?.tradition),
  );
  const inAny = new Set(traditions.flatMap((t) => traditionMemberIds(t)));
  // Features and talents not in any tradition, to pick from
  const candidates = items
    .filter(
      (i) =>
        i.type === "feat" &&
        !i.flags?.pf1spheres?.tradition &&
        !i.flags?.pf1spheres?.spellPool &&
        !inAny.has(i.id),
    )
    .map((i) => ({ id: i.id, name: i.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return traditions.map((t) => ({
    id: t.id,
    name: t.name,
    img: t.img,
    kind: t.flags.pf1spheres.tradition,
    kindLabel: localize(
      t.flags.pf1spheres.tradition === "martial" ? "MartialTradition" : "CastingTradition",
    ),
    members: traditionMemberIds(t)
      .map((id) => items.find((i) => i.id === id))
      .filter(Boolean)
      .map((i: { id: string; name: string; img: string }) => ({
        id: i.id,
        name: i.name,
        img: i.img,
      })),
    candidates,
  }));
};

/**
 * A tradition's members: the module's own list (flags.pf1spheres.members), so deleting a tradition only
 * removes the tradition. pf1 "children" links, used before, would delete the members with it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const traditionMemberIds = (t: any): string[] => [
  ...new Set<string>([
    ...(t.flags?.pf1spheres?.members ?? []),
    ...(t.system?.links?.children ?? []).map((l: { uuid: string }) => l.uuid.split(".").pop()),
  ]),
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const setMembers = (tradition: any, ids: string[]) =>
  tradition.update({ "flags.pf1spheres.members": [...new Set(ids)], "system.links.children": [] });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const addMember = (actor: any, traditionId: string, itemId: string) => {
  const t = actor.items.get(traditionId);
  if (!t || !itemId || itemId === traditionId || !actor.items.get(itemId)) return;
  // An item belongs to one tradition at a time
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const other of actor.items.filter((i: any) => i.flags?.pf1spheres?.tradition && i !== t)) {
    const ids = traditionMemberIds(other);
    if (ids.includes(itemId))
      setMembers(
        other,
        ids.filter((id) => id !== itemId),
      );
  }
  return setMembers(t, [...traditionMemberIds(t), itemId]);
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const removeMember = (actor: any, traditionId: string, itemId: string) => {
  const t = actor.items.get(traditionId);
  if (t)
    return setMembers(
      t,
      traditionMemberIds(t).filter((id) => id !== itemId),
    );
};

const createTradition = async (actor: ActorPF, kind: "martial" | "casting") => {
  const name = localize(kind === "martial" ? "MartialTradition" : "CastingTradition");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [item] = await (actor as any).createEmbeddedDocuments("Item", [
    {
      name,
      type: "feat",
      img:
        kind === "martial"
          ? "icons/skills/melee/weapons-crossed-swords-white-blue.webp"
          : "icons/magic/symbols/runes-star-pentagon-blue.webp",
      system: {
        subType: "classFeat",
        description: { value: `<p>${localize("TraditionHint")}</p>` },
      },
      flags: { pf1spheres: { tradition: kind, members: [] } },
    },
  ]);
  item?.sheet?.render(true);
};

const normaliseSphere = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");

/**
 * The imbuements a prodigy can choose: those listed in Imbue Sequence for each magic sphere she has,
 * and for the current choice its text and the finishers it unlocks.
 *
 * @param actor - The prodigy
 * @param current - The chosen imbuement, "Sphere: Name"
 */
const imbueChoices = (actor: ActorPF, current: string) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items = (actor as any).items.contents as any[];
  const feature = items.find((i) => i.name === "Imbue Sequence");
  if (!feature) return { imbueOptions: [], imbueChosen: null };
  const known = new Set(
    items
      .filter((i) => i.system.subType === "magicTalent")
      .map((i) => i.flags?.pf1spheres?.sphere)
      .filter(Boolean)
      .map((k: string) => normaliseSphere(k)),
  );
  const groups = parseImbuements(feature.system.description?.value ?? "").filter((g) =>
    known.has(normaliseSphere(g.sphere)),
  );
  const imbueOptions = groups.flatMap((g) =>
    g.entries
      .filter((e) => e.kind === "imbue")
      .map((e) => {
        const value = `${g.sphere}: ${e.name}`;
        return {
          value,
          label: e.requires ? `${value} (${e.requires})` : value,
          selected: value === current,
        };
      }),
  );
  const group = groups.find((g) =>
    g.entries.some((e) => e.kind === "imbue" && `${g.sphere}: ${e.name}` === current),
  );
  const imbue = group?.entries.find(
    (e) => e.kind === "imbue" && `${group.sphere}: ${e.name}` === current,
  );
  const imbueChosen =
    group && imbue
      ? { ...imbue, finishers: group.entries.filter((e) => e.kind === "finish") }
      : null;
  return { imbueOptions, imbueChosen };
};

const getSpheresData = (app: ActorSheetPF, actor: ActorPF): SpheresTemplateData => {
  if (!actor.system.spheres) throw new Error("Spheres data missing!");
  const spheres = actor.system.spheres as PF1ActorSpheresData;

  const attributeGrid = (["cl", "msb", "msd"] as const).map(
    (attribute): AttributeData => ({
      attribute,
      total: spheres[attribute].total ?? 0,
      label: localize(attribute.toLocaleUpperCase() as Uppercase<typeof attribute>),
      rollable: ["msb"].includes(attribute) ? "rollable" : "",
    }),
  );
  // Insert Concentration element between MSB and MSD
  attributeGrid.splice(2, 0, {
    attribute: "concentration",
    total: actor.system.spheres.concentration.total ?? 0,
    label: localize("PF1.Concentration"),
    rollable: "rollable",
  });

  // const spellPool = actor.items.getName("Spell Pool");
  // attributeGrid.push({
  //   attribute: "spellPool",
  //   total: spellPool && "uses" in spellPool.data.data ? spellPool?.data.data.uses?.value ?? 0 : 0,
  //   label: "Spell Pool", // TODO: localise, or use item tag?
  //   path: spellPool
  //     ? spellPool.data.data.useCustomTag
  //       ? `@resources.${spellPool.data.data.tag}`
  //       : "@resources.spellPool.value"
  //     : "",
  //   sources: [],
  //   cappedSources: [],
  //   rollable: "",
  // });

  attributeGrid.push({
    attribute: "bab",
    total: actor.system.attributes.bab.total,
    label: localize("PF1.BABAbbr"),
    rollable: "",
  });
  // const martialFocus = actor.items.getName("Martial Focus");
  // attributeGrid.push({
  //   attribute: "martialFocus",
  //   total:
  //     martialFocus && "uses" in martialFocus.data.data
  //       ? martialFocus?.data.data.uses?.value ?? 0
  //       : 0,
  //   label: "Martial Focus", // TODO: localise, or use item tag?
  //   path: martialFocus
  //     ? martialFocus?.data.data.useCustomTag
  //       ? `@resources.${martialFocus?.data.data.tag}.value`
  //       : "@resources.martialFocus.value"
  //     : "",
  //   sources: [],
  //   cappedSources: [],
  //   rollable: "",
  // });

  const levelLabels = {
    magic: localize("CL"),
    combat: localize("PF1.BABAbbr"),
  };

  // Get owned talents and collect info for every sphere regardless of talents
  const ownedTalents = actor.items.reduce((talents: TalentMap, item) => {
    const sphere = item.flags.pf1spheres?.sphere;
    if (
      item.type === "feat" &&
      ["combatTalent", "magicTalent"].includes(item.system.subType) &&
      sphere
    ) {
      talents[sphere] ??= [];
      talents[sphere]?.push(getTalentTemplateData(item));
    }
    return talents;
  }, {});
  const sphereCLs = Object.keys(pf1s.config.magicSpheres).map(
    (sphere): SphereData => ({
      sphere,
      tooltipId: `cl:${sphere}`,
      label: pf1s.config.magicSpheres[sphere].label,
      levelLabel: levelLabels.magic,
      total: spheres.cl[sphere].total ?? 0,
      icon: pf1s.config.magicSpheres[sphere].icon || CONFIG.Item.documentClass.DEFAULT_ICON,
      talents: ownedTalents[sphere] ?? [],
      talentCounts: spheres.talents[sphere],
      hasTalents: Boolean(ownedTalents[sphere]?.length),
      expandTalents: Boolean(app.spheresTab.expandedSpheres[sphere] ?? false),
    }),
  );
  const sphereBabs = Object.keys(pf1s.config.combatSpheres).map(
    (sphere): SphereData => ({
      sphere,
      tooltipId: `bab:${sphere}`,
      label: pf1s.config.combatSpheres[sphere].label,
      levelLabel: levelLabels.combat,
      total: actor.system.spheres?.bab[sphere].total ?? 0,
      icon: pf1s.config.combatSpheres[sphere].icon || CONFIG.Item.documentClass.DEFAULT_ICON,
      talents: ownedTalents[sphere] ?? [],
      talentCounts: spheres.talents[sphere],
      hasTalents: Boolean(ownedTalents[sphere]?.length),
      expandTalents: Boolean(app.spheresTab.expandedSpheres[sphere] ?? false),
    }),
  );

  return {
    dataGroup: "primary",
    attributeGrid,
    spellPoints: { value: spheres.spellPoints.value, max: spheres.spellPoints.max },
    martialFocus: spheres.martialFocus === 1,
    weatherCaster: getWeatherCaster(actor as never) !== null,
    alchemist: isAlchemist(actor),
    blaster: isBlaster(actor),
    effects: getEffects(actor).map((e) => ({
      ...e,
      remaining: formatRemaining(effectRemaining(e)),
      canPersist: e.concentration && Boolean(e.persistSeconds),
    })),
    marks: marksPlacedBy(actor),
    sequence:
      prodigyLevel(actor) > 0
        ? {
            ...getSequence(actor),
            max: sequenceMax(prodigyLevel(actor)),
            bonus: inspiredBonus(getSequence(actor).length),
            ...imbueChoices(actor, getSequence(actor).imbue ?? ""),
          }
        : null,
    traditions: getTraditions(actor),
    sphereCLs,
    sphereBabs,
    allSpheres: [...sphereCLs, ...sphereBabs].sort((a, b) => a.sphere.localeCompare(b.sphere)),
  };
};

const getRenderedSpheresTab = (data: SpheresTemplateData) =>
  renderPf1sTemplate("actor-spheres-tab", data);

const activateListeners = (app: ActorSheetPF, html: JQuery<HTMLElement>, actor: ActorPF) => {
  html.find(".msb>.attribute-name.rollable").on("click", _onMsbRoll(actor));
  html.find(".concentration>.attribute-name.rollable").on("click", _onConcentrationRoll(actor));

  html.find(".expand-sphere").on("click", _toggleSphereTalentsDisplay(app));

  html
    .find(".talent-name")
    // @ts-expect-error Weird contextmenu types?
    .on("contextmenu", pf1.applications.actor.ActorSheetPF.prototype._onItemEdit.bind(app));

  // TODO: Decide upon own solution for rolling – depends on how talents should be activated
  html
    .find(".talent-use>a")
    .on("click", pf1.applications.actor.ActorSheetPF.prototype._itemActivationControl.bind(app));
  html.find(".talent .talent-icon").on("click", (event) => app._onItemRoll(event));

  html.find(".sphere-label").on("click", _openSphereJournal);
  // The pool lives on the Spell Points item (or the actor flag before it exists), not in the sheet form
  html.find("input.pf1s-spell-points").on("change", (ev) => {
    ev.stopPropagation();
    setSpellPoints(actor, Number((ev.currentTarget as HTMLInputElement).value) || 0);
  });
  html.find(".pf1s-control-weather").on("click", () => openCasterWeather(actor));
  html.find(".pf1s-tradition-add").on("change", (ev) => {
    const el = ev.currentTarget as HTMLSelectElement;
    addMember(actor, el.dataset.traditionId ?? "", el.value);
  });
  html.find(".pf1s-tradition-remove").on("click", (ev) => {
    const el = ev.currentTarget as HTMLElement;
    removeMember(actor, el.dataset.traditionId ?? "", el.dataset.itemId ?? "");
  });
  // Drag an item from this sheet onto a tradition to add it
  html.find(".tradition").on("dragover", (ev) => ev.preventDefault());
  html.find(".tradition").on("drop", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const g = globalThis as any;
    const data = g.foundry.applications.ux.TextEditor.implementation.getDragEventData(
      ev.originalEvent,
    );
    const item = data?.type === "Item" && data.uuid ? g.fromUuidSync(data.uuid) : null;
    if (item?.parent === actor)
      addMember(actor, (ev.currentTarget as HTMLElement).dataset.traditionId ?? "", item.id);
  });
  html
    .find(".pf1s-tradition-new")
    .on("click", (ev) =>
      createTradition(
        actor,
        (ev.currentTarget as HTMLElement).dataset.kind as "martial" | "casting",
      ),
    );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  html
    .find(".pf1s-open-item")
    .on("click", (ev) =>
      (actor as any).items
        .get((ev.currentTarget as HTMLElement).dataset.itemId)
        ?.sheet?.render(true),
    );
  html.find(".pf1s-prepare-formulae").on("click", () => openFormulae(actor));
  html.find(".pf1s-build-blasts").on("click", () => buildBlastActions(actor));
  html.find(".pf1s-msb-vs").on("click", () => rollMsbVsTargets(actor));
  html.find(".pf1s-effect-end").on("click", (ev) => endEffect(actor, effectIdOf(ev)));
  html.find(".pf1s-effect-persist").on("click", (ev) => persistEffect(actor, effectIdOf(ev)));
  html.find(".pf1s-clear-marks").on("click", () => clearMyMarks(actor));
  html.find(".pf1s-seq-add").on("click", () => changeSequence(actor, 1));
  html.find(".pf1s-seq-sub").on("click", () => changeSequence(actor, -1));
  html.find(".pf1s-seq-end").on("click", () => endSequence(actor));
  html
    .find(".pf1s-seq-imbue")
    .on("change", (ev) =>
      setImbue(actor, (ev.currentTarget as HTMLInputElement | HTMLSelectElement).value),
    );

  html
    // @ts-expect-error Incorrect types
    .on("pointerover", "[data-tooltip-sphere]", activateSphereTooltip(app))
    // @ts-expect-error Missing tooltip types
    .on("pointerleave", "[data-tooltip-sphere]", () => getGame().tooltip.deactivate());
};

const getTalentTemplateData = (item: ItemPF): TalentTemplateData => ({
  id: item.id ?? "",
  img: item.img ?? pf1.config.defaultIcons.items.feat,
  name: item.name ?? "",
  tags: item.system.tags,
  hasAction: item.hasAction,
  activationType: item.getLabels().activation,
});

interface TalentTemplateData {
  id: string;
  img: string;
  name: string;
  tags: string[];
  hasAction: boolean;
  activationType: string;
}

const _onMsbRoll = (actor: ActorPF) => (ev: JQuery.ClickEvent<HTMLElement>) => {
  ev.preventDefault();
  return actor.spheres.rollMsb({ skipDialog: pf1.documents.settings.getSkipActionPrompt() });
};

const _onConcentrationRoll = (actor: ActorPF) => (ev: JQuery.ClickEvent<HTMLElement>) => {
  ev.preventDefault();
  return actor.spheres.rollConcentration({
    skipDialog: pf1.documents.settings.getSkipActionPrompt(),
  });
};

/**
 * Opens a journal entry sheet for the clicked on sphere
 *
 * @param event - The click event for a sphere label
 */
const _openSphereJournal = async (event: JQuery.ClickEvent<HTMLElement>) => {
  event.preventDefault();

  const sphere = event.currentTarget.closest(".sphere")?.dataset.sphere as Sphere | undefined;
  enforce(sphere);
  const sphereConfigs = {
    ...pf1s.config.magicSpheres,
    ...pf1s.config.combatSpheres,
    ...pf1s.config.skillSpheres,
  };
  const sphereConfig = sphereConfigs[sphere];
  if (!("reference" in sphereConfig)) throw new Error(`Sphere ${sphere} has no reference`);
  return openJournal(sphereConfig.reference, { width: 700, height: 800 });
};

/**
 * Opens journal or journal page.
 *
 * Pages are opened in collapsed state.
 *
 * @param uuid - UUID to journal or journal page
 * @param [options={}] - Additional rendering options
 */
export async function openJournal(uuid: string, options = {}) {
  const journal = await fromUuid(uuid);
  enforce(journal);

  // @ts-expect-error Missing types
  if (journal instanceof JournalEntryPage) {
    journal.parent.sheet.render(true, {
      pageId: journal.id,
      editable: false,
      collapsed: true,
      width: 600,
      height: 700,
      ...options,
    });
  } else {
    // @ts-expect-error Missing types
    journal.sheet.render(true, { editable: false, ...options });
  }

  return journal;
}

const _toggleSphereTalentsDisplay = (app: ActorSheetPF) => (ev: JQuery.ClickEvent<HTMLElement>) => {
  ev.preventDefault();

  // TODO: Look for pure JS alternative?
  const sphere = $(ev.currentTarget).parents(".sphere").data("sphere") as Sphere;
  const talents = $(ev.currentTarget).parents(".sphere").find(".sphere-talents");
  talents.slideToggle({
    duration: "fast",
    complete: function () {
      if ($(this).is(":visible")) {
        $(this).css("display", "grid");
        app.spheresTab.expandedSpheres[sphere] = true;
      } else {
        app.spheresTab.expandedSpheres[sphere] = false;
      }
    },
    start: function () {
      $(this).css("display", "grid");
    },
  });

  ev.currentTarget.querySelector("i").classList.toggle("rotate-arrow");
};

interface ActorSheetPFData {
  actor: ActorPF;
}

export declare class ActorSheetPF extends ActorSheet {
  _onItemEdit: (ev: JQuery.ClickEvent<HTMLElement>) => void;
  _itemActivationControl: (ev: JQuery.ClickEvent<HTMLElement>) => void;
  _onItemRoll: (ev: JQuery.ClickEvent<HTMLElement>) => void;
  spheresTab: {
    activateTab: string | false;
    expandedSpheres: Partial<Record<Sphere, boolean>>;
  };
}

interface SpheresTemplateData {
  dataGroup: string;
  traditions: ReturnType<typeof getTraditions>;
  attributeGrid: AttributeData[];
  spellPoints: { value: number; max: number };
  martialFocus: boolean;
  weatherCaster: boolean;
  alchemist: boolean;
  blaster: boolean;
  effects: unknown[];
  marks: unknown[];
  sequence: unknown;
  sphereCLs: SphereData[];
  sphereBabs: SphereData[];
  allSpheres: SphereData[];
}

interface SphereData {
  sphere: MagicSphere | CombatSphere;
  tooltipId: string;
  label: string;
  levelLabel: string;
  total: number;
  icon: string;
  talents: TalentTemplateData[];
  hasTalents: boolean;
  expandTalents: boolean;
  talentCounts: SpheresTalentsRecord[Sphere];
}

type TalentMap = {
  [Key in Sphere]?: TalentTemplateData[];
};

interface AttributeData {
  attribute?: "cl" | "msb" | "concentration" | "msd" | "bab" | "martialFocus" | "spellPool";
  sphere?: Sphere;
  total: number;
  label: string;
  rollable: "rollable" | "";
}
