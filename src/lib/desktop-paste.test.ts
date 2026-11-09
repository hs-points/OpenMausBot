import { describe, expect, it } from "vitest";

import { isPasteShortcut, pasteKeyEvents, pasteOnDesktop } from "./desktop-paste";

const key = (over: Partial<KeyboardEvent>) => ({ code: "KeyV", key: "v", metaKey: false, ctrlKey: false, altKey: false, ...over });

describe("desktop paste", () => {
  it("knows the paste shortcut on each platform", () => {
    expect(isPasteShortcut(key({ metaKey: true }), true)).toBe(true);
    expect(isPasteShortcut(key({ metaKey: true, key: "V" }), true)).toBe(true);
    expect(isPasteShortcut(key({ ctrlKey: true }), true)).toBe(false);
    expect(isPasteShortcut(key({ ctrlKey: true }), false)).toBe(true);
    expect(isPasteShortcut(key({ metaKey: true }), false)).toBe(false);
    expect(isPasteShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false);
    expect(isPasteShortcut(key({ ctrlKey: true, code: "KeyC", key: "c" }), false)).toBe(false);
  });

  it("turns Cmd+V on a Mac into Ctrl+V on the remote, releasing what noVNC sent for Cmd", () => {
    expect(pasteKeyEvents({ mac: true, meta: true, ctrl: false })).toEqual([
      [0xffe9, "MetaLeft", false], [0xffeb, "MetaRight", false],
      [0xffe3, "ControlLeft", true], [0x76, "KeyV", true], [0x76, "KeyV", false], [0xffe3, "ControlLeft", false],
    ]);
  });

  it("only adds V when Ctrl is already held on the remote", () => {
    expect(pasteKeyEvents({ mac: false, meta: false, ctrl: true })).toEqual([[0x76, "KeyV", true], [0x76, "KeyV", false]]);
  });

  it("sets the remote clipboard before pressing the keys", () => {
    const calls: unknown[] = [];
    const client = { clipboardPasteFrom: (text: string) => calls.push(["clipboard", text]), sendKey: (...args: unknown[]) => calls.push(args) };
    pasteOnDesktop(client as never, "hello", { mac: false, meta: false, ctrl: false });
    expect(calls[0]).toEqual(["clipboard", "hello"]);
    expect(calls).toHaveLength(5);
  });
});
