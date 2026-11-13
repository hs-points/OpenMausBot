import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildAdminResponse, buildPeopleResponse, peopleForBot, readBridgeStatus, type SlackBotRecord, type TeamMember } from "./hsp-slack.ts";
import { createHspSlackRoutes } from "./routes/hsp-slack.ts";
import type { RequestAuth } from "./request-auth.ts";

const NOW = Date.parse("2026-11-07T15:02:40.000Z");
const status = (over: Record<string, unknown> = {}) => ({
  version: 1, startedAt: "2026-11-07T13:27:00.000Z", updatedAt: "2026-11-07T15:02:30.000Z",
  bots: [{ key: "milo", name: "Milo", ombBotId: "b1", slackAppId: "A1", slackTeamId: "T1", connected: true,
    connectedAt: "2026-11-07T13:28:00.000Z", lastMessageAt: "2026-11-07T15:00:00.000Z",
    channels: [{ id: "C1", name: "ops" }], today: { handled: 7, refused: 1 },
    errors: [{ at: "2026-11-07T14:00:00.000Z", code: "upload_too_large", text: "A file was over 20 MB and was not sent." }] }],
  ...over,
});

const members: TeamMember[] = [
  { email: "Owner@x.com", role: "owner", name: "Olive" },
  { email: "admin@x.com", role: "admin" },
  { email: "chatty@x.com", role: "member", name: "Chet" },
  { email: "editor@x.com", role: "member" },
  { email: "viewer@x.com", role: "member" },
  { email: "nobody@x.com", role: "member" },
];
const bot = (over: Record<string, unknown> = {}): SlackBotRecord => ({
  id: "b1", name: "Milo", visibility: "everyone",
  access: { everyone: "none", people: { "chatty@x.com": "chat", "editor@x.com": "edit", "viewer@x.com": "view" } },
  ...over,
}) as SlackBotRecord;

describe("bridge status file", () => {
  let dir: string, file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-slack-")); file = join(dir, "status.json"); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const write = (value: unknown) => writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));

  it("reads a fresh file as reporting", () => {
    write(status());
    const read = readBridgeStatus(file, NOW);
    expect(read?.reporting).toBe(true);
    expect(read?.bots[0]).toMatchObject({ ombBotId: "b1", connected: true, today: { handled: 7, refused: 1 } });
  });
  it("marks a file older than 120 s as not reporting", () => {
    write(status({ updatedAt: "2026-11-07T15:00:00.000Z" }));
    expect(readBridgeStatus(file, NOW)?.reporting).toBe(false);
  });
  it("returns null for missing, garbled or wrong-version files", () => {
    expect(readBridgeStatus(join(dir, "none"), NOW)).toBeNull();
    write("{not json");
    expect(readBridgeStatus(file, NOW)).toBeNull();
    write(status({ version: 2 }));
    expect(readBridgeStatus(file, NOW)).toBeNull();
    write(status({ updatedAt: "yesterday" }));
    expect(readBridgeStatus(file, NOW)).toBeNull();
  });
  it("caps arrays and strings and drops unvalidated fields", () => {
    const base = status();
    const channels = Array.from({ length: 300 }, (_, i) => ({ id: `C${i}`, name: "n".repeat(500) }));
    const errors = Array.from({ length: 30 }, () => ({ at: "2026-11-07T14:00:00.000Z", code: "x", text: "y" }));
    write(status({ bots: [{ ...base.bots[0], channels, errors, secret: "token", today: { handled: -4, refused: "x" } }, "junk", { name: "no id" }] }));
    const read = readBridgeStatus(file, NOW)!;
    expect(read.bots).toHaveLength(1);
    expect(read.bots[0]!.channels).toHaveLength(200);
    expect(read.bots[0]!.channels[0]!.name).toHaveLength(200);
    expect(read.bots[0]!.errors).toHaveLength(10);
    expect(read.bots[0]!.today).toEqual({ handled: 0, refused: 0 });
    expect(JSON.stringify(read)).not.toContain("token");
  });
});

