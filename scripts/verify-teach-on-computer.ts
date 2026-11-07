// Teach on computer against an isolated server: the real server, renderer and noVNC viewer, with only the Local VM
// container replaced by a drawn fake desktop on 127.0.0.1 (server/testing/teach-vm-hooks.mjs). No Docker, no user data.
// Run: node --experimental-strip-types scripts/verify-teach-on-computer.ts [--vps] [--static <vite build dir>]
// --vps puts Ada on a self-hosted VPS cloud computer (server/testing/teach-vps-mock.mjs) instead of a Local VM.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { verificationServerEnvironment } from "./control-omb.ts";
import { freePortBlock } from "../server/testing/ports.ts";
import { fixtureApi, parkUntilSignal } from "./testing/preview-fixture.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const given = process.argv.indexOf("--static");
const onVps = process.argv.includes("--vps");
const home = mkdtempSync(join(tmpdir(), "omb-teach-verify-"));
const staticDir = given > 0 ? process.argv[given + 1]! : join(home, "ui");
if (given < 0) {
  const built = spawnSync(process.execPath, [join(ROOT, "node_modules", "vite", "bin", "vite.js"), "build", "--outDir", staticDir, "--emptyOutDir"], { cwd: ROOT, stdio: "inherit" });
  if (built.status !== 0) throw new Error("vite build failed");
}

const data = join(home, "data");
mkdirSync(join(data, "tmp"), { recursive: true });
writeFileSync(join(data, "config.json"), JSON.stringify({
  features: { smartSetupChoices: false },
  localVm: { mode: "per-bot" },
  ...onVps ? { vps: { sshAlias: "teach-fixture-vps" } } : {},
  instances: { claude: { driver: "claudeAgent", displayName: "Verification fixture", config: { cli: join(ROOT, "server", "testing", "fake-claude-cli.ts") } } },
}, null, 2));
const port = await freePortBlock([0, 1]);
const url = `http://127.0.0.1:${port}`;
const env = { ...verificationServerEnvironment(process.env, data, port), OMB_STATIC_DIR: staticDir, OMB_DEV_TRUST_LOCAL_BROWSER: "1" };
const logPath = join(home, "server.log");
const log = openSync(logPath, "a", 0o600);
const child = spawn(process.execPath, [
  "--experimental-strip-types", "--import", pathToFileURL(join(ROOT, "server", "testing", "teach-vm-hooks.mjs")).href,
  join(ROOT, "server", "index.ts"),
], { cwd: ROOT, env, stdio: ["ignore", log, log] });

const api = fixtureApi(url, { headers: { origin: url } });
try {
  for (let i = 0; ; i++) {
    if (child.exitCode !== null) throw new Error(`server exited; see ${logPath}`);
    try { if ((await fetch(`${url}/api/health`)).ok) break; } catch {}
    if (i > 300) throw new Error(`server did not start; see ${logPath}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const { bot } = await api("POST", "/api/bots", { name: "Ada" });
  await api("PATCH", `/api/bots/${bot.id}`, onVps ? { computer: "cloud", cloudBackend: "vps" } : { computer: "vm" });
  console.log(JSON.stringify({ url, botId: bot.id, data, log: logPath, evidence: join(data, "evidence") }, null, 2));
  await parkUntilSignal();
} finally {
  child.kill("SIGTERM");
  await new Promise((resolve) => child.once("exit", resolve));
  rmSync(home, { recursive: true, force: true });
}
