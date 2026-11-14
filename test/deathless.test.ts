/*
 * SPDX-FileCopyrightText: 2026 NoctuaeSophos
 *
 * SPDX-License-Identifier: EUPL-1.2
 */

import { describe, expect, it } from "vitest";
import {
  type ActorDeathContext,
  type DeathlessState,
  deathThreshold,
  fallDownChanges,
  filterConditions,
  hasDeathlessItem,
  hasHardToKillItem,
  nextStep,
  PRONE_WINDOW_MS,
} from "../src/module/automation/deathless-logic";

/*
 * A small simulation of one actor's conditions with three parties on setConditions: Krune 0.3.18's Hard to Kill
 * wrapper and GM hook (re-implemented from its source), our filter, and Nevela's HP-update call sequences (from
 * NAS 2.2.9). Both wrapper orders are run, since libWrapper may put either module outside the other.
 */
type Changes = Record<string, unknown>;
interface Opts {
  krune?: boolean;
  ours?: boolean;
}

class Sim {
  statuses = new Set<string>();
  state: DeathlessState | null = null;
  now = 1_000_000;
  knockedOutAt = 0;
  kruneNotes: string[] = [];
  constructor(
    public hp: number,
    public focus: boolean,
    public opts: { deathless?: boolean; htk?: boolean; krune?: boolean; con?: number; kruneFirst?: boolean },
  ) {}
  get con() {
    return this.opts.con ?? 17;
  }
  ctx(): ActorDeathContext {
    return {
      hp: this.hp,
      deathlessReady: !!this.opts.deathless && this.focus,
      htk: !!this.opts.htk,
      con: this.con,
      state: this.state,
    };
  }
  private ours(changes: Changes, o: Opts): Changes {
    if (o.ours) return changes;
    const c = this.ctx();
    if (!(c.hp < 0) || !(c.deathlessReady || c.state)) return changes;
    const r = filterConditions(changes, c, this.now - this.knockedOutAt);
    if (r.knockedOut) this.knockedOutAt = this.now;
    return r.changes;
  }
  private krune(changes: Changes, o: Opts): Changes {
    if (!this.opts.krune || o.krune || !this.opts.htk || !(this.hp < 0)) return changes;
    const out = { ...changes };
    if (out.dying) {
      delete out.dying;
      out.stable = true;
    }
    if (out.dead && this.hp > -2 * this.con) delete out.dead;
    return out;
  }
  set(changes: Changes, o: Opts = {}) {
    const layers = this.opts.kruneFirst
      ? [(c: Changes) => this.krune(c, o), (c: Changes) => this.ours(c, o)]
      : [(c: Changes) => this.ours(c, o), (c: Changes) => this.krune(c, o)];
    let c = changes;
    for (const l of layers) c = l(c);
    for (const [k, v] of Object.entries(c)) if (v) this.statuses.add(k);
      else this.statuses.delete(k);
  }
  /** Nevela on an HP update, for an actor it doesn't itself keep conscious */
  nas() {
    const con = this.con;
    if (this.hp <= -con) {
      for (const [k, v] of [["dead", { overlay: true }], ["prone", true], ["dying", false], ["staggered", false], ["unconscious", true]] as const)
        this.set({ [k]: v });
    }
    if (this.hp >= 0) {
      for (const k of ["unconscious", "dying", "stable", "staggered"]) if (this.statuses.has(k)) this.set({ [k]: false });
      return;
    }
    this.set({ staggered: false });
    this.set({ unconscious: true });
    this.set({ prone: true });
    if (!this.statuses.has("stable")) {
      this.set({ dying: true });
      this.set({ unconscious: true });
    }
  }
  /** Nevela's turn-start dying check: true when it would roll Con (and lose HP on a failure) */
  nasTurnStart() {
    return this.hp < 0 && !this.statuses.has("dead") && !this.statuses.has("stable");
  }
  /** Our GM hook */
  gm() {
    if (!this.opts.deathless && !this.state) return;
    const c = this.ctx();
    const step = nextStep(c, this.statuses);
    if (step.kind === "clear") {
      if (step.removeStaggered) this.set({ staggered: false }, { ours: true });
      this.state = null;
      return;
    }
    if (step.kind === "startNone") this.state = { mode: "none" };
    if (step.kind === "startFight") {
      this.state = step.state;
      this.set(step.fix, { ours: true });
      return;
    }
    if (step.kind === "focusLost") {
      const s = this.state;
      this.state = { ...(s as DeathlessState), mode: "spent" };
      this.fall(s);
      return;
    }
    const limit = deathThreshold(c.con, c.htk, c.deathlessReady);
    if (c.deathlessReady && limit !== null && c.hp <= limit && !this.statuses.has("dead"))
      this.set({ dead: { overlay: true }, unconscious: true, prone: true, staggered: false }, { ours: true });
  }
  fall(s: DeathlessState | null) {
    const { undo, apply } = fallDownChanges(s, this.statuses, !!this.opts.htk);
    this.set(undo, { ours: true });
    this.set(apply);
  }
  /** Krune's GM hook (handle()) */
  kruneGm() {
    if (!this.opts.krune || !this.opts.htk || this.hp >= 0) return;
    const limit = -2 * this.con;
    if (this.hp <= limit) {
      if (!this.statuses.has("dead")) {
        this.set({ dead: { overlay: true }, unconscious: true, prone: true }, { krune: true });
        this.kruneNotes.push(`dead at ${limit}`);
      }
      return;
    }
    if (this.statuses.has("dead")) this.set({ dead: false }, { krune: true });
    if (!this.statuses.has("stable")) this.set({ stable: true }, { krune: true });
  }
  update(hp: number) {
    this.hp = hp;
    this.now += 10_000;
    this.knockedOutAt = this.now;
    this.nas();
    this.gm();
    this.kruneGm();
  }
  setFocus(v: boolean) {
    this.focus = v;
    this.now += 10_000;
    this.gm();
  }
  get list() {
    return [...this.statuses].sort().join(",");
  }
}

