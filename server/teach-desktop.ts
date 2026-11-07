// A bot's Local VM, as Teach on computer sees it: the current frame, and the window and fields under a point.
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

/** One cua-driver tool call inside the container; the parsed JSON it printed, or null when it printed none. */
export async function containerDriverCall(runtime: Runtime, target: LocalVmTarget, tool: string, args: Record<string, unknown>): Promise<unknown> {
  const { stdout } = await sh(runtime, cuaExecArgs(["call", tool, JSON.stringify(args), "--socket", CUA_SOCKET], { container: target.containerName }), 15_000);
  try { return JSON.parse(stdout) as unknown; } catch { return null; }
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
