// HSP: a VPS computer keeps /home/cua on its own named volume (moved out of vps-computer.ts to hold its size ratchet).

/** HSP: the computer's home lives on this named volume, so removing or rebuilding the container keeps sign-ins,
 * browser profiles and files. `docker rm` without -v leaves it; deleting it is a deliberate manual step. */
export const VPS_HOME_TARGET = "/home/cua";
export function vpsHomeVolumeName(containerName: string): string {
  return `${containerName}-home`;
}
export function vpsMountsUsable(mounts: "none" | "home" | "unsafe" | "unknown"): boolean {
  return mounts === "none" || mounts === "home";
}

/** "home" = exactly this computer's own home volume and nothing else; any host folder, other volume or shared mount is unsafe. */
export function mountState(detail: {
  Mounts?: unknown;
  HostConfig?: { Binds?: string[] | null; VolumesFrom?: string[] | null };
}, containerName: string): "none" | "home" | "unsafe" {
  if (detail.HostConfig?.Binds && detail.HostConfig.Binds.length > 0) return "unsafe";
  if (detail.HostConfig?.VolumesFrom && detail.HostConfig.VolumesFrom.length > 0) return "unsafe";
  if (!Array.isArray(detail.Mounts)) return "unsafe";
  if (detail.Mounts.length === 0) return "none";
  if (detail.Mounts.length !== 1) return "unsafe";
  const mount = detail.Mounts[0] as { Type?: unknown; Name?: unknown; Destination?: unknown; Driver?: unknown; RW?: unknown };
  return mount.Type === "volume" &&
    mount.Name === vpsHomeVolumeName(containerName) &&
    mount.Destination === VPS_HOME_TARGET &&
    (mount.Driver === undefined || mount.Driver === "local") &&
    mount.RW === true
    ? "home"
    : "unsafe";
}