describe("people per bot", () => {
  it("lists owners, admins and members with chat or edit, and not view or none", () => {
    const people = peopleForBot(bot(), members);
    expect(people.map((p) => [p.email, p.why])).toEqual([
      ["owner@x.com", "owner"], ["admin@x.com", "admin"], ["chatty@x.com", "chat"], ["editor@x.com", "edit"],
    ]);
    expect(people[0]!.name).toBe("Olive");
    expect(people[1]!.name).toBe("admin");
  });
  it("lists an everyone-can-chat bot's every member", () => {
    const open = bot({ access: { everyone: "chat", people: {} } });
    expect(peopleForBot(open, members).map((p) => p.email)).toContain("nobody@x.com");
  });
  it("leaves out hidden bots and bots a member cannot see", () => {
    expect(peopleForBot(bot({ hidden: true }), members)).toEqual([]);
    expect(buildPeopleResponse([bot({ hidden: true })], members)).toEqual({ bots: {} });
    const adminsOnly = bot({ visibility: "admins", access: { everyone: "none", people: {} } });
    expect(peopleForBot(adminsOnly, members).map((p) => p.email)).toEqual(["owner@x.com", "admin@x.com"]);
  });
  it("answers A with lower-case emails and names only", () => {
    expect(buildPeopleResponse([bot()], members).bots["b1"]![0]).toEqual({ email: "owner@x.com", name: "Olive" });
  });
});

describe("admin response and routes", () => {
  let dir: string, file: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-slack-")); file = join(dir, "status.json"); });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("is unconfigured without the env and has a null bridge for a missing file", () => {
    expect(buildAdminResponse(undefined, () => bot(), members)).toEqual({ configured: false });
    expect(buildAdminResponse(join(dir, "none"), () => bot(), members)).toEqual({ configured: true, bridge: null, bots: [] });
  });
  it("keeps the file's order, skips bots missing from the store and takes names from the store", () => {
    writeFileSync(file, JSON.stringify(status({ bots: [
      { ...status().bots[0], ombBotId: "gone" }, { ...status().bots[0], ombBotId: "b1", name: "File Name" },
    ] })));
    const out = buildAdminResponse(file, (id) => (id === "b1" ? bot() : null), members, NOW) as { bridge: unknown; bots: Array<{ botId: string; name: string; people: unknown[] }> };
    expect(out.bridge).toMatchObject({ reporting: true });
    expect(out.bots).toHaveLength(1);
    expect(out.bots[0]).toMatchObject({ botId: "b1", name: "Milo" });
    expect(out.bots[0]!.people).toHaveLength(4);
  });

  function call(path: string, auth: RequestAuth, team = true) {
    const answers: Array<[number, unknown]> = [];
    const headers: Record<string, string> = {};
    const route = createHspSlackRoutes({ team, bots: () => [bot()], bot: () => bot(), members: () => members, env: { OMB_SLACK_BRIDGE_STATUS_FILE: file } });
    const done = route({
      req: {} as never, res: { setHeader: (k: string, v: string) => { headers[k] = v; } } as never, url: new URL(`http://x${path}`), path, method: "GET", auth,
      json: ((_r: unknown, status: number, value: unknown) => { answers.push([status, value]); }) as never, readBody: (async () => ({})) as never,
    });
    return { done, answers, headers };
  }
  const session = (teamRole: "owner" | "admin" | "member"): RequestAuth => ({
    kind: "session", via: "cookie", scopes: teamRole === "member" ? ["client"] : ["admin", "client"], session: { teamRole } as never,
  });

  it("serves people to session-less loopback only, on a team only, uncached", async () => {
    const ok = call("/api/hsp/slack/people", { kind: "loopback", scopes: ["client"], trust: "service" });
    await ok.done;
    expect(ok.answers[0]![0]).toBe(200);
    expect(ok.headers["cache-control"]).toBe("no-store");
    const viaSession = call("/api/hsp/slack/people", session("admin"));
    await viaSession.done;
    expect(viaSession.answers[0]![0]).toBe(403);
    const notTeam = call("/api/hsp/slack/people", { kind: "loopback", scopes: ["client"], trust: "service" }, false);
    await notTeam.done;
    expect(notTeam.answers[0]![0]).toBe(404);
  });
  it("serves the admin page to team admins and owner-trust loopback, not members or service loopback", async () => {
    writeFileSync(file, JSON.stringify(status()));
    for (const [auth, code] of [
      [session("owner"), 200], [session("admin"), 200], [{ kind: "loopback", scopes: ["admin", "client"] }, 200],
      [session("member"), 403], [{ kind: "loopback", scopes: ["client"], trust: "service" }, 403],
    ] as Array<[RequestAuth, number]>) {
      const run = call("/api/hsp/slack", auth);
      await run.done;
      expect(run.answers[0]![0]).toBe(code);
      expect(run.headers["cache-control"]).toBe("no-store");
    }
    const notTeam = call("/api/hsp/slack", session("admin"), false);
    await notTeam.done;
    expect(notTeam.answers[0]![0]).toBe(404);
  });
});