describe.each([false, true])("Deathless with Krune wrapper first: %s", (kruneFirst) => {
  it("keeps Elmorn (Hard to Kill + Deathless, Con 17) up and kills him at -51", () => {
    const s = new Sim(10, true, { deathless: true, htk: true, krune: true, kruneFirst });
    s.update(-5);
    expect(s.list).toBe("stable,staggered");
    expect(s.state?.mode).toBe("fight");
    expect(s.nasTurnStart()).toBe(false);
    s.update(-20);
    expect(s.list).toBe("stable,staggered");
    s.update(-40); // Krune forces dead at -34: refused
    expect(s.list).toBe("stable,staggered");
    s.update(-50);
    expect(s.list).toBe("stable,staggered");
    s.update(-51);
    expect(s.list).toBe("dead,prone,stable,unconscious");
  });

  it("lets a later trip knock him prone", () => {
    const s = new Sim(10, true, { deathless: true, htk: true, krune: true, kruneFirst });
    s.update(-5);
    s.now += PRONE_WINDOW_MS + 1;
    s.set({ prone: true });
    expect(s.list).toBe("prone,stable,staggered");
  });

  it("drops him when focus is lost, and regaining it doesn't bring him back", () => {
    const s = new Sim(10, true, { deathless: true, htk: true, krune: true, kruneFirst });
    s.update(-20);
    s.setFocus(false);
    expect(s.list).toBe("prone,stable,unconscious");
    expect(s.state?.mode).toBe("spent");
    s.setFocus(true);
    expect(s.list).toBe("prone,stable,unconscious");
    s.update(5);
    expect(s.list).toBe("prone");
    expect(s.state).toBeNull();
  });

  it("with focus lost below -34, Krune's -2 x Con applies again", () => {
    const s = new Sim(10, true, { deathless: true, htk: true, krune: true, kruneFirst });
    s.update(-40);
    expect(s.list).toBe("stable,staggered");
    s.setFocus(false);
    s.update(-40);
    expect(s.list).toContain("dead");
  });

  it("leaves Hard to Kill alone exactly as Krune does it", () => {
    const s = new Sim(10, true, { htk: true, krune: true, kruneFirst });
    s.update(-20);
    expect(s.list).toBe("prone,stable,unconscious");
    s.update(-34);
    expect(s.list).toBe("dead,prone,stable,unconscious");
  });
});

