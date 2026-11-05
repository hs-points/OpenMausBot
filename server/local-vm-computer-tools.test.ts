import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { localVmComputerRpc } from "./local-vm-computer-tools.ts";

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });

function fixture() {
  const folder = mkdtempSync(join(tmpdir(), "omb-vm-mcp-")); folders.push(folder);
  const script = join(folder, "driver.mjs"), receipt = join(folder, "calls.jsonl");
  writeFileSync(script, `import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
for await (const line of createInterface({ input: process.stdin })) {
  const rpc = JSON.parse(line);
  if (!Object.hasOwn(rpc, 'id')) continue;
  appendFileSync(process.env.FIXTURE_RECEIPT, JSON.stringify({method:rpc.method,params:rpc.params,vm:process.argv[2]})+'\\n');
  const result = rpc.method==='initialize' ? {protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}
    : rpc.method==='tools/list' ? {tools:[{name:'screenshot',inputSchema:{type:'object',properties:{}}}]}
    : {content:[{type:'image',data:'c2NyZWVu',mimeType:'image/png'},{type:'text',text:process.argv[2]}]};
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:rpc.id,result})+'\\n');
}
`);
  const gate = vi.fn(async () => ({ held: false, helpOpen: false }));
  const assertActive = vi.fn(), assertClaim = vi.fn();
  return {
    deps: { server: { command: process.execPath, args: [script, "vm-a"], env: { FIXTURE_RECEIPT: receipt } }, gate, assertActive, assertClaim, signal: new AbortController().signal },
    calls: () => { try { return readFileSync(receipt, "utf8").trim().split("\n").map(line => JSON.parse(line)); } catch { return []; } },
  };
}

describe("host-side Local VM MCP", () => {
  it("discovers the actual stdio driver's screen tools without claiming a lazy VM", async () => {
    const f = fixture();
    await expect(localVmComputerRpc({ method: "tools/list", params: {} }, f.deps)).resolves.toMatchObject({ tools: [{ name: "screenshot" }] });
    expect(f.calls().map(call => call.method)).toEqual(["initialize", "tools/list"]);
    expect(f.deps.gate).not.toHaveBeenCalled(); expect(f.deps.assertClaim).not.toHaveBeenCalled();
  });

  it("calls only the server-bound VM even if arguments name another container", async () => {
    const f = fixture();
    await expect(localVmComputerRpc({ method: "tools/call", params: { name: "screenshot", arguments: { container: "vm-b" } } }, f.deps)).resolves.toMatchObject({ content: [{ type: "image" }, { text: "vm-a" }] });
    expect(f.calls().every(call => call.vm === "vm-a")).toBe(true);
    expect(f.deps.gate).toHaveBeenCalledTimes(2); expect(f.deps.assertClaim).toHaveBeenCalled();
  });

  it("does not start a driver or perform an action during a person's takeover", async () => {
    const f = fixture(); f.deps.gate.mockResolvedValue({ held: true, helpOpen: false });
    await expect(localVmComputerRpc({ method: "tools/call", params: { name: "screenshot" } }, f.deps)).resolves.toMatchObject({ isError: true });
    expect(f.calls()).toEqual([]);
  });

  it("rechecks takeover after the driver handshake and refuses the queued action", async () => {
    const f = fixture();
    f.deps.gate.mockResolvedValueOnce({ held: false, helpOpen: false }).mockResolvedValueOnce({ held: true, helpOpen: false });
    await expect(localVmComputerRpc({ method: "tools/call", params: { name: "click", arguments: { x: 1, y: 1 } } }, f.deps)).resolves.toMatchObject({ isError: true });
    expect(f.calls().map(call => call.method)).toEqual(["initialize"]);
    expect(f.deps.gate).toHaveBeenCalledTimes(2);
  });

  it("refuses an expired turn and a VM whose lease belongs to another bot", async () => {
    const f = fixture(); f.deps.assertActive.mockImplementation(() => { throw new Error("turn expired"); });
    await expect(localVmComputerRpc({ method: "tools/list" }, f.deps)).rejects.toThrow("turn expired");
    expect(f.calls()).toEqual([]);
    f.deps.assertActive.mockReset(); f.deps.assertClaim.mockImplementation(() => { throw new Error("VM belongs to bot B"); });
    await expect(localVmComputerRpc({ method: "tools/call", params: { name: "screenshot" } }, f.deps)).rejects.toThrow("VM belongs to bot B");
    expect(f.calls()).toEqual([]);
  });

  it("rechecks the lease immediately before acting after the driver handshake", async () => {
    const f = fixture(); let checks = 0;
    f.deps.assertClaim.mockImplementation(() => { if (++checks === 2) throw new Error("lease changed"); });
    await expect(localVmComputerRpc({ method: "tools/call", params: { name: "click", arguments: { x: 1, y: 1 } } }, f.deps)).rejects.toThrow("lease changed");
    expect(f.calls().map(call => call.method)).toEqual(["initialize"]);
  });

  it("refuses an action that aged out in its turn's serialized queue", async () => {
    const f = fixture();
    await expect(localVmComputerRpc({ method: "tools/call", params: { name: "click" } }, { ...f.deps, arrivedAt: Date.now() - 6_000 })).resolves.toMatchObject({ isError: true });
    expect(f.calls()).toEqual([]);
  });

  it("rejects arbitrary RPC methods and cancelled requests without spawning", async () => {
    const f = fixture();
    await expect(localVmComputerRpc({ method: "resources/read" }, f.deps)).rejects.toThrow("unsupported computer method");
    const controller = new AbortController(); controller.abort();
    await expect(localVmComputerRpc({ method: "tools/list" }, { ...f.deps, signal: controller.signal })).rejects.toThrow();
    expect(f.calls()).toEqual([]);
  });
});
