// Teach on computer: the owner's own clicks, keys and typing on a bot's Local VM desktop, captured at the viewer while
// they hold control, kept as one generation of the conversation's step evidence (same folder, modes, caps and 30-day
// retention as browser steps), then handed to skill authoring as numbered steps.
//
// Security invariant: typed text is stored only when (a) a focus check, started before any later focus-changing event
// was received and finished without one arriving, saw a field that is not a password field, or (b) the driver reports
// no focus at all (cua-driver on Linux does not), and the run began with no focus-changing event since a click on a
// plain text field (not a password field) whose value, read back afterwards, holds the typed text. Anything else is
// stored as hidden, with no length.
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";

import { TEACH_GOAL_CHARS, teachPrompt, type TaughtStep } from "../shared/teach-prompt.ts";
import type { BrowserEvidence, EvidenceImageType, StepRecord } from "./browser-evidence.ts";
import { namesSecret } from "./saved-steps/screen-words.ts";

export const TEACH_LIMITS = {
  steps: 300,
  eventsPerPost: 50,
  textChars: 2000,
  idleMs: 30 * 60_000,
  settleMs: 600,
  goalChars: TEACH_GOAL_CHARS,
  labelChars: 80,
} as const;

export type TeachModifier = "ctrl" | "alt" | "shift" | "meta";
export type TeachEvent =
  | { kind: "click"; x: number; y: number; button: "left" | "middle" | "right"; double: boolean }
  | { kind: "typing" }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string; modifiers: TeachModifier[] }
  | { kind: "scroll"; x: number; y: number; dx: number; dy: number };

export interface TeachElement { role?: string; label?: string }
export interface TeachContext {
  app?: string;
  window?: string;
  focused?: TeachElement;
  hit?: TeachElement;
  /** Identifies the element under the point, so its value can be read back after typing (see `values`). */
  hitKey?: string;
  /** Current values of the window's plain text fields (never password fields), by element key. */
  values?: Record<string, string>;
}

export interface TeachComputer {
  screenshot(): Promise<{ bytes: Buffer; type: EvidenceImageType } | null>;
  inspect(point?: { x: number; y: number }): Promise<TeachContext | null>;
}

export type TeachStep = TaughtStep;

interface Probe { valid: boolean; secret: boolean; field?: TeachElement; epoch: number; unreported?: boolean }

interface Recording {
  id: string;
  key: string;
  botId: string;
  threadId: string;
  leaseId: string;
  desktop: string;
  computer: TeachComputer;
  holds: () => boolean;
  startedAt: number;
  touchedAt: number;
  steps: TeachStep[];
  chain: Promise<void>;
  probes: Map<number, Promise<Probe>>;
  probeSeq: number;
  ended: boolean;
  /** Bumped when a click or focus-moving key is received; a focus check that saw it change is not trusted. */
  focusEpoch: number;
  pendingProbe: number | null;
  /** The last left click's field, with the focus epoch it set; used when the driver reports no focus. */
  lastClick: { epoch: number; key: string; field: TeachElement } | null;
}

export interface TeachDeps {
  evidence: Pick<BrowserEvidence, "nextStep" | "imageTarget" | "commit" | "accepts" | "removeGeneration">;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  settleMs?: number;
}

const SECRET_ROLE = /password|secure/iu;
const TEXT_ROLE = /^(entry|text|editable text|text field|textbox|search box|search field|combo box|spin button|terminal|document text|paragraph)$/iu;
const KEY_NAME = /^[A-Za-z0-9][\w+-]{0,23}$/u;
const MODIFIERS = new Set<TeachModifier>(["ctrl", "alt", "shift", "meta"]);
const FOCUS_KEYS = new Set(["Tab", "Enter", "Escape", "F6"]);

export class TeachError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

const finite = (value: unknown, limit = 100_000): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

