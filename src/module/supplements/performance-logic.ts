/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * NOT SPHERES CONTENT. The core bard's bardic performances as actions on pf1's own Bardic Performance
 * item: any character with that item gets an action for each performance item it has (pf1's
 * Inspire Courage, Fascinate and so on), with buffs for the targets that last until the performance
 * ends. Pure data, no Foundry; the grants sync treats it like an item's flags.pf1spheres.grants.
 */

import type { ActionAutomation, BuffTemplate, Grant, GrantVariant } from "../automation/logic";

/** The item that receives the performances, and whose presence turns them on */
export const PERFORMANCE_ITEM = "Bardic Performance";

const BL = "@item.level";
const COURAGE = `1 + floor((${BL} + 1) / 6)`;
const DC = "10 + floor(@classes.bard.level / 2) + @abilities.cha.mod";
const IMG = "icons/svg/sound.svg";

const ch = (formula: string, target: string, type = "untyped") => ({
  formula,
  target,
  type,
  operator: "add",
});
const penalties = (targets: string[]) => targets.map((t) => ch("-2", t));
const tpl = (
  name: string,
  desc: string,
  changes: ReturnType<typeof ch>[] = [],
  notes: { text: string; target: string }[] = [],
): BuffTemplate => ({
  name,
  img: IMG,
  description: `<p>${desc}</p>`,
  changes,
  contextNotes: notes,
});

export const PERFORMANCE_TEMPLATES: Record<string, BuffTemplate> = {
  "inspire-courage": tpl(
    "Inspire Courage",
    "Bardic performance: a morale bonus on saves against charm and fear, and a competence bonus on attack and weapon damage rolls (+1, +1 more at 5th, 11th and 17th bard level).",
    [ch(COURAGE, "attack", "competence"), ch(COURAGE, "wdamage", "competence")],
    [
      {
        text: `Inspire Courage: +[[${COURAGE}]] morale on saves against charm and fear`,
        target: "allSavingThrows",
      },
    ],
  ),
  "inspire-courage-defense": tpl(
    "Inspire Courage (Inspired Defense)",
    "Bardic performance with the marshal's Inspired Defense: the save bonus applies to all saves; a competence bonus on attack and weapon damage rolls.",
    [
      ch(COURAGE, "attack", "competence"),
      ch(COURAGE, "wdamage", "competence"),
      ch(COURAGE, "allSavingThrows", "morale"),
    ],
  ),
  "inspire-courage-mythic": tpl(
    "Inspire Courage (Inspired Defense, mythic)",
    "Bardic performance with Inspired Defense and a use of mythic power: the save bonus applies to all saves and adds the marshal's tier.",
    [
      ch(COURAGE, "attack", "competence"),
      ch(COURAGE, "wdamage", "competence"),
      ch(`${COURAGE} + @caster.details.mythicTier`, "allSavingThrows", "morale"),
    ],
  ),
  "inspire-competence": tpl(
    "Inspire Competence",
    "Bardic performance: a competence bonus on checks with one skill (+2, +1 per four bard levels beyond 3rd).",
    [],
    [
      {
        text: `Inspire Competence: +[[2 + floor((${BL} - 3) / 4)]] competence on checks with the chosen skill`,
        target: "skills",
      },
    ],
  ),
  "inspire-greatness": tpl(
    "Inspire Greatness",
    "Bardic performance: 2 bonus Hit Dice (d10s) with their temporary hit points, which count for Hit Dice dependent effects, a +2 competence bonus on attack rolls and +1 competence on Fortitude saves.",
    [ch("2", "attack", "competence"), ch("1", "fort", "competence")],
  ),
  "inspire-heroics": tpl(
    "Inspire Heroics",
    "Bardic performance: a +4 morale bonus on saving throws and a +4 dodge bonus to AC.",
    [ch("4", "allSavingThrows", "morale"), ch("4", "ac", "dodge")],
  ),
  "dirge-of-doom": tpl(
    "Shaken (Dirge of Doom)",
    "Bardic performance: shaken while within 30 ft. of the bard and able to see and hear the performance. It can't make a creature frightened or panicked (mind-affecting fear).",
    penalties(["attack", "allSavingThrows", "skills", "allChecks"]),
  ),
  fascinated: tpl(
    "Fascinated (Fascinate)",
    "Bardic performance: sits quietly and watches the bard, taking no other actions, with a -4 penalty on skill checks made as reactions (Perception). A potential threat allows a new save; an obvious threat, such as a weapon drawn or a spell cast at it, ends the effect. Lasts as long as the bard keeps performing (up to 1 round per bard level).",
    [],
    [
      {
        text: "Fascinated: -4 on Perception and other skill checks made as reactions",
        target: "skills",
      },
    ],
  ),
  frightened: tpl(
    "Frightened (Frightening Tune)",
    "Bardic performance: frightened, fleeing the bard as well as it can, for as long as it can hear the performance (mind-affecting fear).",
    penalties(["attack", "allSavingThrows", "skills", "allChecks"]),
  ),
};

