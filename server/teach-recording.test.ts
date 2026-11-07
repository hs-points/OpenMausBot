import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { SAVE_RUN_AS_SKILL_LINE } from "../shared/learn-request.ts";
import { BrowserEvidence } from "./browser-evidence.ts";
import {
  inspectDesktop,
  parseTeachEvents,
  teachPrompt,
  TeachRecorder,
  type TeachComputer,
  type TeachContext,
  type TeachEvent,
} from "./teach-recording.ts";

const posix = process.platform !== "win32";
const LEASE = "lease-0123456789abcdef";
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const PNG = Buffer.from("89504e470d0a1a0a", "hex");

/** A fake Local VM: each inspect answers from `focus`, which a test moves as the person would. */
function fakeComputer() {
  const state = {
    focus: { role: "text", label: "Search" } as TeachContext["focused"] | undefined,
    inspectDelay: 0,
    screenshots: 0,
    beforeInspect: null as null | (() => void),
  };
  const computer: TeachComputer = {
    screenshot: async () => { state.screenshots++; return { bytes: Buffer.concat([PNG, Buffer.from([state.screenshots])]), type: "png" }; },
    inspect: async (point) => {
      state.beforeInspect?.();
      if (state.inspectDelay) await new Promise((done) => setTimeout(done, state.inspectDelay));
      const context: TeachContext = { app: "Firefox", window: "Invoices" };
      if (state.focus) context.focused = state.focus;
      if (point) context.hit = { role: "push button", label: "Export" };
      return context;
    },
  };
  return { state, computer };
}

function setup(options: { holds?: () => boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "omb-teach-"));
  roots.push(dir);
  const evidence = new BrowserEvidence({ root: join(dir, "evidence") });
  const recorder = new TeachRecorder({ evidence, sleep: async () => {}, settleMs: 0 });
  const { state, computer } = fakeComputer();
  const holds = options.holds ?? (() => true);
  const start = () => recorder.start({ key: "vm-ada", botId: "ada", threadId: "thread-1", leaseId: LEASE, desktop: "Ada's Linux desktop", computer, holds });
  const record = (recordingId: string, events: TeachEvent[]) => recorder.record({ key: "vm-ada", recordingId, leaseId: LEASE, events });
  const stop = (recordingId: string, goal?: string) => recorder.stop({ key: "vm-ada", recordingId, leaseId: LEASE, ...(goal ? { goal } : {}) });
  return { evidence, recorder, state, start, record, stop };
}

describe("teach events from the viewer", () => {
  it("accepts clicks, keys, scrolls and typed text, and rejects anything else", () => {
    expect(parseTeachEvents([
      { kind: "click", x: 10.4, y: 20, button: "left", double: true },
      { kind: "typing" },
      { kind: "type", text: "hello" },
      { kind: "key", key: "Tab", modifiers: ["shift", "shift"] },
      { kind: "scroll", x: 1, y: 2, dx: 0, dy: 3 },
    ])).toEqual([
      { kind: "click", x: 10, y: 20, button: "left", double: true },
      { kind: "typing" },
      { kind: "type", text: "hello" },
      { kind: "key", key: "Tab", modifiers: ["shift"] },
      { kind: "scroll", x: 1, y: 2, dx: 0, dy: 3 },
    ]);
    expect(parseTeachEvents([{ kind: "click", x: "1", y: 2, button: "left" }])).toBeNull();
    expect(parseTeachEvents([{ kind: "key", key: "rm -rf /", modifiers: [] }])).toBeNull();
    expect(parseTeachEvents([{ kind: "key", key: "a", modifiers: ["hyper"] }])).toBeNull();
    expect(parseTeachEvents([{ kind: "type", text: "" }])).toBeNull();
    expect(parseTeachEvents([{ kind: "type", text: "x".repeat(2001) }])).toBeNull();
    expect(parseTeachEvents([{ kind: "eval", code: "1" }])).toBeNull();
    expect(parseTeachEvents(Array.from({ length: 51 }, () => ({ kind: "typing" })))).toBeNull();
    expect(parseTeachEvents("click")).toBeNull();
  });
});

