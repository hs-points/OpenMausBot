// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./ModelPicker", () => ({ ModelPicker: () => null }));
vi.mock("./ApprovalModeSelector", () => ({ ApprovalModeSelector: () => null }));

const { ChatView } = await import("./ChatView");
const { BotEditorStore, initialState } = await import("@/state/store");
const at = 1_700_000_000_000;
const message = (id: string, fields: Partial<Message>): Message => ({ id, role: "bot", kind: "text", at, ...fields });

describe("recorded call in ChatView", () => {
  it("opens the hidden conversation from its record, including a late answer", () => {
    const spoken = message("spoken", { role: "user", text: "Check the build", via: "call", callId: "call" });
    const record = message("record", { kind: "call", call: {
      callId: "call", botId: "pepper", client: "desktop", startedAt: at, endedAt: at + 42_000, seconds: 42, endReason: "hung-up",
    } });
    const bot: Bot = {
      id: "pepper", threadId: "fixture-thread", name: "Pepper", title: "", description: "", color: "green",
      notifications: true, unread: false, busy: false, modelSelection: { instanceId: "test", model: "fixture" },
      messages: [message("typed", { role: "user", text: "Keep this typed message" }), spoken,
        message("answer", { text: "The build passed.", requestMessageId: spoken.id }), record],
    };
    const state = { ...initialState, bots: [bot], instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo] };
    const value = { state, dispatch: vi.fn(), flushBotPatches: async () => null, refreshInstances: async () => {}, refreshModels: async () => {} };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const draw = () => flushSync(() => root.render(createElement(BotEditorStore, { value, children: createElement(ChatView, { bot: { ...bot } }) })));
    try {
      draw();
      const chat = () => host.querySelector('[role="log"]')!;
      expect(chat().textContent).toContain("Keep this typed message");
      expect(chat().textContent).not.toContain("Check the build");
      expect(chat().textContent).not.toContain("The build passed.");
      flushSync(() => host.querySelector<HTMLButtonElement>('[data-testid="call-record"] button')!.click());
      const sheet = () => document.querySelector('[data-testid="call-sheet"]')!;
      expect(sheet().textContent).toContain("Check the build");
      expect(sheet().textContent).toContain("The build passed.");
      expect(sheet().textContent).not.toContain("Keep this typed message");
      bot.messages = [...bot.messages, message("late", { text: "The report is ready.", requestMessageId: spoken.id })];
      draw();
      expect(chat().textContent).not.toContain("The report is ready.");
      expect(sheet().textContent).toContain("The report is ready.");
      flushSync(() => sheet().querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
      expect(document.querySelector('[data-testid="call-sheet"]')).toBeNull();
    } finally {
      flushSync(() => root.unmount());
      host.remove();
    }
  });
});
