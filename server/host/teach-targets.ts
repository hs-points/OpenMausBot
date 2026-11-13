// Which desktop "Teach on computer" records on for a bot: its self-hosted VPS cloud desktop, or its Local VM.
import { SHARED_LOCAL_VM_TARGET, type LocalVmTarget } from "../container-computer.ts";
import type { TeachDesktopKind, TeachTarget } from "../routes/teach-recording.ts";
import type { BotRecord } from "../store.ts";
import type { TeachComputer } from "../teach-recording.ts";
import { SHARED_VM_CONTROL_KEY } from "./shared-vm-control.ts";

export interface TeachTargetDeps {
  bot(botId: string): BotRecord | null | undefined;
  controlKey(bot: BotRecord): string;
  /** A bot that borrows its team's computer has no cloud desktop of its own to record on. */
  inheritsTeamComputer(bot: BotRecord): boolean;
  ownsLease(controlKey: string, leaseId: string): boolean;
  vpsComputer(bot: BotRecord): Promise<TeachComputer>;
  localVmTarget(botId: string, threadId: string): LocalVmTarget;
  localVmComputer(target: LocalVmTarget): Promise<TeachComputer>;
  cloudHome: boolean;
}

export function createTeachTargets(deps: TeachTargetDeps) {
  return (botId: string, _auth: unknown, computer: TeachDesktopKind): TeachTarget | null => {
    const bot = deps.bot(botId);
    if (!bot) throw Object.assign(new Error("no such bot"), { status: 404 });
    const controlKey = deps.controlKey(bot);
    if (computer === "vps") {
      if (bot.cloudBackend !== "vps" || deps.inheritsTeamComputer(bot)) return null;
      return {
        key: `vps/${bot.id}`, botId: bot.id, threadId: bot.threadId, desktop: `${bot.name}'s cloud desktop`,
        holds: (leaseId) => deps.ownsLease(controlKey, leaseId),
        computer: () => deps.vpsComputer(bot),
      };
    }
    // A Cloud home or team machine has no Local VM of its own; its bots' self-hosted cloud desktops (above) still record.
    if (deps.cloudHome) return null;
    const target = deps.localVmTarget(bot.id, bot.threadId);
    // The panel's take names the desktop it shows, and a named desktop is held under the shared Local VM's own key, any
    // other under the bot's (shared-vm-control.ts holdKey): the bot's key never owns a lease on the shared desktop.
    const vmKey = target.key === SHARED_LOCAL_VM_TARGET.key ? SHARED_VM_CONTROL_KEY : bot.id;
    return {
      key: target.key, botId: bot.id, threadId: bot.threadId, desktop: `${bot.name}'s Linux desktop`,
      holds: (leaseId) => deps.ownsLease(vmKey, leaseId),
      computer: () => deps.localVmComputer(target),
    };
  };
}
