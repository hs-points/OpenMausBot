// A bot's Local VM or self-hosted VPS desktop, as Teach on computer sees it: the current frame, and the window and
// fields under a point.
import type { AppConfig } from "./config.ts";
import {
  containerComputerFrame,
  containerComputerStatus,
  CUA_SOCKET,
  cuaExecArgs,
  sh,
  type LocalVmTarget,
  type Runtime,
} from "./container-computer.ts";
import { inspectDesktop, type TeachComputer } from "./teach-recording.ts";
import { defaultRunner, vpsComputerScreenshot, vpsComputerStatus, vpsDockerArgs, type VpsCommandRunner } from "./vps-computer.ts";

const CONTAINER_REF = /^(?:[a-f0-9]{12,64}|[a-zA-Z0-9][a-zA-Z0-9_.-]+)$/;

/** Parses one cua-driver call's printed JSON; null when it printed none. */
function driverJson(stdout: string): unknown {
  try { return JSON.parse(stdout) as unknown; } catch { return null; }
}

/** One cua-driver tool call inside the container; the parsed JSON it printed, or null when it printed none. */
export async function containerDriverCall(runtime: Runtime, target: LocalVmTarget, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const { stdout } = await sh(runtime, cuaExecArgs(["call", tool, JSON.stringify(args), "--socket", CUA_SOCKET], { container: target.containerName }), 15_000);
  return driverJson(stdout);
}

export async function localVmTeachComputer(target: LocalVmTarget): Promise<TeachComputer> {
  const status = await containerComputerStatus(undefined, undefined, target);
  if (!status.ready || !status.runtime) throw Object.assign(new Error(status.problem ?? "The Local VM is not ready"), { status: 409 });
  const runtime = status.runtime;
  return {
    screenshot: async () => {
      const frame = await containerComputerFrame(undefined, undefined, target);
      return { bytes: Buffer.from(frame.png, "base64"), type: frame.format === "jpeg" ? "jpg" : "png" };
    },
    inspect: (point) => inspectDesktop((tool, args) => containerDriverCall(runtime, target, tool, args), point),
  };
}

/**
 * The bot's self-hosted VPS desktop (Docker over SSH, the same path as its screen preview). `cfg` is the bot's own VPS
 * config (vpsConfigForBot); cua-driver runs in the bot's container there, and its arguments reach it as argv, never a shell.
 */
export async function vpsTeachComputer(cfg: AppConfig, botId: string, runner: VpsCommandRunner = defaultRunner): Promise<TeachComputer> {
  const status = await vpsComputerStatus(cfg, botId, runner);
  if (!status.ready || !status.sshAlias) throw Object.assign(new Error(status.problem ?? "The VPS computer is not ready"), { status: 409 });
  const alias = status.sshAlias;
  const container = status.container_id ?? status.container_name;
  if (!CONTAINER_REF.test(container)) throw Object.assign(new Error("the VPS container reference is malformed"), { status: 409 });
  const call = async (tool: string, args: Record<string, unknown>) => {
    const { stdout } = await runner(vpsDockerArgs(alias, cuaExecArgs(["call", tool, JSON.stringify(args), "--socket", CUA_SOCKET], { container })), { timeoutMs: 15_000 });
    return driverJson(stdout);
  };
  return {
    screenshot: async () => {
      const frame = await vpsComputerScreenshot(cfg, botId, runner);
      return { bytes: Buffer.from(frame.png, "base64"), type: frame.format === "jpeg" ? "jpg" : "png" };
    },
    inspect: (point) => inspectDesktop(call, point),
  };
}
