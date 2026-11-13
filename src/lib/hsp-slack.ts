import { useEffect, useState } from "react";

import { api, type AppSettingsSection, type BotSettingsSection } from "@/state/store";

export interface HspSlackBot {
  botId: string;
  name: string;
  slack: {
    connected: boolean;
    lastMessageAt: string | null;
    channels: Array<{ id: string; name: string }>;
    today: { handled: number; refused: number };
    errors: Array<{ at: string; code: string; text: string }>;
  };
  people: Array<{ email: string; name: string; why: string }>;
}

export interface HspSlack {
  bridge: { reporting: boolean; startedAt: string | null; updatedAt: string | null } | null;
  bots: HspSlackBot[];
}

export type HspSlackState = { status: "loading" } | { status: "hidden" } | { status: "ready"; data: HspSlack };

const ERROR_WINDOW_MS = 24 * 60 * 60_000;
export const SLACK_REFRESH_MS = 30_000;

const text = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const count = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : 0);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? value as Record<string, unknown> : {});

/** Null unless the answer says `configured: true`; anything else the page cannot read is dropped. */
export function parseHspSlack(response: unknown): HspSlack | null {
  const body = record(response);
  if (body.configured !== true) return null;
  const bridge = body.bridge && typeof body.bridge === "object"
    ? { reporting: record(body.bridge).reporting === true, startedAt: text(record(body.bridge).startedAt), updatedAt: text(record(body.bridge).updatedAt) }
    : null;
  const bots = list(body.bots).flatMap((entry): HspSlackBot[] => {
    const bot = record(entry);
    const slack = record(bot.slack);
    const botId = text(bot.botId);
    if (!botId) return [];
    return [{
      botId,
      name: text(bot.name) ?? botId,
      slack: {
        connected: slack.connected === true,
        lastMessageAt: text(slack.lastMessageAt),
        channels: list(slack.channels).flatMap((channel) => {
          const name = text(record(channel).name);
          return name ? [{ id: text(record(channel).id) ?? name, name }] : [];
        }),
        today: { handled: count(record(slack.today).handled), refused: count(record(slack.today).refused) },
        errors: list(slack.errors).flatMap((error) => {
          const { at, code, text: message } = record(error);
          return typeof at === "string" && typeof message === "string" ? [{ at, code: typeof code === "string" ? code : "", text: message }] : [];
        }),
      },
      people: list(bot.people).flatMap((person) => {
        const { email, name, why } = record(person);
        return typeof email === "string" ? [{ email, name: typeof name === "string" && name ? name : email, why: typeof why === "string" ? why : "" }] : [];
      }),
    }];
  });
  return { bridge, bots };
}

/** Bridge numbers are only trusted while it reports. */
export function bridgeReporting(data: HspSlack): data is HspSlack & { bridge: NonNullable<HspSlack["bridge"]> } {
  return data.bridge !== null && data.bridge.reporting;
}

export function slackSummary(data: HspSlack): { connected: number; total: number; handled: number; refused: number } {
  return {
    connected: data.bots.filter((bot) => bot.slack.connected).length,
    total: data.bots.length,
    handled: data.bots.reduce((sum, bot) => sum + bot.slack.today.handled, 0),
    refused: data.bots.reduce((sum, bot) => sum + bot.slack.today.refused, 0),
  };
}

/** Errors from the past 24 hours, newest first. */
export function recentSlackErrors(bot: HspSlackBot, now = Date.now()): HspSlackBot["slack"]["errors"] {
  return bot.slack.errors
    .filter((error) => {
      const at = Date.parse(error.at);
      return Number.isFinite(at) && now - at <= ERROR_WINDOW_MS;
    })
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

/** Fetches once when enabled, then every `refreshMs` while that is set. Hidden on 403/404 or a first failure; a failed
 * refresh keeps what was shown. */
export function useHspSlack(enabled: boolean, refreshMs = 0): HspSlackState {
  const [state, setState] = useState<HspSlackState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = async (background: boolean) => {
      try {
        const data = parseHspSlack(await api("/api/hsp/slack", { signal: controller.signal, timeoutMs: 10_000, background }));
        if (!controller.signal.aborted) setState(data ? { status: "ready", data } : { status: "hidden" });
      } catch (error) {
        if (controller.signal.aborted) return;
        const status = (error as { status?: unknown }).status;
        setState((current) => (current.status === "ready" && status !== 403 && status !== 404 ? current : { status: "hidden" }));
      }
    };
    void load(false);
    const timer = refreshMs > 0 ? setInterval(() => void load(true), refreshMs) : null;
    return () => {
      controller.abort();
      if (timer) clearInterval(timer);
    };
  }, [enabled, refreshMs]);
  return enabled ? state : { status: "hidden" };
}

export type SlackDeepLink =
  | { type: "toggleAppSettings"; open: true; section: Extract<AppSettingsSection, "slack"> }
  | { type: "toggleSettings"; open: true; section: Extract<BotSettingsSection, "slack">; botId: string };

/** `#settings=slack` or `#bot=<id>&settings=slack`; anything else is not ours. */
export function parseSlackDeepLink(hash: string): SlackDeepLink | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  if (params.get("settings") !== "slack") return null;
  const botId = params.get("bot");
  if (botId === null) return { type: "toggleAppSettings", open: true, section: "slack" };
  return botId ? { type: "toggleSettings", open: true, section: "slack", botId } : null;
}

/** A bot link waits, hash intact, until that bot has loaded: the store ignores a settings request for one it lacks. */
export function useSlackDeepLink(dispatch: (action: SlackDeepLink) => void, bots: ReadonlyArray<{ id: string }>): void {
  useEffect(() => {
    const handle = () => {
      const action = parseSlackDeepLink(window.location.hash);
      if (!action) return;
      if (action.type === "toggleSettings" && !bots.some((bot) => bot.id === action.botId)) return;
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
      dispatch(action);
    };
    handle();
    window.addEventListener("hashchange", handle);
    return () => window.removeEventListener("hashchange", handle);
  }, [dispatch, bots]);
}
