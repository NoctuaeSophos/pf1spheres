/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

/**
 * Values read from an actor's items, kept until the actor next prepares its data. pf1 builds roll data
 * hundreds of times while preparing one actor, and creating, updating or deleting an item resets its
 * actor, so a scan of the items only needs to run once per preparation.
 */
const cache = new WeakMap<object, Map<string, unknown>>();

/**
 * The value of `compute` for this actor, computed once per data preparation.
 *
 * @param actor - The actor the value belongs to
 * @param key - A name for the value, unique across the module
 * @param compute - Reads the value from the actor
 */
export const perPreparation = <T>(actor: object, key: string, compute: () => T): T => {
  let values = cache.get(actor);
  if (!values) cache.set(actor, (values = new Map()));
  if (!values.has(key)) values.set(key, compute());
  return values.get(key) as T;
};

/** Forgets the actor's values; called as its data preparation starts */
export const clearPreparationCache = (actor: object): void => {
  cache.delete(actor);
};
