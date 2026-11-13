// HSP Slack bridge: one Slack app per OpenMausBot bot, over Socket Mode (no public webhook).
// A DM or @mention from a person the bot is shared with (OMB Sharing, Chat level or admin) goes into that bot's OMB thread through the guarded loopback route;
// the bot's reply (and its files) comes back to Slack. Approvals are never answered from Slack.
// Config: $BRIDGE_CONFIG (default /etc/hsp-slack-bridge/config.json). Secrets: systemd credentials in
// $CREDENTIALS_DIRECTORY: relay.token and <bot>.json ({"botToken":"xoxb-…","appToken":"xapp-…"}). Never logged.
// Writes $BRIDGE_STATUS (default next to state.json) for OMB's Slack settings page; see DASHBOARD.md.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { join, dirname } from "node:path";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient, LogLevel } from "@slack/web-api";

const CONFIG_PATH = process.env.BRIDGE_CONFIG ?? "/etc/hsp-slack-bridge/config.json";
const CRED_DIR = process.env.CREDENTIALS_DIRECTORY ?? process.env.BRIDGE_CREDENTIALS_DIR ?? "/etc/hsp-slack-bridge/tokens";
const STATE_PATH = process.env.BRIDGE_STATE ?? "/var/lib/hsp-slack-bridge/state.json";
// Read by OMB's Slack settings page (0644). No secrets, message text, Slack user names/ids or client names.
const STATUS_PATH = process.env.BRIDGE_STATUS ?? join(dirname(STATE_PATH), "status.json");

const config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
// Who may use each bot comes from OMB Sharing (GET /api/hsp/slack/people). The old per-bot email list is used only while the
// server is too old to have that route (it answers 404).
const LEGACY_ACCESS_PATH = config.accessFile ?? "/etc/hsp-slack-bridge/access.json";
const LEGACY_ACCESS = config.access ?? (existsSync(LEGACY_ACCESS_PATH) ? JSON.parse(readFileSync(LEGACY_ACCESS_PATH, "utf8")) : null);
const OMB = (config.ombUrl ?? "http://127.0.0.1:8870").replace(/\/$/, "");
const WORKSPACE_URL = config.workspaceUrl ?? "the HSP workspace";
const POLL_LIMIT_MS = (config.maxRequestMinutes ?? 180) * 60_000;
const SLACK_FILE_MAX = 20 * 1024 * 1024;

const log = (...parts) => console.log(new Date().toISOString(), ...parts);
const readSecret = (name) => {
  const file = join(CRED_DIR, name);
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
};
const RELAY_TOKEN = readSecret("relay.token");
if (!RELAY_TOKEN) log("warning: no relay.token credential; guarded calls will be refused if the server requires one");

