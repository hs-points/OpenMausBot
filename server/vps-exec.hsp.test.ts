// HSP: vm_exec on a self-hosted VPS computer runs inside the bot's own container and reports its exit code.
import { describe, expect, it } from "vitest";
import { vpsContainerExec } from "./vps-computer.ts";
import type { AppConfig } from "./config.ts";

const cfg = { vps: { sshAlias: "kvm8-cpc" } } as unknown as AppConfig;

function runner(stdout: string, stderr: string) {
  const calls: string[][] = [];
  const run = async (args: string[]) => { calls.push(args); return { stdout, stderr }; };
  return { calls, run: run as never };
}

describe("vpsContainerExec", () => {
  it("runs as the desktop user inside the bot's container and passes the command as one argument", async () => {
    const r = runner("hello\n", "warn\n__omb_exit__=0\n");
    const result = await vpsContainerExec(cfg, "bot1", "openmausbot-vps-abc-def", "echo 'hello' && apt list", { runner: r.run });
    expect(result).toEqual({ exitCode: 0, stdout: "hello\n", stderr: "warn\n", timedOut: false });
    const args = r.calls[0]!;
    expect(args).toContain("ssh://kvm8-cpc");
    expect(args.slice(args.indexOf("exec"), args.indexOf("exec") + 3)).toEqual(["exec", "-u", "cua"]);
    expect(args).toContain("openmausbot-vps-abc-def");
    expect(args.at(-1)).toBe("echo 'hello' && apt list");
  });

  it("reports a failing command's exit code instead of throwing", async () => {
    const r = runner("", "E: denied\n__omb_exit__=100\n");
    expect(await vpsContainerExec(cfg, "bot1", undefined, "apt install x", { runner: r.run }))
      .toMatchObject({ exitCode: 100, stderr: "E: denied\n", timedOut: false });
  });

  it("marks a timeout and caps the timeout at 300 seconds", async () => {
    const r = runner("", "__omb_exit__=124\n");
    const result = await vpsContainerExec(cfg, "bot1", undefined, "sleep 999", { runner: r.run, timeoutSeconds: 9999 });
    expect(result.timedOut).toBe(true);
    expect(r.calls[0]!.join(" ")).toContain("timeout -k 5 300 ");
  });

  it("refuses an empty command and a bad container name", async () => {
    await expect(vpsContainerExec(cfg, "bot1", undefined, "  ")).rejects.toThrow("command is required");
    await expect(vpsContainerExec(cfg, "bot1", "bad name;rm", "ls", { runner: runner("", "").run })).rejects.toThrow("invalid VPS container");
  });
});
