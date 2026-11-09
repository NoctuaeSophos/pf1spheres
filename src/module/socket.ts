/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

// Foundry 13 socket and user APIs are not covered by the bundled v9 types.
// @ts-nocheck

import { MODULE_ID, localize } from "./util";

/**
 * Requests that need GM rights (scene flags, tokens and actors the player doesn't own) go to the
 * active GM's client, which runs the registered handler. A GM's own requests run locally.
 */

const SOCKET = `module.${MODULE_ID}`;
const handlers = new Map<string, (msg, user) => Promise<void> | void>();

/** True on exactly one client: the active GM's. Shared state is only written there. */
export const isGMWriter = () =>
  game.user?.isGM && (game.users.activeGM ?? game.user).id === game.user.id;

/**
 * Registers a handler for a request type.
 *
 * @param action - Request type
 * @param fn - Handler, called with the request and the requesting user
 */
export const registerSocketHandler = (action: string, fn: (msg, user) => Promise<void> | void) => {
  handlers.set(action, fn);
};

// Handlers read a flag, await, then write it back, so they run one at a time
let queue: Promise<void> = Promise.resolve();
const run = (msg) => {
  const job = queue.then(async () => {
    const fn = handlers.get(msg?.action);
    const user = game.users.get(msg?.userId);
    if (!fn || !user) return;
    await fn(msg, user);
  });
  queue = job.catch((err) => console.error(`${MODULE_ID} | socket ${msg?.action}`, err));
  return job;
};

/**
 * Runs async jobs one after another under a key, so overlapping triggers never interleave.
 *
 * @param fn - The job
 * @returns A function that queues a run of the job
 */
export const serialised = (fn: () => Promise<void>) => {
  let chain: Promise<void> = Promise.resolve();
  return () => {
    chain = chain.then(fn).catch((err) => console.error(`${MODULE_ID} | queued job`, err));
    return chain;
  };
};

/**
 * Sends a request to the active GM, or runs it directly when this client is that GM.
 *
 * @param msg - The request; `action` names the handler
 * @returns Whether it was sent
 */
export const requestGM = async (msg): Promise<boolean> => {
  const payload = { ...msg, userId: game.user.id };
  if (isGMWriter()) {
    await run(payload);
    return true;
  }
  if (!game.users.activeGM) {
    ui.notifications.warn(localize("NeedGM"));
    return false;
  }
  game.socket.emit(SOCKET, payload);
  return true;
};

/** True if the user may act for this actor (GM or owner) */
export const userOwns = (user, actor) =>
  Boolean(user?.isGM || actor?.testUserPermission?.(user, "OWNER"));

export const registerSocket = () => {
  Hooks.once("ready", () => {
    game.socket.on(SOCKET, (msg) => {
      if (isGMWriter()) run(msg).catch(() => {});
    });
  });
};
