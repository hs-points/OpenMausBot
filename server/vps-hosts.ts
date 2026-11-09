// Which VPS host a bot's computer lives on: the app-wide SSH alias, or the bot's own.
import { isValidSshAlias, vpsSshAlias, type AppConfig } from "./config.ts";
import { vpsComputerSettingsOf } from "../shared/vps-computer-settings.ts";

/** A bot's own SSH alias wins over the default; both are validated the same way. */
export function vpsSshAliasForBot(cfg: AppConfig, bot: { vpsAlias?: string } | null | undefined): string | null {
  return isValidSshAlias(bot?.vpsAlias) ? bot.vpsAlias : vpsSshAlias(cfg);
}

/** A config scoped to one bot's VPS alias and its own computer settings, shaped for the vps-computer calls. */
export function vpsConfigForBot(cfg: AppConfig, bot: { vpsAlias?: string; vpsComputer?: unknown } | null | undefined): AppConfig {
  const sshAlias = vpsSshAliasForBot(cfg, bot);
  const computer = vpsComputerSettingsOf(bot);
  return sshAlias ? { vps: { sshAlias, ...(computer ? { computer } : {}) } } : {};
}

/** The bot's cloud computer is a coding machine: its prompt lets it install and sign in AI CLIs there. */
export function vpsCodingComputer(bot: { vpsComputer?: unknown } | null | undefined): boolean {
  return vpsComputerSettingsOf(bot)?.codingTools === true;
}

/** Every alias this installation can hold VPS computers on: the default first, then each bot's own. */
export function vpsAliasesInPlay(cfg: AppConfig, bots: ReadonlyArray<{ vpsAlias?: string }>): string[] {
  const aliases = new Set<string>();
  const primary = vpsSshAlias(cfg);
  if (primary) aliases.add(primary);
  for (const bot of bots) {
    if (isValidSshAlias(bot.vpsAlias)) aliases.add(bot.vpsAlias);
  }
  return [...aliases];
}
