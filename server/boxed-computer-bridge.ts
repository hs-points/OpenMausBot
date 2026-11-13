// A bot box has no network and no ~/.ssh, so a boxed turn's computer tools reach the computer through the host: the box
// runs only the harness proxy, and the host runs the computer's MCP child (Local VM container or self-hosted VPS) on
// each call it forwards, one screen action at a time.
import { harnessMcpTokenEnv } from "./harness-mcp-token.ts";
import { localVmComputerRpc } from "./local-vm-computer-tools.ts";
import type { ControlState } from "./control-client.ts";

export type McpServer = { command: string; args: string[]; env: Record<string, string> };

/** The host side of one boxed turn's computer: the MCP child to run, the claim each call re-checks, and the call queue. */
export type BoxedComputerConnection = { server(): McpServer; assertClaim(): void; calls: Promise<void> };

/** What the box runs in place of the computer's MCP server: the harness proxy holding only the turn's capability token. */
export function boxedComputerProxy(opts: { harnessMcp: string; nodeEnv: Record<string, string>; port: number; token: string }): McpServer {
  return {
    command: process.execPath,
    args: [opts.harnessMcp, "computer"],
    env: { ...opts.nodeEnv, OMB_HARNESS_URL: `http://127.0.0.1:${opts.port}`, [harnessMcpTokenEnv("computer")]: opts.token },
  };
}

/** Serves one forwarded MCP request; tool calls run in arrival order so two screen actions never interleave. */
export async function serveBoxedComputerCall(connection: BoxedComputerConnection, body: unknown, opts: {
  signal: AbortSignal;
  gate(): Promise<ControlState>;
  assertActive(): void;
}): Promise<unknown> {
  const arrivedAt = Date.now();
  const perform = () => localVmComputerRpc(body, {
    server: connection.server(), signal: opts.signal, arrivedAt, gate: opts.gate, assertActive: opts.assertActive, assertClaim: connection.assertClaim,
  });
  if ((body as { method?: unknown } | null)?.method !== "tools/call") return perform();
  const result = connection.calls.then(perform);
  connection.calls = result.then(() => {}, () => {});
  return result;
}
