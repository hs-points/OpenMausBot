// Turns the person's own input on the live desktop into teach events. It only watches: the viewer still sends every
// key and click to the computer as before. Coordinates are the remote screen's pixels.
export type TeachModifier = "ctrl" | "alt" | "shift" | "meta";
export type TeachEvent =
  | { kind: "click"; x: number; y: number; button: "left" | "middle" | "right"; double: boolean }
  | { kind: "typing" }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string; modifiers: TeachModifier[] }
  | { kind: "scroll"; x: number; y: number; dx: number; dy: number };

const DOUBLE_MS = 350;
const DOUBLE_PX = 6;
const TEXT_IDLE_MS = 1_500;
const SCROLL_MS = 400;
const TEXT_CHARS = 2_000;
const KEY_NAME = /^[A-Za-z0-9][\w+-]{0,23}$/u;
const LONE_MODIFIERS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "OS", "Super", "Hyper", "Fn"]);
const BUTTONS = ["left", "middle", "right"] as const;

export function modifiersOf(event: Pick<KeyboardEvent, "ctrlKey" | "altKey" | "shiftKey" | "metaKey">): TeachModifier[] {
  const out: TeachModifier[] = [];
  if (event.ctrlKey) out.push("ctrl");
  if (event.altKey) out.push("alt");
  if (event.shiftKey) out.push("shift");
  if (event.metaKey) out.push("meta");
  return out;
}

/** The remote-screen pixel under a pointer, or null outside the drawn screen. */
export function remotePoint(canvas: HTMLCanvasElement, clientX: number, clientY: number): { x: number; y: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height || !canvas.width || !canvas.height) return null;
  const x = Math.round((clientX - rect.left) * canvas.width / rect.width);
  const y = Math.round((clientY - rect.top) * canvas.height / rect.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
  return { x, y };
}

/** Text typed through the viewer's own text box rather than key by key. */
export const typedEvents = (text: string): TeachEvent[] => text ? [{ kind: "typing" }, { kind: "type", text: text.slice(0, TEXT_CHARS) }] : [];

export function captureTeachInput(screen: HTMLElement, emit: (events: TeachEvent[]) => void): { flush(): void; stop(): void } {
  let text = "";
  let textTimer: ReturnType<typeof setTimeout> | undefined;
  let click: { x: number; y: number; button: number; at: number } | null = null;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;
  let scroll: { x: number; y: number; dx: number; dy: number } | null = null;
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;

  const canvas = () => screen.querySelector("canvas");

  const flushClick = () => {
    clearTimeout(clickTimer);
    if (!click) return;
    const { x, y, button } = click;
    click = null;
    emit([{ kind: "click", x, y, button: BUTTONS[button] ?? "left", double: false }]);
  };
  const flushText = () => {
    clearTimeout(textTimer);
    if (!text) return;
    const typed = text;
    text = "";
    emit([{ kind: "type", text: typed }]);
  };
  const flushScroll = () => {
    clearTimeout(scrollTimer);
    if (!scroll) return;
    const { x, y, dx, dy } = scroll;
    scroll = null;
    if (dx || dy) emit([{ kind: "scroll", x, y, dx, dy }]);
  };
  const flush = () => {
    flushClick();
    flushText();
    flushScroll();
  };

  const onPointerDown = (event: PointerEvent) => {
    const surface = canvas();
    if (!surface || event.button > 2) return;
    const point = remotePoint(surface, event.clientX, event.clientY);
    if (!point) return;
    flushText();
    flushScroll();
    const now = event.timeStamp;
    if (click && click.button === event.button && event.button === 0 && now - click.at <= DOUBLE_MS
      && Math.abs(click.x - point.x) <= DOUBLE_PX && Math.abs(click.y - point.y) <= DOUBLE_PX) {
      clearTimeout(clickTimer);
      click = null;
      emit([{ kind: "click", ...point, button: "left", double: true }]);
      return;
    }
    flushClick();
    click = { ...point, button: event.button, at: now };
    clickTimer = setTimeout(flushClick, DOUBLE_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.isComposing || LONE_MODIFIERS.has(event.key)) return;
    const modifiers = modifiersOf(event);
    const printable = [...event.key].length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey;
    flushClick();
    flushScroll();
    if (printable) {
      if (!text) emit([{ kind: "typing" }]);
      if (text.length < TEXT_CHARS) text += event.key;
      clearTimeout(textTimer);
      textTimer = setTimeout(flushText, TEXT_IDLE_MS);
      return;
    }
    if (event.key === "Backspace" && text && !modifiers.length) {
      text = [...text].slice(0, -1).join("");
      clearTimeout(textTimer);
      textTimer = setTimeout(flushText, TEXT_IDLE_MS);
      return;
    }
    const name = KEY_NAME.test(event.key) ? event.key : KEY_NAME.test(event.code) ? event.code : null;
    if (!name) return;
    flushText();
    emit([{ kind: "key", key: name, modifiers }]);
  };

  const onWheel = (event: WheelEvent) => {
    const surface = canvas();
    if (!surface) return;
    const point = remotePoint(surface, event.clientX, event.clientY);
    if (!point) return;
    flushClick();
    flushText();
    const ticks = (delta: number) => delta === 0 ? 0 : Math.sign(delta) * Math.max(1, Math.round(Math.abs(delta) / (event.deltaMode === 0 ? 100 : 3)));
    scroll ??= { ...point, dx: 0, dy: 0 };
    scroll.dx += ticks(event.deltaX);
    scroll.dy += ticks(event.deltaY);
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(flushScroll, SCROLL_MS);
  };

  screen.addEventListener("pointerdown", onPointerDown, true);
  screen.addEventListener("keydown", onKeyDown, true);
  screen.addEventListener("wheel", onWheel, { capture: true, passive: true });
  return {
    flush,
    stop: () => {
      flush();
      screen.removeEventListener("pointerdown", onPointerDown, true);
      screen.removeEventListener("keydown", onKeyDown, true);
      screen.removeEventListener("wheel", onWheel, true);
    },
  };
}
