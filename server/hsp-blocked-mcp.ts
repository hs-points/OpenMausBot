// HSP patch: no bot may run the Codex or Claude CLI as an MCP server. Those CLIs carry the owner's own model sign-in
// and can run shell commands outside the bot sandbox's rules, so an MCP server that wraps them would hand a bot a
// second, unwalled agent. Checked when an entry is parsed, so add, update, enable and config load all refuse it.

const BLOCKED_BASENAMES = new Set(["codex", "claude", "claude-code"]);
const BLOCKED_PACKAGES = ["@openai/codex", "@anthropic-ai/claude-code", "@anthropic-ai/claude-agent-sdk"];
const SCRIPT_SUFFIX = /\.(?:js|mjs|cjs|exe|cmd|bat|ps1|sh)$/i;

export const BLOCKED_AGENT_MCP_ERROR =
  "This MCP server runs the Codex or Claude CLI, which bots may not use as an MCP server on this install.";

function tokens(value: string): string[] {
  // Split on whitespace and shell punctuation so `sh -c "codex mcp-server"` and `npx -y @openai/codex@1` are seen.
  return value.split(/[\s;&|()<>"'`=]+/).filter(Boolean);
}

function blockedToken(token: string): boolean {
  const lower = token.toLowerCase();
  if (BLOCKED_PACKAGES.some((pkg) => lower === pkg || lower.startsWith(`${pkg}@`) || lower.includes(`/${pkg.slice(1)}/`) || lower.includes(`${pkg}/`))) {
    return true;
  }
  const base = lower.split(/[\\/]/).pop() ?? "";
  const bare = base.replace(/@[^@]*$/, "").replace(SCRIPT_SUFFIX, "");
  return BLOCKED_BASENAMES.has(bare);
}

/** True when the command or any argument starts the Codex or Claude CLI (directly, via npx/bunx/sh, or by path). */
export function runsBlockedAgentCli(command: string, args: readonly string[] = []): boolean {
  return [command, ...args].some((part) => typeof part === "string" && tokens(part).some(blockedToken));
}
