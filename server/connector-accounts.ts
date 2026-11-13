// Which connected account a bot's app calls run as. A bot's `connectorAccounts` assigns it one account per app; an
// assignment marked `exclusive` also keeps every other bot off that account. Enforced where every Composio call crosses
// the harness (POST /api/internal/connectors/mcp), so the model's own `account` argument never decides: an assigned
// account is written into the call, and a call OpenMausBot cannot read is refused. With no assignment on any bot,
// nothing here runs and calls pass exactly as before.
import { createHash } from "node:crypto";

import { CONNECTOR_SLUG_PATTERN, type ConnectorAccountPin } from "../shared/wire.ts";
import { ACCOUNT_ID } from "./composio-inventory-schema.ts";
import { COMPOSIO_MULTI_EXECUTE_TOOL, serviceSlugFor, serviceSlugForCandidates } from "./connector-verdict.ts";

export type ConnectorAccounts = Record<string, ConnectorAccountPin>;

const CONNECTOR_ACCOUNTS_MAX = 100;

/** `null` and `{}` both clear the assignments. */
export function parseConnectorAccounts(value: unknown): { ok: true; accounts: ConnectorAccounts | undefined } | { ok: false; error: string } {
  if (value === null) return { ok: true, accounts: undefined };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "connectorAccounts must be an object of app slugs to { account, exclusive? }, or null" };
  }
  const entries = Object.entries(value);
  if (entries.length > CONNECTOR_ACCOUNTS_MAX) return { ok: false, error: `connectorAccounts may name at most ${CONNECTOR_ACCOUNTS_MAX} apps` };
  const accounts: ConnectorAccounts = {};
  for (const [slug, pin] of entries) {
    if (!CONNECTOR_SLUG_PATTERN.test(slug)) return { ok: false, error: `connectorAccounts app slugs must be lowercase slugs (got "${slug}")` };
    if (!pin || typeof pin !== "object" || Array.isArray(pin)) return { ok: false, error: `connectorAccounts.${slug} must be { account, exclusive? }` };
    const { account, exclusive, ...rest } = pin as { account?: unknown; exclusive?: unknown };
    if (Object.keys(rest).length) return { ok: false, error: `connectorAccounts.${slug} accepts only account and exclusive` };
    if (typeof account !== "string" || !ACCOUNT_ID.test(account)) return { ok: false, error: `connectorAccounts.${slug}.account must be a connected account ID` };
    if (exclusive !== undefined && typeof exclusive !== "boolean") return { ok: false, error: `connectorAccounts.${slug}.exclusive must be true or false` };
    accounts[slug] = exclusive === true ? { account, exclusive: true } : { account };
  }
  return { ok: true, accounts: Object.keys(accounts).length ? accounts : undefined };
}

export interface AccountRules {
  /** The account this bot must use, per app. */
  own: ConnectorAccounts;
  /** Per app, the accounts kept for other bots: this bot may never use them. */
  reserved: Record<string, string[]>;
}

type BotAccounts = { id: string; connectorAccounts?: ConnectorAccounts };

/** Null when no rule touches this bot: it has no assigned account and no other bot keeps one to itself. */
export function accountRulesFor(botId: string, bots: Iterable<BotAccounts>): AccountRules | null {
  let own: ConnectorAccounts = {};
  const exclusive = new Map<string, Set<string>>();
  for (const bot of bots) {
    const pins = bot.connectorAccounts;
    if (!pins) continue;
    if (bot.id === botId) own = pins;
    for (const [slug, pin] of Object.entries(pins)) {
      if (!pin.exclusive) continue;
      const ids = exclusive.get(slug) ?? new Set<string>();
      ids.add(pin.account);
      exclusive.set(slug, ids);
    }
  }
  const reserved: Record<string, string[]> = {};
  for (const [slug, ids] of exclusive) {
    const kept = [...ids].filter((id) => !Object.hasOwn(own, slug) || own[slug]!.account !== id);
    if (kept.length) reserved[slug] = kept;
  }
  return Object.keys(own).length || Object.keys(reserved).length ? { own, reserved } : null;
}

/** For an app-event automation: the one account this bot must watch, or the accounts it may not. Null: no rule. */
export function accountChoiceFor(rules: AccountRules | null, app: string): { only: string } | { except: readonly string[] } | null {
  if (!rules) return null;
  if (Object.hasOwn(rules.own, app)) return { only: rules.own[app]!.account };
  return Object.hasOwn(rules.reserved, app) ? { except: rules.reserved[app]! } : null;
}

