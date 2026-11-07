// Stands in for vps-computer.ts in the Teach on computer fixture (`--vps`): every self-hosted VPS computer is the drawn
// desktop of teach-vm-mock.mjs, already running and joined on 127.0.0.1. Nothing reaches SSH or Docker: a command the
// fixture does not answer fails.
import { fixtureDesktop } from "./teach-vm-mock.mjs";

const actual = await import(new URL("../vps-computer.ts?actual", import.meta.url).href);
export * from "../vps-computer.ts?actual";

const ALIAS = "teach-fixture-vps";
const joinUrl = `http://127.0.0.1:${fixtureDesktop.viewerPort}/vnc.html#password=fixture`;
const status = (botId) => ({
  configured: true, sshAlias: ALIAS, daemonUp: true, image: true, imageMatches: true, managed: true, container: "running",
  network: "private", mounts: "none", security: "hardened", desktopReady: true, desktop_error: null, ready: true, problem: null,
  image_ref: actual.VPS_IMAGE, base_image_ref: actual.VPS_IMAGE, driver_version: "fixture",
  container_name: actual.vpsContainerName(botId), container_id: "0123456789ab", image_id: null,
});

export async function vpsComputerStatus(_cfg, botId) { return status(botId); }
export async function vpsComputerAction(_action, _cfg, botId) { return status(botId); }
export async function inspectVpsForAuto(_cfg, botId) { return status(botId); }
export async function reuseVps(_cfg, botId) { return status(botId); }
export async function removeManagedVpsComputer() { return { removed: [] }; }
export async function vpsComputerScreenshot() { return { png: fixtureDesktop.png().toString("base64"), format: "png" }; }
export async function vpsComputerJoin() { return { joinUrl, state: "running" }; }
export async function listManagedVpsComputers() { return { available: true, problem: null, instances: [] }; }
export function vpsDesktopConnection() {
  return { port: fixtureDesktop.viewerPort, password: "fixture", live: () => true, retain: () => () => {} };
}
export function closeVpsDesktopTunnel() { return { closed: true }; }
// cua-driver tool calls (`-H ssh://… exec … cua-driver call <tool> <json> --socket …`) answer from the drawn desktop.
export async function defaultRunner(args) {
  const at = args.indexOf("call");
  if (args[1] === `ssh://${ALIAS}` && at >= 0 && args.includes("--socket")) return { stdout: JSON.stringify(fixtureDesktop.driverCall(args[at + 1])), stderr: "" };
  throw new Error("the Teach fixture has no Docker over SSH");
}
