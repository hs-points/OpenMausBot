// HSP patch: a relay token for the Slack bridge. Session-less loopback is every process on this machine, not only the
// bridge (docs/self-hosting.md, "What `service` does not close yet"), so any local program could post into a bot's thread
// through the guarded route as anyone it names in onBehalfOf. With OMB_RELAY_TOKEN_FILE set, the routes the bridge uses to
// send and follow a request answer a session-less loopback caller only when it presents that token. Unset: unchanged.
import { readFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";

export const RELAY_TOKEN_HEADER = "x-omb-relay-token";

/** The guarded send, following one request, stopping it, and the bridge's read of who may use each bot. */
const RELAY_ROUTES: ReadonlyArray<{ method: string; path: RegExp }> = [
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/messages\/guarded$/ },
  { method: "GET", path: /^\/api\/bots\/[\w-]+\/requests\/[\w-]+$/ },
  { method: "POST", path: /^\/api\/bots\/[\w-]+\/requests\/[\w-]+\/interrupt$/ },
  { method: "GET", path: /^\/api\/hsp\/slack\/people$/ },
];

export const RELAY_TOKEN_REFUSAL = "forbidden: this local request needs the relay token";

export function isRelayRoute(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return RELAY_ROUTES.some((route) => route.method === upper && route.path.test(path));
}

/** Reads the token file. A set but unreadable or short file fails closed: the routes then refuse every loopback caller. */
export function loadRelayToken(env: NodeJS.ProcessEnv = process.env): { token: string | null; required: boolean; problem?: string } {
  const file = env.OMB_RELAY_TOKEN_FILE?.trim();
  if (!file) return { token: null, required: false };
  try {
    const token = readFileSync(file, "utf8").trim();
    if (token.length < 32) return { token: null, required: true, problem: "relay token file holds fewer than 32 characters" };
    return { token, required: true };
  } catch {
    return { token: null, required: true, problem: "relay token file could not be read" };
  }
}

let loaded: ReturnType<typeof loadRelayToken> | null = null;
/** Tests replace the loaded state. */
export function setRelayTokenForTests(state: ReturnType<typeof loadRelayToken> | null): void { loaded = state; }
function current(): ReturnType<typeof loadRelayToken> {
  loaded ??= loadRelayToken();
  return loaded;
}

/** The refusal for a session-less loopback request to a relay route without the right token; null otherwise. */
export function relayTokenRefusal(method: string, path: string, presented: string | undefined): string | null {
  const state = current();
  if (!state.required || !isRelayRoute(method, path)) return null;
  if (!state.token || !presented) return RELAY_TOKEN_REFUSAL;
  const a = Buffer.from(presented), b = Buffer.from(state.token);
  return a.length === b.length && timingSafeEqual(a, b) ? null : RELAY_TOKEN_REFUSAL;
}

/** One start-up line for the server log; never the token. */
export function relayTokenStatus(): string | null {
  const state = current();
  if (!state.required) return null;
  return state.token ? "relay token: on (guarded routes need it from loopback)" : `relay token: REFUSING guarded routes (${state.problem})`;
}
