import { registerHooks } from 'node:module';

// Boxed-VPS e2e only: bot box on, no real SSH/docker. The VPS reports ready and its MCP child is the fixture driver,
// started with `<alias>:<container>` as its target so the test can see exactly which VPS the host reached.
const fixture = new URL('./fake-local-vm-mcp.mjs', import.meta.url).pathname;
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    let source = String(loaded.source);
    if (url.endsWith('/bot-box/box.ts')) {
      source = source.replace('enabled(): boolean { return this.runner !== null; }', 'enabled(): boolean { return true; }');
    }
    if (url.endsWith('/server/vps-computer.ts')) {
      source = source
        .replace('export async function vpsComputerAction(', 'async function realVpsComputerAction(')
        .replace('export function vpsComputerMcp(', 'function realVpsComputerMcp(')
        .replace('export async function inspectVpsForAuto(', 'async function realInspectVpsForAuto(');
      source += `
        const READY = (botId) => ({ ready: true, daemonUp: true, sshAlias: 'fixture-vps', container: 'running', container_id: 'abcdef' + String(botId).replace(/[^a-f0-9]/gi, '').padEnd(6, '0').slice(0, 12), container_name: 'openmausbot-vps-' + botId });
        export async function vpsComputerAction(_action, _cfg, botId) { return READY(botId); }
        export async function inspectVpsForAuto(_cfg, botId) { return READY(botId); }
        export function vpsComputerMcp(cfg, botId, containerRef) {
          const real = realVpsComputerMcp(cfg, botId, containerRef);
          const [, alias, container] = real.args;
          return { command: process.execPath, args: [${JSON.stringify(fixture)}, alias + ':' + container, process.env.OMB_TEST_VM_CALLS], env: real.env };
        }
      `;
    }
    return { ...loaded, source };
  },
});
