// Per-bot accounts against a real server: which account each bot's connected-app call reaches Composio with.
import { spawn, type ChildProcess } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { launchVerificationServer, verificationServerEnvironment, type VerificationServer } from "../scripts/control-omb.ts";
import { waitForExit } from "./testing/cleanup.ts";

const key = "isolated-accounts-capability";
let fixture: VerificationServer;
let child: ChildProcess;
let composio: Server;
let origin = "";
let milo: any;
let maus: any;
let plain: any;
const relayed: any[] = [];
const accounts = [
  { id: "ca_team", alias: "team", status: "ACTIVE" },
  { id: "ca_milo", alias: "milo", status: "ACTIVE" },
  { id: "ca_maus", alias: "maus", status: "ACTIVE" },
];

const api = async (method: string, path: string, body?: unknown, token?: string) => {
  const response = await fetch(fixture.info.url + path, {
    method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20_000),
  });
  return { status: response.status, body: await response.json() as any };
};
const mint = async (bot: any) => {
  const response = await fetch(fixture.info.url + "/api/testing/internal-capability", {
    method: "POST", headers: { "content-type": "application/json", "x-openmausbot-test-capability": key },
    body: JSON.stringify({ botId: bot.id, threadId: bot.threadId, kind: "connectors" }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as any).token as string;
};
const relay = async (bot: any, name: string, args: unknown = {}) => api("POST", "/api/internal/connectors/mcp",
  { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } }, await mint(bot));
const run = (bot: any, account?: string) => relay(bot, "COMPOSIO_MULTI_EXECUTE_TOOL",
  { tools: [{ tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: { owner: "acme", repo: "site" }, ...(account === undefined ? {} : { account }) }] });
const text = (answer: { body: any }) => String(answer.body?.result?.content?.[0]?.text ?? "");
const reached = () => relayed.map((frame) => frame.params.arguments.tools[0].account);
const assign = (bot: any, connectorAccounts: unknown) => api("PATCH", `/api/bots/${bot.id}`, { connectorAccounts });

beforeAll(async () => {
  composio = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const path = new URL(req.url ?? "/", "http://fixture").pathname;
    res.setHeader("content-type", "application/json");
    if (path === "/api/tool_router/session/fixture-session") {
      return res.end(JSON.stringify({ session_id: "fixture-session", mcp: { type: "http", url: origin + "/mcp" },
        config: { user_id: "fixture-user", multi_account: { enable: true, max_accounts_per_toolkit: 5, require_explicit_selection: true } } }));
    }
    if (path === "/api/connected_accounts") {
      return res.end(JSON.stringify({ items: accounts.map((account) => ({ ...account, user_id: "fixture-user", updated_at: "2026-11-01T00:00:00Z", toolkit: { slug: "github" } })) }));
    }
    if (path === "/mcp") {
      const body = JSON.parse(raw);
      if (body.method === "tools/call") relayed.push(body);
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id ?? null, result: { content: [{ type: "text", text: "relay-ok" }] } }));
    }
    return res.end(JSON.stringify({ items: [{ slug: "github", connected_account: { id: "ca_team", status: "ACTIVE" } }] }));
  });
  await new Promise<void>((resolve) => composio.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(composio.address() as { port: number }).port}`;
  fixture = await launchVerificationServer();
  const make = async (name: string) => {
    const created = await api("POST", "/api/bots", { name });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return created.body.bot;
  };
  milo = await make("Milo");
  maus = await make("MausBot");
  plain = await make("Plain");
  await waitForExit(fixture.child, { signal: "SIGTERM" });
  const configFile = join(fixture.info.dataDir, "config.json");
  const config = JSON.parse(readFileSync(configFile, "utf8"));
  config.composio = { apiKey: "ak_isolated_fixture", userId: "fixture-user", sessionId: "fixture-session" };
  writeFileSync(configFile, JSON.stringify(config));
  const log = openSync(fixture.info.logPath, "a", 0o600);
  child = spawn(process.execPath, ["--experimental-strip-types", fileURLToPath(new URL("./index.ts", import.meta.url))], {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...verificationServerEnvironment({}, fixture.info.dataDir, Number(new URL(fixture.info.url).port)),
      OMB_TEST_INTERNAL_CAPABILITY_KEY: key, OMB_COMPOSIO_API: origin + "/api", OMB_COMPOSIO_TOOLKITS_API: origin + "/api" },
    stdio: ["ignore", log, log],
  });
  closeSync(log);
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(fixture.info.url + "/api/health")).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("isolated accounts server did not start");
}, 40_000);

afterAll(async () => {
  await waitForExit(child, { signal: "SIGTERM" });
  await fixture.close();
  await new Promise<void>((resolve) => composio.close(() => resolve()));
});

beforeEach(() => { relayed.length = 0; });

it("changes nothing while no bot has an account assigned", async () => {
  expect(text(await run(plain, "milo"))).toBe("relay-ok");
  expect(text(await run(plain))).toBe("relay-ok");
  expect(text(await relay(plain, "COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: "1" }))).toBe("relay-ok");
  expect(relayed.slice(0, 2).map((frame) => frame.params.arguments.tools[0]), "the bot's own words reach Composio").toEqual([
    { tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: { owner: "acme", repo: "site" }, account: "milo" },
    { tool_slug: "GITHUB_GET_A_REPOSITORY", arguments: { owner: "acme", repo: "site" } },
  ]);
}, 30_000);

it("saves an assignment only for an account connected for that app", async () => {
  expect((await assign(milo, { github: { account: "ca_nobody" } })).status).toBe(400);
  expect((await assign(milo, { gmail: { account: "ca_milo" } })).status).toBe(400);
  expect((await assign(milo, { github: "ca_milo" })).status).toBe(400);
  const saved = await assign(milo, { github: { account: "ca_milo", exclusive: true } });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  expect(saved.body.bot.connectorAccounts).toEqual({ github: { account: "ca_milo", exclusive: true } });
  expect((await assign(maus, { github: { account: "ca_maus", exclusive: true } })).status).toBe(200);
}, 30_000);

it("runs each bot's calls as its own account, whatever the bot asks for", async () => {
  for (const asked of [undefined, "maus", "ca_maus", "team"]) expect(text(await run(milo, asked)), String(asked)).toBe("relay-ok");
  expect(reached()).toEqual(["ca_milo", "ca_milo", "ca_milo", "ca_milo"]);
  relayed.length = 0;
  for (const asked of [undefined, "milo", "ca_milo"]) expect(text(await run(maus, asked)), String(asked)).toBe("relay-ok");
  expect(reached()).toEqual(["ca_maus", "ca_maus", "ca_maus"]);
}, 30_000);

it("keeps a bot without an assignment off the accounts other bots keep to themselves", async () => {
  for (const asked of ["milo", "ca_milo", "MAUS", "ca_maus"]) expect(text(await run(plain, asked)), asked).toMatch(/has no Github account by that name/);
  expect(relayed, "nothing reached Composio").toEqual([]);
  expect(text(await run(plain))).toBe("relay-ok");
  expect(text(await run(plain, "team"))).toBe("relay-ok");
  expect(reached(), "the one account left").toEqual(["ca_team", "ca_team"]);
}, 30_000);

it("refuses code it cannot check, for every bot, while accounts are assigned", async () => {
  for (const bot of [milo, plain]) {
    expect(text(await relay(bot, "COMPOSIO_REMOTE_WORKBENCH", { code_to_execute: "run_composio_tool('GITHUB_GET_A_REPOSITORY', {})" }))).toMatch(/can't check which account/);
    expect(text(await relay(bot, "GITHUB_GET_A_REPOSITORY", { owner: "acme", repo: "site" }))).toMatch(/COMPOSIO_MULTI_EXECUTE_TOOL/);
  }
  expect(relayed).toEqual([]);
  expect(text(await relay(milo, "COMPOSIO_SEARCH_TOOLS", { queries: [{ use_case: "read a repository" }] }))).toBe("relay-ok");
}, 30_000);

it("refuses the call, and uses no other account, once the assigned account is signed out", async () => {
  accounts[1]!.status = "EXPIRED";
  // Saving any assignment drops the few seconds of remembered accounts.
  expect((await assign(maus, { github: { account: "ca_maus", exclusive: true } })).status).toBe(200);
  expect(text(await run(milo))).toMatch(/no longer connected.*No other account was used/);
  expect(relayed).toEqual([]);
  accounts[1]!.status = "ACTIVE";
}, 30_000);

it("goes back to today's behaviour when the assignments are cleared", async () => {
  expect((await assign(milo, null)).body.bot.connectorAccounts).toBeUndefined();
  expect((await assign(maus, {})).body.bot.connectorAccounts).toBeUndefined();
  expect(text(await run(plain, "milo"))).toBe("relay-ok");
  expect(text(await run(milo))).toBe("relay-ok");
  expect(reached()).toEqual(["milo", undefined]);
}, 30_000);
