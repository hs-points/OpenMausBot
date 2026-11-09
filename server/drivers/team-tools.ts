/** Shown in the chat when an engine could not start the `agents` MCP server, a bot's only way to reach other bots. */
export const TEAM_TOOLS_FAILED = "This bot's team tools didn't connect, so it couldn't reach other bots this time. They reconnect on your next message.";

/** Shown when the computer a person selected for this turn could not start its screen tools; the turn stops there. */
export const COMPUTER_TOOLS_FAILED = "The selected computer's screen tools did not connect. This turn has stopped. Check the computer connection, then start a new turn.";

/** Codex's startup state for the `computer` MCP server: failed while this turn selected it. */
export function computerToolsFailed(server: unknown, selected: { has(name: string): boolean }): boolean {
  const record = server && typeof server === "object" ? server as { name?: unknown; status?: unknown } : null;
  return record?.name === "computer" && record.status === "failed" && selected.has("computer");
}

/** One MCP server's startup state, as Claude Code's `system/init` lists it in `mcp_servers` and
 * Codex's `mcpServer/startupStatus/updated` sends it: the `agents` server failed. */
export function teamToolsFailed(server: unknown): boolean {
  const record = server && typeof server === "object" ? server as { name?: unknown; status?: unknown } : null;
  return record?.name === "agents" && record.status === "failed";
}

/** The servers of `custom` that Claude Code's `system/init` `mcp_servers` lists as failed, for `session.started`. */
export function failedCustomMcp(servers: unknown, custom: Readonly<Record<string, unknown>> | undefined): { mcpFailed?: string[] } {
  if (!Array.isArray(servers) || !custom) return {};
  const failed = servers.flatMap((server) => {
    const record = server && typeof server === "object" ? server as { name?: unknown; status?: unknown } : null;
    return typeof record?.name === "string" && record.status === "failed" && Object.hasOwn(custom, record.name) ? [record.name] : [];
  });
  return failed.length ? { mcpFailed: failed } : {};
}
