// A member reaches these through the client allow-list: only one who can edit the bot may watch or steer its screen.
import { refusalFor } from "../host/bot-access-gate.ts";
import type { RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export function createBotComputerAccessRoutes(deps: { mayEdit(auth: RequestAuth, botId: string): boolean; botName(botId: string): string | undefined }): RouteHandler {
  return async ({ res, path, auth, json }) => {
    const m = path.match(/^\/api\/bots\/([\w-]+)\/computer(?:\/(?:control|join|screenshot|viewer-close))?$/);
    if (!m || auth.scopes.includes("admin") || deps.mayEdit(auth, m[1]!)) return PASS;
    json(res, 403, refusalFor(deps.botName(m[1]!) ?? "this bot", "edit"));
  };
}
