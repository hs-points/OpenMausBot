// Owner or admin only: a member never records on, or writes skill steps for, a bot's computer.
import { ownerOrAdmin, type RequestAuth } from "../request-auth.ts";
import { parseTeachEvents, TEACH_LIMITS, TeachError, type TeachComputer, type TeachRecorder } from "../teach-recording.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface TeachTarget {
  key: string;
  botId: string;
  threadId: string;
  desktop: string;
  holds: (leaseId: string) => boolean;
  computer: () => Promise<TeachComputer>;
}

export interface TeachRouteDeps {
  recorder: Pick<TeachRecorder, "start" | "record" | "stop" | "discard" | "active">;
  enabled(): boolean;
  /** Null when the bot has no Local VM desktop to record on; throws a 404 for an unknown bot. */
  target(botId: string, auth: RequestAuth): TeachTarget | null;
}

const LEASE = /^[A-Za-z0-9_-]{16,120}$/u;
const RECORDING = /^teach-[0-9a-f-]{36}$/u;

export function createTeachRecordingRoutes(deps: TeachRouteDeps): RouteHandler {
  return async ({ req, res, path, method, auth, json, readBody }) => {
    const m = /^\/api\/bots\/([\w-]+)\/teach\/(start|events|stop|discard)$/u.exec(path);
    if (!m) return PASS;
    if (method !== "POST") return json(res, 405, { error: "method not allowed" });
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "only the owner can teach a bot on its computer" });
    if (!deps.enabled()) return json(res, 403, { error: "skill authoring is off" });
    if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
      return json(res, 415, { error: "content-type must be application/json" });
    }
    const body = await readBody(req) as Record<string, unknown>;
    const leaseId = typeof body.controlLeaseId === "string" && LEASE.test(body.controlLeaseId) ? body.controlLeaseId : null;
    if (!leaseId) return json(res, 400, { error: "controlLeaseId is invalid" });
    let target: TeachTarget | null;
    try { target = deps.target(m[1]!, auth); }
    catch (error) { return json(res, (error as { status?: number }).status ?? 404, { error: (error as Error).message }); }
    if (!target) return json(res, 409, { error: "this bot has no Local VM desktop to record on" });
    const recordingId = typeof body.recordingId === "string" && RECORDING.test(body.recordingId) ? body.recordingId : null;
    try {
      if (m[2] === "start") {
        if (!target.holds(leaseId)) return json(res, 409, { error: "Take control of this computer before recording." });
        const computer = await target.computer();
        const holds = () => target.holds(leaseId);
        return json(res, 200, await deps.recorder.start({ key: target.key, botId: target.botId, threadId: target.threadId, leaseId, desktop: target.desktop, computer, holds }));
      }
      if (!recordingId) return json(res, 400, { error: "recordingId is invalid" });
      if (m[2] === "events") {
        const events = parseTeachEvents(body.events);
        if (!events) return json(res, 400, { error: `events must be at most ${TEACH_LIMITS.eventsPerPost} clicks, keys, scrolls or typed text` });
        return json(res, 200, deps.recorder.record({ key: target.key, recordingId, leaseId, events }));
      }
      if (m[2] === "stop") {
        const goal = typeof body.goal === "string" ? body.goal.slice(0, TEACH_LIMITS.goalChars) : undefined;
        return json(res, 200, await deps.recorder.stop({ key: target.key, recordingId, leaseId, ...(goal ? { goal } : {}) }));
      }
      await deps.recorder.discard({ key: target.key, recordingId, leaseId, threadId: target.threadId });
      return json(res, 200, { discarded: true });
    } catch (error) {
      if (error instanceof TeachError) return json(res, error.status, { error: error.message });
      return json(res, (error as { status?: number }).status ?? 502, { error: (error as Error).message || "the recording failed" });
    }
  };
}