describe("Deathless without Krune", () => {
  it("Deathless alone: x2, stable stops the dying roll, dead at -34", () => {
    const s = new Sim(10, true, { deathless: true });
    s.update(-5);
    expect(s.list).toBe("stable,staggered");
    expect(s.nasTurnStart()).toBe(false);
    s.update(-33);
    expect(s.list).toBe("stable,staggered");
    s.update(-34);
    expect(s.list).toBe("dead,prone,stable,unconscious");
  });

  it("focus lost: our stable comes off, so dying resumes", () => {
    const s = new Sim(10, true, { deathless: true });
    s.update(-5);
    s.setFocus(false);
    expect(s.list).toBe("dying,prone,unconscious");
    expect(s.nasTurnStart()).toBe(true);
  });

  it("declining on the card: unconscious and dying", () => {
    const s = new Sim(10, true, { deathless: true });
    s.update(-5);
    const st = s.state;
    s.state = { ...(st as DeathlessState), mode: "down" };
    s.fall(st);
    expect(s.list).toBe("dying,prone,unconscious");
  });

  it("no focus at the drop: normal handling, and focus later changes nothing", () => {
    const s = new Sim(10, false, { deathless: true });
    s.update(-5);
    expect(s.list).toBe("dying,prone,unconscious");
    expect(s.state?.mode).toBe("none");
    s.setFocus(true);
    expect(s.list).toBe("dying,prone,unconscious");
  });

  it("an actor without Deathless is untouched", () => {
    const s = new Sim(10, true, {});
    s.update(-5);
    expect(s.list).toBe("dying,prone,unconscious");
    expect(s.state).toBeNull();
  });
});

describe("Deathless helpers", () => {
  it("thresholds", () => {
    expect(deathThreshold(17, true, true)).toBe(-51);
    expect(deathThreshold(17, true, false)).toBe(-34);
    expect(deathThreshold(17, false, true)).toBe(-34);
    expect(deathThreshold(17, false, false)).toBeNull();
  });
  it("finds the talents by source or name, and ignores disabled ones", () => {
    const dl = { name: "Deathless", type: "feat", system: { subType: "combatTalent" } };
    expect(hasDeathlessItem([dl])).toBe(true);
    expect(hasDeathlessItem([{ ...dl, system: { subType: "combatTalent", disabled: true } }])).toBe(false);
    expect(hasDeathlessItem([{ name: "Deathless Initiate", type: "feat", system: { subType: "feat" } }])).toBe(false);
    expect(
      hasDeathlessItem([{ name: "X", _stats: { compendiumSource: "Compendium.pf1spheres.combat-talents.Item.rbfP5616p00CSwoc" } }]),
    ).toBe(true);
    expect(
      hasHardToKillItem([{ name: "Hard to Kill", _stats: { compendiumSource: "Compendium.krune-table.content.Item.vncScB4NngVOPRpi" } }]),
    ).toBe(true);
    expect(hasHardToKillItem([{ name: "Hard to Kill", type: "feat", system: { subType: "mythic" } }])).toBe(true);
    expect(hasHardToKillItem([{ name: "Hard to Kill", type: "feat", system: { subType: "feat" } }])).toBe(false);
  });
  it("passes other modules' requests through for actors at 0 HP or above", () => {
    const c = { hp: 3, deathlessReady: true, htk: true, con: 17, state: null };
    expect(filterConditions({ unconscious: true }, c, 0).changes).toEqual({ unconscious: true });
  });
});
