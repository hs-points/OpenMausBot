// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({ ...await importOriginal<typeof import("@/state/store")>(), api: server.api }));

const { parseHspSlack, parseSlackDeepLink, recentSlackErrors, slackSummary, useHspSlack, useSlackDeepLink } = await import("./hsp-slack");
type HspSlackState = import("./hsp-slack").HspSlackState;

const answer = {
  configured: true,
  bridge: { reporting: true, startedAt: "2026-11-07T08:00:00Z", updatedAt: "2026-11-07T09:00:00Z" },
  bots: [
    { botId: "milo", name: "Milo", slack: { appId: "A1", teamId: "T1", connected: true, connectedAt: "x", lastMessageAt: "2026-11-07T08:59:00Z",
      channels: [{ id: "C1", name: "ops" }], today: { handled: 7, refused: 1 },
      errors: [{ at: "2026-11-07T08:00:00Z", code: "x", text: "Newer" }, { at: "2026-11-05T08:00:00Z", code: "y", text: "Old" }] },
      people: [{ email: "a@x.test", name: "Ada", why: "admin" }] },
    { botId: "ivy", name: "Ivy", slack: { connected: false, channels: [], today: { handled: 2, refused: 0 }, errors: [] }, people: [] },
  ],
};

describe("parseHspSlack", () => {
  it("reads the contract and is null unless configured", () => {
    const data = parseHspSlack(answer)!;
    expect(data.bots.map((bot) => bot.name)).toEqual(["Milo", "Ivy"]);
    expect(data.bots[1]!.slack.lastMessageAt).toBeNull();
    expect(slackSummary(data)).toEqual({ connected: 1, total: 2, handled: 9, refused: 1 });
    expect(parseHspSlack({ configured: false })).toBeNull();
    expect(parseHspSlack(null)).toBeNull();
    expect(parseHspSlack({ configured: true, bridge: null, bots: "nope" })).toEqual({ bridge: null, bots: [] });
  });

  it("keeps only the past 24 hours of errors, newest first", () => {
    const milo = parseHspSlack(answer)!.bots[0]!;
    expect(recentSlackErrors(milo, Date.parse("2026-11-07T09:00:00Z")).map((error) => error.text)).toEqual(["Newer"]);
  });
});

describe("parseSlackDeepLink", () => {
  it("accepts the two Slack links and ignores everything else", () => {
    expect(parseSlackDeepLink("#settings=slack")).toEqual({ type: "toggleAppSettings", open: true, section: "slack" });
    expect(parseSlackDeepLink("#bot=milo&settings=slack")).toEqual({ type: "toggleSettings", open: true, section: "slack", botId: "milo" });
    for (const hash of ["", "#", "#settings=people", "#settings=slack2", "#bot=milo", "#bot=&settings=slack", "#code=abc", "#signin=omb_pair_x"])
      expect(parseSlackDeepLink(hash), hash).toBeNull();
  });
});

let host: HTMLDivElement;
const settle = async () => { for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

beforeEach(() => {
  host = document.createElement("div");
  server.api.mockReset();
  window.history.replaceState(null, "", "/");
});
afterEach(() => { host.remove(); });

describe("useHspSlack", () => {
  const seen: HspSlackState[] = [];
  const Probe = ({ enabled }: { enabled: boolean }) => { seen.push(useHspSlack(enabled)); return null; };
  const mount = async (enabled: boolean) => {
    seen.length = 0;
    flushSync(() => createRoot(host).render(createElement(Probe, { enabled })));
    await settle();
    return seen.at(-1)!;
  };

  it("is ready for a configured answer", async () => {
    server.api.mockResolvedValue(answer);
    expect((await mount(true)).status).toBe("ready");
    expect(server.api.mock.calls[0]![0]).toBe("/api/hsp/slack");
  });

  it("is hidden for configured:false, 403, 404 and errors, and never asks when not enabled", async () => {
    server.api.mockResolvedValue({ configured: false });
    expect((await mount(true)).status).toBe("hidden");
    for (const status of [403, 404, 500]) {
      host = document.createElement("div");
      server.api.mockRejectedValue(Object.assign(new Error("no"), { status }));
      expect((await mount(true)).status, String(status)).toBe("hidden");
    }
    server.api.mockClear();
    host = document.createElement("div");
    expect((await mount(false)).status).toBe("hidden");
    expect(server.api).not.toHaveBeenCalled();
  });
});

describe("useSlackDeepLink", () => {
  const dispatch = vi.fn();
  const Probe = ({ bots }: { bots: Array<{ id: string }> }) => { useSlackDeepLink(dispatch, bots); return null; };
  const mount = (bots: Array<{ id: string }>) => {
    dispatch.mockClear();
    const root = createRoot(host);
    flushSync(() => root.render(createElement(Probe, { bots })));
    return root;
  };

  it("opens team Slack settings on load and clears the hash", () => {
    window.history.replaceState(null, "", "/#settings=slack");
    mount([]);
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleAppSettings", open: true, section: "slack" });
    expect(window.location.hash).toBe("");
  });

  it("opens a bot's Slack tab once that bot has loaded, and on hashchange", async () => {
    window.history.replaceState(null, "", "/#bot=milo&settings=slack");
    const root = mount([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#bot=milo&settings=slack");
    flushSync(() => root.render(createElement(Probe, { bots: [{ id: "milo" }] })));
    expect(dispatch).toHaveBeenCalledWith({ type: "toggleSettings", open: true, section: "slack", botId: "milo" });
    expect(window.location.hash).toBe("");
    dispatch.mockClear();
    window.location.hash = "#settings=slack";
    await settle();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("leaves unknown hashes alone", () => {
    window.history.replaceState(null, "", "/#settings=people");
    mount([]);
    expect(dispatch).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#settings=people");
  });
});