describe("recording the owner's steps", () => {
  it("keeps each step with what was clicked and an after-screenshot, as one generation of the conversation's evidence", async () => {
    const { evidence, start, record, stop, state } = setup();
    const { recordingId } = await start();
    expect(recordingId).toMatch(/^teach-[0-9a-f-]{36}$/u);
    record(recordingId, [{ kind: "click", x: 40, y: 50, button: "left", double: false }]);
    record(recordingId, [{ kind: "scroll", x: 40, y: 50, dx: 0, dy: 3 }, { kind: "key", key: "s", modifiers: ["ctrl"] }]);
    const result = await stop(recordingId);
    expect(result.desktop).toBe("Ada's Linux desktop");
    expect(result.steps.map((step) => [step.action, step.summary])).toEqual([
      ["start", "Start in Firefox — \"Invoices\""],
      ["click", "Click \"Export\" (push button) in Firefox — \"Invoices\" at (40, 50)"],
      ["scroll", expect.stringContaining("down 3")],
      ["key", "Press Ctrl+S"],
    ]);
    expect(state.screenshots).toBe(4);
    const listed = evidence.list("thread-1", { generation: recordingId }).steps;
    expect(listed).toHaveLength(4);
    expect(listed[1]).toMatchObject({ source: "teach", botId: "ada", action: "click", x: 40, y: 50 });
    expect(listed[1]!.imageUrl).toMatch(/step-\d+\.png$/u);
    const dir = join(evidence.root, "thread-1", recordingId);
    expect(readdirSync(dir).filter((file) => file.endsWith(".png"))).toHaveLength(4);
    if (posix) {
      expect(statSync(dir).mode & 0o777).toBe(0o700);
      for (const file of readdirSync(dir)) expect(statSync(join(dir, file)).mode & 0o777).toBe(0o600);
    }
  });

  it("keeps text typed into an ordinary field", async () => {
    const { start, record, stop } = setup();
    const { recordingId } = await start();
    record(recordingId, [{ kind: "typing" }]);
    record(recordingId, [{ kind: "type", text: "march invoices" }]);
    const { steps, prompt } = await stop(recordingId);
    expect(steps[1]).toMatchObject({ action: "type", summary: "Type \"march invoices\" into \"Search\" (text)" });
    expect(steps[1]!.hidden).toBeUndefined();
    expect(prompt).toContain("march invoices");
  });

  it("never keeps text typed into a password field, nor its length", async () => {
    const { evidence, start, record, stop, state } = setup();
    state.focus = { role: "password text", label: "Password" };
    const { recordingId } = await start();
    record(recordingId, [{ kind: "typing" }, { kind: "type", text: "hunter2-secret" }]);
    const { steps, prompt } = await stop(recordingId);
    expect(steps[1]).toMatchObject({ action: "type", hidden: true });
    expect(steps[1]!.summary).toContain("hidden");
    expect(prompt).not.toContain("hunter2");
    const stored = readFileSync(join(evidence.root, "thread-1", recordingId, "steps.jsonl"), "utf8");
    expect(stored).not.toContain("hunter2");
    const typed = JSON.parse(stored.trim().split("\n")[1]!) as Record<string, unknown>;
    expect(Object.keys(typed).sort()).toEqual(["action", "at", "botId", "generation", "hidden", "image", "source", "step", "summary", "threadId", "v"]);
  });

  it("hides typed text when the focused field cannot be read", async () => {
    const { start, record, stop, state } = setup();
    state.focus = undefined;
    const { recordingId } = await start();
    record(recordingId, [{ kind: "typing" }, { kind: "type", text: "maybe-secret" }]);
    const { steps } = await stop(recordingId);
    expect(steps[1]).toMatchObject({ hidden: true });
    expect(JSON.stringify(steps)).not.toContain("maybe-secret");
  });

  it("hides typed text when focus moved before the field was checked", async () => {
    const { start, record, stop, state } = setup();
    const { recordingId } = await start();
    // Tab arrives in the same batch after the first keystroke: the check may have seen the next field.
    record(recordingId, [{ kind: "typing" }, { kind: "key", key: "Tab", modifiers: [] }, { kind: "type", text: "alice" }]);
    // A click arrives in a later batch while the check is still running.
    state.inspectDelay = 20;
    record(recordingId, [{ kind: "typing" }]);
    record(recordingId, [{ kind: "click", x: 1, y: 1, button: "left", double: false }, { kind: "type", text: "s3cret" }]);
    const { steps } = await stop(recordingId);
    const typed = steps.filter((step) => step.action === "type");
    expect(typed).toHaveLength(2);
    for (const step of typed) expect(step.hidden).toBe(true);
    expect(JSON.stringify(steps)).not.toMatch(/alice|s3cret/u);
  });

  it("stops taking steps once control is lost, but can still be stopped", async () => {
    let holding = true;
    const { start, record, stop } = setup({ holds: () => holding });
    const { recordingId } = await start();
    record(recordingId, [{ kind: "click", x: 1, y: 1, button: "left", double: false }]);
    holding = false;
    expect(() => record(recordingId, [{ kind: "key", key: "Enter", modifiers: [] }])).toThrow(expect.objectContaining({ status: 409 }));
    const { steps } = await stop(recordingId);
    expect(steps.map((step) => step.action)).toEqual(["start", "click"]);
  });

  it("refuses to start without control, and refuses a second recording on the same computer", async () => {
    const lost = setup({ holds: () => false });
    await expect(lost.start()).rejects.toMatchObject({ status: 409 });
    const { start } = setup();
    await start();
    await expect(start()).rejects.toMatchObject({ status: 409 });
  });

  it("refuses steps for another recording or lease", async () => {
    const { start, recorder } = setup();
    const { recordingId } = await start();
    expect(() => recorder.record({ key: "vm-ada", recordingId, leaseId: "other-lease-0123456789", events: [] })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => recorder.record({ key: "vm-ada", recordingId: "teach-00000000-0000-0000-0000-000000000000", leaseId: LEASE, events: [] })).toThrow(expect.objectContaining({ status: 404 }));
  });

  it("discarding deletes the recording's steps and screenshots", async () => {
    const { evidence, start, record, stop, recorder } = setup();
    const { recordingId } = await start();
    record(recordingId, [{ kind: "click", x: 1, y: 1, button: "left", double: false }]);
    await stop(recordingId);
    const dir = join(evidence.root, "thread-1", recordingId);
    expect(existsSync(dir)).toBe(true);
    await recorder.discard({ key: "vm-ada", recordingId, leaseId: LEASE, threadId: "thread-1" });
    expect(existsSync(dir)).toBe(false);
    expect(evidence.list("thread-1").steps).toHaveLength(0);
  });
});

