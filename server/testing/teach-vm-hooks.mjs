// Loaded only by scripts/verify-teach-on-computer.ts via --import: every Local VM and self-hosted VPS computer becomes
// the fake desktop in teach-vm-mock.mjs (teach-vps-mock.mjs for the VPS). The rest of the server is real.
import { registerHooks } from "node:module";
const mock = new URL("./teach-vm-mock.mjs", import.meta.url).href;
const vpsMock = new URL("./teach-vps-mock.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/container-computer.ts") && context.parentURL !== mock) return { url: mock, shortCircuit: true };
    if (specifier.endsWith("/vps-computer.ts") && context.parentURL !== vpsMock) return { url: vpsMock, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