// ---------- state (atomic JSON) ----------
let state = { threads: {}, inflight: {}, refusedAt: {} };
try { state = { ...state, ...JSON.parse(readFileSync(STATE_PATH, "utf8")) }; } catch { /* first start */ }
let saveTimer = null;
function saveState(now = false) {
  const write = () => {
    saveTimer = null;
    mkdirSync(dirname(STATE_PATH), { recursive: true });
    const tmp = `${STATE_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
    renameSync(tmp, STATE_PATH);
  };
  if (now) { if (saveTimer) clearTimeout(saveTimer); write(); return; }
  saveTimer ??= setTimeout(write, 200);
}

// ---------- OMB API ----------
async function omb(method, path, body) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (RELAY_TOKEN) headers["x-omb-relay-token"] = RELAY_TOKEN;
  const init = { method, headers, signal: AbortSignal.timeout(30_000) };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${OMB}${path}`, init);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text.slice(0, 200) }; }
  return { status: res.status, data };
}
async function ombBytes(path) {
  const headers = RELAY_TOKEN ? { "x-omb-relay-token": RELAY_TOKEN } : {};
  const res = await fetch(`${OMB}${path}`, { headers, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return null;
  return Buffer.from(await res.arrayBuffer());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const newSendId = () => `slk_${randomBytes(18).toString("base64url")}`;

// ---------- per-key serial queue ----------
const chains = new Map();
function serial(key, job) {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(job, job).catch((err) => log(`[${key}] job failed:`, err?.message ?? err));
  chains.set(key, next);
  next.finally(() => { if (chains.get(key) === next) chains.delete(key); });
  return next;
}

// ---------- status file (read by OMB's Slack settings page) ----------
const STARTED_AT = new Date().toISOString();
const ERROR_TEXT = {
  upload_too_large: "A file was over 20 MB and was not sent to Slack.",
  upload_failed: "Slack did not accept a file upload.",
  attachment_missing: "A file from the bot could not be read from OMB.",
  request_failed: "A request could not be passed on to the bot.",
  send_refused: "OMB refused a request (the person may no longer have access).",
  custom_level: "The bot is set to a custom approval level, which Slack cannot use.",
  slack_disconnected: "The Slack connection dropped for over a minute.",
  slack_start_failed: "The bot could not connect to Slack.",
  people_unavailable: "Could not read from OMB Sharing who may use the bot.",
};
const status = new Map(); // key -> the bot's entry in status.json
const isoDay = () => new Date().toISOString().slice(0, 10);
let previousStatus = {};
try {
  const old = JSON.parse(readFileSync(STATUS_PATH, "utf8"));
  for (const b of old?.bots ?? []) if (b?.key) previousStatus[b.key] = b;
} catch { /* first start */ }
function statusOf(key) {
  let st = status.get(key);
  if (st) return st;
  const spec = config.bots?.[key] ?? {}, old = previousStatus[key] ?? {};
  st = {
    key, name: spec.name ?? key, ombBotId: spec.ombBotId ?? null, slackAppId: spec.slackAppId ?? null, slackTeamId: null,
    connected: false, connectedAt: null, lastMessageAt: old.lastMessageAt ?? null, channels: [],
    // Today's counts and recent errors survive a restart of the bridge.
    today: old.today?.date === isoDay() ? { date: old.today.date, handled: old.today.handled | 0, refused: old.today.refused | 0 } : { date: isoDay(), handled: 0, refused: 0 },
    errors: Array.isArray(old.errors) ? old.errors.filter((e) => ERROR_TEXT[e?.code] && typeof e.at === "string").map((e) => ({ at: e.at, code: e.code, text: ERROR_TEXT[e.code] })) : [],
  };
  status.set(key, st);
  return st;
}
function today(key) {
  const st = statusOf(key);
  if (st.today.date !== isoDay()) st.today = { date: isoDay(), handled: 0, refused: 0 };
  return st.today;
}
// Errors: fixed sentences per code, newest first, last 10 within 24 h. A repeat of the newest code within 10 min only moves its time.
function noteError(key, code) {
  const st = statusOf(key), at = new Date().toISOString();
  if (st.errors[0]?.code === code && Date.now() - Date.parse(st.errors[0].at) < 600_000) st.errors[0].at = at;
  else st.errors.unshift({ at, code, text: ERROR_TEXT[code] });
  writeStatusSoon();
}
let statusTimer = null;
function writeStatus() {
  clearTimeout(statusTimer);
  statusTimer = null;
  const cutoff = Date.now() - 86_400_000;
  for (const key of status.keys()) {
    const st = statusOf(key);
    today(key);
    st.errors = st.errors.filter((e) => Date.parse(e.at) >= cutoff).slice(0, 10);
  }
  const doc = { version: 1, startedAt: STARTED_AT, updatedAt: new Date().toISOString(), bots: [...status.values()] };
  try {
    mkdirSync(dirname(STATUS_PATH), { recursive: true });
    const tmp = `${STATUS_PATH}.tmp`;
    writeFileSync(tmp, JSON.stringify(doc, null, 1), { mode: 0o644 });
    chmodSync(tmp, 0o644);
    renameSync(tmp, STATUS_PATH);
  } catch (err) {
    log(`could not write the status file (${err?.code ?? err?.message})`);
  }
}
function writeStatusSoon() { statusTimer ??= setTimeout(writeStatus, 1_000); }

// ---------- who may use each bot ----------
// people: Map<ombBotId, Map<email, {email, name}>>, from OMB Sharing (refreshed every minute; the last good list is kept if a
// refresh fails). Until a list has loaded, everyone is refused.
let people = null, peopleSource = null;
function legacyPeople() {
  const out = new Map();
  for (const [key, spec] of Object.entries(config.bots ?? {})) {
    const emails = (LEGACY_ACCESS?.[key] ?? []).map((e) => String(e).trim().toLowerCase()).filter(Boolean);
    out.set(spec.ombBotId, new Map(emails.map((email) => [email, { email, name: null }])));
  }
  return out;
}
async function refreshPeople() {
  try {
    const { status: code, data } = await omb("GET", "/api/hsp/slack/people");
    if (code === 200 && data?.bots && typeof data.bots === "object") {
      const next = new Map();
      for (const [botId, list] of Object.entries(data.bots)) {
        const byEmail = new Map();
        for (const p of Array.isArray(list) ? list : []) {
          if (typeof p?.email !== "string" || !p.email.includes("@")) continue;
          const email = p.email.trim().toLowerCase();
          byEmail.set(email, { email, name: typeof p.name === "string" ? p.name.trim().slice(0, 120) || null : null });
        }
        next.set(botId, byEmail);
      }
      if (peopleSource !== "omb") log("people: using OMB Sharing");
      people = next; peopleSource = "omb";
      return;
    }
    if (code === 404 && LEGACY_ACCESS) {
      if (peopleSource !== "legacy") log("people: this OMB has no Sharing route; using the old access list");
      people = legacyPeople(); peopleSource = "legacy";
      return;
    }
    throw new Error(`status ${code}`);
  } catch (err) {
    log(`people: could not refresh (${err?.message ?? err}); ${people ? "keeping the last list" : "refusing everyone until it loads"}`);
    for (const key of Object.keys(config.bots ?? {})) noteError(key, "people_unavailable");
  }
}

// ---------- bots ----------
const bots = new Map(); // key -> { key, name, ombBotId, web, socket, selfUserId, users:Map }

function botFor(key) { return bots.get(key); }

// A Slack user is matched by the email on their Slack profile (workspace-verified; looked up by user ID, cached for an hour).
// The email sent to OMB is the one on the Sharing list.
async function slackUser(bot, userId) {
  const hit = bot.users.get(userId);
  if (hit && Date.now() - hit.at < 3_600_000) return hit;
  try {
    const { user } = await bot.web.users.info({ user: userId });
    const usable = user && !user.deleted && !user.is_bot;
    const entry = {
      at: Date.now(),
      email: usable && typeof user.profile?.email === "string" ? user.profile.email.trim().toLowerCase() || null : null,
      name: usable ? (user.profile?.display_name || user.real_name || user.name || "").trim().slice(0, 120) || null : null,
    };
    bot.users.set(userId, entry);
    if (bot.users.size > 2_000) bot.users.delete(bot.users.keys().next().value);
    return entry;
  } catch (err) {
    log(`[${bot.key}] could not look up a Slack user (${err?.data?.error ?? err?.message})`);
    return null;
  }
}
async function personFor(bot, userId) {
  const list = people?.get(bot.ombBotId);
  if (!list?.size) return null;
  const who = await slackUser(bot, userId);
  const p = who?.email ? list.get(who.email) : null;
  return p ? { email: p.email, name: p.name ?? who.name } : null;
}

// Channels the bot is in, by name (needs channels:read + groups:read; without them the page shows DMs only).
async function refreshChannels(bot) {
  const st = statusOf(bot.key);
  try {
    const found = [];
    let cursor;
    do {
      const page = await bot.web.users.conversations({ types: "public_channel,private_channel", exclude_archived: true, limit: 200, cursor });
      for (const c of page.channels ?? []) if (c?.id) found.push({ id: c.id, name: typeof c.name === "string" ? c.name : null });
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor && found.length < 1_000);
    st.channels = found.filter((c) => c.name);
  } catch (err) {
    if (err?.data?.error !== "missing_scope") log(`[${bot.key}] could not list channels (${err?.data?.error ?? err?.message})`);
  }
  writeStatusSoon();
}

// The level the relay must name: the bot's current one. Only these four can be relayed (Custom cannot).
const RELAYABLE = new Set(["ask", "edits", "auto", "full"]);
async function approvalModeOf(bot) {
  const { status, data } = await omb("GET", "/api/bots");
  const list = Array.isArray(data) ? data : data?.bots ?? [];
  const found = list.find((b) => b.id === bot.ombBotId);
  if (status !== 200 || !found) throw new Error(`could not read ${bot.name}'s settings (${status})`);
  return found.approvalMode ?? "full";
}

async function threadFor(bot, key, title) {
  const known = state.threads[key];
  if (known) return known;
  const { status, data } = await omb("POST", `/api/bots/${bot.ombBotId}/tasks`, { title, select: false });
  if (status !== 201 || !data?.task?.threadId) throw new Error(`create task failed (${status}): ${data?.error ?? "no threadId"}`);
  state.threads[key] = data.task.threadId;
  saveState(true);
  log(`[${bot.key}] new OMB thread for ${key.split("|")[1]}`);
  return data.task.threadId;
}

async function slackPost(bot, channel, threadTs, text) {
  const chunks = [];
  for (let rest = text; rest.length; rest = rest.slice(11_000)) chunks.push(rest.slice(0, 11_000));
  for (const chunk of chunks.length ? chunks : ["(no text)"]) {
    try {
      await bot.web.chat.postMessage({ channel, thread_ts: threadTs, markdown_text: chunk, unfurl_links: false });
    } catch {
      await bot.web.chat.postMessage({ channel, thread_ts: threadTs, text: chunk.slice(0, 3_900), unfurl_links: false });
    }
  }
}

async function react(bot, channel, ts, add, remove) {
  if (remove) await bot.web.reactions.remove({ channel, timestamp: ts, name: remove }).catch(() => {});
  if (add) await bot.web.reactions.add({ channel, timestamp: ts, name: add }).catch(() => {});
}

// ---------- the request flow ----------
async function relay(bot, job) {
  // job: { sendId, threadKey, title, text, channel, threadTs, msgTs, email, name, phase }
  const threadId = await threadFor(bot, job.threadKey, job.title);
  job.threadId = threadId;
  if (job.phase === "new") {
    const startedAt = Date.now();
    let modeRetried = false;
    for (let attempt = 0; ; attempt++) {
      const mode = await approvalModeOf(bot);
      if (!RELAYABLE.has(mode)) {
        throw Object.assign(new Error(`${bot.name} is set to a custom approval level, which Slack cannot use. Use the HSP workspace.`), { userFacing: true, code: "custom_level" });
      }
      const page = await omb("GET", `/api/threads/${threadId}/messages?limit=1`);
      if (page.status === 404) { // thread was deleted in the web UI: start a fresh one
        delete state.threads[job.threadKey];
        job.threadId = await threadFor(bot, job.threadKey, job.title);
        continue;
      }
      const leaf = page.data?.activeLeafId ?? null;
      const send = await omb("POST", `/api/bots/${bot.ombBotId}/messages/guarded`, {
        threadId: job.threadId, sendId: job.sendId, text: job.text, expectedActiveLeafId: leaf, expectedApprovalMode: mode,
        onBehalfOf: { email: job.email, ...(job.name ? { name: job.name } : {}) },
      });
      if (send.status === 202 || send.status === 200) break;
      const code = send.data?.code ?? "";
      if (code === "guarded_permissions" && !modeRetried) { modeRetried = true; continue; } // the level changed between read and send
      if (code === "guarded_permissions") {
        throw Object.assign(new Error(`This conversation with ${bot.name} has its own approval settings, so it can't be used from Slack. Send a new message (not in this thread) to start a fresh one, or use the HSP workspace.`), { userFacing: true });
      }
      const retryable = send.status === 409 && /guarded_busy|guarded_branch/.test(`${code} ${send.data?.error ?? ""}`) ||
        send.status === 409 && /changed before|free thread slot/.test(send.data?.error ?? "");
      if (!retryable || Date.now() - startedAt > 15 * 60_000) {
        throw Object.assign(new Error(send.data?.error ?? `send refused (${send.status})`), { userFacing: send.status === 403, code: send.status === 403 ? "send_refused" : "request_failed" });
      }
      if (attempt === 2) await slackPost(bot, job.channel, job.threadTs, `${bot.name} is still busy with something else in this conversation; your message will go in as soon as it is free.`);
      await sleep(Math.min(30_000, 2_000 * 2 ** Math.min(attempt, 4)));
    }
    job.phase = "sent";
    saveState(true);
  }

  // Follow the request until it settles.
  let delay = 1_000, toldWaiting = false;
  const started = job.sentAt ??= Date.now();
  saveState();
  for (;;) {
    const r = await omb("GET", `/api/bots/${bot.ombBotId}/requests/${job.sendId}?threadId=${job.threadId}`);
    if (r.status === 200) {
      const phase = r.data?.phase;
      if (phase === "settled" || phase === "untracked") return deliver(bot, job, r.data.messages ?? []);
      if (phase === "waiting" && !toldWaiting) {
        toldWaiting = true;
        await slackPost(bot, job.channel, job.threadTs, `${bot.name} needs a decision in ${WORKSPACE_URL} before it can continue. I'll post the answer here when it's done.`);
      }
    } else if (r.status === 409 || r.status === 404) {
      // The conversation moved on in the web UI (a newer message, a stop); report what we can.
      await slackPost(bot, job.channel, job.threadTs, `This request was changed or stopped in ${WORKSPACE_URL}. Open it there to see where it ended.`);
      return;
    } else if (r.status >= 500 || r.status === 0) {
      log(`[${bot.key}] follow got ${r.status}; retrying`);
    } else {
      throw new Error(`follow failed (${r.status}): ${r.data?.error ?? ""}`);
    }
    if (Date.now() - started > POLL_LIMIT_MS) {
      await slackPost(bot, job.channel, job.threadTs, `${bot.name} is still working on this. Check ${WORKSPACE_URL} for the result.`);
      return;
    }
    await sleep(delay);
    delay = Math.min(5_000, delay + 1_000);
  }
}

// Bot replies name attachments by their file path on the OMB host (…/attachments/<uuid>.png); the server serves only the
// bare stored name, at /api/attachments/<name> (the web UI does the same mapping).
function attachmentUrl(path) {
  if (typeof path !== "string") return null;
  const parts = path.replaceAll("\\", "/").split("/");
  const name = parts.pop();
  if (!/^[\w-]+(\.[\w-]+)*$/.test(name ?? "")) return null;
  const dir = parts.join("/");
  return dir === "/api/attachments" || dir.endsWith("/attachments") ? `/api/attachments/${encodeURIComponent(name)}` : null;
}

// OMB stores bot pictures under generated names (<uuid>.png). For Slack, name such a file after what the bot's reply says
// it is: "Here's the current screenshot of wa.hspoints.com showing the sign-in page." -> wa-hspoints-com-showing-sign-in-page.png
const GENERATED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$|^[0-9a-f]{16,}$/i;
function describedName(text) {
  let s = (text ?? "").replace(/[*_`~>#]/g, " ").trim().split(/\n|[.!?](?=\s|$)/)[0] ?? "";
  s = s.replace(/^(here(['’]s| is| are)|this is|attached( is)?|i['’]ve attached|below is)\s+/i, "")
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/^(current|latest|new|updated|requested)\s+/i, "")
    .replace(/^(browser\s+)?(screenshots?|screen shots?|images?|pictures?|photos?|files?)(\s+of)?\s+/i, "");
  const out = slugWords(s);
  return out.includes("-") ? out : ""; // one word ("Done.") says nothing about the picture
}
// What a screenshot shows, from the last screen-reading tool call in the same turn: the window title plus the page the
// address bar is on. "WATeamInbox — Mozilla Firefox" at wa.hspoints.com/login -> "WATeamInbox login page".
const BROWSER_SUFFIX = /\s+[—–-]\s+(mozilla firefox|firefox|google chrome|chromium|microsoft edge|safari|brave)$/i;
const ADDRESS_BAR = /(?:entry|combo box|text field|edit)\s+"(?:search or enter address|address and search bar|search google or type a url|search or type url|address bar)"[^\n]*?value="([^"]{1,500})"/i;
function pageWords(url) {
  let u;
  try { u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`); } catch { return null; }
  const parts = u.pathname.split("/").map((p) => decodeURIComponent(p).replace(/\.(html?|php|aspx?)$/i, ""))
    .filter((p) => p && p.length <= 40 && !GENERATED.test(p) && !/^\d+$/.test(p) && /[a-z]/i.test(p));
  return { host: u.hostname.replace(/^www\./, ""), path: parts.slice(-2).join(" ") };
}
// "…showing the sign-in page." -> "sign-in page" (the words right before page/screen/dialog/…, minus filler words)
const PAGE_FILLER = new Set(["the", "a", "an", "its", "his", "her", "their", "your", "our", "my", "this", "that", "current", "same",
  "shows", "showing", "show", "of", "on", "in", "at", "to", "is", "was", "now", "still", "main", "web", "browser"]);
function pageFromText(text) {
  const m = String(text ?? "").replace(/[*_`~]/g, " ").match(/((?:[a-z0-9][\w-]*\s+){0,3})(page|screen|dialog|form|dashboard|inbox|tab)\b/i);
  if (!m) return "";
  const words = m[1].trim().split(/\s+/).filter(Boolean);
  while (words.length && PAGE_FILLER.has(words[0].toLowerCase())) words.shift();
  return words.length ? `${words.join(" ")} ${m[2]}` : "";
}
function screenBefore(messages, index, text) {
  const turn = messages[index]?.turnId;
  for (let i = index - 1; i >= 0; i--) {
    const m = messages[i];
    if (turn && m.turnId && m.turnId !== turn) break;
    const out = m.tool?.output;
    if (!out) continue;
    const raw = (typeof out === "string" ? out : JSON.stringify(out)).replace(/\\"/g, '"').replace(/\\n/g, "\n");
    let title = null;
    try { title = (typeof out === "string" ? JSON.parse(out) : out)?.structuredContent?.window_title; } catch {}
    title ??= raw.match(/"window_title"\s*:\s*"([^"]{1,200})"/)?.[1] ?? raw.match(/\[0\]\s+frame\s+"([^"]{1,200})"/)?.[1] ?? null;
    const page = pageWords(raw.match(ADDRESS_BAR)?.[1] ?? "");
    title = title?.trim().replace(BROWSER_SUFFIX, "") || null;
    if (!title && !page) continue;
    const name = title || page.host;
    const said = pageFromText(text);
    const extra = page?.path ? `${page.path} page` : said;
    if (extra && name.toLowerCase().includes(extra.toLowerCase().replace(/ (page|screen|dialog|form|dashboard|inbox|tab)$/, ""))) return name;
    return [name, extra].filter(Boolean).join(" ");
  }
  return null;
}
function slugWords(text, max = 60) {
  const words = (text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !["the", "a", "an"].includes(w));
  let out = "";
  for (const w of words) { if ((out ? out.length + 1 : 0) + w.length > max) break; out = out ? `${out}-${w}` : w; }
  return out;
}

function slackFileName(bot, file, text, index, total) {
  const base = file.name || String(file.path ?? "").replaceAll("\\", "/").split("/").pop() || "file";
  const dot = base.lastIndexOf(".");
  const stem = dot > 0 ? base.slice(0, dot) : base, ext = dot > 0 ? base.slice(dot) : "";
  if (!GENERATED.test(stem)) return base;
  const described = (file.windowTitle && slugWords(file.windowTitle)) || describedName(text) || `${bot.key}-${file.kind === "image" ? "image" : "file"}`;
  return `${described}${total > 1 ? `-${index + 1}` : ""}${ext}`;
}

async function deliver(bot, job, messages) {
  const replies = messages.slice(1).filter((m) => m.role === "bot" && (m.kind === "text" || m.attachments?.length));
  const finalText = [...replies].reverse().find((m) => m.kind === "text" && m.text?.trim())?.text?.trim();
  await slackPost(bot, job.channel, job.threadTs, finalText || `${bot.name} finished without a written reply.`);
  // Each file keeps the text of the reply it came with (or the final reply), so its Slack name can say what it shows.
  const files = replies.flatMap((m) => (m.attachments ?? []).map((a) => ({
    ...a, context: m.text?.trim() || finalText, windowTitle: a.kind === "image" ? screenBefore(messages, messages.indexOf(m), m.text?.trim() || finalText) : null,
  })))
    .filter((a) => a.kind === "image" || a.kind === "file");
  const sent = files.slice(0, 10);
  const skipped = [];
  const unnamed = sent.filter((f) => GENERATED.test(String(f.name || f.path || "").split("/").pop().replace(/\.[^.]*$/, "")));
  for (const file of sent) {
    const name = slackFileName(bot, file, file.context, unnamed.indexOf(file), unnamed.length);
    const url = attachmentUrl(file.path);
    const bytes = url ? await ombBytes(url).catch(() => null) : null;
    if (!bytes) { log(`[${bot.key}] could not fetch attachment ${name}`); noteError(bot.key, "attachment_missing"); }
    else if (bytes.length > SLACK_FILE_MAX) noteError(bot.key, "upload_too_large");
    if (!bytes || bytes.length > SLACK_FILE_MAX) { skipped.push(name); continue; }
    try {
      await bot.web.filesUploadV2({ channel_id: job.channel, thread_ts: job.threadTs, file: bytes, filename: name });
    } catch (err) {
      log(`[${bot.key}] file upload failed: ${err?.data?.error ?? err?.message}`);
      noteError(bot.key, "upload_failed");
      skipped.push(name);
    }
  }
  if (skipped.length || files.length > 10) {
    const more = [...skipped, ...files.slice(10).map((f) => f.name || "file")];
    await slackPost(bot, job.channel, job.threadTs, `Files not attached here (open them in ${WORKSPACE_URL}): ${more.join(", ")}`);
  }
}

async function runJob(bot, job) {
  try {
    await relay(bot, job);
    await react(bot, job.channel, job.msgTs, "white_check_mark", "eyes");
  } catch (err) {
    log(`[${bot.key}] request failed: ${err?.message ?? err}`);
    noteError(bot.key, ERROR_TEXT[err?.code] ? err.code : "request_failed");
    await react(bot, job.channel, job.msgTs, "x", "eyes");
    const why = err?.userFacing ? err.message : "Something went wrong passing this on. Please try again, or use the HSP workspace.";
    await slackPost(bot, job.channel, job.threadTs, why).catch(() => {});
  } finally {
    delete state.inflight[job.sendId];
    saveState(true);
  }
}

// ---------- Slack events ----------
async function onMessage(bot, event) {
  const isDm = event.channel_type === "im";
  if (event.bot_id || event.app_id || (event.subtype && event.subtype !== "file_share") || !event.user) return;
  if (event.user === bot.selfUserId) return;
  if (!isDm && event.type !== "app_mention") return;

  const st = statusOf(bot.key);
  st.lastMessageAt = new Date().toISOString();
  const person = await personFor(bot, event.user);
  if (!person) {
    log(`[${bot.key}] refused Slack user ${event.user}`);
    today(bot.key).refused++;
    writeStatusSoon();
    const key = `${bot.key}|${event.user}`;
    if (Date.now() - (state.refusedAt[key] ?? 0) > 86_400_000) {
      state.refusedAt[key] = Date.now();
      saveState();
      await slackPost(bot, event.channel, event.thread_ts ?? event.ts,
        `Sorry, I can only take requests from people HSP has set up to work with ${bot.name}.`);
    }
    return;
  }

  let text = (event.text ?? "").replace(new RegExp(`<@${bot.selfUserId}>`, "g"), "").trim();
  // DMs and channels work alike: the reply goes in the Slack thread under the message, and one Slack thread is one OMB
  // conversation. A new top-level message starts a new conversation.
  const threadTs = event.thread_ts ?? event.ts;
  const threadKey = `${bot.key}|${isDm ? "dm" : "ch"}|${event.channel}|${threadTs}`;
  const names = (event.files ?? []).map((f) => f.name || f.title || "file");
  if (names.length) text += `\n\n[Sent from Slack with files that were not passed through: ${names.join(", ")}. Ask the person to share them in the HSP workspace if you need them.]`;
  if (!text.trim()) return;

  const job = {
    sendId: newSendId(), threadKey, phase: "new",
    title: isDm ? `Slack · ${person.name ?? person.email}` : `Slack thread · ${person.name ?? person.email}`,
    text, channel: event.channel, threadTs, msgTs: event.ts, email: person.email, name: person.name,
  };
  state.inflight[job.sendId] = { bot: bot.key, ...job };
  saveState(true);
  today(bot.key).handled++;
  writeStatusSoon();
  await react(bot, event.channel, event.ts, "eyes");
  serial(threadKey, () => runJob(bot, state.inflight[job.sendId] ?? job));
}

async function startBot(key, spec) {
  const st = statusOf(key);
  const raw = readSecret(`tokens_${key}.json`) ?? readSecret(`${key}.json`);
  if (!raw) { log(`[${key}] no Slack tokens yet; skipped`); return; }
  let tokens;
  try { tokens = JSON.parse(raw); } catch { log(`[${key}] token credential is not valid JSON; skipped`); return; }
  if (!String(tokens.botToken ?? "").startsWith("xoxb-") || !String(tokens.appToken ?? "").startsWith("xapp-")) { log(`[${key}] token credential has wrong token types; skipped`); return; }

  const web = new WebClient(tokens.botToken, { logLevel: LogLevel.ERROR });
  const auth = await web.auth.test();
  st.slackTeamId = auth.team_id ?? null;
  if (auth.bot_id) {
    const info = await web.bots.info({ bot: auth.bot_id }).catch(() => null);
    st.slackAppId = info?.bot?.app_id ?? st.slackAppId;
  }
  const bot = { key, name: spec.name ?? key, ombBotId: spec.ombBotId, web, selfUserId: auth.user_id, users: new Map() };
  const socket = new SocketModeClient({ appToken: tokens.appToken, logLevel: LogLevel.ERROR });
  const seen = new Set();
  // @slack/socket-mode 3.x emits Events API payloads under the inner event type and as "slack_event"; never "events_api".
  socket.on("slack_event", async ({ type, body, ack }) => {
    await ack();
    if (type !== "events_api" || !body) return;
    if (seen.has(body.event_id)) return;
    seen.add(body.event_id);
    if (seen.size > 1_000) seen.delete(seen.values().next().value);
    onMessage(bot, body.event ?? {}).catch((err) => log(`[${key}] event failed: ${err?.message ?? err}`));
  });
  // Slack recycles Socket Mode connections now and then; only a drop that lasts over a minute counts as an error.
  let dropTimer = null;
  socket.on("connected", () => {
    clearTimeout(dropTimer);
    dropTimer = null;
    if (!st.connected) st.connectedAt = new Date().toISOString();
    st.connected = true;
    log(`[${key}] connected to Slack as ${auth.user} (team ${auth.team})`);
    writeStatusSoon();
  });
  socket.on("disconnected", () => {
    log(`[${key}] disconnected; reconnecting`);
    dropTimer ??= setTimeout(() => { st.connected = false; noteError(key, "slack_disconnected"); }, 60_000);
  });
  await socket.start();
  st.connected = true;
  st.connectedAt ??= new Date().toISOString();
  bot.socket = socket;
  bots.set(key, bot);
  await refreshChannels(bot);
  setInterval(() => refreshChannels(bot), 600_000).unref();
  log(`[${key}] ready: ${people?.get(bot.ombBotId)?.size ?? 0} people may use ${bot.name}`);
}

// ---------- main ----------
const health = await omb("GET", "/api/health").catch((err) => ({ status: 0, data: { error: err.message } }));
const caps = health.data?.capabilities ?? {};
if (health.status !== 200 || !caps.guardedMessages || !caps.guardedRequests || !caps.guardedOnBehalfOf) {
  log(`OMB at ${OMB} lacks the guarded routes (status ${health.status}); exiting`);
  process.exit(1);
}
await refreshPeople();
setInterval(refreshPeople, (config.peopleRefreshSeconds ?? 60) * 1_000);
for (const [key, spec] of Object.entries(config.bots ?? {})) {
  await startBot(key, spec).catch((err) => {
    log(`[${key}] failed to start: ${err?.data?.error ?? err?.message ?? err}`);
    noteError(key, "slack_start_failed");
  });
}
// Resume requests that were in flight when the service stopped. A resend with the same sendId returns the original receipt.
for (const job of Object.values(state.inflight)) {
  const bot = botFor(job.bot);
  if (!bot) continue;
  log(`[${bot.key}] resuming an in-flight request`);
  serial(job.threadKey, () => runJob(bot, job));
}
log(`bridge up: ${bots.size} of ${Object.keys(config.bots ?? {}).length} bots connected`);
writeStatus();
// The status file is rewritten every 30 s even when nothing happens, so OMB can tell the bridge is alive.
// This also keeps the process up with no bot connected yet (tokens arrive as credentials; a restart picks them up).
setInterval(writeStatus, 30_000);

const shutdown = async () => {
  saveState(true);
  for (const st of status.values()) st.connected = false;
  writeStatus();
  await Promise.allSettled([...bots.values()].map((b) => b.socket?.disconnect()));
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
