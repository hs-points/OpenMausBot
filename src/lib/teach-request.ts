// The composer's Teach a task records on the bot's Local VM, away from the screen card that owns taking control and
// the recording. The composer leaves a request here and opens the panel; the card takes it once that bot's desktop is
// live and drivable. The panel may mount after the request, so it waits here instead of passing through a listener,
// and a request nobody takes in time lapses: a stopped VM started much later does not begin recording on its own.
const REQUEST_TTL_MS = 120_000;
const requested = new Map<string, number>();
const listeners = new Set<() => void>();

export function requestTeachRecording(botId: string, now = Date.now()): void {
  requested.set(botId, now);
  for (const listener of Array.from(listeners)) listener();
}

/** Whether a recording is waiting for this bot; a lapsed request is dropped. */
export function teachRecordingRequested(botId: string, now = Date.now()): boolean {
  const at = requested.get(botId);
  if (at === undefined) return false;
  if (now - at <= REQUEST_TTL_MS) return true;
  requested.delete(botId);
  return false;
}

/** Takes the waiting request: true once, for the card that starts the recording. */
export function takeTeachRecordingRequest(botId: string, now = Date.now()): boolean {
  const live = teachRecordingRequested(botId, now);
  requested.delete(botId);
  return live;
}

export function onTeachRecordingRequest(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
