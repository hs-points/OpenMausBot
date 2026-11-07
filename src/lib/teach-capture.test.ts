// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { captureTeachInput, remotePoint, typedEvents, type TeachEvent } from "./teach-capture";

let screen: HTMLDivElement;
let canvas: HTMLCanvasElement;
let events: TeachEvent[];
let capture: ReturnType<typeof captureTeachInput>;

beforeEach(() => {
  vi.useFakeTimers();
  screen = document.createElement("div");
  canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  // Drawn at half size, offset 10/20 on the page.
  canvas.getBoundingClientRect = () => ({ left: 10, top: 20, width: 640, height: 400, right: 650, bottom: 420, x: 10, y: 20, toJSON() {} }) as DOMRect;
  screen.append(canvas);
  document.body.append(screen);
  events = [];
  capture = captureTeachInput(screen, (batch) => events.push(...batch));
});
afterEach(() => {
  capture.stop();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const point = (clientX: number, clientY: number, button = 0, timeStamp = 0) => {
  const event = new PointerEvent("pointerdown", { clientX, clientY, button, bubbles: true });
  Object.defineProperty(event, "timeStamp", { value: timeStamp });
  canvas.dispatchEvent(event);
};
const wheel = (deltaY: number) => {
  const event = new WheelEvent("wheel", { deltaY, bubbles: true });
  Object.defineProperties(event, { clientX: { value: 110 }, clientY: { value: 120 } });
  canvas.dispatchEvent(event);
};
const key = (key: string, init: KeyboardEventInit = {}) => canvas.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));

describe("teach capture", () => {
  it("maps the pointer to the remote screen's pixels", () => {
    expect(remotePoint(canvas, 10, 20)).toEqual({ x: 0, y: 0 });
    expect(remotePoint(canvas, 330, 220)).toEqual({ x: 640, y: 400 });
    expect(remotePoint(canvas, 5, 20)).toBeNull();
    expect(remotePoint(canvas, 650, 420)).toBeNull();
    expect(remotePoint(canvas, Number.NaN, 20)).toBeNull();
  });

  it("reports a click once the double-click window has passed, and a double click as one step", () => {
    point(110, 120, 0, 1_000);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(400);
    expect(events).toEqual([{ kind: "click", x: 200, y: 200, button: "left", double: false }]);
    point(110, 120, 0, 2_000);
    point(111, 121, 0, 2_200);
    expect(events.at(-1)).toEqual({ kind: "click", x: 202, y: 202, button: "left", double: true });
    point(110, 120, 2, 3_000);
    capture.flush();
    expect(events.at(-1)).toMatchObject({ kind: "click", button: "right", double: false });
    expect(events).toHaveLength(3);
  });

  it("announces typing on the first key and reports the run when it ends", () => {
    key("h");
    expect(events).toEqual([{ kind: "typing" }]);
    key("i");
    key("x");
    key("Backspace");
    key("!", { shiftKey: true });
    key("Enter");
    expect(events).toEqual([{ kind: "typing" }, { kind: "type", text: "hi!" }, { kind: "key", key: "Enter", modifiers: [] }]);
  });

  it("ends a run after a pause, before a click and before a shortcut", () => {
    key("a");
    vi.advanceTimersByTime(1_600);
    expect(events).toEqual([{ kind: "typing" }, { kind: "type", text: "a" }]);
    key("b");
    point(110, 120, 0, 5_000);
    expect(events.slice(2)).toEqual([{ kind: "typing" }, { kind: "type", text: "b" }]);
    key("c", { ctrlKey: true });
    expect(events.at(-2)).toMatchObject({ kind: "click", double: false });
    expect(events.at(-1)).toEqual({ kind: "key", key: "c", modifiers: ["ctrl"] });
  });

  it("skips lone modifiers and keeps scrolls as wheel ticks", () => {
    key("Shift", { shiftKey: true });
    expect(events).toEqual([]);
    wheel(100);
    wheel(250);
    vi.advanceTimersByTime(500);
    expect(events).toEqual([{ kind: "scroll", x: 200, y: 200, dx: 0, dy: 4 }]);
  });

  it("stops watching once stopped", () => {
    capture.stop();
    key("a");
    point(110, 120);
    vi.advanceTimersByTime(2_000);
    expect(events).toEqual([]);
  });

  it("reports text from the viewer's text box as a typed run", () => {
    expect(typedEvents("")).toEqual([]);
    expect(typedEvents("hello")).toEqual([{ kind: "typing" }, { kind: "type", text: "hello" }]);
  });
});
