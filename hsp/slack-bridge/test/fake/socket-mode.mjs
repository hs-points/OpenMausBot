import { EventEmitter } from "node:events";
const BASE = process.env.FAKE_SLACK_URL;
export class SocketModeClient extends EventEmitter {
  constructor({ appToken }) { super(); this.appToken = appToken; this.ctl = new AbortController(); }
  async start() {
    const res = await fetch(`${BASE}/socket`, { headers: { authorization: `Bearer ${this.appToken}` }, signal: this.ctl.signal });
    this.emit("connected");
    (async () => {
      let buf = "";
      try {
        for await (const chunk of res.body) {
          buf += Buffer.from(chunk).toString();
          let i;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            // Same dispatch as @slack/socket-mode 3.1.0 onWebSocketMessage: events_api payloads are emitted under the
            // inner event type, then everything again as "slack_event" with the envelope type.
            const body = JSON.parse(line), ack = async () => {};
            this.emit(body.event.type, { ack, body, event: body.event });
            this.emit("slack_event", { ack, type: "events_api", body });
          }
        }
      } catch { /* aborted */ }
    })();
  }
  async disconnect() { this.ctl.abort(); }
}
