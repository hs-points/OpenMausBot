import { describe, expect, it, vi } from "vitest";
import { onTeachRecordingRequest, requestTeachRecording, takeTeachRecordingRequest, teachRecordingRequested } from "./teach-request";

describe("the composer's request to record a task", () => {
  it("waits for the bot's screen card, which takes it once", () => {
    requestTeachRecording("ada", 1_000);
    expect(teachRecordingRequested("ada", 2_000)).toBe(true);
    expect(teachRecordingRequested("bea", 2_000)).toBe(false);
    expect(takeTeachRecordingRequest("ada", 2_000)).toBe(true);
    expect(takeTeachRecordingRequest("ada", 2_000)).toBe(false);
  });

  it("lapses when nobody takes it in time", () => {
    requestTeachRecording("ada", 1_000);
    expect(teachRecordingRequested("ada", 1_000 + 120_001)).toBe(false);
    expect(takeTeachRecordingRequest("ada", 1_000 + 1)).toBe(false);
  });

  it("tells listeners a request arrived, until they stop listening", () => {
    const listener = vi.fn();
    const stop = onTeachRecordingRequest(listener);
    requestTeachRecording("ada");
    stop();
    requestTeachRecording("ada");
    expect(listener).toHaveBeenCalledTimes(1);
    takeTeachRecordingRequest("ada");
  });
});
