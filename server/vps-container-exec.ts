// HSP: vm_exec on a bot's self-hosted VPS computer (moved out of vps-computer.ts to hold its size ratchet).
import { vpsSshAlias, type AppConfig } from "./config.ts";
import { clipExecOutput, DISPLAY, type ContainerExecResult } from "./container-computer.ts";
import { CONTAINER_ID, CONTAINER_NAME, defaultRunner, type VpsCommandRunner, vpsContainerName, vpsDockerArgs } from "./vps-computer.ts";

const VPS_EXEC_EXIT = "__omb_exit__=";

/** vm_exec on a bot's self-hosted VPS computer: runs as the desktop user inside the bot's own container, never on the
 * VPS host, and opens no window. The command travels as argv; the wrapper prints its exit code so the runner, which
 * rejects any non-zero exit, still hands back the output. */
export async function vpsContainerExec(
  cfg: AppConfig,
  botId: string,
  containerRef: string | undefined,
  command: string,
  options: { timeoutSeconds?: number; runner?: VpsCommandRunner } = {},
): Promise<ContainerExecResult> {
  if (!command.trim()) throw Object.assign(new Error("command is required"), { status: 400 });
  if (command.length > 20_000) throw Object.assign(new Error("command is too long"), { status: 400 });
  if (options.timeoutSeconds !== undefined && !Number.isFinite(options.timeoutSeconds)) {
    throw Object.assign(new Error("timeout_seconds must be finite"), { status: 400 });
  }
  const alias = vpsSshAlias(cfg);
  if (!alias) throw Object.assign(new Error("VPS is not configured"), { status: 409 });
  const container = containerRef ?? vpsContainerName(botId);
  if (!CONTAINER_NAME.test(container) && !CONTAINER_ID.test(container)) throw new Error("invalid VPS container");
  const seconds = Math.min(Math.max(Math.floor(options.timeoutSeconds ?? 60), 1), 300);
  const { stdout, stderr } = await (options.runner ?? defaultRunner)(vpsDockerArgs(alias, [
    "exec", "-u", "cua", "-w", "/home/cua", "-e", "HOME=/home/cua", "-e", `DISPLAY=${DISPLAY}`, container,
    "sh", "-c", `timeout -k 5 ${seconds} sh -lc "$1"; echo "${VPS_EXEC_EXIT}$?" >&2`, "omb-exec", command,
  ]), { timeoutMs: (seconds + 30) * 1000 });
  const marker = stderr.lastIndexOf(VPS_EXEC_EXIT);
  const exitCode = marker >= 0 ? Number.parseInt(stderr.slice(marker + VPS_EXEC_EXIT.length), 10) : -1;
  const errors = marker >= 0 ? stderr.slice(0, marker) : stderr;
  return {
    exitCode: Number.isFinite(exitCode) ? exitCode : -1,
    stdout: clipExecOutput(stdout),
    stderr: clipExecOutput(errors),
    timedOut: exitCode === 124 || exitCode === 137,
  };
}
