// Stands in for container-computer.ts in the Teach on computer fixture (teach-vm-hooks.mjs). Every bot's Local VM is a
// ready, loopback-only fake: one drawn Firefox sign-in window, served to the app's own noVNC viewer by a minimal RFB
// server on 127.0.0.1, with screenshots and an AT-SPI-shaped window tree drawn from the same state.
import { deflateSync, crc32 } from "node:zlib";
import { WebSocketServer } from "ws";

const actualUrl = new URL("../container-computer.ts?actual", import.meta.url).href;
const actual = await import(actualUrl);
export * from "../container-computer.ts?actual";

const W = 1280, H = 800;
const WINDOW = { x: 160, y: 80, w: 960, h: 620 };
const FIELDS = [
  { name: "Email", role: "entry", x: 400, y: 300, w: 480, h: 44 },
  { name: "Password", role: "password text", x: 400, y: 380, w: 480, h: 44 },
];
const BUTTON = { name: "Sign in", role: "push button", x: 400, y: 460, w: 160, h: 44 };
const desk = { focused: -1, text: ["", ""], version: 0 };

const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
function draw() {
  const px = new Uint8Array(W * H * 3);
  const fill = (x, y, w, h, color) => {
    const [r, g, b] = rgb(color);
    for (let j = Math.max(0, y); j < Math.min(H, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) { const o = (j * W + i) * 3; px[o] = r; px[o + 1] = g; px[o + 2] = b; }
    }
  };
  fill(0, 0, W, H, "#2d4f73");
  fill(0, 0, W, 28, "#1b1d21");
  for (let i = 0; i < 4; i++) fill(10 + i * 34, 6, 22, 16, i === 1 ? "#e66000" : "#5b6270");
  fill(WINDOW.x + 6, WINDOW.y + 6, WINDOW.w, WINDOW.h, "#1f344b");
  fill(WINDOW.x, WINDOW.y, WINDOW.w, WINDOW.h, "#f6f7f9");
  fill(WINDOW.x, WINDOW.y, WINDOW.w, 34, "#e4e6ea");
  fill(WINDOW.x, WINDOW.y + 34, WINDOW.w, 40, "#d9dce1");
  fill(WINDOW.x + 120, WINDOW.y + 42, 640, 24, "#ffffff");
  fill(WINDOW.x + WINDOW.w - 34, WINDOW.y + 10, 14, 14, "#d9534f");
  fill(400, 200, 220, 26, "#1f2937");
  fill(400, 240, 360, 12, "#9aa1ab");
  FIELDS.forEach((field, index) => {
    const focus = desk.focused === index;
    fill(field.x - 2, field.y - 2, field.w + 4, field.h + 4, focus ? "#2563eb" : "#c3c8cf");
    fill(field.x, field.y, field.w, field.h, "#ffffff");
    [...desk.text[index]].slice(0, 40).forEach((_, at) => {
      if (field.role === "password text") fill(field.x + 14 + at * 14, field.y + 18, 8, 8, "#111827");
      else fill(field.x + 14 + at * 11, field.y + 13, 8, 18, "#111827");
    });
    if (focus) fill(field.x + 14 + desk.text[index].length * (index ? 14 : 11), field.y + 10, 2, 24, "#111827");
  });
  fill(BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, "#2563eb");
  fill(BUTTON.x + 40, BUTTON.y + 18, 80, 8, "#dbeafe");
  return px;
}

function png() {
  const px = draw();
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++) Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
  const chunk = (type, data) => {
    const head = Buffer.alloc(8); head.writeUInt32BE(data.length, 0); head.write(type, 4, "latin1");
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "latin1"), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
function pointer(x, y) {
  const hit = FIELDS.findIndex((field) => inside(field, x, y));
  desk.focused = hit;
  desk.version++;
}
function key(sym) {
  if (sym === 0xff09) desk.focused = desk.focused === 0 ? 1 : 0;
  else if (sym === 0xff08 && desk.focused >= 0) desk.text[desk.focused] = desk.text[desk.focused].slice(0, -1);
  else if (sym >= 0x20 && sym < 0x7f && desk.focused >= 0) desk.text[desk.focused] += String.fromCharCode(sym);
  else if (sym >= 0x1000000 && desk.focused >= 0) desk.text[desk.focused] += String.fromCodePoint(sym - 0x1000000);
  else return;
  desk.version++;
}

