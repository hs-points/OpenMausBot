import { describe, expect, it, vi } from "vitest";

import { parseVpsComputerSettings, vpsComputerSettingsOf } from "../shared/vps-computer-settings.ts";
import { desktopCapArgs } from "./container-isolation.ts";
import { syncVpsLimits, vpsCapabilityArgs, vpsResourceArgs, vpsSecurityAccepted } from "./vps-container-settings.ts";

const hardened = {
  CapDrop: ["ALL"], CapAdd: ["SETUID", "SETGID"], Privileged: false, IpcMode: "private", CgroupnsMode: "private",
  SecurityOpt: ["no-new-privileges"], RestartPolicy: { Name: "unless-stopped" },
};

describe("VPS computer settings", () => {
  it("parses, clears and rejects settings", () => {
    expect(parseVpsComputerSettings({ rootCapable: true, memoryGb: 10, cpus: 4, codingTools: true }))
      .toEqual({ ok: true, settings: { rootCapable: true, memoryGb: 10, cpus: 4, codingTools: true } });
    expect(parseVpsComputerSettings(null)).toEqual({ ok: true, settings: undefined });
    expect(parseVpsComputerSettings({ rootCapable: false })).toEqual({ ok: true, settings: undefined });
    expect(parseVpsComputerSettings({ cpus: 1.5 })).toEqual({ ok: true, settings: { cpus: 1.5 } });
    expect(parseVpsComputerSettings({ privileged: true })).toMatchObject({ ok: false, error: "vpsComputer.privileged is not a setting" });
    expect(parseVpsComputerSettings({ memoryGb: 2.5 })).toMatchObject({ ok: false });
    expect(parseVpsComputerSettings({ memoryGb: 0 })).toMatchObject({ ok: false });
    expect(parseVpsComputerSettings({ cpus: 1.3 })).toMatchObject({ ok: false });
    expect(parseVpsComputerSettings({ rootCapable: "yes" })).toMatchObject({ ok: false });
    expect(parseVpsComputerSettings([])).toMatchObject({ ok: false });
    expect(vpsComputerSettingsOf({ vpsComputer: { memoryGb: "lots" } })).toBeUndefined();
  });

  it("keeps the strict defaults unless a PC opts in", () => {
    expect(vpsResourceArgs(undefined)).toEqual(["--memory", "4g", "--memory-swap", "4g", "--cpus", "2"]);
    expect(vpsResourceArgs({ memoryGb: 10, cpus: 4 })).toEqual(["--memory", "10g", "--memory-swap", "10g", "--cpus", "4"]);
    expect(vpsCapabilityArgs(undefined)).toEqual(desktopCapArgs("docker"));
    expect(vpsCapabilityArgs({ rootCapable: true })).toEqual(["--cap-drop", "NET_RAW"]);
  });

  it("accepts default capabilities only for a root-capable PC, and nothing else looser", () => {
    const rootCapable = { ...hardened, CapDrop: null, CapAdd: null };
    expect(vpsSecurityAccepted(hardened, undefined)).toBe(true);
    expect(vpsSecurityAccepted(hardened, { rootCapable: true })).toBe(true);
    expect(vpsSecurityAccepted(rootCapable, undefined)).toBe(false);
    expect(vpsSecurityAccepted(rootCapable, { memoryGb: 10 })).toBe(false);
    expect(vpsSecurityAccepted(rootCapable, { rootCapable: true })).toBe(true);
    expect(vpsSecurityAccepted({ ...rootCapable, CapDrop: ["CAP_NET_RAW"] }, { rootCapable: true })).toBe(true);
    expect(vpsSecurityAccepted({ ...rootCapable, CapDrop: ["NET_RAW"] }, { rootCapable: true })).toBe(true);
    expect(vpsSecurityAccepted({ ...rootCapable, CapDrop: ["NET_RAW", "CHOWN"] }, { rootCapable: true })).toBe(false);
    expect(vpsSecurityAccepted({ ...rootCapable, CapAdd: ["NET_ADMIN"] }, { rootCapable: true })).toBe(false);
    expect(vpsSecurityAccepted({ ...rootCapable, CapDrop: ["NET_RAW"] }, undefined)).toBe(false);
    expect(vpsSecurityAccepted({ ...rootCapable, Privileged: true }, { rootCapable: true })).toBe(false);
    expect(vpsSecurityAccepted({ ...rootCapable, CapAdd: ["SYS_ADMIN"] }, { rootCapable: true })).toBe(false);
    expect(vpsSecurityAccepted({ ...rootCapable, PidMode: "host" }, { rootCapable: true })).toBe(false);
    expect(vpsSecurityAccepted(undefined, { rootCapable: true })).toBe(false);
  });

  it("moves a live container onto its saved limits once", async () => {
    const docker = vi.fn(async () => undefined);
    const live = { Memory: 4 * 1024 ** 3, MemorySwap: 4 * 1024 ** 3, NanoCpus: 2e9 };
    expect(syncVpsLimits("c1", live, undefined, docker)).toBe(false);
    expect(syncVpsLimits("c1", live, { rootCapable: true }, docker)).toBe(false);
    expect(syncVpsLimits("c1", live, { memoryGb: 10, cpus: 4 }, docker)).toBe(true);
    expect(syncVpsLimits("c1", live, { memoryGb: 10, cpus: 4 }, docker)).toBe(false);
    await Promise.resolve(); await Promise.resolve();
    expect(docker).toHaveBeenCalledTimes(1);
    expect(docker).toHaveBeenCalledWith(["update", "--memory", "10g", "--memory-swap", "10g", "--cpus", "4", "c1"], 15_000);
    expect(syncVpsLimits("c2", { Memory: 10 * 1024 ** 3, MemorySwap: 10 * 1024 ** 3, NanoCpus: 4e9 }, { memoryGb: 10, cpus: 4 }, docker)).toBe(false);
  });
});