/** At most TEACH_LIMITS.eventsPerPost well-formed events, or null. */
export function parseTeachEvents(value: unknown): TeachEvent[] | null {
  if (!Array.isArray(value) || value.length > TEACH_LIMITS.eventsPerPost) return null;
  const out: TeachEvent[] = [];
  for (const raw of value) {
    if (typeof raw !== "object" || raw === null) return null;
    const event = raw as Record<string, unknown>;
    if (event.kind === "click") {
      if (!finite(event.x) || !finite(event.y) || !["left", "middle", "right"].includes(String(event.button))) return null;
      out.push({ kind: "click", x: Math.round(event.x), y: Math.round(event.y), button: event.button as "left", double: event.double === true });
    } else if (event.kind === "typing") {
      out.push({ kind: "typing" });
    } else if (event.kind === "type") {
      if (typeof event.text !== "string" || !event.text || event.text.length > TEACH_LIMITS.textChars) return null;
      out.push({ kind: "type", text: event.text });
    } else if (event.kind === "key") {
      const modifiers = Array.isArray(event.modifiers) ? event.modifiers : [];
      if (typeof event.key !== "string" || !KEY_NAME.test(event.key) || modifiers.length > 4
        || !modifiers.every((modifier) => MODIFIERS.has(modifier as TeachModifier))) return null;
      out.push({ kind: "key", key: event.key, modifiers: [...new Set(modifiers as TeachModifier[])] });
    } else if (event.kind === "scroll") {
      if (!finite(event.x) || !finite(event.y) || !finite(event.dx, 10_000) || !finite(event.dy, 10_000)) return null;
      out.push({ kind: "scroll", x: Math.round(event.x), y: Math.round(event.y), dx: Math.round(event.dx), dy: Math.round(event.dy) });
    } else return null;
  }
  return out;
}

export function isSecretField(element: TeachElement | undefined): boolean {
  if (!element) return false;
  return SECRET_ROLE.test(element.role ?? "") || namesSecret(element.label) || namesSecret(element.role);
}

