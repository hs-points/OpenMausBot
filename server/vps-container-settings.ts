// How a bot's VPS computer settings (shared/vps-computer-settings.ts) shape its container: the docker run
// flags, which hardening the status check accepts, and keeping a live container on its saved CPU/RAM.
import { dockerSecurityIsHardened, type DockerHardeningConfig } from "./container-computer.ts";
import { VPS_DEFAULT_CPUS, VPS_DEFAULT_MEMORY_GB, type VpsComputerSettings } from "../shared/vps-computer-settings.ts";

const GIB = 1024 ** 3;

export function vpsResourceArgs(settings: VpsComputerSettings | undefined): string[] {
  const memory = `${settings?.memoryGb ?? VPS_DEFAULT_MEMORY_GB}g`;
  return ["--memory", memory, "--memory-swap", memory, "--cpus", String(settings?.cpus ?? VPS_DEFAULT_CPUS)];
}

/** Root-capable PCs keep Docker's default capability set; every other PC drops all but SETUID/SETGID. */
export function vpsCapabilityArgs(settings: VpsComputerSettings | undefined): string[] {
  return settings?.rootCapable ? [] : ["--cap-drop", "ALL", "--cap-add", "SETUID", "--cap-add", "SETGID"];
}

/** Strict hardening for every PC. A root-capable PC may instead carry Docker's default capabilities exactly
 * (no drop, no add): everything else in the contract, privileged and namespaces included, is still checked. */
export function vpsSecurityAccepted(config: DockerHardeningConfig | undefined, settings: VpsComputerSettings | undefined): boolean {
  if (dockerSecurityIsHardened(config, { restartPolicy: "any" })) return true;
  if (!settings?.rootCapable || !config) return false;
  if ((config.CapDrop ?? []).length > 0 || (config.CapAdd ?? []).length > 0) return false;
  return dockerSecurityIsHardened({ ...config, CapDrop: ["ALL"], CapAdd: ["SETUID", "SETGID"] }, { restartPolicy: "any" });
}

const synced = new Map<string, string>();

/** A container made before its limits were saved, or changed by hand, is moved onto the saved CPU/RAM in place:
 * `docker update` works on a running container. Only explicitly saved limits are enforced; tried once per value per run. */
export function syncVpsLimits(
  container: string,
  hostConfig: { Memory?: number | null; MemorySwap?: number | null; NanoCpus?: number | null } | undefined,
  settings: VpsComputerSettings | undefined,
  docker: (args: string[], timeoutMs?: number) => Promise<unknown>,
): boolean {
  if (!settings || (settings.memoryGb === undefined && settings.cpus === undefined) || !hostConfig) return false;
  const args: string[] = [];
  if (settings.memoryGb !== undefined) {
    const bytes = settings.memoryGb * GIB;
    if (hostConfig.Memory !== bytes || hostConfig.MemorySwap !== bytes) args.push("--memory", `${settings.memoryGb}g`, "--memory-swap", `${settings.memoryGb}g`);
  }
  if (settings.cpus !== undefined && hostConfig.NanoCpus !== Math.round(settings.cpus * 1e9)) args.push("--cpus", String(settings.cpus));
  if (!args.length) return false;
  const key = `${container}:${args.join(" ")}`;
  if (synced.get(container) === key) return false;
  synced.set(container, key);
  void Promise.resolve().then(() => docker(["update", ...args, container], 15_000)).catch(() => {});
  return true;
}
