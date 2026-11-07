import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { BrowserEvidence } from "../browser-evidence.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { TeachRecorder } from "../teach-recording.ts";
import { createTeachRecordingRoutes, type TeachDesktopKind, type TeachTarget } from "./teach-recording.ts";
import { dispatchRoutes } from "./table.ts";

const LEASE = "lease-0123456789abcdef";
const cleanup: Array<() => Promise<unknown> | void> = [];
afterEach(async () => { for (const step of cleanup.splice(0)) await step(); });

const OWNER = { kind: "loopback", trust: "owner", scopes: ["admin"] } as unknown as RequestAuth;
const MEMBER = { kind: "token", scopes: ["chat"] } as unknown as RequestAuth;

async function serve(options: { enabled?: boolean; auth?: RequestAuth; target?: "none" | "unknown" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-teach-routes-"));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  const evidence = new BrowserEvidence({ root: join(dir, "evidence") });
  const recorder = new TeachRecorder({ evidence, sleep: async () => {}, settleMs: 0 });
  const held = new Set([LEASE]);
  const asked: TeachDesktopKind[] = [];
  const target = (botId: string, _auth: RequestAuth, computer: TeachDesktopKind): TeachTarget | null => {
    asked.push(computer);
    if (options.target === "unknown") throw Object.assign(new Error("no such bot"), { status: 404 });
    if (options.target === "none") return null;
    return {
      key: `${computer}-${botId}`, botId, threadId: "thread-1", desktop: computer === "vps" ? "Ada's cloud desktop" : "Ada's Linux desktop",
      holds: (leaseId) => held.has(leaseId),
      computer: async () => ({
        screenshot: async () => ({ bytes: Buffer.from("png"), type: "png" }),
        inspect: async () => ({ app: "Firefox", focused: { role: "text", label: "Search" }, hit: { role: "push button", label: "Go" } }),
      }),
    };
  };
  const routes = [createTeachRecordingRoutes({ recorder, enabled: () => options.enabled ?? true, target })];
  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth: options.auth ?? OWNER, json, readBody })) json(res, 404, { from: "inline routes" });
  });
  cleanup.push(() => new Promise((done) => server.close(done)));
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/ada/teach`;
  const post = async (action: string, body: unknown, contentType = "application/json") => {
    const response = await fetch(`${base}/${action}`, { method: "POST", headers: { "content-type": contentType }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { post, held, evidence, base, asked };
}

describe("teach on computer routes", () => {
  it("records, stops and returns the steps and the skill request", async () => {
    const { post } = await serve();
    const started = await post("start", { controlLeaseId: LEASE });
    expect(started.status).toBe(200);
    const recordingId = started.body.recordingId as string;
    // As the viewer sends them: the first keystroke of a run is posted on its own, the run's text when it ends.
    const events = await post("events", { controlLeaseId: LEASE, recordingId, events: [{ kind: "click", x: 5, y: 6, button: "left", double: false }, { kind: "typing" }] });
    expect(events).toMatchObject({ status: 200, body: { accepted: 2 } });
    await post("events", { controlLeaseId: LEASE, recordingId, events: [{ kind: "type", text: "invoices" }, { kind: "key", key: "Enter", modifiers: [] }] });
    const stopped = await post("stop", { controlLeaseId: LEASE, recordingId, goal: "Find invoices" });
    expect(stopped.status).toBe(200);
    expect((stopped.body.steps as Array<{ summary: string }>).map((step) => step.summary)).toEqual([
      "Start in Firefox",
      "Click \"Go\" (push button) in Firefox at (5, 6)",
      "Type \"invoices\" into \"Search\" (text)",
      "Press Enter",
    ]);
    expect(stopped.body).toMatchObject({ desktop: "Ada's Linux desktop", threadId: "thread-1" });
    expect(stopped.body.prompt).toContain("Goal: Find invoices");
  });

  it("records on the self-hosted VPS desktop when asked, and keeps each call on that desktop", async () => {
    const { post, asked } = await serve();
    const started = await post("start", { controlLeaseId: LEASE, computer: "vps" });
    expect(started.status).toBe(200);
    const recordingId = started.body.recordingId as string;
    // A call without the same desktop names another recording key: the VPS recording is not found there.
    expect((await post("stop", { controlLeaseId: LEASE, recordingId })).status).toBe(404);
    const stopped = await post("stop", { controlLeaseId: LEASE, recordingId, computer: "vps" });
    expect(stopped).toMatchObject({ status: 200, body: { desktop: "Ada's cloud desktop" } });
    expect(asked).toEqual(["vps", "vm", "vps"]);
    expect((await post("start", { controlLeaseId: LEASE, computer: "box" })).status).toBe(400);
  });

  it("is for the owner only, and only while skill authoring is on", async () => {
    expect((await (await serve({ auth: MEMBER })).post("start", { controlLeaseId: LEASE })).status).toBe(403);
    expect((await (await serve({ enabled: false })).post("start", { controlLeaseId: LEASE })).status).toBe(403);
  });

  it("refuses non-JSON bodies, bad leases, bad recordings and bad events", async () => {
    const { post, base } = await serve();
    expect((await post("start", { controlLeaseId: LEASE }, "text/plain")).status).toBe(415);
    expect((await post("start", { controlLeaseId: "short" })).status).toBe(400);
    expect((await post("events", { controlLeaseId: LEASE, recordingId: "../../etc", events: [] })).status).toBe(400);
    const { body } = await post("start", { controlLeaseId: LEASE });
    expect((await post("events", { controlLeaseId: LEASE, recordingId: body.recordingId, events: [{ kind: "exec" }] })).status).toBe(400);
    expect((await fetch(`${base}/start`)).status).toBe(405);
  });

  it("needs control of a Local VM desktop to start", async () => {
    const { post, held } = await serve();
    held.clear();
    expect((await post("start", { controlLeaseId: LEASE })).status).toBe(409);
    expect((await (await serve({ target: "none" })).post("start", { controlLeaseId: LEASE })).status).toBe(409);
    expect((await (await serve({ target: "unknown" })).post("start", { controlLeaseId: LEASE })).status).toBe(404);
  });

  it("stops taking steps after a hand-back, and discard deletes what was kept", async () => {
    const { post, held, evidence } = await serve();
    const { body } = await post("start", { controlLeaseId: LEASE });
    const recordingId = body.recordingId as string;
    held.clear();
    expect((await post("events", { controlLeaseId: LEASE, recordingId, events: [{ kind: "key", key: "a", modifiers: [] }] })).status).toBe(409);
    expect((await post("stop", { controlLeaseId: LEASE, recordingId })).status).toBe(200);
    expect(evidence.list("thread-1", { generation: recordingId }).steps).toHaveLength(1);
    expect((await post("discard", { controlLeaseId: LEASE, recordingId })).body).toEqual({ discarded: true });
    expect(evidence.list("thread-1", { generation: recordingId }).steps).toHaveLength(0);
  });
});
