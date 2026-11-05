import './group-local-vm-hooks.mjs';
import { registerHooks } from 'node:module';

const fixture = new URL('./fake-local-vm-mcp.mjs', import.meta.url).pathname;
registerHooks({
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    let source = String(loaded.source);
    if (url.endsWith('/bot-box/box.ts')) {
      source = source.replace('enabled(): boolean { return this.runner !== null; }', 'enabled(): boolean { return true; }');
    }
    if (url.endsWith('/testing/group-local-vm-mock.mjs')) {
      source += `
        export function containerComputerMcp(runtime, control, target) {
          return { command: process.execPath, args: [${JSON.stringify(fixture)}, target.key, process.env.OMB_TEST_VM_CALLS], env: {}, platform: 'linux' };
        }
      `;
    }
    return { ...loaded, source };
  },
});
