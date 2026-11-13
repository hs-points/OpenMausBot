import { describe, expect, it } from "vitest";
import type { InstanceInfo } from "@/state/store";
import { placeFacts } from "./place-view";
import { placeState } from "../../shared/place-view";

const bot = { name: "Riya", modelSelection: { instanceId: "codex-1", model: "gpt-6.1-sol" }, toolScope: undefined, cloudBackend: "vps" } as never;
const seat = { server: "remote", plan: null, role: "member", mode: "team" } as never;
const config = { box: { configured: false, included: false } } as never;

describe("placeFacts for a member who cannot see the engine list", () => {
  it("does not call a vps bot unable to use a desktop", () => {
    const view = placeState(placeFacts({ bot, place: "cloud", seat, config, instances: [] }));
    expect(view.state).not.toBe("cc-cannot");
  });
  it("still says so when an admin sees the engine has no desktop", () => {
    const instances = [{ instanceId: "codex-1", displayName: "Codex", capabilities: { computerMcp: false } }] as unknown as InstanceInfo[];
    const view = placeState(placeFacts({ bot, place: "cloud", seat, config, instances }));
    expect(view.state).toBe("cc-cannot");
  });
});
