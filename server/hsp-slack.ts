// HSP patch: what the Slack page in team settings needs from this server. The bridge writes a status file that this
// server only reads; the bridge asks this server who may use each bot. Nothing here contacts Slack.
import { readFileSync, statSync } from "node:fs";

import type { AccessBot } from "./bot-visibility.ts";
import { memberLevel } from "./bot-visibility.ts";
import { relayedSendRefusal } from "./host/bot-access-gate.ts";

export const STATUS_FRESH_MS = 120_000;
const MAX_CHANNELS = 200, MAX_ERRORS = 10, MAX_BOTS = 100, MAX_TEXT = 200, MAX_FILE_BYTES = 2_000_000;

export interface SlackChannel { id: string; name: string }
export interface SlackError { at: string; code: string; text: string }
export interface SlackBotStatus {
  key: string; name: string; ombBotId: string; slackAppId: string; slackTeamId: string;
  connected: boolean; connectedAt: string | null; lastMessageAt: string | null;
  channels: SlackChannel[]; today: { handled: number; refused: number }; errors: SlackError[];
}
export interface BridgeStatus { startedAt: string; updatedAt: string; reporting: boolean; bots: SlackBotStatus[] }

const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value.slice(0, MAX_TEXT) : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
const record = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
const list = (value: unknown, max: number): unknown[] => (Array.isArray(value) ? value.slice(0, max) : []);
const time = (value: unknown): string | null => {
  const one = text(value);
  return one && Number.isFinite(Date.parse(one)) ? one : null;
};

function parseBot(raw: unknown): SlackBotStatus | null {
  const bot = record(raw);
  const ombBotId = text(bot?.ombBotId);
  if (!bot || !ombBotId) return null;
  const channels: SlackChannel[] = [];
  for (const one of list(bot.channels, MAX_CHANNELS)) {
    const channel = record(one), id = text(channel?.id), name = text(channel?.name);
    if (id && name) channels.push({ id, name });
  }
  const errors: SlackError[] = [];
  for (const one of list(bot.errors, MAX_ERRORS)) {
    const row = record(one), at = time(row?.at), code = text(row?.code), message = text(row?.text);
    if (at && code && message) errors.push({ at, code, text: message });
  }
  const today = record(bot.today);
  return {
    key: text(bot.key) ?? "", name: text(bot.name) ?? "", ombBotId,
    slackAppId: text(bot.slackAppId) ?? "", slackTeamId: text(bot.slackTeamId) ?? "",
    connected: bot.connected === true, connectedAt: time(bot.connectedAt), lastMessageAt: time(bot.lastMessageAt),
    channels, today: { handled: count(today?.handled), refused: count(today?.refused) }, errors,
  };
}

/** Null when the file is missing, oversized, garbled or not a version 1 status; otherwise only validated fields. */
export function readBridgeStatus(file: string, now: number = Date.now()): BridgeStatus | null {
  try {
    if (statSync(file).size > MAX_FILE_BYTES) return null;
    const root = record(JSON.parse(readFileSync(file, "utf8")));
    if (!root || root.version !== 1) return null;
    const startedAt = time(root.startedAt), updatedAt = time(root.updatedAt);
    if (!startedAt || !updatedAt) return null;
    const bots = list(root.bots, MAX_BOTS).map(parseBot).filter((one): one is SlackBotStatus => one !== null);
    return { startedAt, updatedAt, reporting: Math.abs(now - Date.parse(updatedAt)) <= STATUS_FRESH_MS, bots };
  } catch {
    return null;
  }
}

export type PersonWhy = "owner" | "admin" | "chat" | "edit";
export interface TeamMember { email: string; role: "owner" | "admin" | "member"; name?: string }
export interface SlackPerson { email: string; name: string; why: PersonWhy }
export type SlackBotRecord = AccessBot & { id: string; name: string; hidden?: boolean };

/** Exactly the people for whom the server would accept a relayed send: relayedSendRefusal(bot, email, admin) === null. */
export function peopleForBot(bot: SlackBotRecord, members: readonly TeamMember[]): SlackPerson[] {
  if (bot.hidden) return [];
  const out: SlackPerson[] = [];
  for (const member of members) {
    const email = member.email.trim().toLowerCase();
    const admin = member.role !== "member";
    if (relayedSendRefusal(bot, email, admin) !== null) continue;
    const level = memberLevel(bot, email);
    const why: PersonWhy = member.role === "owner" ? "owner" : admin ? "admin" : level === "edit" ? "edit" : "chat";
    out.push({ email, name: (member.name ?? "").slice(0, MAX_TEXT) || email.split("@")[0]!, why });
  }
  return out;
}

export function buildPeopleResponse(bots: readonly SlackBotRecord[], members: readonly TeamMember[]): { bots: Record<string, Array<{ email: string; name: string }>> } {
  const out: Record<string, Array<{ email: string; name: string }>> = {};
  for (const bot of bots) {
    if (bot.hidden) continue;
    out[bot.id] = peopleForBot(bot, members).map(({ email, name }) => ({ email, name }));
  }
  return { bots: out };
}

export function buildAdminResponse(
  file: string | undefined,
  lookup: (id: string) => SlackBotRecord | null | undefined,
  members: readonly TeamMember[],
  now: number = Date.now(),
): Record<string, unknown> {
  if (!file?.trim()) return { configured: false };
  const status = readBridgeStatus(file, now);
  const bots = (status?.bots ?? []).flatMap((slack) => {
    const bot = lookup(slack.ombBotId);
    if (!bot) return [];
    return [{
      botId: bot.id, name: bot.name,
      slack: {
        appId: slack.slackAppId, teamId: slack.slackTeamId, connected: slack.connected, connectedAt: slack.connectedAt,
        lastMessageAt: slack.lastMessageAt, channels: slack.channels, today: slack.today, errors: slack.errors,
      },
      people: peopleForBot(bot, members),
    }];
  });
  return {
    configured: true,
    bridge: status ? { reporting: status.reporting, startedAt: status.startedAt, updatedAt: status.updatedAt } : null,
    bots,
  };
}
