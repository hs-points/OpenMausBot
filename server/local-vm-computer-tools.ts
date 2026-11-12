import { CONTROL_ACT_WITHIN_MS, CONTROL_WAITED, controlRefusal, type ControlState } from "./control-client.ts";
import { HARNESS_CALL_BUDGET_MS } from "./harness-budget.ts";
import { ON_HOST, openAppClient } from "./mcp-app-connections.ts";

/** Host-side MCP child for a boxed turn: Local VM containers and the self-hosted VPS both run through here, outside the box
 * (ON_HOST): inside it docker has no socket and ssh has no network and refuses the root-owned /etc/ssh/ssh_config. */
export async function localVmComputerRpc(request: unknown, deps: {
  server: { command: string; args: string[]; env: Record<string, string> };
  gate(): Promise<ControlState>;
  assertActive(): void;
  assertClaim(): void;
  signal: AbortSignal;
  arrivedAt?: number;
}): Promise<unknown> {
  if (!request || typeof request !== "object" || !("method" in request) ||
      (request.method !== "tools/list" && request.method !== "tools/call")) {
    throw Object.assign(new Error("unsupported computer method"), { status: 400 });
  }
  const arrivedAt = deps.arrivedAt ?? Date.now();
  const signal = AbortSignal.any([deps.signal, AbortSignal.timeout(HARNESS_CALL_BUDGET_MS)]);
  signal.throwIfAborted();
  deps.assertActive();
  const acting = request.method === "tools/call";
  if (acting) {
    const state = await deps.gate();
    if (state.held) return { content: [{ type: "text", text: controlRefusal(state) }], isError: true };
    deps.assertActive(); deps.assertClaim();
    if (Date.now() - arrivedAt > CONTROL_ACT_WITHIN_MS) return { content: [{ type: "text", text: CONTROL_WAITED }], isError: true };
  }
  const client = await openAppClient(deps.server, { onNotification() {} }, false, signal, ON_HOST);
  try {
    if (acting) {
      const state = await deps.gate();
      if (state.held) return { content: [{ type: "text", text: controlRefusal(state) }], isError: true };
    }
    deps.assertActive();
    if (acting) {
      deps.assertClaim();
      if (Date.now() - arrivedAt > CONTROL_ACT_WITHIN_MS) return { content: [{ type: "text", text: CONTROL_WAITED }], isError: true };
    }
    const result = await client.request(request.method, "params" in request ? request.params : {}, signal);
    deps.assertActive();
    if (acting) deps.assertClaim();
    return result;
  } finally { await client.close(); }
}
