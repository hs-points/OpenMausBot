import { describe, expect, it } from "vitest";

import type { RequestAuth } from "../request-auth.ts";
import { createBotComputerAccessRoutes } from "./bot-computer-access.ts";
import { PASS, type RouteContext } from "./table.ts";

const member = { kind: "session", scopes: ["chat"] } as unknown as RequestAuth;
const admin = { kind: "session", scopes: ["admin"] } as unknown as RequestAuth;

function call(path: string, auth: RequestAuth, editable: string[] = []) {
  const answers: Array<{ status: number; body: unknown }> = [];
  const asked: string[] = [];
  const handler = createBotComputerAccessRoutes({
    mayEdit: (_auth, botId) => { asked.push(botId); return editable.includes(botId); },
    botName: (botId) => (botId === "milo" ? "Milo" : undefined),
  });
  const json = ((_res: unknown, status: number, body: unknown) => { answers.push({ status, body }); }) as RouteContext["json"];
  const ctx = { res: {}, path, auth, json, method: "POST" } as unknown as RouteContext;
  return handler(ctx).then((result) => ({ result, answers, asked }));
}

describe("bot computer access gate", () => {
  it.each(["/api/bots/milo/computer", "/api/bots/milo/computer/control", "/api/bots/milo/computer/join",
    "/api/bots/milo/computer/screenshot", "/api/bots/milo/computer/viewer-close"])("refuses %s to a member who cannot edit the bot", async (path) => {
    const { result, answers, asked } = await call(path, member);
    expect(result).not.toBe(PASS);
    expect(asked).toEqual(["milo"]);
    expect(answers).toEqual([{ status: 403, body: { error: "Only people who can edit Milo can change this." } }]);
  });

  it("lets a member who can edit the bot through to the real handler", async () => {
    const { result, answers } = await call("/api/bots/milo/computer/control", member, ["milo"]);
    expect(result).toBe(PASS);
    expect(answers).toEqual([]);
  });

  it("lets an admin through without asking about edit rights", async () => {
    const { result, answers, asked } = await call("/api/bots/milo/computer/join", admin);
    expect(result).toBe(PASS);
    expect(answers).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("checks edit rights on the bot the path names, not another the member can edit", async () => {
    const { result, answers } = await call("/api/bots/ada/computer/screenshot", member, ["milo"]);
    expect(result).not.toBe(PASS);
    expect(answers).toEqual([{ status: 403, body: { error: "Only people who can edit this bot can change this." } }]);
  });

  it.each(["/api/bots/milo/computer/provision", "/api/bots/milo/computer/exec", "/api/bots/milo/computer/remove",
    "/api/bots/milo/computerx", "/api/bots/milo", "/api/bots/milo/computer/control/extra"])("leaves %s to its own gate", async (path) => {
    const { result, answers, asked } = await call(path, member);
    expect(result).toBe(PASS);
    expect(answers).toEqual([]);
    expect(asked).toEqual([]);
  });
});
