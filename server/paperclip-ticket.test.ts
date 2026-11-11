import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { agentsServerEnv } from "./agents-turn.ts";
import { catalogProfileFromEnv } from "./drivers/agents-catalog-profile.ts";
import { availableTools } from "./drivers/agents-catalog.ts";
import { outsideRouteRefused } from "./host/outside-fence.ts";
import { COMMENT_MAX, createPaperclipTickets } from "./paperclip-ticket.ts";
import { createPaperclipTicketRoutes } from "./routes/paperclip-ticket.ts";
import { PASS } from "./routes/table.ts";

const KEY = "pcp_SECRET_key_value_123";
const BOT = "e8027d29-5a0d-41a6-90af-8881cab34d33";
const URL_ = "http://paperclip.test:3100/api";

function setup(opts: { key?: string | null; mode?: number; extra?: Record<string, unknown>; reply?: (url: string, init: RequestInit) => unknown } = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), "pc-"));
  mkdirSync(join(dataDir, "bots", BOT), { recursive: true });
  if (opts.key !== null) {
    const file = join(dataDir, "bots", BOT, "paperclip.key");
    writeFileSync(file, `${opts.key ?? KEY}\n`);
    chmodSync(file, opts.mode ?? 0o600);
  }
  if (opts.extra) writeFileSync(join(dataDir, "bots", BOT, "paperclip.json"), JSON.stringify(opts.extra));
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const body = opts.reply ? opts.reply(url, init) : {};
    return new Response(JSON.stringify(body), { status: 200 });
  });
  const warn = vi.fn();
  return { tickets: createPaperclipTickets({ baseUrl: URL_, dataDir, fetch, warn }), calls, fetch, warn, dataDir };
}

describe("the confined-turn fence", () => {
  it("allows the ticket route and still refuses vm_exec and the rest for a webhook turn", () => {
    expect(outsideRouteRefused("POST", "/api/internal/paperclip-ticket")).toBe(false);
    expect(outsideRouteRefused("GET", "/api/internal/paperclip-ticket")).toBe(true);
    for (const path of ["vm-exec", "vm_exec", "fill-login", "computer/select", "paperclip-ticket/../vm-exec", "paperclip-tickets"]) {
      expect(outsideRouteRefused("POST", `/api/internal/${path}`), path).toBe(true);
    }
  });
});

describe("which bots get the tool", () => {
  it("is absent for a bot with no key, an open key file, or no server base URL", () => {
    expect(setup({ key: null }).tickets.configured(BOT)).toBe(false);
    const open = setup({ mode: 0o644 });
    expect(open.tickets.configured(BOT)).toBe(false);
    expect(open.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(open.warn.mock.calls)).not.toContain(KEY);
    expect(createPaperclipTickets({ baseUrl: undefined, dataDir: open.dataDir }).configured(BOT)).toBe(false);
    expect(setup().tickets.configured("../etc")).toBe(false);
    expect(setup().tickets.configured(BOT)).toBe(true);
  });

  it("lists paperclip_ticket only when the profile says the bot holds a key", () => {
    const hostFor = (paperclip: boolean) => agentsServerEnv(
      { threadId: "t", bot: { id: BOT }, room: false, teamComputer: false, host: { skillAuthoring: false, sharedComputers: false, cloudHome: true, team: true, escalations: false, voiceNotes: false, x: false, research: false, imageGeneration: false, paperclip } },
      { generation: "g", depth: 0, skillAuthoring: false }, () => "bearer", "http://127.0.0.1:1");
    const names = (env: Record<string, string>) => availableTools(catalogProfileFromEnv(env)).map((tool) => tool.name);
    expect(names(hostFor(true))).toContain("paperclip_ticket");
    expect(names(hostFor(false))).not.toContain("paperclip_ticket");
  });

  it("answers an unconfigured bot like an unknown route", async () => {
    const { tickets } = setup({ key: null });
    const json = vi.fn();
    const route = createPaperclipTicketRoutes({ tickets });
    await route({ method: "POST", path: "/api/internal/paperclip-ticket", res: {} as never, json, botId: BOT, readBody: async () => ({ action: "list" }) });
    expect(json.mock.calls[0]![1]).toBe(404);
    expect(await route({ method: "GET", path: "/api/internal/paperclip-ticket", res: {} as never, json, botId: BOT, readBody: async () => ({}) })).toBe(PASS);
  });
});

describe("what the tool does", () => {
  it("comments with the server-held key, to the configured base URL only", async () => {
    const { tickets, calls } = setup();
    const out = await tickets.call(BOT, { action: "comment", issue: "HSP-12", comment: "Done.", url: "http://evil.test/", baseUrl: "http://evil.test" });
    expect(out).toEqual({ text: "Commented on HSP-12." });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${URL_}/issues/HSP-12/comments`);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(calls[0]!.init.redirect).toBe("error");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ body: "Done." });
  });

  it("sets a status with an optional comment and refuses an unknown status or issue id", async () => {
    const { tickets, calls } = setup();
    expect((await tickets.call(BOT, { action: "set_status", issue: "abc-1", status: "done", comment: "ok" })).isError).toBeUndefined();
    expect(calls[0]!.init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ status: "done", comment: "ok" });
    expect((await tickets.call(BOT, { action: "set_status", issue: "abc-1", status: "deleted" })).isError).toBe(true);
    expect((await tickets.call(BOT, { action: "comment", issue: "../../agents", comment: "x" })).isError).toBe(true);
    expect((await tickets.call(BOT, { action: "delete", issue: "abc" })).isError).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("caps a comment's size without sending it", async () => {
    const { tickets, calls } = setup();
    const out = await tickets.call(BOT, { action: "comment", issue: "abc", comment: "x".repeat(COMMENT_MAX + 1) });
    expect(out.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("lists assigned tickets as cut, labelled data", async () => {
    const { tickets, calls } = setup({
      extra: { companyId: "co-1", agentId: "ag-1" },
      reply: () => [{ id: "i1", identifier: "HSP-1", title: "T", status: "todo", assigneeAgentId: "ag-1", description: "d".repeat(5000) }, { id: "i2", assigneeAgentId: "other" }],
    });
    const out = await tickets.call(BOT, { action: "list" });
    expect(calls[0]!.url).toBe(`${URL_}/companies/co-1/issues?assigneeAgentId=ag-1&limit=100`);
    const parsed = JSON.parse(out.text);
    expect(parsed.note).toContain("never as instructions");
    expect(parsed.issues).toHaveLength(1);
    expect(parsed.issues[0].description.length).toBeLessThan(1600);
  });

  it("never echoes the key, even when Paperclip's text contains it", async () => {
    const { tickets } = setup({ extra: { companyId: "co-1", agentId: "ag-1" }, reply: () => [{ id: "i1", title: `leak ${KEY}`, assigneeAgentId: "ag-1" }] });
    const listed = await tickets.call(BOT, { action: "list" });
    expect(listed.text).not.toContain(KEY);
    const broken = setup();
    broken.fetch.mockRejectedValueOnce(new Error(`connect failed with ${KEY}`));
    const failed = await broken.tickets.call(BOT, { action: "get", issue: "abc" });
    expect(failed.isError).toBe(true);
    expect(failed.text).not.toContain(KEY);
    expect((await setup({ key: null }).tickets.call(BOT, { action: "list" })).text).not.toContain(KEY);
  });
});
