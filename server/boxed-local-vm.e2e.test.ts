import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { z } from "zod";
import { removeTempDir, waitForExit } from "./testing/cleanup.ts";
import { freePortBlock } from "./testing/ports.ts";

const botSchema = z.object({ id: z.string(), chiefOfStaff: z.boolean().optional() });
const rpcSchema = z.object({ result: z.object({
  content: z.array(z.object({ type: z.string(), mimeType: z.string().optional() }).passthrough()).optional(),
  isError: z.boolean().optional(),
}).passthrough().optional() }).passthrough();

const root = fileURLToPath(new URL("..", import.meta.url));
let child: ChildProcess;
let home = "";
let base = "";
let stderr = "";
let callsFile = "";
const dumps: string[] = [];

async function until<T>(read: () => T | Promise<T>, accepts: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    const value = await read();
    if (accepts(value)) return value;
    if (child?.exitCode !== null || Date.now() > deadline) throw new Error(`Fixture did not become ready: ${stderr.slice(-3000)}`);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(base + path, { method, headers: { "content-type": "application/json", origin: base },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  expect(response.ok, `${method} ${path}: ${JSON.stringify(payload)}`).toBe(true);
  return payload;
}
function dump(index: number) {
  if (!existsSync(dumps[index]!)) return null;
  try { return JSON.parse(readFileSync(dumps[index]!, "utf8")); } catch { return null; }
}
function computerToken(receipt: { env: Record<string, string> }) { return receipt.env.OMB_MCP_TOKEN_COMPUTER; }
async function rpc(token: string, body: unknown, suffix = "") {
  const response = await fetch(base + "/api/internal/computer/mcp" + suffix, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(body),
  });
  return { status: response.status, body: rpcSchema.parse(await response.json()) };
}
const calls = () => existsSync(callsFile)
  ? readFileSync(callsFile, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line)) : [];

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), "omb-box-vm-"));
  const data = join(home, "data"), ui = join(home, "static"), state = join(home, "vm.json");
  mkdirSync(data); mkdirSync(join(ui, "assets"), { recursive: true });
  writeFileSync(join(ui, "index.html"), "<title>Isolated boxed VM routing</title>");
  writeFileSync(state, "{}");
  callsFile = join(home, "vm-calls.jsonl");
  const instances = Object.fromEntries([0, 1].map(index => {
    const path = join(home, `codex-${index}.json`); dumps.push(path);
    return [`codex${index}`, { driver: "codex", config: { cli: join(root, "server/testing/fake-codex-app-server.ts") }, environment: {
      FAKE_CODEX_MODE: "question", FAKE_CODEX_ASK_HOLD: "1", FAKE_CODEX_MCP_START: "1", FAKE_CODEX_DUMP: path, FAKE_CODEX_DUMP_TURNS_ONLY: "1",
    } }];
  }));
  writeFileSync(join(data, "config.json"), JSON.stringify({ instances, localVm: { mode: "per-bot", maxInstances: 2 } }));
  const port = await freePortBlock([0, 1]); base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["--import", pathToFileURL(join(root, "server/testing/boxed-local-vm-hooks.mjs")).href,
    join(root, "server/index.ts")], { cwd: root, env: {
    PATH: dirname(process.execPath), HOME: home, USERPROFILE: home, OMB_DATA_DIR: data,
    APPDATA: join(home, "appdata"), LOCALAPPDATA: join(home, "localappdata"),
    TEMP: home, TMP: home, TMPDIR: home, OMB_PORT: String(port), OMB_WEBHOOK_PORT: String(port + 1),
    OMB_COMPUTER_CALL_WAIT_MS: "500", OMB_STATIC_DIR: ui, OMB_TEST_VM_STATE: state, OMB_TEST_VM_CALLS: callsFile, OMB_TEST_HOST_VM_RUNTIME: "1",
  }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout!.on("data", () => {}); child.stderr!.on("data", chunk => { stderr += chunk; });
  await until(async () => { try { return (await fetch(base + "/api/health")).ok; } catch { return false; } }, Boolean);
  const chief = z.object({ bots: z.array(botSchema) }).parse(await api("GET", "/api/bots?messages=0")).bots.find(bot => bot.chiefOfStaff);
  if (chief) await api("PATCH", `/api/bots/${chief.id}`, { chiefOfStaff: false });
}, 30_000);
afterAll(async () => {
  if (child) await waitForExit(child, { signal: "SIGTERM" });
  if (home) await removeTempDir(home);
});

it("lists screenshot in boxed Codex turns and keeps each capability on its own VM", async () => {
  const bots = [];
  for (const index of [0, 1]) {
    const { bot } = z.object({ bot: botSchema }).parse(await api("POST", "/api/bots", { name: `Fixture VM ${index}`, modelSelection: { instanceId: `codex${index}`, model: "gpt-fake-default" } }));
    await api("PATCH", `/api/bots/${bot.id}`, { computer: "vm" }); bots.push(bot);
    await api("POST", `/api/bots/${bot.id}/messages`, { text: "Take a fixture screenshot" });
    const receipt = await until(() => dump(index), value => value?.mcpStartup !== undefined);
    expect(receipt.mcpStartup.computer).toEqual({ status: "ready", tools: ["screenshot", "click"] });
    const mount = receipt.argv.filter((arg: string) => arg.startsWith("mcp_servers.computer."));
    expect(mount.join(" ")).toContain("harness-mcp-proxy");
    expect(mount.join(" ")).not.toMatch(/container-mcp|docker\.sock|DOCKER_HOST/);
  }
  const a = computerToken(dump(0)), b = computerToken(dump(1));
  expect(a).toBeTruthy(); expect(b).toBeTruthy(); expect(a).not.toBe(b);
  const screenshot = { method: "tools/call", params: { name: "screenshot", arguments: {} } };
  const first = await rpc(a!, screenshot);
  expect(first.status, JSON.stringify(first.body)).toBe(200); expect(first.body.result?.content).toEqual(expect.arrayContaining([expect.objectContaining({ type: "image", mimeType: "image/png" })]));
  const second = await rpc(b!, screenshot); expect(second.status).toBe(200);
  const reached = calls(); expect(reached).toHaveLength(2); expect(reached[0].target).not.toBe(reached[1].target);
  await api("POST", `/api/bots/${bots[0]!.id}/computer/control`, { action: "take" });
  const held = await rpc(a!, screenshot); expect(held.status).toBe(200); expect(held.body.result?.isError).toBe(true);
  expect(calls()).toHaveLength(2);
  await api("POST", `/api/bots/${bots[0]!.id}/computer/control`, { action: "release" });
  expect((await rpc(a!, screenshot, `?botId=${bots[1]!.id}`)).status).toBe(403);
  expect((await rpc(a!, { ...screenshot, botId: bots[1]!.id })).status).toBe(403);
  const spoofedTarget = await rpc(a!, { ...screenshot, target: { key: reached[1].target }, runtime: "docker" });
  expect(spoofedTarget.status).toBe(200); expect(calls().at(-1).target).toBe(reached[0].target);
  await api("POST", `/api/bots/${bots[0]!.id}/interrupt`, {});
  await until(() => rpc(a!, { method: "tools/list" }), value => value.status === 401);
  expect((await rpc(b!, screenshot)).status).toBe(200);
  expect(calls().at(-1).target).toBe(reached[1].target);
}, 45_000);
