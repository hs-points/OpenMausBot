import { describe, expect, it } from "vitest";

import { runsBlockedAgentCli } from "./hsp-blocked-mcp.ts";
import { parseMcpServerMutation, parseStoredMcpServer } from "./mcp-registry.ts";

describe("HSP: Codex/Claude CLIs are never MCP servers", () => {
  it.each([
    ["codex", ["mcp-server"]],
    ["/usr/local/bin/codex", ["mcp-server"]],
    ["claude", ["mcp", "serve"]],
    ["/home/x/.local/bin/claude", []],
    ["claude-code", []],
    ["npx", ["-y", "@openai/codex", "mcp-server"]],
    ["npx", ["-y", "@openai/codex@0.156.0", "mcp-server"]],
    ["bunx", ["@anthropic-ai/claude-code", "mcp", "serve"]],
    ["sh", ["-c", "exec codex mcp-server"]],
    ["bash", ["-lc", "claude mcp serve"]],
    ["node", ["/usr/lib/node_modules/@openai/codex/bin/codex.js", "mcp-server"]],
    ["C:\\tools\\codex.exe", ["mcp-server"]],
    ["env", ["FOO=1", "codex", "mcp-server"]],
  ])("blocks %s %j", (command, args) => {
    expect(runsBlockedAgentCli(command, args)).toBe(true);
    expect(parseMcpServerMutation("x", { command, args }).ok).toBe(false);
    expect(parseStoredMcpServer("x", { command, args }).ok).toBe(false);
  });

  it.each([
    ["npx", ["-y", "@modelcontextprotocol/server-filesystem", "/srv/data"]],
    ["node", ["/opt/hsp-openmausbot/mcp-remote-proxy.js", "https://wti.example/mcp"]],
    ["node", ["/var/lib/openmausbot/hsp/bot-codex-homes/abc/server.js"]],
    ["uvx", ["mcp-server-fetch"]],
  ])("allows %s %j", (command, args) => {
    expect(runsBlockedAgentCli(command, args)).toBe(false);
    expect(parseStoredMcpServer("x", { command, args }).ok).toBe(true);
  });
});
