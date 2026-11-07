import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "./config.ts";
import type { VpsCommandRunner } from "./vps-computer.ts";

const vps = vi.hoisted(() => ({ status: { ready: true, sshAlias: "kvm8", container_id: "0123456789ab", container_name: "openmausbot-vps-ada-0123456789ab", problem: null } as Record<string, unknown> }));
vi.mock("./vps-computer.ts", async (actual) => ({
  ...await actual<typeof import("./vps-computer.ts")>(),
  vpsComputerStatus: async () => vps.status,
  vpsComputerScreenshot: async () => ({ png: Buffer.from("frame").toString("base64"), format: "jpeg" }),
}));

const { vpsTeachComputer } = await import("./teach-desktop.ts");
const CFG = { vps: { sshAlias: "kvm8" } } as unknown as AppConfig;

describe("the self-hosted VPS desktop for Teach on computer", () => {
  it("asks cua-driver in the bot's container over Docker-over-SSH, with the arguments as argv", async () => {
    const calls: string[][] = [];
    const runner: VpsCommandRunner = async (args) => {
      calls.push(args);
      const tool = args[args.indexOf("call") + 1];
      const out = tool === "list_windows"
        ? { structuredContent: { windows: [{ pid: 7, window_id: 3, app_name: "Firefox", title: "Invoices", is_focused: true }] } }
        : { structuredContent: { elements: [{ role: "entry", name: "Email", bounds: { x: 0, y: 0, width: 100, height: 20 }, states: ["focused"] }] } };
      return { stdout: JSON.stringify(out), stderr: "" };
    };
    const computer = await vpsTeachComputer(CFG, "ada", runner);
    expect(await computer.inspect({ x: 10, y: 10 })).toMatchObject({ app: "Firefox", window: "Invoices", hit: { label: "Email" } });
    expect(calls[0]!.slice(0, 2)).toEqual(["-H", "ssh://kvm8"]);
    expect(calls[0]).toContain("0123456789ab");
    expect(calls[1]).toContain(JSON.stringify({ pid: 7, window_id: 3, tree_format: "elements" }));
    expect(await computer.screenshot()).toEqual({ bytes: Buffer.from("frame"), type: "jpg" });
  });

  it("refuses a desktop that is not ready, or a container reference that could reach argv unchecked", async () => {
    vps.status = { ready: false, sshAlias: "kvm8", container_name: "x", problem: "The VPS computer is stopped" };
    await expect(vpsTeachComputer(CFG, "ada")).rejects.toMatchObject({ status: 409, message: "The VPS computer is stopped" });
    vps.status = { ready: true, sshAlias: "kvm8", container_id: null, container_name: "--privileged" };
    await expect(vpsTeachComputer(CFG, "ada")).rejects.toMatchObject({ status: 409 });
  });
});