// RFB 3.8, security None, raw encoding: enough for noVNC to draw and send input.
const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/websockify" });
await new Promise((resolve) => wss.once("listening", resolve));
const VIEWER_PORT = wss.address().port;
wss.on("connection", (socket) => {
  let stage = "version", buffer = Buffer.alloc(0), format = { bpp: 32, big: false, rs: 16, gs: 8, bs: 0 }, pending = null, sent = -1;
  const send = (data) => socket.readyState === 1 && socket.send(data);
  const update = (full) => {
    if (!full && sent === desk.version) return false;
    sent = desk.version;
    const px = draw();
    const out = Buffer.alloc(16 + W * H * 4);
    out.writeUInt16BE(1, 2); out.writeUInt16BE(W, 8); out.writeUInt16BE(H, 10); out.writeInt32BE(0, 12);
    for (let i = 0, o = 16; i < W * H; i++, o += 4) {
      const value = (px[i * 3] << format.rs) | (px[i * 3 + 1] << format.gs) | (px[i * 3 + 2] << format.bs);
      if (format.big) out.writeUInt32BE(value >>> 0, o); else out.writeUInt32LE(value >>> 0, o);
    }
    send(out);
    return true;
  };
  const timer = setInterval(() => { if (pending !== null && update(false)) pending = null; }, 50);
  socket.on("close", () => clearInterval(timer));
  send(Buffer.from("RFB 003.008\n", "latin1"));
  socket.on("message", (data) => {
    buffer = Buffer.concat([buffer, Buffer.from(data)]);
    for (;;) {
      if (stage === "version") { if (buffer.length < 12) return; buffer = buffer.subarray(12); stage = "security"; send(Buffer.from([1, 1])); continue; }
      if (stage === "security") { if (buffer.length < 1) return; buffer = buffer.subarray(1); stage = "init"; send(Buffer.alloc(4)); continue; }
      if (stage === "init") {
        if (buffer.length < 1) return;
        buffer = buffer.subarray(1); stage = "normal";
        const name = Buffer.from("Fixture Linux desktop", "latin1");
        const init = Buffer.alloc(24 + name.length);
        init.writeUInt16BE(W, 0); init.writeUInt16BE(H, 2);
        init[4] = 32; init[5] = 24; init[6] = 0; init[7] = 1;
        init.writeUInt16BE(255, 8); init.writeUInt16BE(255, 10); init.writeUInt16BE(255, 12);
        init[14] = 16; init[15] = 8; init[16] = 0;
        init.writeUInt32BE(name.length, 20); name.copy(init, 24);
        send(init);
        continue;
      }
      if (!buffer.length) return;
      const type = buffer[0];
      const need = type === 0 ? 20 : type === 2 ? (buffer.length < 4 ? 4 : 4 + buffer.readUInt16BE(2) * 4) : type === 3 ? 10 : type === 4 ? 8 : type === 5 ? 6
        : type === 6 ? (buffer.length < 8 ? 8 : 8 + buffer.readUInt32BE(4)) : 1;
      if (buffer.length < need) return;
      const message = buffer.subarray(0, need);
      buffer = buffer.subarray(need);
      if (type === 0) format = { bpp: message[4], big: message[6] === 1, rs: message[14], gs: message[15], bs: message[16] };
      else if (type === 3) { if (!update(message[1] === 0)) pending = true; }
      else if (type === 4 && message[1] === 1) key(message.readUInt32BE(4));
      else if (type === 5 && (message[1] & 1)) pointer(message.readUInt16BE(2), message.readUInt16BE(4));
    }
  });
});

const status = (target) => ({
  runtime: "docker", daemonUp: true, image: true, create_supported: true, managed: true, container: "running", ready: true,
  desktopReady: true, imageMatches: true, network: "loopback", security: "hardened", persistence: "durable", resumable: false,
  stopped_at: null, problem: null, container_name: target?.containerName ?? "fixture", target_key: target?.key ?? "shared",
  workspace_path: target?.workspaceDir ?? "/fixture/workspace", viewer_port: VIEWER_PORT,
  viewer_url: `http://127.0.0.1:${VIEWER_PORT}/vnc.html#password=fixture`,
});

export async function containerRuntimeStatus() { return { runtime: "docker", daemonUp: true }; }
export async function containerComputerExists() { return true; }
export async function containerComputerStatus(_run, _platform, target = actual.SHARED_LOCAL_VM_TARGET) { return status(target); }
export async function containerComputerAction(_action, _run, _platform, target = actual.SHARED_LOCAL_VM_TARGET) { return status(target); }
export async function containerExec() { return { exitCode: 0, stdout: "", stderr: "", timedOut: false }; }
export async function containerComputerFrame() { return { png: png().toString("base64"), format: "png" }; }
export async function containerComputerScreenshot() { return { png: png().toString("base64"), format: "png" }; }
function driverCall(tool) {
  if (tool === "list_windows") {
    return { structuredContent: { windows: [{ pid: 4242, window_id: 7, app_name: "Firefox", title: "Sign in — Invoices", is_focused: true }] } };
  }
  if (tool === "get_window_state") {
    const element = (item, index) => ({ role: item.role, name: item.name, bounds: { x: item.x, y: item.y, width: item.w, height: item.h },
      states: index === desk.focused ? ["focused", "editable"] : ["editable"] });
    return { structuredContent: { elements: [
      { role: "frame", name: "Sign in — Invoices", bounds: { x: WINDOW.x, y: WINDOW.y, width: WINDOW.w, height: WINDOW.h }, states: [] },
      ...FIELDS.map(element),
      { role: BUTTON.role, name: BUTTON.name, bounds: { x: BUTTON.x, y: BUTTON.y, width: BUTTON.w, height: BUTTON.h }, states: [] },
    ] } };
  }
  return null;
}
// cua-driver tool calls (`exec … cua-driver call <tool> <json> --socket …`) answer from the drawn desktop; anything else runs for real.
export async function sh(cmd, args, timeout) {
  const at = args.indexOf("call");
  if (at >= 0 && args.includes("--socket")) return { stdout: JSON.stringify(driverCall(args[at + 1])) };
  return actual.sh(cmd, args, timeout);
}
/** The same drawn desktop, for the self-hosted VPS stand-in (teach-vps-mock.mjs). */
export const fixtureDesktop = { png, driverCall, viewerPort: VIEWER_PORT };
