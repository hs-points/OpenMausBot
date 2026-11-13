import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { parseHspSlack } from "@/lib/hsp-slack";

const dispatch = vi.hoisted(() => vi.fn());
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: [] }, dispatch }),
}));
vi.mock("./Avatar", () => ({ BotAvatar: () => null }));

const { HspSlackSettings } = await import("./HspSlackSettings");

const NOW = Date.parse("2026-11-07T09:00:00Z");
const response = (bridge: unknown) => parseHspSlack({
  configured: true,
  bridge,
  bots: [
    { botId: "milo", name: "Milo", slack: { connected: true, lastMessageAt: "2026-11-07T08:30:00Z", channels: [{ id: "C1", name: "ops" }],
      today: { handled: 7, refused: 1 }, errors: [{ at: "2026-11-07T08:00:00Z", code: "x", text: "Slack refused a reply." }] },
      people: [{ email: "a@x.test", name: "Ada", why: "admin" }, { email: "b@x.test", name: "Bob", why: "chat" }] },
    { botId: "ivy", name: "Ivy", slack: { connected: false, lastMessageAt: null, channels: [], today: { handled: 0, refused: 0 }, errors: [] }, people: [] },
  ],
})!;
const reporting = { reporting: true, startedAt: "2026-11-07T07:00:00Z", updatedAt: "2026-11-07T08:59:30Z" };
const render = (bridge: unknown) => renderToStaticMarkup(createElement(HspSlackSettings, { data: response(bridge), now: NOW }));

describe("Slack settings page", () => {
  it("shows the summary and one row per bot", () => {
    const html = render(reporting);
    expect(html).toContain("1 of 2 connected");
    expect(html).toContain("Bridge running since");
    expect(html).toContain("Today: 7 messages, 1 refused");
    expect(html).not.toContain("Bridge not reporting");
    expect(html.match(/data-slack-bot=/g)).toHaveLength(2);
    expect(html).toContain("Ada (admin), Bob (chat)");
    expect(html).toContain("Manage in sharing");
    expect(html).toContain("Direct messages, #ops");
    expect(html).toContain("30 min ago");
    expect(html).toContain("1 (newest: Slack refused a reply.)");
    expect(html).toContain("Connected");
    expect(html).toContain("Not connected");
    expect(html).toContain("/invite @Milo");
    expect(html).toContain("within a minute");
  });

  it("says the bridge is not reporting when it is missing or stale", () => {
    for (const bridge of [null, { ...reporting, reporting: false }]) {
      const html = render(bridge);
      expect(html).toContain("Bridge not reporting");
      expect(html).not.toContain("Bridge running since");
      expect(html).not.toContain("Today:");
      expect(html.match(/data-slack-bot=/g)).toHaveLength(2);
    }
  });
});