const clip = (text: string | undefined, limit: number = TEACH_LIMITS.labelChars) => {
  const flat = (text ?? "").replace(/\s+/gu, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
};

function describe(element: TeachElement | undefined): string {
  const label = clip(element?.label);
  const role = clip(element?.role, 30).toLowerCase();
  if (label && role) return `${JSON.stringify(label)} (${role})`;
  if (label) return JSON.stringify(label);
  return role ? `a ${role}` : "";
}

function where(context: TeachContext | null): string {
  const app = clip(context?.app, 40);
  const window = clip(context?.window, 60);
  if (app && window && window !== app) return ` in ${app} — ${JSON.stringify(window)}`;
  if (app || window) return ` in ${app || JSON.stringify(window)}`;
  return "";
}

const KEY_LABEL: Record<string, string> = { ctrl: "Ctrl", alt: "Alt", shift: "Shift", meta: "Super" };

export function keyCombo(key: string, modifiers: readonly TeachModifier[]): string {
  const order: TeachModifier[] = ["ctrl", "alt", "shift", "meta"];
  return [...order.filter((modifier) => modifiers.includes(modifier)).map((modifier) => KEY_LABEL[modifier]), key.length === 1 ? key.toUpperCase() : key].join("+");
}

export function clickSummary(event: Extract<TeachEvent, { kind: "click" }>, context: TeachContext | null): string {
  const verb = event.button === "right" ? "Right-click" : event.button === "middle" ? "Middle-click" : event.double ? "Double-click" : "Click";
  const target = describe(context?.hit) || "the screen";
  return `${verb} ${target}${where(context)} at (${event.x}, ${event.y})`;
}

export function typeSummary(text: string | null, field: TeachElement | undefined): string {
  const into = describe(field);
  if (text === null) return `Type hidden text${into ? ` into ${into}` : ""} (a password field, or one that could not be checked; ask me for it)`;
  return `Type ${JSON.stringify(text)}${into ? ` into ${into}` : ""}`;
}

export function scrollSummary(event: Extract<TeachEvent, { kind: "scroll" }>): string {
  const parts: string[] = [];
  if (event.dy) parts.push(`${event.dy > 0 ? "down" : "up"} ${Math.abs(event.dy)}`);
  if (event.dx) parts.push(`${event.dx > 0 ? "right" : "left"} ${Math.abs(event.dx)}`);
  return `Scroll ${parts.join(" and ") || "0"} at (${event.x}, ${event.y})`;
}

export { teachPrompt };

export class TeachRecorder {
  private recordings = new Map<string, Recording>();
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private settleMs: number;
  private deps: TeachDeps;

  constructor(deps: TeachDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.settleMs = deps.settleMs ?? TEACH_LIMITS.settleMs;
  }

  active(key: string): { recordingId: string; botId: string; startedAt: number; steps: number } | null {
    const recording = this.live(key);
    return recording ? { recordingId: recording.id, botId: recording.botId, startedAt: recording.startedAt, steps: recording.steps.length } : null;
  }

  /** A recording whose control was lost or that sat idle takes no more steps, but can still be stopped or discarded. */
  private live(key: string): Recording | null {
    const recording = this.recordings.get(key);
    if (!recording) return null;
    if (this.now() - recording.touchedAt > 2 * TEACH_LIMITS.idleMs) {
      this.recordings.delete(key);
      return null;
    }
    if (recording.ended || this.now() - recording.touchedAt > TEACH_LIMITS.idleMs || !recording.holds()) {
      recording.ended = true;
      return null;
    }
    return recording;
  }

  private owned(key: string, recordingId: string, leaseId: string): Recording {
    const recording = this.recordings.get(key);
    if (!recording || recording.id !== recordingId || recording.leaseId !== leaseId) throw new TeachError("This recording is not running.", 404);
    if (!this.live(key)) throw new TeachError("Recording stopped: you no longer have control of this computer.", 409);
    return recording;
  }

  async start(input: { key: string; botId: string; threadId: string; leaseId: string; desktop: string; computer: TeachComputer; holds: () => boolean }): Promise<{ recordingId: string; startedAt: number }> {
    if (!input.holds()) throw new TeachError("Take control of this computer before recording.", 409);
    if (this.live(input.key)) throw new TeachError("A recording is already running on this computer.", 409);
    if (!this.deps.evidence.accepts(input.threadId)) throw new TeachError("This conversation keeps no more recorded steps.", 409);
    const recording: Recording = {
      ...input,
      id: `teach-${randomUUID()}`,
      startedAt: this.now(),
      touchedAt: this.now(),
      steps: [],
      chain: Promise.resolve(),
      probes: new Map(),
      probeSeq: 0,
      focusEpoch: 0,
      pendingProbe: null,
      lastClick: null,
      ended: false,
    };
    this.recordings.set(input.key, recording);
    this.enqueue(recording, async () => {
      const context = await recording.computer.inspect().catch(() => null);
      await this.commit(recording, "start", `Start${where(context)}`, {}, true);
    });
    return { recordingId: recording.id, startedAt: recording.startedAt };
  }

  /** Events are applied in the order received; only clicks and keys wait for the screen to settle. */
  record(input: { key: string; recordingId: string; leaseId: string; events: TeachEvent[] }): { accepted: number; steps: number } {
    const recording = this.owned(input.key, input.recordingId, input.leaseId);
    recording.touchedAt = this.now();
    const focusMoves = (event: TeachEvent) => event.kind === "click" || (event.kind === "key" && (FOCUS_KEYS.has(event.key) || event.modifiers.some((modifier) => modifier !== "shift")));
    const later = input.events.map((_, index) => input.events.slice(index + 1).some(focusMoves));
    input.events.forEach((event, index) => {
      if (event.kind === "typing") {
        const id = ++recording.probeSeq;
        recording.pendingProbe = id;
        recording.probes.set(id, later[index] ? Promise.resolve({ valid: false, secret: true, epoch: -1 }) : this.probe(recording));
        return;
      }
      if (focusMoves(event)) recording.focusEpoch++;
      if (event.kind === "type") {
        const probeId = recording.pendingProbe;
        recording.pendingProbe = null;
        const probe = probeId === null ? null : recording.probes.get(probeId);
        if (probeId !== null) recording.probes.delete(probeId);
        this.enqueue(recording, async () => {
          const seen = probe ? await probe : null;
          let visible = seen !== null && seen.valid && !seen.secret;
          let field = seen?.field;
          if (!visible && seen?.unreported) {
            const clicked = await this.typedIntoClicked(recording, seen.epoch, event.text);
            if (clicked) { visible = true; field = clicked; }
          }
          await this.commit(recording, "type", typeSummary(visible ? event.text : null, field), visible ? { text: event.text } : { hidden: true }, false);
        });
        return;
      }
      recording.pendingProbe = null;
      const epoch = recording.focusEpoch;
      this.enqueue(recording, async () => {
        if (event.kind === "click") {
          const [context] = await Promise.all([recording.computer.inspect({ x: event.x, y: event.y }).catch(() => null), this.sleep(this.settleMs)]);
          recording.lastClick = event.button === "left" && context?.hit && context.hitKey ? { epoch, key: context.hitKey, field: context.hit } : null;
          await this.commit(recording, "click", clickSummary(event, context), { x: event.x, y: event.y, button: event.button, double: event.double }, true);
        } else if (event.kind === "key") {
          const settles = FOCUS_KEYS.has(event.key) || event.modifiers.length > 0;
          if (settles) await this.sleep(this.settleMs);
          await this.commit(recording, "key", `Press ${keyCombo(event.key, event.modifiers)}`, { key: event.key, modifiers: event.modifiers }, settles);
        } else {
          await this.commit(recording, "scroll", scrollSummary(event), { x: event.x, y: event.y, dx: event.dx, dy: event.dy }, true);
        }
      });
    });
    return { accepted: input.events.length, steps: recording.steps.length };
  }

  async stop(input: { key: string; recordingId: string; leaseId: string; goal?: string }): Promise<{ recordingId: string; threadId: string; desktop: string; steps: TeachStep[]; prompt: string }> {
    const recording = this.recordings.get(input.key);
    if (!recording || recording.id !== input.recordingId || recording.leaseId !== input.leaseId) throw new TeachError("This recording is not running.", 404);
    this.recordings.delete(input.key);
    await recording.chain;
    return {
      recordingId: recording.id,
      threadId: recording.threadId,
      desktop: recording.desktop,
      steps: recording.steps,
      prompt: teachPrompt({ goal: input.goal, desktop: recording.desktop, steps: recording.steps }),
    };
  }

  /** Stops if running, then deletes the recording's saved steps and screenshots. */
  async discard(input: { key: string; recordingId: string; leaseId: string; threadId: string }): Promise<void> {
    const recording = this.recordings.get(input.key);
    if (recording?.id === input.recordingId && recording.leaseId === input.leaseId) {
      this.recordings.delete(input.key);
      await recording.chain;
    }
    this.deps.evidence.removeGeneration(input.threadId, input.recordingId);
  }

  private async probe(recording: Recording): Promise<Probe> {
    const epoch = recording.focusEpoch;
    const context = await recording.computer.inspect().catch(() => null);
    const field = context?.focused;
    // No focus reported: the fallback (typedIntoClicked) judges by the click before `epoch` and a value read-back, so a
    // focus change during this check does not void it.
    if (!field) return { valid: false, secret: true, epoch, unreported: context !== null };
    if (recording.focusEpoch !== epoch) return { valid: false, secret: true, epoch, field };
    return { valid: true, secret: isSecretField(field), field, epoch };
  }

  /** For a driver that reports no focus: the last-clicked plain text field, if nothing moved focus between that click
   * and the start of typing and the field's value now holds the typed text. Otherwise null (the text stays hidden). */
  private async typedIntoClicked(recording: Recording, epoch: number, typed: string): Promise<TeachElement | null> {
    const click = recording.lastClick;
    if (!click || click.epoch !== epoch || isSecretField(click.field) || !TEXT_ROLE.test(click.field.role ?? "")) return null;
    const context = await recording.computer.inspect().catch(() => null);
    const value = context?.values?.[click.key];
    return typeof value === "string" && value.includes(typed) ? click.field : null;
  }

  private enqueue(recording: Recording, work: () => Promise<void>): void {
    recording.chain = recording.chain.then(work).catch(() => {});
  }

  private async commit(recording: Recording, action: TeachStep["action"], summary: string, fields: Record<string, unknown>, screenshot: boolean): Promise<void> {
    if (recording.steps.length >= TEACH_LIMITS.steps) return;
    const step = this.deps.evidence.nextStep();
    let imagePath: string | null = null;
    if (screenshot) {
      const shot = await recording.computer.screenshot().catch(() => null);
      if (shot) {
        const target = this.deps.evidence.imageTarget(recording.threadId, recording.id, step, shot.type);
        if ("path" in target) {
          try { writeFileSync(target.path, shot.bytes, { mode: 0o600 }); imagePath = target.path; } catch {}
        }
      }
    }
    const record: StepRecord = {
      v: 1, step, at: this.now(), threadId: recording.threadId, generation: recording.id, image: null,
      source: "teach", botId: recording.botId, action, summary, ...fields,
    };
    const saved = await this.deps.evidence.commit(record, imagePath).catch(() => null);
    recording.steps.push({ step, action, summary, ...(fields.hidden ? { hidden: true as const } : {}), image: saved?.image ?? null });
  }
}

type Json = Record<string, unknown>;
const isJson = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const text = (source: Json, keys: readonly string[]) => {
  for (const key of keys) if (typeof source[key] === "string" && source[key]) return source[key] as string;
  return undefined;
};

/** A driver result may arrive bare or wrapped as an MCP tool result. */
export function driverStructured(value: unknown): Json | null {
  if (!isJson(value)) return null;
  if (isJson(value.structuredContent)) return value.structuredContent;
  if (isJson(value.result)) return driverStructured(value.result);
  return value;
}

function box(element: Json): { x: number; y: number; w: number; h: number } | null {
  const raw = element.bounds ?? element.frame ?? element.rect ?? element.extents;
  if (Array.isArray(raw) && raw.length === 4 && raw.every((n) => typeof n === "number")) return { x: raw[0], y: raw[1], w: raw[2], h: raw[3] };
  if (isJson(raw)) {
    const x = raw.x ?? raw.left, y = raw.y ?? raw.top, w = raw.width ?? raw.w, h = raw.height ?? raw.h;
    if ([x, y, w, h].every((n) => typeof n === "number")) return { x: x as number, y: y as number, w: w as number, h: h as number };
  }
  return null;
}

const focusedFlag = (element: Json) => element.focused === true || element.is_focused === true
  || (Array.isArray(element.states) && element.states.some((state) => typeof state === "string" && /^focused$/iu.test(state)));

const elementOf = (element: Json): TeachElement => {
  const out: TeachElement = {};
  const role = text(element, ["role", "role_name", "subrole"]);
  const label = text(element, ["label", "name", "title", "description"]);
  if (role) out.role = role;
  if (label) out.label = label;
  return out;
};

const contains = (rect: { x: number; y: number; w: number; h: number } | null, point: { x: number; y: number }) =>
  rect !== null && point.x >= rect.x && point.y >= rect.y && point.x <= rect.x + rect.w && point.y <= rect.y + rect.h;
/** Desktop background, panels and docks: never the window someone is working in unless they clicked on one. */
const CHROME_WINDOW = /^(xfdesktop|xfce4-panel|plasmashell|gnome-shell|desktop|panel|dock|tint2|polybar)$/iu;
const zIndex = (window: Json) => (typeof window.z_index === "number" ? window.z_index : -1);

/** The window being worked in: one the driver flags as focused; else the topmost under the point; else the topmost
 * window that is not the desktop or a panel. cua-driver on Linux sends no focus flag, only `z_index` (higher is on top). */
function pickWindow(windows: Json[], point?: { x: number; y: number }): Json | undefined {
  const flagged = windows.find((candidate) => candidate.focused === true || candidate.is_focused === true || candidate.active === true);
  if (flagged) return flagged;
  const shown = windows.filter((candidate) => candidate.is_on_screen !== false);
  const top = (list: Json[]) => list.reduce<Json | undefined>((best, candidate) => (!best || zIndex(candidate) > zIndex(best) ? candidate : best), undefined);
  const under = point ? top(shown.filter((candidate) => contains(box(candidate), point))) : undefined;
  if (under) return under;
  if (!shown.some((candidate) => typeof candidate.z_index === "number")) return windows[0];
  return top(shown.filter((candidate) => !CHROME_WINDOW.test(text(candidate, ["app_name", "owner_name", "application"]) ?? "")
    && !CHROME_WINDOW.test(text(candidate, ["title", "name"]) ?? ""))) ?? top(shown);
}

/** Reads app, window, focused element, the smallest element under the point and the window's text-field values
 * from list_windows + get_window_state (element tree). */
export async function inspectDesktop(call: (tool: string, args: Json) => Promise<unknown>, point?: { x: number; y: number }): Promise<TeachContext | null> {
  const listed = driverStructured(await call("list_windows", {}));
  const windows = Array.isArray(listed?.windows) ? listed.windows.filter(isJson) : [];
  const window = pickWindow(windows, point);
  if (!window) return null;
  const context: TeachContext = {};
  const app = text(window, ["app_name", "owner_name", "application"]);
  const title = text(window, ["title", "name"]);
  if (app) context.app = app;
  if (title) context.window = title;
  const pid = window.pid, windowId = window.window_id ?? window.id;
  if (typeof pid !== "number" || typeof windowId !== "number") return context;
  const state = driverStructured(await call("get_window_state", { pid, window_id: windowId, tree_format: "elements" }));
  const elements = Array.isArray(state?.elements) ? state.elements.filter(isJson) : [];
  const focused = elements.find(focusedFlag);
  if (focused) context.focused = elementOf(focused);
  const keyOf = (element: Json) => {
    const rect = box(element);
    const found = elementOf(element);
    return JSON.stringify([windowId, found.role ?? "", found.label ?? "", rect ? [rect.x, rect.y, rect.w, rect.h] : null]);
  };
  const values: Record<string, string> = {};
  for (const element of elements) {
    const found = elementOf(element);
    if (typeof element.value === "string" && TEXT_ROLE.test(found.role ?? "") && !isSecretField(found)) values[keyOf(element)] = element.value;
  }
  if (Object.keys(values).length) context.values = values;
  if (point) {
    let best: { element: Json; area: number } | null = null;
    for (const element of elements) {
      const rect = box(element);
      if (!rect || !contains(rect, point)) continue;
      const area = rect.w * rect.h;
      if (!best || area < best.area) best = { element, area };
    }
    if (best) {
      context.hit = elementOf(best.element);
      context.hitKey = keyOf(best.element);
    }
  }
  return context;
}
