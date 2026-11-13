// @vitest-environment happy-dom
// Teach on computer over the live desktop, with the server played by the test.
import { createElement, createRef } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SAVE_RUN_AS_SKILL_LINE } from "../../shared/learn-request";

const fixture = vi.hoisted(() => ({
  posts: [] as Array<{ action: string; body: Record<string, unknown> }>,
  refuseEvents: false,
}));
vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/state/store")>();
  return {
    ...actual,
    api: async (path: string, init?: RequestInit) => {
      const action = path.split("/").at(-1)!;
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      fixture.posts.push({ action, body });
      if (action === "start") return { recordingId: "teach-00000000-0000-4000-8000-000000000000" };
      if (action === "events") {
        if (fixture.refuseEvents) throw new actual.ApiError("Recording stopped", 409);
        return { accepted: (body.events as unknown[]).length };
      }
      if (action === "stop") {
        return {
          desktop: "Ada's Linux desktop",
          steps: [
            { step: 1, action: "start", summary: "Start in Firefox", image: null },
            { step: 2, action: "click", summary: "Click \"Go\" (push button) in Firefox at (200, 200)", image: null },
            { step: 3, action: "type", summary: "Type hidden text into \"Password\" (password text)", hidden: true, image: null },
          ],
        };
      }
      return { discarded: true };
    },
  };
});

const { TeachOnComputer } = await import("./TeachOnComputer");
let root: Root;
let screen: HTMLDivElement;
let session: { botId: string; botName: string; computer?: "vm" | "vps"; leaseId: () => string | null; onTeach: ReturnType<typeof vi.fn<(prompt: string) => void>>; onClose: ReturnType<typeof vi.fn<() => void>> };
const typedSink = { current: null as ((text: string) => void) | null };
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };
const button = (label: string) => [...document.querySelectorAll("button")].find((candidate) => candidate.textContent?.trim() === label);
const click = async (label: string) => {
  const target = button(label);
  if (!target) throw new Error(`no button ${label}`);
  flushSync(() => target.click());
  await settle();
};
const draw = (connected = true) => {
  const ref = createRef<HTMLDivElement>() as { current: HTMLDivElement | null };
  ref.current = screen;
  flushSync(() => root.render(createElement(TeachOnComputer, { session, screen: ref, typedSink, connected })));
};

beforeEach(() => {
  fixture.posts = [];
  fixture.refuseEvents = false;
  typedSink.current = null;
  screen = document.createElement("div");
  const canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 800;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 640, height: 400, right: 640, bottom: 400, x: 0, y: 0, toJSON() {} }) as DOMRect;
  screen.append(canvas);
  const container = document.createElement("div");
  document.body.append(screen, container);
  root = createRoot(container);
  session = { botId: "ada", botName: "Ada", leaseId: () => "lease-0123456789abcdef", onTeach: vi.fn<(prompt: string) => void>(), onClose: vi.fn<() => void>() };
  draw();
});
afterEach(() => {
  root.unmount();
  document.body.innerHTML = "";
});

describe("teach on computer", () => {
  it("offers to record, records, and sends the reviewed steps to the bot", async () => {
    expect(document.querySelector("[data-teach=banner]")?.textContent).toContain("Record yourself doing a task. Ada learns the steps and can run them again on its own.");
    await click("Start recording");
    expect(fixture.posts[0]).toEqual({ action: "start", body: { controlLeaseId: "lease-0123456789abcdef" } });
    const pill = document.querySelector("[data-teach=recording]");
    expect(pill?.textContent).toContain("You're in control");
    expect(pill?.textContent).toContain("0 steps");

    const canvas = screen.querySelector("canvas")!;
    canvas.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    typedSink.current?.("invoices");
    await settle();
    expect(document.querySelector("[data-teach=recording]")?.textContent).toContain("2 steps");

    await click("Stop");
    const events = fixture.posts.filter((post) => post.action === "events").flatMap((post) => post.body.events as unknown[]);
    expect(events).toEqual([{ kind: "key", key: "Enter", modifiers: [] }, { kind: "typing" }, { kind: "type", text: "invoices" }]);
    expect(fixture.posts.at(-1)).toMatchObject({ action: "stop", body: { recordingId: "teach-00000000-0000-4000-8000-000000000000" } });
    expect(typedSink.current).toBeNull();

    const review = document.querySelector("[data-teach=review]")!;
    expect(review.querySelectorAll("li")).toHaveLength(2);
    expect(review.textContent).not.toContain("Start in Firefox");
    const goal = review.querySelector("input")!;
    flushSync(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(goal, "Log in to the portal");
      goal.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Teach Ada");
    expect(session.onTeach).toHaveBeenCalledTimes(1);
    const prompt = session.onTeach.mock.calls[0]![0] as string;
    expect(prompt.startsWith(SAVE_RUN_AS_SKILL_LINE)).toBe(true);
    expect(prompt).toContain("Goal: Log in to the portal");
    expect(prompt).toContain("Ada's Linux desktop");
  });

  it("can't start until the desktop is connected, and Not now closes", async () => {
    draw(false);
    expect(button("Start recording")?.disabled).toBe(true);
    await click("Not now");
    expect(session.onClose).toHaveBeenCalled();
    expect(fixture.posts).toEqual([]);
  });

  it("needs this view to hold control", async () => {
    session.leaseId = () => null;
    draw();
    await click("Start recording");
    expect(document.querySelector("[role=alert]")?.textContent).toBeTruthy();
    expect(fixture.posts).toEqual([]);
  });

  it("says so when control is lost mid-recording, and still lets the steps be kept or discarded", async () => {
    await click("Start recording");
    fixture.refuseEvents = true;
    screen.querySelector("canvas")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await settle();
    expect(document.querySelector("[data-teach=recording] [role=alert]")).not.toBeNull();
    await click("Stop");
    await click("Discard");
    expect(fixture.posts.at(-1)).toMatchObject({ action: "discard", body: { controlLeaseId: "lease-0123456789abcdef" } });
    expect(session.onClose).toHaveBeenCalled();
  });

  it("discards a recording left mid-way", async () => {
    await click("Start recording");
    root.unmount();
    await settle();
    expect(fixture.posts.at(-1)?.action).toBe("discard");
    root = createRoot(document.createElement("div"));
  });

  it("names the self-hosted VPS desktop on every call, including the discard on leaving", async () => {
    session.computer = "vps";
    draw();
    await click("Start recording");
    screen.querySelector("canvas")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await settle();
    root.unmount();
    await settle();
    expect(fixture.posts.map((post) => [post.action, post.body.computer])).toEqual([["start", "vps"], ["events", "vps"], ["discard", "vps"]]);
    root = createRoot(document.createElement("div"));
  });
});
