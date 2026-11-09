/*
 * SPDX-FileCopyrightText: 2022 Ethaks <ethaks@pm.me>
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import type { TotalData, TotalModData, ValueData } from "./common-data";
import type { ActorPF, PF1ActorSpheresData } from "./actor-data";
import type {
  CombatSphere,
  MagicSphere,
  PF1ClassDataSource,
  PF1FeatDataSourceData,
  SkillSphere,
} from "./item-data";
import { getActorMethods } from "./actor-methods";
import { getActorHelpers } from "./actor-util";
import { getGame, localize } from "./util";
import type { ItemPF } from "./item-data";
import { isTalent } from "./item-util";

/**
 * Hooks into the preparation of base data for Actors, setting base values
 * derived from class levels.
 *
 * Every change target needs to get initialised with a value of the type number,
 * as otherwise Changes cannot be calculated and summed up.
 *
 * @param actor - The actor whose data gets prepared
 */
export const onActorBasePreparation = (actor: ActorPF): void => {
  // Do not interact with basic actors, whose data can/should be empty
  if (actor.type === "basic") return;

  // Add Spheres actor methods if not already present
  // @ts-expect-error - This adds the spheres property to the actor
  if (!("spheres" in actor)) actor.spheres = getActorMethods(actor);

  // Populate/reset spheres data
  const sphereData = (actor.system.spheres = getBlankSphereData());

  // Start actual calculations
  const useFractionalBAB = getGame().settings.get("pf1", "useFractionalBaseBonuses") ?? false;

  const { pushPSourceInfo } = getActorHelpers(actor);
  pushPSourceInfo("system.spheres.msd.base", {
    name: localize("PF1.Base"),
    value: 11,
  });

  // Determine MSB and Caster Level from classes
  // @ts-expect-error - Hack for outdated types
  const { casterLevel, baseMSB } = actor.items
    .filter(filterClasses)
    .map(getItemLevelData(useFractionalBAB))
    .map(pushLevelSources(actor))
    .reduce(
      (levels, data) => {
        levels.casterLevel += data.clPart;
        levels.baseMSB += data.baseLevel;
        return levels;
      },
      { casterLevel: 0, baseMSB: 0 },
    );

  // Set base MSB and MSD
  sphereData.msb.base = baseMSB;
  // Spell pools from all casting classes stack, so the base is the sum of casting class levels
  sphereData.spellPoints.base = baseMSB;
  sphereData.msd.base = baseMSB + 11;

  // Base Caster Level after fractional BAB check
  sphereData.cl.base = useFractionalBAB ? Math.floor(casterLevel) : casterLevel;

  // Talent counts
  for (const talent of actor.items.filter(
    (item): item is ItemPF & { system: PF1FeatDataSourceData } => isTalent(item),
  )) {
    if (talent.flags.pf1spheres?.sphere) {
      const sphere = talent.flags.pf1spheres.sphere;
      const sphereTalentsData = sphereData.talents[sphere];
      if (!sphereTalentsData) continue; // Skip talents with invalid spheres
      if (talent.system.disabled) continue; // Ignore fully disabled talents
      if (talent.flags.pf1spheres?.countExcluded === true) sphereTalentsData.excluded++;
      else sphereTalentsData.value++;
      sphereTalentsData.total++;
    }
  }
};

/** Filters itemData by its type, narrowing available data to class data with a caster progression */
export const filterClasses = (item: ItemPF): item is ItemPF & PF1ClassDataSource =>
  item.type === "class" && Boolean(item.flags.pf1spheres?.casterProgression);

/**
 * Returns a function that determines an itemData's effective contribution to
 * a character's overall sphere caster level dependent on fractional BAB rules usage.
 */
export const getItemLevelData =
  (useFractionalBAB: boolean) =>
  (item: ItemPF & PF1ClassDataSource): ItemSphereClData => {
    const baseLevel = item.system.level ?? 0;

    // Determine progression for actual CL contribution
    const progression = item.flags.pf1spheres?.casterProgression;
    const rawLevel =
      progression && progression in pf1s.config.progressionFormula
        ? pf1s.config.progressionFormula[progression] * baseLevel
        : 0;

    // The actual number of levels contributed by this class
    const clPart = useFractionalBAB ? rawLevel : Math.floor(rawLevel);

    return { baseLevel, clPart, name: item.name ?? "" };
  };

/**
 * Returns a function that adds an itemData's data to an actor's source info
 * and returns the itemData unchanged.
 */
export const pushLevelSources = (
  actor: ActorPF,
): ((data: ItemSphereClData) => ItemSphereClData) => {
  // Get curried function to add to sourceInfo
  const { pushPSourceInfo } = getActorHelpers(actor);

  return (data: ItemSphereClData): ItemSphereClData => {
    if (data.baseLevel > 0) {
      pushPSourceInfo("system.spheres.msb.base", {
        value: data.baseLevel ?? 0,
        name: data.name,
        type: "untyped",
      });
      pushPSourceInfo("system.spheres.msd.base", {
        value: data.baseLevel ?? 0,
        name: data.name,
        type: "untyped",
      });
    }
    if (data.clPart > 0) {
      pushPSourceInfo("system.spheres.cl.base", {
        value: data.clPart,
        name: data.name,
        type: "untyped",
      });
    }
    return data;
  };
};