export type AccountInventory = Record<string, { accounts: ReadonlyArray<{ id: string; alias?: string; status: string }> }>;

export type AccountDecision =
  | { ok: true; payload: unknown; /** app → the account id written into the call */ used: Record<string, string> }
  | { ok: false; text: string };

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const active = (status: string) => /^active$/i.test(status);
const label = (slug: string) => slug.split(/[-_]+/).map((part) => (part ? part[0]!.toUpperCase() + part.slice(1) : part)).join(" ");
const NOT_RUN = "This call was not run.";

/** Composio's tools that run no app tool: search, schemas and the connection cards. */
function runsNoAppTool(name: string): boolean {
  return ["COMPOSIO_SEARCH_TOOLS", "COMPOSIO_GET_TOOL_SCHEMAS", "COMPOSIO_MANAGE_CONNECTIONS", "COMPOSIO_WAIT_FOR_CONNECTIONS"].includes(name)
    || name.endsWith("_MANAGE_CONNECTIONS") || name.endsWith("_WAIT_FOR_CONNECTIONS");
}

/**
 * The frame as it may be sent for this bot: each app call carries the account the rules allow, or the whole frame is
 * refused. `inventory` is read only when a call touches an app with a rule; a read that fails refuses the call.
 */
export async function applyAccountRules(
  payload: unknown,
  rules: AccountRules,
  inventory: () => Promise<AccountInventory>,
  serviceSlugs: readonly string[] = [],
): Promise<AccountDecision> {
  // A JSON-RPC batch is never read call by call.
  if (Array.isArray(payload)) return { ok: false, text: `OpenMausBot could not check which account this request would use. ${NOT_RUN} Send one call at a time.` };
  if (!isRecord(payload) || payload.method !== "tools/call") return { ok: true, payload, used: {} };
  const params = payload.params;
  const name = isRecord(params) ? params.name : undefined;
  if (!isRecord(params) || typeof name !== "string" || !name) {
    return { ok: false, text: `OpenMausBot could not read this call, so it could not check which account it would use. ${NOT_RUN}` };
  }
  if (runsNoAppTool(name)) {
    // Composio's connection tool can also disconnect an account, and takes no word on whose it is.
    if (name.endsWith("MANAGE_CONNECTIONS") && /remov|delet|disconnect|revok/i.test(JSON.stringify(params.arguments ?? null))) {
      return { ok: false, text: `Connected accounts are assigned per bot here, so a bot can't disconnect one. ${NOT_RUN} Ask the person to do it on the Apps page.` };
    }
    return { ok: true, payload, used: {} };
  }
  const ruledApps = [...new Set([...Object.keys(rules.own), ...Object.keys(rules.reserved)])];
  // An app with a rule is matched first and loosely (google-drive, google_drive and googledrive are one app): a tool
  // must never slip past its app's rule over a spelling.
  const squashed = (text: string) => text.replace(/[-_]/g, "").toUpperCase();
  const appOf = (tool: string) => {
    const parts = tool.split("_");
    let match: string | null = null;
    for (const app of ruledApps) {
      const hit = parts.some((_, index) => index > 0 && squashed(parts.slice(0, index).join("_")) === squashed(app));
      if (hit && (match === null || app.length > match.length)) match = app;
    }
    // A longer connected app wins: with a rule on "google", GOOGLE_DRIVE_FIND_FILE still belongs to google_drive.
    const connected = serviceSlugForCandidates(tool, serviceSlugs);
    if (connected && (match === null || squashed(connected).length > squashed(match).length)) return connected;
    return match ?? serviceSlugFor(tool);
  };
  const ruled = (app: string | null): app is string => app !== null && ruledApps.includes(app);

  if (name !== COMPOSIO_MULTI_EXECUTE_TOOL) {
    if (name.startsWith("COMPOSIO_")) {
      // Workbench, bash and proxy code can reach any account of any app.
      return { ok: false, text: `OpenMausBot can't check which account ${name} would use, and connected accounts are assigned per bot here. ${NOT_RUN} Run the app's tools with ${COMPOSIO_MULTI_EXECUTE_TOOL} instead.` };
    }
    const app = appOf(name);
    if (!ruled(app)) return { ok: true, payload, used: {} };
    return { ok: false, text: `${label(app)} accounts are assigned per bot here, and a direct ${name} call names no account. ${NOT_RUN} Run it with ${COMPOSIO_MULTI_EXECUTE_TOOL} as tools: [{ tool_slug, arguments }].` };
  }

  const args = params.arguments;
  const tools = isRecord(args) ? args.tools : undefined;
  if (!isRecord(args) || !Array.isArray(tools) || !tools.length) {
    return { ok: false, text: `OpenMausBot could not read which tools this ${COMPOSIO_MULTI_EXECUTE_TOOL} call runs, so it could not check their accounts. ${NOT_RUN} Send the tools as tools: [{ tool_slug, arguments }].` };
  }
  let known: AccountInventory | null = null;
  const used: Record<string, string> = {};
  const items: unknown[] = [];
  for (const item of tools) {
    const slug = isRecord(item) ? item.tool_slug : undefined;
    if (!isRecord(item) || typeof slug !== "string" || !slug) {
      return { ok: false, text: `An entry in the tools list named no tool_slug, so OpenMausBot could not check its account. ${NOT_RUN}` };
    }
    const app = appOf(slug);
    if (!ruled(app)) {
      items.push(item);
      continue;
    }
    if (!known) {
      try {
        known = await inventory();
      } catch {
        return { ok: false, text: `OpenMausBot could not check the connected ${label(app)} accounts just now. ${NOT_RUN} Try again in a moment.` };
      }
    }
    const working = (Object.hasOwn(known, app) ? known[app]!.accounts : []).filter((account) => active(account.status));
    let account: string;
    if (Object.hasOwn(rules.own, app)) {
      account = rules.own[app]!.account;
      if (!working.some((candidate) => candidate.id === account)) {
        return { ok: false, text: `The ${label(app)} account assigned to this bot is no longer connected. ${NOT_RUN} Ask the person to reconnect it or to assign another account in this bot's Access settings. No other account was used.` };
      }
    } else {
      const reserved = rules.reserved[app]!;
      const open = working.filter((candidate) => !reserved.includes(candidate.id));
      const names = open.map((candidate) => candidate.alias ?? candidate.id).join(", ");
      const wanted = item.account;
      if (wanted === undefined || wanted === null || wanted === "") {
        if (!open.length) return { ok: false, text: `This bot has no ${label(app)} account: the connected ones are assigned to other bots. ${NOT_RUN} Ask the person to assign one in this bot's Access settings.` };
        if (open.length > 1) return { ok: false, text: `Name the ${label(app)} account to use: pass account on the tool entry, one of ${names}. ${NOT_RUN}` };
        account = open[0]!.id;
      } else {
        const key = typeof wanted === "string" ? wanted.trim() : "";
        const match = key ? open.find((candidate) => candidate.id === key || candidate.alias?.toLowerCase() === key.toLowerCase()) : undefined;
        // Never says whether the name belongs to another bot's account.
        if (!match) return { ok: false, text: `This bot has no ${label(app)} account by that name${names ? `; it may use ${names}` : ""}. ${NOT_RUN}` };
        account = match.id;
      }
    }
    used[app] = account;
    items.push({ ...item, account });
  }
  if (!Object.keys(used).length) return { ok: true, payload, used };
  return { ok: true, payload: { ...payload, params: { ...params, arguments: { ...args, tools: items } } }, used };
}

