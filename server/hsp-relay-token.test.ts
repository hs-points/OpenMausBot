import type { IncomingMessage } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isRelayRoute, loadRelayToken, RELAY_TOKEN_REFUSAL, relayTokenRefusal, setRelayTokenForTests } from "./hsp-relay-token.ts";
import { resolveRequestAuth } from "./request-auth.ts";
import { SessionRegistry } from "./sessions.ts";

const TOKEN = "r".repeat(43);
const SEND = "/api/bots/milo/messages/guarded";
const FOLLOW = "/api/bots/milo/requests/abcdefghijklmnop";
const STOP = "/api/bots/milo/requests/abcdefghijklmnop/interrupt";
const PEOPLE = "/api/hsp/slack/people";

function request(headers: Record<string, string>, method: string): IncomingMessage {
  // SAFETY: the resolver reads only headers and method
  return { headers, method } as unknown as IncomingMessage;
}

describe("hsp relay token", () => {
  let dir: string;
  let sessions: SessionRegistry;
  const check = (method: string, path: string, headers: Record<string, string> = {}) =>
    resolveRequestAuth(request({ host: "127.0.0.1:8870", ...headers }, method), {
      sessions, cookieName: "omb_session_8870", streamPath: "/api/events", url: new URL(path, "http://x"), loopbackTrust: "service",
    });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "omb-relay-"));
    sessions = new SessionRegistry({ file: join(dir, "sessions.json") });
  });
  afterEach(() => { setRelayTokenForTests(null); rmSync(dir, { recursive: true, force: true }); });

  it("matches only the send, follow and stop routes", () => {
    expect(isRelayRoute("POST", SEND)).toBe(true);
    expect(isRelayRoute("get", FOLLOW)).toBe(true);
    expect(isRelayRoute("POST", STOP)).toBe(true);
    expect(isRelayRoute("GET", PEOPLE)).toBe(true);
    expect(isRelayRoute("POST", PEOPLE)).toBe(false);
    expect(isRelayRoute("GET", "/api/hsp/slack")).toBe(false);
    expect(isRelayRoute("GET", SEND)).toBe(false);
    expect(isRelayRoute("POST", "/api/bots/milo/tasks")).toBe(false);
    expect(isRelayRoute("GET", "/api/health")).toBe(false);
  });

  it("changes nothing when OMB_RELAY_TOKEN_FILE is unset", () => {
    setRelayTokenForTests(loadRelayToken({}));
    expect(check("POST", SEND).auth).toEqual({ kind: "loopback", scopes: ["client"], trust: "service" });
    expect(relayTokenRefusal("POST", SEND, undefined)).toBeNull();
  });

  it("requires the exact token on relay routes and leaves other service routes alone", () => {
    const file = join(dir, "relay.token");
    writeFileSync(file, `${TOKEN}\n`);
    setRelayTokenForTests(loadRelayToken({ OMB_RELAY_TOKEN_FILE: file }));
    for (const [method, path] of [["POST", SEND], ["GET", FOLLOW], ["POST", STOP], ["GET", PEOPLE]] as const) {
      expect(check(method, path).auth, `${method} ${path} no token`).toBeNull();
      expect(check(method, path).error).toBe(RELAY_TOKEN_REFUSAL);
      expect(check(method, path, { "x-omb-relay-token": "x".repeat(43) }).auth, "wrong token").toBeNull();
      expect(check(method, path, { "x-omb-relay-token": TOKEN.slice(1) }).auth, "short token").toBeNull();
      expect(check(method, path, { "x-omb-relay-token": TOKEN }).auth).toEqual({ kind: "loopback", scopes: ["client"], trust: "service" });
    }
    expect(check("GET", "/api/hsp/slack").auth, "admin route is not service-reachable").toBeNull();
    expect(check("GET", "/api/health").auth?.kind).toBe("loopback");
    expect(check("POST", "/api/bots/milo/tasks").auth?.kind).toBe("loopback");
  });

  it("fails closed when the file is missing or too short", () => {
    expect(loadRelayToken({ OMB_RELAY_TOKEN_FILE: join(dir, "nope") })).toMatchObject({ token: null, required: true });
    const short = join(dir, "short");
    writeFileSync(short, "abc");
    setRelayTokenForTests(loadRelayToken({ OMB_RELAY_TOKEN_FILE: short }));
    expect(check("POST", SEND, { "x-omb-relay-token": "abc" }).auth).toBeNull();
  });
});