/**
 * Returns an object containing all spheres data with reset values as it is expected by the system.
 */
const getBlankSphereData = (): PF1ActorSpheresData => {
  // Data layouts for spheres data
  const valueDataTemplate = (): ValueData<number> => ({
    base: 0,
    modCap: 0,
    total: 0,
  });
  const totalModTemplate = (): TotalModData<number> => ({
    modCap: 0,
    total: 0,
  });
  const totalTemplate = (): TotalData<number> => ({ total: 0 });

  /** Helper to fill a Record containing spheres, each with a data set */
  /* eslint-disable-next-line @typescript-eslint/ban-types */
  const fillSpheres = <S extends string, D extends () => object>(keys: S[], data: D) =>
    Object.fromEntries(keys.map((k) => [k, data()])) as { [Key in S]: ReturnType<D> };

  return {
    cl: {
      ...fillSpheres(Object.keys(pf1s.config.magicSpheres) as MagicSphere[], totalModTemplate),
      ...valueDataTemplate(),
    },
    cam: 0,
    pam: 0,
    oam: 0,
    msb: valueDataTemplate(),
    msd: valueDataTemplate(),
    concentration: totalTemplate(),
    bab: fillSpheres(Object.keys(pf1s.config.combatSpheres) as CombatSphere[], totalModTemplate),
    spellPoints: { base: 0, bonus: 0, max: 0, value: 0 },
    martialFocus: 0,
    talents: {
      ...fillSpheres(
        [
          ...Object.keys(pf1s.config.magicSpheres),
          ...Object.keys(pf1s.config.combatSpheres),
          ...Object.keys(pf1s.config.skillSpheres),
        ] as (MagicSphere | CombatSphere | SkillSphere)[],
        () => ({ total: 0, value: 0, excluded: 0 }),
      ),
    },
  };
};

/**
 * The actor's "Spell Points" item: a daily-use pf1 resource the module keeps, which abilities with a
 * spell point cost draw their charges from.
 *
 * @param actor - The actor
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const spellPoolItem = (actor: any) =>
  actor?.items?.find?.((i: any) => i.flags?.pf1spheres?.spellPool === true) ?? null;

/**
 * Sets the spell pool's current value, on the Spell Points item when there is one.
 *
 * @param actor - The actor
 * @param value - The new value, clamped at 0
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const setSpellPoints = async (actor: any, value: number): Promise<void> => {
  const v = Math.max(0, Math.floor(value));
  const item = spellPoolItem(actor);
  if (item) await item.update({ "system.uses.value": v });
  else await actor.update({ "flags.pf1spheres.spellPoints": v });
};

/**
 * Finishes spell pool and martial focus data once Changes (and with them the CAM) are applied.
 *
 * @param actor - The actor whose data is being prepared
 */
export const onActorDerivedPreparation = (actor: ActorPF): void => {
  const sphereData = actor.system.spheres;
  if (!sphereData) return;
  const pool = sphereData.spellPoints;
  const casting = pool.base > 0 ? Math.max(1, pool.base + sphereData.cam) : 0;
  pool.max = Math.max(0, casting + pool.bonus);
  // The "Spell Points" item is the pool once the module has created it; before that, the actor flag
  const item = spellPoolItem(actor);
  const stored = item ? item.system.uses?.value : actor.flags.pf1spheres?.spellPoints;
  pool.value = Math.min(pool.max, Math.max(0, typeof stored === "number" ? stored : pool.max));
  sphereData.martialFocus = actor.flags.pf1spheres?.martialFocus === true ? 1 : 0;
  applyArmorTraining(actor);
};

const ARMOR_TIERS = ["lgt", "med", "hvy"];

/**
 * Armor Training grants light and medium armor, or medium and heavy for someone already proficient
 * with light armor; taken again it climbs further. It depends on proficiencies from other sources, so
 * the module adds it here, after pf1 has totalled everything else.
 *
 * @param actor - The actor being prepared
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const applyArmorTraining = (actor: any): void => {
  const count =
    actor.items?.filter?.((i: any) => i.flags?.pf1spheres?.armorTraining === true).length ?? 0;
  const prof = actor.system.traits?.armorProf;
  // total is a getter that rebuilds from its parts; item proficiencies live in standard
  if (!count || !(prof?.standard instanceof Set)) return;
  const have = new Set<string>(prof.total ?? []);
  for (let n = 0; n < count; n++) {
    for (const t of ARMOR_TIERS.filter((tier) => !have.has(tier)).slice(0, 2)) {
      have.add(t);
      prof.standard.add(t);
    }
  }
};

/**
 * Refills the spell pool when the actor rests and restores daily uses.
 *
 * @param actor - The resting actor
 * @param options - The rest options
 */
export const onActorRest = (actor: ActorPF, options: { restoreDailyUses?: boolean }): void => {
  if (options.restoreDailyUses === false) return;
  if (!actor.isOwner) return;
  // pf1 refills the Spell Points item itself, as a daily-use item
  if (spellPoolItem(actor)) return;
  const max = actor.system.spheres?.spellPoints.max ?? 0;
  if (max > 0 && actor.flags.pf1spheres?.spellPoints !== max) {
    actor.update({ "flags.pf1spheres.spellPoints": max });
  }
};

export interface ItemSphereClData {
  clPart: number;
  baseLevel: number;
  name: string;
}
