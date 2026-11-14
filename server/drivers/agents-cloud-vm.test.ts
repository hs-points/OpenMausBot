import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentsServerEnv } from "../agents-turn.ts";
import { childEnv } from "../testing/omb-env.ts";
import { waitForExit } from "../testing/cleanup.ts";

const PROXY = fileURLToPath(new URL("./agents-proxy.ts", import.meta.url));
const GATE = fileURLToPath(new URL("../mcp-gate.ts", import.meta.url));

describe("cloud-home VM tools through the tool-scope gate", () => {
  let server: Server;
  let port: number;
  let mounted: boolean;
  let calls: unknown[];
  const children: ChildProcessWithoutNullStreams[] = [];

  beforeEach(async () => {
    mounted = true;
    calls = [];
    server = createServer(async (request, response) => {
      if (request.url !== "/api/internal/vm-exec" || request.method !== "POST") {
        response.writeHead(404).end();
        return;
      }
      expect(request.headers.authorization).toBe("Bearer fixture-token");
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      calls.push(JSON.parse(Buffer.concat(chunks).toString()));
      response.writeHead(mounted ? 200 : 409, { "content-type": "application/json" });
      response.end(JSON.stringify(mounted
        ? { exitCode: 0, stdout: "VM_OK", stderr: "", timedOut: false }
        : { error: "You have no Local VM or cloud computer in this turn, so there is nowhere to run a command." }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await Promise.all(children.splice(0).map((child) => waitForExit(child, { signal: "SIGTERM" })));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  function start(threadId: string, deny: string[] = ["mcp:agents:fill_login"], vpsCommands?: string, gated = true) {
    const env = agentsServerEnv({
      threadId, bot: { id: "fixture-ada", cloudBackend: "vps", computer: "cloud" }, room: false,
      teamComputer: false, botDriven: threadId !== "main-turn",
      host: { cloudHome: true, skillAuthoring: false, sharedComputers: false, team: true, voiceNotes: false, x: false, research: false, imageGeneration: false },
    }, { generation: threadId, depth: threadId === "main-turn" ? 0 : 1, skillAuthoring: false },
    () => "fixture-token", `http://127.0.0.1:${port}`);
    if (vpsCommands !== undefined) env.OMB_VPS_COMMANDS = vpsCommands;
    const child = spawn(process.execPath, [gated ? GATE : PROXY], {
      env: {
        ...childEnv(),
        ...(gated ? {
          OMB_GATE_NAME: "agents", OMB_GATE_BUDGET: "0",
          OMB_GATE_TOOL_SCOPE: JSON.stringify({ deny }),
          OMB_GATE_UPSTREAM: JSON.stringify({ command: process.execPath, args: [PROXY], env }),
        } : env),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    children.push(child);
    let id = 0;
    const pending = new Map<number, (message: any) => void>();
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    });
    return (method: string, params?: unknown): Promise<any> => new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`${method} timed out`));
      }, 10_000);
      pending.set(requestId, (message) => { clearTimeout(timer); resolve(message); });
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params }) + "\n");
    });
  }

  it.each(["main-turn", "start_thread-child", "coordinate-self-child"])("lists and executes vm_exec for a scoped bot's %s", async (thread) => {
    const rpc = start(thread);
    const listed = await rpc("tools/list");
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).toContain("vm_exec");
    const result = await rpc("tools/call", { name: "vm_exec", arguments: { command: "printf VM_OK" } });
    expect(result.result.isError).toBeFalsy();
    expect(result.result.content[0].text).toContain("VM_OK");
    expect(calls).toEqual([{ command: "printf VM_OK" }]);
  });

  it("leaves ungated VPS tools unchanged", async () => {
    const gated = await start("main-turn", [])("tools/list");
    const ungated = await start("main-turn", [], undefined, false)("tools/list");
    expect(gated.result.tools).toEqual(ungated.result.tools);
  });

  it.each(["0", ""])("hides vm_exec without an enabled VPS flag (%s)", async (flag) => {
    const rpc = start("main-turn", [], flag);
    const listed = await rpc("tools/list");
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("vm_exec");
    const result = await rpc("tools/call", { name: "vm_exec", arguments: { command: "printf VM_OK" } });
    expect(result.error ?? result.result?.isError).toBeTruthy();
    expect(calls).toEqual([]);
  });

  it("propagates the mounted-computer guard's refusal for the same scoped bot", async () => {
    mounted = false;
    const rpc = start("main-turn");
    const result = await rpc("tools/call", { name: "vm_exec", arguments: { command: "printf VM_OK" } });
    expect(result.error).toBeUndefined();
    expect(result.result.isError).toBe(true);
    expect(result.result.content[0].text).toContain("no Local VM or cloud computer");
  });

  it.each(["mcp:agents:vm_exec", "mcp:agents:*"])("does not list or forward vm_exec denied by %s", async (selector) => {
    const rpc = start("main-turn", [selector]);
    const listed = await rpc("tools/list");
    expect(listed.result.tools.map((tool: { name: string }) => tool.name)).not.toContain("vm_exec");
    const result = await rpc("tools/call", { name: "vm_exec", arguments: { command: "printf VM_OK" } });
    expect(result.error ?? result.result?.isError).toBeTruthy();
    expect(calls).toEqual([]);
  });
});
