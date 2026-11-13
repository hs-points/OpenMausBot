// HSP patch: the Slack page's two reads. `people` answers the bridge (loopback + relay token); the other answers team admins.
import { buildAdminResponse, buildPeopleResponse, type SlackBotRecord, type TeamMember } from "../hsp-slack.ts";
import { ownerOrAdmin } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";

export interface HspSlackRouteDeps {
  team: boolean;
  bots(): readonly SlackBotRecord[];
  bot(id: string): SlackBotRecord | null | undefined;
  members(): readonly TeamMember[];
  env?: NodeJS.ProcessEnv;
}

export function createHspSlackRoutes(deps: HspSlackRouteDeps): RouteHandler {
  return async ({ res, path, method, auth, json }) => {
    if (method !== "GET" || (path !== "/api/hsp/slack/people" && path !== "/api/hsp/slack")) return PASS;
    res.setHeader("cache-control", "no-store");
    if (!deps.team) return json(res, 404, { error: "not found" });
    if (path === "/api/hsp/slack/people") {
      if (auth.kind !== "loopback") return json(res, 403, { error: "forbidden" });
      return json(res, 200, buildPeopleResponse(deps.bots(), deps.members()));
    }
    // Security: team admins and owner-trust loopback only; service-trust loopback (every bot's shell) is refused.
    if (!ownerOrAdmin(auth)) return json(res, 403, { error: "forbidden" });
    return json(res, 200, buildAdminResponse((deps.env ?? process.env).OMB_SLACK_BRIDGE_STATUS_FILE, deps.bot, deps.members()));
  };
}
