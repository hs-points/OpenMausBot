import { describe, expect, it } from "vitest";

import { viewerTargetId } from "../../shared/desktop-viewer.ts";
import { ComputerControl } from "../computer-control.ts";
import { SHARED_LOCAL_VM_TARGET, perBotLocalVmTarget, poolLocalVmTarget, type LocalVmTarget } from "../container-computer.ts";
import type { BotRecord } from "../store.ts";
import type { TeachComputer } from "../teach-recording.ts";
import { createSharedVmControl } from "./shared-vm-control.ts";
import { createTeachTargets } from "./teach-targets.ts";

const LEASE = "lease-0123456789abcdef";
const computer = {} as TeachComputer;

/** The real control and key resolution the server uses, so a hold lands where the Computer panel's take puts it. */
function fixture(mode: "shared" | "per-bot" | "pool", settings: Partial<BotRecord> = {}, options: { cloudHome?: boolean; team?: boolean } = {}) {
  const control = new ComputerControl();
  const bot = { id: "ada", name: "Ada", threadId: "main", ...settings } as BotRecord;
  const vm = createSharedVmControl({
    control,
    store: { bots: [bot], bot: (id) => id === bot.id ? bot : null, tasks: () => [] },
    mode: () => options.cloudHome ? null : mode,
    botForThread: (botId) => botId === bot.id ? bot : null,
    turnBots: { entries: () => new Map<string, BotRecord>().entries() },
    teamTurns: { get: () => undefined, values: () => new Map<string, { computerId: string; botId: string }>().values() },
    teamComputer: () => undefined,
    place: (which) => which.computer,
    turnVmTargets: { get: () => undefined },
    busy: () => false,
  });
  const localVmTarget = (): LocalVmTarget => mode === "shared" ? SHARED_LOCAL_VM_TARGET : mode === "per-bot" ? perBotLocalVmTarget(bot.id) : poolLocalVmTarget(0);
  const target = createTeachTargets({
    bot: (id) => id === bot.id ? bot : null,
    controlKey: (which) => which.id,
    inheritsTeamComputer: () => options.team === true,
    ownsLease: (key, leaseId) => control.ownsLease(key, leaseId),
    vpsComputer: async () => computer,
    localVmTarget,
    localVmComputer: async () => computer,
    cloudHome: options.cloudHome === true,
  });
  /** What POST /api/bots/:id/computer/control does with the panel's take, which names the desktop it shows. */
  const take = (shown: string) => {
    const key = vm.holdKey(bot, bot.threadId, shown);
    if (key === null) throw new Error("this conversation does not show that desktop");
    return control.acquireLease(key, LEASE);
  };
  return { bot, control, vm, target, take, localVmTarget };
}

describe("the desktop Teach on computer records on", () => {
  for (const mode of ["shared", "per-bot", "pool"] as const) {
    it(`a ${mode} Local VM: the lease of the panel's take holds it, and no other lease does`, () => {
      const f = fixture(mode, { computer: "vm" });
      const teach = f.target(f.bot.id, undefined, "vm")!;
      expect(teach.key).toBe(f.localVmTarget().key);
      expect(teach.holds(LEASE)).toBe(false);
      expect(f.take(viewerTargetId(f.localVmTarget())).owned).toBe(true);
      expect(teach.holds(LEASE)).toBe(true);
      expect(teach.holds("lease-of-someone-else-0123")).toBe(false);
      f.vm.release(f.bot, f.bot.threadId, LEASE);
      expect(teach.holds(LEASE)).toBe(false);
    });
  }

  it("the shared Local VM is not held by a lease on the bot's own key", () => {
    const f = fixture("shared", { computer: "vm" });
    f.control.acquireLease(f.bot.id, LEASE);
    expect(f.target(f.bot.id, undefined, "vm")!.holds(LEASE)).toBe(false);
  });

  it("a self-hosted VPS desktop: the lease of the panel's take holds it", () => {
    const f = fixture("shared", { computer: "cloud", cloudBackend: "vps" });
    const teach = f.target(f.bot.id, undefined, "vps")!;
    expect(teach.key).toBe(`vps/${f.bot.id}`);
    expect(teach.holds(LEASE)).toBe(false);
    expect(f.take(`vps/${f.bot.id}`).owned).toBe(true);
    expect(teach.holds(LEASE)).toBe(true);
  });

  it("has no VPS desktop for a bot on another backend or on its team's computer, and no Local VM in a Cloud home", () => {
    expect(fixture("shared", { computer: "cloud" }).target("ada", undefined, "vps")).toBeNull();
    expect(fixture("shared", { computer: "cloud", cloudBackend: "vps" }, { team: true }).target("ada", undefined, "vps")).toBeNull();
    expect(fixture("shared", { computer: "vm" }, { cloudHome: true }).target("ada", undefined, "vm")).toBeNull();
  });

  it("refuses a bot that does not exist", () => {
    expect(() => fixture("shared").target("nobody", undefined, "vm")).toThrow("no such bot");
  });
});
