// Test-only: resolve the Slack SDKs to fakes that talk to the test server at $FAKE_SLACK_URL.
import { registerHooks } from "node:module";
const map = {
  "@slack/socket-mode": new URL("./socket-mode.mjs", import.meta.url).href,
  "@slack/web-api": new URL("./web-api.mjs", import.meta.url).href,
};
registerHooks({ resolve(spec, ctx, next) { return map[spec] ? { url: map[spec], shortCircuit: true } : next(spec, ctx); } });
