import { useEffect, useRef, useState, type MutableRefObject, type RefObject } from "react";
import { EyeOff, Loader2, Square } from "lucide-react";
import { teachPrompt, type TaughtStep } from "../../shared/teach-prompt";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { captureTeachInput, typedEvents, type TeachEvent } from "@/lib/teach-capture";
import { api, ApiError } from "@/state/store";

export interface TeachSession {
  botId: string;
  botName: string;
  /** The desktop recorded on: the bot's Local VM (the default) or its self-hosted VPS computer. */
  computer?: "vm" | "vps";
  /** The control lease this view holds; a recording is bound to it. */
  leaseId: () => string | null;
  /** Hands the authored request to the bot's conversation. */
  onTeach: (prompt: string) => void;
  onClose: () => void;
}

type Phase =
  | { kind: "intro"; starting: boolean }
  | { kind: "recording"; id: string; steps: number; stopping: boolean; ended: boolean }
  | { kind: "review"; id: string | null; lease: string; steps: TaughtStep[]; desktop: string; ended: boolean };

const BATCH = 50;

/** Teach on computer, over the live desktop: a banner to start, a pill while recording, then the steps to send. */
export function TeachOnComputer({ session, screen, typedSink, connected }: {
  session: TeachSession;
  screen: RefObject<HTMLDivElement | null>;
  /** The viewer's text box reports what it typed here while recording. */
  typedSink: MutableRefObject<((text: string) => void) | null>;
  connected: boolean;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "intro", starting: false });
  const [error, setError] = useState<string | null>(null);
  const [goal, setGoal] = useState("");
  const queue = useRef<TeachEvent[]>([]);
  const pumping = useRef<Promise<void> | null>(null);
  const recording = useRef<{ id: string; lease: string; ended: boolean } | null>(null);
  const capture = useRef<ReturnType<typeof captureTeachInput> | null>(null);
  const base = `/api/bots/${encodeURIComponent(session.botId)}/teach`;

  // Every call names the same desktop: the server keeps a recording under its desktop.
  const desktop = session.computer === "vps" ? { computer: "vps" } : {};
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;
  const post = <T,>(action: string, body: Record<string, unknown>) =>
    api<T>(`${base}/${action}`, { method: "POST", body: JSON.stringify({ ...body, ...desktop }) });

  const pump = () => {
    pumping.current ??= (async () => {
      while (queue.current.length && recording.current && !recording.current.ended) {
        const events = queue.current.splice(0, BATCH);
        const { id, lease } = recording.current;
        try {
          await post("events", { controlLeaseId: lease, recordingId: id, events });
        } catch (cause) {
          if (cause instanceof ApiError && (cause.status === 404 || cause.status === 409)) {
            recording.current.ended = true;
            setPhase((now) => now.kind === "recording" ? { ...now, ended: true } : now);
          } else setError(cause instanceof Error ? cause.message : String(cause));
        }
      }
      pumping.current = null;
    })();
    return pumping.current;
  };

  const emit = (events: TeachEvent[]) => {
    if (!recording.current || recording.current.ended) return;
    queue.current.push(...events);
    const steps = events.filter((event) => event.kind !== "typing").length;
    if (steps) setPhase((now) => now.kind === "recording" ? { ...now, steps: now.steps + steps } : now);
    void pump();
  };

  const stopCapture = () => {
    capture.current?.stop();
    capture.current = null;
    typedSink.current = null;
  };

  const baseRef = useRef(base);
  baseRef.current = base;
  useEffect(() => () => {
    capture.current?.stop();
    capture.current = null;
    typedSink.current = null;
    const live = recording.current;
    recording.current = null;
    // Leaving mid-recording keeps nothing of it.
    if (live) {
      void api(`${baseRef.current}/discard`, { method: "POST", body: JSON.stringify({ controlLeaseId: live.lease, recordingId: live.id, ...desktopRef.current }) }).catch(() => {});
    }
  }, [typedSink]);

  const start = async () => {
    const lease = session.leaseId();
    const element = screen.current;
    if (!lease || !element) return setError(t("teach.needControl"));
    setError(null);
    setPhase({ kind: "intro", starting: true });
    try {
      const { recordingId } = await post<{ recordingId: string }>("start", { controlLeaseId: lease });
      recording.current = { id: recordingId, lease, ended: false };
      capture.current = captureTeachInput(element, emit);
      typedSink.current = (text) => emit(typedEvents(text));
      setPhase({ kind: "recording", id: recordingId, steps: 0, stopping: false, ended: false });
      element.querySelector("canvas")?.focus({ preventScroll: true });
    } catch (cause) {
      setPhase({ kind: "intro", starting: false });
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const stop = async () => {
    const live = recording.current;
    if (!live || phase.kind !== "recording") return;
    setPhase({ ...phase, stopping: true });
    capture.current?.flush();
    stopCapture();
    await (pumping.current ?? Promise.resolve());
    try {
      const result = await post<{ steps: TaughtStep[]; desktop: string }>("stop", { controlLeaseId: live.lease, recordingId: live.id });
      recording.current = null;
      setPhase({ kind: "review", id: live.id, lease: live.lease, steps: result.steps, desktop: result.desktop, ended: live.ended });
    } catch (cause) {
      recording.current = null;
      setError(cause instanceof Error ? cause.message : String(cause));
      setPhase({ kind: "review", id: null, lease: live.lease, steps: [], desktop: "", ended: true });
    }
  };

  const discard = () => {
    if (phase.kind === "review" && phase.id) void post("discard", { controlLeaseId: phase.lease, recordingId: phase.id }).catch(() => {});
    session.onClose();
  };

  const taught = phase.kind === "review" ? phase.steps.filter((step) => step.action !== "start") : [];

  if (phase.kind === "intro") {
    return (
      <div data-teach="banner" role="dialog" aria-label={t("teach.title")} className="absolute inset-x-0 top-0 z-10 flex justify-center p-3">
        <div className="flex max-w-[560px] flex-wrap items-center gap-3 rounded-xl border border-hairline bg-panel/95 px-4 py-3 shadow-lg backdrop-blur">
          <p className="min-w-0 flex-1 basis-60 text-[13px] leading-snug text-ink">
            {t("teach.banner", { name: session.botName })}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" onClick={session.onClose} className="rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-raised-hover">
              {t("teach.notNow")}
            </button>
            <button
              type="button"
              onClick={() => void start()}
              disabled={phase.starting || !connected}
              className="flex items-center gap-1.5 rounded-lg bg-danger px-3 py-1.5 text-[12px] font-medium text-white hover:brightness-110 disabled:opacity-50"
            >
              {phase.starting ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <span className="size-2.5 rounded-full bg-white" aria-hidden="true" />}
              {t("teach.start")}
            </button>
          </div>
          {error && <p role="alert" className="basis-full text-[12px] text-danger">{error}</p>}
        </div>
      </div>
    );
  }

  if (phase.kind === "recording") {
    return (
      <div data-teach="recording" className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-center gap-1.5 p-4">
        {(phase.ended || error) && (
          <p role="alert" className="rounded-md bg-black/75 px-2.5 py-1 text-[12px] text-white">{phase.ended ? t("teach.ended") : error}</p>
        )}
        <div role="status" className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/80 py-1.5 pl-3.5 pr-1.5 text-[12px] font-medium text-white shadow-lg">
          <span className="relative flex size-2.5" aria-hidden="true">
            <span className={cn("absolute inset-0 rounded-full bg-danger", !phase.ended && "animate-ping opacity-75")} />
            <span className="relative size-2.5 rounded-full bg-danger" />
          </span>
          <span>{t("computer.inControl")}</span>
          <span className="text-white/60">{t("teach.stepCount", { count: String(phase.steps) })}</span>
          <span className="h-4 w-px bg-white/30" aria-hidden="true" />
          <button
            type="button"
            onClick={() => void stop()}
            disabled={phase.stopping}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-60"
          >
            {phase.stopping ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Square size={11} className="fill-current" aria-hidden="true" />}
            {t("teach.stop")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div data-teach="review" className="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onKeyDown={(event) => event.stopPropagation()}>
      <form
        role="dialog"
        aria-label={t("teach.reviewTitle", { name: session.botName })}
        className="flex max-h-full w-full max-w-[520px] flex-col gap-3 overflow-hidden rounded-xl border border-hairline bg-panel p-4 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (!taught.length) return;
          session.onTeach(teachPrompt({ goal, desktop: phase.desktop, steps: phase.steps }));
        }}
      >
        <h2 className="text-[14px] font-medium text-ink">{t("teach.reviewTitle", { name: session.botName })}</h2>
        {phase.ended && <p className="text-[12px] text-ink-secondary">{t("teach.ended")}</p>}
        {error && <p role="alert" className="text-[12px] text-danger">{error}</p>}
        <label className="flex flex-col gap-1 text-[12px] text-ink-secondary">
          {t("teach.goal")}
          <input
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            maxLength={300}
            placeholder={t("teach.goalPlaceholder")}
            className="rounded-lg border border-hairline bg-inset px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-focus"
          />
        </label>
        {taught.length ? (
          <ol className="min-h-0 flex-1 list-decimal space-y-1 overflow-y-auto pl-5 text-[12px] leading-snug text-ink">
            {taught.map((step) => (
              <li key={step.step} className={cn(step.hidden && "text-ink-secondary")}>
                {step.hidden && <EyeOff size={11} className="mr-1 inline align-[-1px]" aria-label={t("teach.hidden")} />}
                {step.summary}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-[12px] text-ink-secondary">{t("teach.noSteps")}</p>
        )}
        <p className="text-[11px] text-ink-secondary">{t("teach.reviewNote", { name: session.botName })}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={discard} className="rounded-lg px-3 py-1.5 text-[12px] text-ink-secondary hover:bg-raised-hover">
            {t("teach.discard")}
          </button>
          <button type="submit" disabled={!taught.length} className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:brightness-110 disabled:opacity-50">
            {t("teach.send", { name: session.botName })}
          </button>
        </div>
      </form>
    </div>
  );
}
