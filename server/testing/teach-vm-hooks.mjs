// Loaded only by scripts/verify-teach-on-computer.ts via --import: every Local VM becomes the fake desktop in
// teach-vm-mock.mjs. The rest of the server is real.
import { registerHooks } from "node:module";
const mock = new URL("./teach-vm-mock.mjs", import.meta.url).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith("/container-computer.ts") && context.parentURL !== mock) return { url: mock, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
