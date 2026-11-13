// A bot's own settings for its managed VPS cloud computer (bot.vpsComputer). Admin-only on the bot PATCH route.

export interface VpsComputerSettings {
  /** Run the container with Docker's default capabilities instead of --cap-drop ALL, so root inside it can use
   * sudo and apt like a VM. Every other isolation rule (not privileged, no host mounts, no published ports,
   * private IPC and cgroup namespaces) still holds. Takes effect when the container is next created. */
  rootCapable?: boolean;
  /** Memory cap in GiB (swap capped to the same). Absent: 4. */
  memoryGb?: number;
  /** CPU cap. Absent: 2. */
  cpus?: number;
  /** The cloud computer is a coding machine: the bot may install and sign in AI CLIs (Claude Code, Codex, gh) there. */
  codingTools?: boolean;
}

export const VPS_DEFAULT_MEMORY_GB = 4;
export const VPS_DEFAULT_CPUS = 2;
const MAX_MEMORY_GB = 256;
const MAX_CPUS = 64;
const KEYS = new Set(["rootCapable", "memoryGb", "cpus", "codingTools"]);

/** null clears the settings; a malformed value is an error naming the field. */
export function parseVpsComputerSettings(raw: unknown): { ok: true; settings: VpsComputerSettings | undefined } | { ok: false; error: string } {
  if (raw === null) return { ok: true, settings: undefined };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "vpsComputer must be an object or null" };
  const input = raw as Record<string, unknown>;
  const unknown = Object.keys(input).find((key) => !KEYS.has(key));
  if (unknown) return { ok: false, error: `vpsComputer.${unknown} is not a setting` };
  const settings: VpsComputerSettings = {};
  for (const key of ["rootCapable", "codingTools"] as const) {
    if (input[key] === undefined || input[key] === null) continue;
    if (typeof input[key] !== "boolean") return { ok: false, error: `vpsComputer.${key} must be true or false` };
    if (input[key]) settings[key] = true;
  }
  if (input.memoryGb !== undefined && input.memoryGb !== null) {
    if (typeof input.memoryGb !== "number" || !Number.isInteger(input.memoryGb) || input.memoryGb < 1 || input.memoryGb > MAX_MEMORY_GB) {
      return { ok: false, error: `vpsComputer.memoryGb must be a whole number of GiB from 1 to ${MAX_MEMORY_GB}` };
    }
    settings.memoryGb = input.memoryGb;
  }
  if (input.cpus !== undefined && input.cpus !== null) {
    // Docker takes --cpus to two decimals; quarter steps keep the value exact in both directions.
    if (typeof input.cpus !== "number" || !Number.isFinite(input.cpus) || input.cpus < 0.25 || input.cpus > MAX_CPUS || (input.cpus * 4) % 1 !== 0) {
      return { ok: false, error: `vpsComputer.cpus must be from 0.25 to ${MAX_CPUS} in steps of 0.25` };
    }
    settings.cpus = input.cpus;
  }
  return { ok: true, settings: Object.keys(settings).length ? settings : undefined };
}

/** What a stored record holds, read defensively: anything malformed counts as unset. */
export function vpsComputerSettingsOf(bot: { vpsComputer?: unknown } | null | undefined): VpsComputerSettings | undefined {
  if (bot?.vpsComputer === undefined) return undefined;
  const parsed = parseVpsComputerSettings(bot.vpsComputer);
  return parsed.ok ? parsed.settings : undefined;
}