describe("the request handed to skill authoring", () => {
  it("is a Teach a task request with the goal and numbered steps, asking for hidden text instead of guessing", () => {
    const prompt = teachPrompt({
      goal: "  Export   last month's invoices ",
      desktop: "Ada's Linux desktop",
      steps: [
        { step: 1, action: "start", summary: "Start in Firefox", image: null },
        { step: 2, action: "click", summary: "Click \"Export\"", image: null },
        { step: 3, action: "type", summary: "Type hidden text", hidden: true, image: null },
      ],
    });
    expect(prompt.startsWith(`${SAVE_RUN_AS_SKILL_LINE}\n`)).toBe(true);
    expect(prompt).toContain("Goal: Export last month's invoices\n");
    expect(prompt).toContain("Ada's Linux desktop");
    expect(prompt).toContain("1. Click \"Export\"\n2. Type hidden text");
    expect(prompt).not.toContain("Start in Firefox");
  });
});

describe("reading the desktop around a step", () => {
  it("finds the focused window's app, the focused field and the smallest element under the point", async () => {
    const calls: string[] = [];
    const context = await inspectDesktop(async (tool) => {
      calls.push(tool);
      if (tool === "list_windows") {
        return { structuredContent: { windows: [
          { pid: 1, window_id: 7, app_name: "Files", title: "Home" },
          { pid: 2, window_id: 9, app_name: "Firefox", title: "Login", is_focused: true },
        ] } };
      }
      return { elements: [
        { role: "frame", name: "Login", bounds: [0, 0, 800, 600] },
        { role: "password text", name: "Password", states: ["focused", "editable"], frame: { x: 10, y: 10, width: 200, height: 30 } },
        { role: "push button", name: "Sign in", rect: { left: 10, top: 50, w: 80, h: 30 } },
      ] };
    }, { x: 20, y: 60 });
    expect(calls).toEqual(["list_windows", "get_window_state"]);
    expect(context).toEqual({
      app: "Firefox",
      window: "Login",
      focused: { role: "password text", label: "Password" },
      hit: { role: "push button", label: "Sign in" },
    });
  });

  it("answers nothing when the driver returns nothing it understands", async () => {
    expect(await inspectDesktop(async () => null)).toBeNull();
    expect(await inspectDesktop(async () => ({ windows: "none" }))).toBeNull();
  });
});