/** A system-prompt line: which apps run as an assigned account, so the bot does not go looking for one. */
export function connectorAccountsPrompt(pins: ConnectorAccounts | undefined): string {
  const apps = Object.keys(pins ?? {});
  if (!apps.length) return "";
  return ` For ${apps.map(label).join(", ")}, OpenMausBot already chose the account this bot uses and applies it to every call: leave account out, and do not try another one.`;
}

const INVENTORY_TTL_MS = 15_000;
const inventories = new Map<string, { at: number; value: Promise<AccountInventory> }>();

/** One inventory read per installation every few seconds, however many calls a turn makes; a failed read is not kept. */
export function recentAccountInventory(installation: string, read: () => Promise<AccountInventory>, now = Date.now()): Promise<AccountInventory> {
  const key = createHash("sha256").update(installation).digest("hex");
  const held = inventories.get(key);
  if (held && now - held.at < INVENTORY_TTL_MS) return held.value;
  const value = read();
  inventories.set(key, { at: now, value });
  value.catch(() => { if (inventories.get(key)?.value === value) inventories.delete(key); });
  for (const [other, entry] of inventories) if (now - entry.at >= INVENTORY_TTL_MS) inventories.delete(other);
  return value;
}

export function forgetAccountInventories(): void {
  inventories.clear();
}