const FOOT =
  "Bardic performance: start as a standard action (move at 7th level, swift at 13th), then maintain it as a free action each round, spending 1 round of performance per round. One performance at a time; end the effect when it stops.";
const STD = { type: "standard", unchained: { type: "action", cost: 2 } };
const save = (description: string) => ({ type: "will", dc: DC, description });

const perf = (
  name: string,
  automation: NonNullable<GrantVariant["automation"]>,
  foot: string,
  action: Record<string, unknown> = {},
  requires: string[] = [],
): GrantVariant => ({
  requires,
  name,
  action: {
    actionType: "other",
    activation: STD,
    uses: { autoDeductChargesCost: "1" },
    duration: { units: "spec" },
    notes: { footer: [foot, FOOT] },
    ...action,
  },
  automation,
});

const buff = (key: string, extra: Partial<NonNullable<ActionAutomation["buff"]>> = {}) => ({
  effect: { enabled: true },
  buff: { itemId: `tpl:${key}`, level: "@classes.bard.level", ...extra },
});
const ft30 = { range: { units: "ft", value: "30" } };
const grant = (key: string, ...variants: GrantVariant[]): Grant => ({
  key: `perf:${key}`,
  target: PERFORMANCE_ITEM,
  variants,
});

/** Every performance; each variant needs the performance's own item, so a bard only gets what he has */
export const PERFORMANCE_GRANTS: Grant[] = [
  grant(
    "countersong",
    perf(
      "Countersong",
      { effect: { enabled: true } },
      "Roll Perform (keyboard, percussion, wind, string or sing). Creatures within 30 ft. (you included) affected by a sonic or language-dependent magical attack may use your result in place of their save. Up to 10 rounds.",
      ft30,
      ["Countersong"],
    ),
  ),
  grant(
    "distraction",
    perf(
      "Distraction",
      { effect: { enabled: true } },
      "Roll Perform (act, comedy, dance or oratory). Creatures within 30 ft. (you included) affected by an illusion (pattern) or (figment) may use your result in place of their save. Up to 10 rounds.",
      ft30,
      ["Distraction"],
    ),
  ),
  grant(
    "fascinate",
    perf(
      "Fascinate",
      { effect: { enabled: true }, onFail: { buffId: "tpl:fascinated", whileEffect: true } },
      "Target creatures within 90 ft. that can see and hear you and pay attention (not in combat): one, plus one per three bard levels beyond 1st. A creature that saves can't be fascinated by you for 24 hours.",
      { range: { units: "ft", value: "90" }, save: save("Will negates") },
      ["Fascinate"],
    ),
  ),
  grant(
    "inspire-courage",
    perf(
      "Inspire Courage",
      buff("inspire-courage-defense", { self: true }),
      "Target the allies who can hear you; you are included.",
      {},
      ["Inspire Courage", "Inspired Defense"],
    ),
    perf(
      "Inspire Courage",
      buff("inspire-courage", { self: true }),
      "Target the allies who can hear you; you are included.",
      {},
      ["Inspire Courage"],
    ),
  ),
  grant(
    "inspire-courage-mythic",
    perf(
      "Inspire Courage (mythic power)",
      buff("inspire-courage-mythic", { self: true }),
      "Inspired Defense with a use of mythic power: spend it with Inspired Defense's own button. Target the allies who can hear you; you are included.",
      {},
      ["Inspire Courage", "Inspired Defense"],
    ),
  ),
  grant(
    "inspire-competence",
    perf(
      "Inspire Competence",
      buff("inspire-competence", { others: true }),
      "Target one ally within 30 ft. who can see and hear you (never yourself); name the skill.",
      ft30,
      ["Inspire Competence"],
    ),
  ),
  grant(
    "suggestion",
    perf(
      "Suggestion",
      {},
      "As the spell, on one creature you have fascinated; a standard action that doesn't end the fascination, usable more than once per performance. Mind-affecting, language dependent.",
      { save: save("Will negates"), uses: { autoDeductChargesCost: "0" } },
      ["Suggestion"],
    ),
  ),
  grant(
    "dirge-of-doom",
    perf(
      "Dirge of Doom",
      buff("dirge-of-doom", { others: true }),
      "Target the enemies within 30 ft. who can see and hear you. Remove the buff from any that move beyond 30 ft.",
      ft30,
      ["Dirge of Doom"],
    ),
  ),
  grant(
    "inspire-greatness",
    perf(
      "Inspire Greatness",
      {
        ...buff("inspire-greatness"),
        tempHp: { formula: "2d10 + 2 * @abilities.con.mod", who: "targets" },
      },
      "Target yourself or willing allies within 30 ft.: one, plus one per three bard levels beyond 9th. Each rolls 2d10 + twice its Constitution modifier temporary hit points; with no targets, you get them.",
      ft30,
      ["Inspire Greatness"],
    ),
  ),
  grant(
    "soothing-performance",
    perf(
      "Soothing Performance",
      {},
      "Mass cure serious wounds at your bard level: apply the healing to each creature (one per bard level, no two more than 30 ft. apart), and remove fatigued, sickened and shaken from them. Takes 4 rounds of continuous performance (charged here).",
      {
        actionType: "heal",
        uses: { autoDeductChargesCost: "4" },
        duration: { units: "inst" },
        damage: {
          parts: [{ formula: "3d8 + min(35, @classes.bard.level)", types: ["positive"] }],
        },
      },
      ["Soothing Performance"],
    ),
  ),
  grant(
    "frightening-tune",
    perf(
      "Frightening Tune",
      { effect: { enabled: true }, onFail: { buffId: "tpl:frightened", whileEffect: true } },
      "Target the enemies within 30 ft. who can hear you. A creature that saves is immune for 24 hours. Mind-affecting fear.",
      { ...ft30, save: save("Will negates") },
      ["Frightening Tune"],
    ),
  ),
  grant(
    "inspire-heroics",
    perf(
      "Inspire Heroics",
      buff("inspire-heroics"),
      "Target yourself or allies within 30 ft. who can see and hear you: one, plus one per three bard levels beyond 15th.",
      ft30,
      ["Inspire Heroics"],
    ),
  ),
  grant(
    "mass-suggestion",
    perf(
      "Mass Suggestion",
      {},
      "As suggestion, on any number of creatures you have fascinated at once.",
      { save: save("Will negates"), uses: { autoDeductChargesCost: "0" } },
      ["Mass Suggestion"],
    ),
  ),
  grant(
    "deadly-performance",
    perf(
      "Deadly Performance",
      { onFail: { conditions: "dead" } },
      "One enemy within 30 ft. that has seen and heard you perform for a full round. On a successful save it is staggered for 1d4 rounds and immune for 24 hours. Mind-affecting death effect.",
      { ...ft30, save: save("Will negates (staggered 1d4 rounds instead)") },
      ["Deadly Performance"],
    ),
  ),
];
