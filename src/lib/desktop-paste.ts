// Paste from this computer into the remote desktop: Cmd+V / Ctrl+V (or the app's Paste menu) while the screen
// has focus sets the remote clipboard to the local text, then presses Ctrl+V there.
import type RFB from "@novnc/novnc";

const XK_CONTROL_L = 0xffe3;
const XK_ALT_L = 0xffe9;
const XK_SUPER_L = 0xffeb;
const XK_V = 0x0076;

type KeyEvent = [keysym: number, code: string, down: boolean];

/** The key events that paste on the remote. On a Mac, noVNC has already sent the held Cmd key as Alt_L (left)
 * or Super_L (right); both are released first so the remote sees Ctrl+V, not Alt+Ctrl+V. A held Shift stays held,
 * so Cmd+Shift+V becomes the terminal paste Ctrl+Shift+V. */
export function pasteKeyEvents(options: { mac: boolean; meta: boolean; ctrl: boolean }): KeyEvent[] {
  const events: KeyEvent[] = [];
  if (options.mac && options.meta) events.push([XK_ALT_L, "MetaLeft", false], [XK_SUPER_L, "MetaRight", false]);
  if (!options.ctrl) events.push([XK_CONTROL_L, "ControlLeft", true]);
  events.push([XK_V, "KeyV", true], [XK_V, "KeyV", false]);
  if (!options.ctrl) events.push([XK_CONTROL_L, "ControlLeft", false]);
  return events;
}

export function pasteOnDesktop(client: RFB, text: string, options: { mac: boolean; meta: boolean; ctrl: boolean }): void {
  client.clipboardPasteFrom(text);
  for (const [keysym, code, down] of pasteKeyEvents(options)) client.sendKey(keysym, code, down);
}

/** Paste shortcuts: Cmd+V on a Mac, Ctrl+V elsewhere, either with Shift; never with Alt/Option. */
export function isPasteShortcut(event: Pick<KeyboardEvent, "code" | "key" | "metaKey" | "ctrlKey" | "altKey">, mac: boolean): boolean {
  if (event.altKey || !(event.code === "KeyV" || event.key.toLowerCase() === "v")) return false;
  return mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
}

export const isMacPlatform = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent);

/**
 * Wires paste into the remote screen. The shortcut keydown is caught before noVNC (which would cancel it), so
 * the browser goes on to fire its own `paste` event with the local clipboard; the app's Paste menu fires the same
 * event. If no paste event comes (some browsers fire none on a canvas), the async clipboard API is tried, and
 * `unavailable` is called when that is refused too.
 */
export function attachDesktopPaste(screen: HTMLElement, client: () => RFB | null, unavailable: () => void): () => void {
  const mac = isMacPlatform();
  let held = { meta: false, ctrl: false };
  let fallback: ReturnType<typeof setTimeout> | undefined;
  const focused = () => screen.contains(document.activeElement);
  const send = (text: string) => {
    const rfb = client();
    if (rfb && text) pasteOnDesktop(rfb, text, { mac, ...held });
    held = { meta: false, ctrl: false };
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!focused() || !client() || !isPasteShortcut(event, mac)) return;
    event.stopPropagation();
    held = { meta: event.metaKey, ctrl: event.ctrlKey };
    clearTimeout(fallback);
    fallback = setTimeout(() => {
      fallback = undefined;
      if (!navigator.clipboard?.readText) return unavailable();
      navigator.clipboard.readText().then(send, unavailable);
    }, 300);
  };
  const onPaste = (event: ClipboardEvent) => {
    if (!focused() || !client()) return;
    event.preventDefault();
    clearTimeout(fallback);
    fallback = undefined;
    send(event.clipboardData?.getData("text/plain") ?? "");
  };
  window.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("paste", onPaste, true);
  return () => {
    clearTimeout(fallback);
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("paste", onPaste, true);
  };
}
