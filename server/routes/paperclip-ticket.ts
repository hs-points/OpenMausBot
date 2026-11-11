// The internal call behind the paperclip_ticket tool. Runs inside index.ts's /api/internal/ block after the capability
// bearer is checked: the bot is the capability's, never the body's. A bot with no key gets the same answer as an unknown route.
import type { ServerResponse } from "node:http";

import type { json as sendJson } from "../harness/http.ts";
import type { PaperclipTickets } from "../paperclip-ticket.ts";
import { PASS } from "./table.ts";

export const PAPERCLIP_TICKET_ROUTE = "/api/internal/paperclip-ticket";

export interface PaperclipRouteContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  botId: string;
  readBody(): Promise<unknown>;
}

export function createPaperclipTicketRoutes(deps: { tickets: PaperclipTickets }) {
  return async (ctx: PaperclipRouteContext): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || ctx.path !== PAPERCLIP_TICKET_ROUTE) return PASS;
    if (!deps.tickets.configured(ctx.botId)) return void ctx.json(ctx.res, 404, { error: "Ticket updates are not set up for you." });
    const result = await deps.tickets.call(ctx.botId, await ctx.readBody());
    return void ctx.json(ctx.res, result.isError ? 400 : 200, result.isError ? { error: result.text } : { text: result.text });
  };
}
