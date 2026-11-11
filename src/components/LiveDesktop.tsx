import { useEffect, useRef, useState } from "react";
import { Keyboard, Loader2, Minimize2, RefreshCw, Send } from "lucide-react";
import type RFB from "@novnc/novnc";
import { cn } from "@/lib/cn";
import { connectDesktop, typeOnDesktop } from "@/lib/desktop-connection";
import { t } from "@/lib/i18n";
import { useCaptionChrome, useDesktopCapabilities } from "./DesktopCapabilities";
import { DesktopPill, FRAME } from "./DesktopPill";
import { TeachOnComputer, type TeachSession } from "./TeachOnComputer";

type Connection = "connecting" | "connected" | "disconnected";

/** The computer the person took control of, live and drivable where they were watching it. */
export function LiveDesktop({ target, threadId, name, poster, expanded, onExpandedChange, onHandBack, handingBack, onUnreachable, teach }: {
  target: string;
  threadId: string;
  name: string;
  /** The last watched frame, shown until the first live one arrives. */
  poster: string | null;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onHandBack: () => void;
  handingBack: boolean;
  /** The desktop never came up, so the person cannot drive it. */
  onUnreachable: () => void;
  /** Teach on computer: record the person's own steps for the bot to learn. */
  teach?: TeachSession;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFB | null>(null);
  const [connection, setConnection] = useState<Connection>("connecting");
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const live = useRef(false);
  const typedSink = useRef<((text: string) => void) | null>(null);
  const { dragProps, noDragStyle } = useCaptionChrome();
  const macInset = useDesktopCapabilities().capabilities.windowChrome === "mac-inset";
  const unreachable = useRef(onUnreachable);
  unreachable.current = onUnreachable;

  useEffect(() => {
    const controller = new AbortController();
    let client: RFB | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const lost = () => {
      setConnection("disconnected");
      if (!live.current) unreachable.current();
      else if (attempt === 0) retry = setTimeout(() => setAttempt(1), 1_000);
    };
    setConnection("connecting");
    void connectDesktop(screen.current!, target, {
      threadId,
      signal: controller.signal,
      events: {
        connected: () => {
          live.current = true;
          setConnection("connected");
        },
        disconnected: lost,
      },
    }).then((connected) => {
      if (controller.signal.aborted) return connected.disconnect();
      client = connected;
      connected.background = "transparent";
      rfb.current = connected;
    }, () => { if (!controller.signal.aborted) lost(); });
    return () => {
      controller.abort();
      clearTimeout(retry);
      client?.disconnect();
      if (rfb.current === client) rfb.current = null;
    };
  }, [target, threadId, attempt]);

  useEffect(() => {
    if (connection === "connected") rfb.current?.focus({ preventScroll: true });
  }, [expanded, connection]);

  const label = t("computer.viewerTitle", { name });
  const [typing, setTyping] = useState(false);
  const iconButton = "flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] focus-visible:outline-2 focus-visible:outline-focus disabled:opacity-50";

  return (
    <div
      data-live-desktop
      data-state={connection}
      data-expanded={expanded ? "true" : undefined}
      className={cn(expanded ? FRAME : "relative h-full w-full")}
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape" && !(event.target instanceof HTMLCanvasElement)) onExpandedChange(false);
      }}
    >
      {expanded && (
        <header {...dragProps} className={cn("absolute inset-x-0 top-0 z-10 h-12", macInset && "pl-[86px]")}>
          <div style={noDragStyle} className="absolute right-3 top-3 flex items-center gap-1">
            {typing && (
              <form
                className="flex min-w-0 items-center gap-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!rfb.current || connection !== "connected" || !text) return;
                  typeOnDesktop(rfb.current, text);
                  typedSink.current?.(text);
                  setText("");
                }}
              >
                <input
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  maxLength={4096}
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  autoFocus
                  placeholder={t("desktopViewer.text")}
                  aria-label={t("desktopViewer.text")}
                  className="w-44 min-w-0 rounded-lg border border-white/15 bg-white/10 px-2.5 py-1.5 text-[12px] text-white outline-none placeholder:text-neutral-400 focus:border-focus max-sm:w-28"
                />
                <button type="submit" disabled={connection !== "connected" || !text} title={t("desktopViewer.send")} aria-label={t("desktopViewer.send")} className={cn(iconButton, "bg-white/10 text-white hover:bg-white/20")}>
                  <Send size={14} aria-hidden="true" />
                </button>
              </form>
            )}
            <button type="button" onClick={() => setTyping((value) => !value)} title={t("desktopViewer.text")} aria-label={t("desktopViewer.text")} aria-pressed={typing} className="flex size-8 items-center justify-center rounded-md text-neutral-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-focus">
              <Keyboard size={16} aria-hidden="true" />
            </button>
            <button type="button" onClick={() => onExpandedChange(false)} title={t("desktopViewer.exitFullscreen")} aria-label={t("desktopViewer.exitFullscreen")} className="flex size-8 items-center justify-center rounded-md text-neutral-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-focus">
              <Minimize2 size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
      )}
      <div className={cn("relative overflow-hidden", expanded ? "mx-auto min-h-0 w-full flex-1 bg-transparent px-3 pb-2 pt-12 sm:px-12 [&_canvas]:rounded-2xl" : "h-full w-full bg-inset")}>
        {poster && connection !== "connected" && (
          <img src={poster} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-contain opacity-50" />
        )}
        <div ref={screen} role="application" aria-label={label} className={cn("absolute", expanded ? "inset-x-3 bottom-2 top-12 sm:inset-x-12" : "inset-0")} />
        {connection === "connecting" && (
          <div role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-ink-secondary">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            {t("desktopViewer.connecting")}
          </div>
        )}
        {teach && <TeachOnComputer session={teach} screen={screen} typedSink={typedSink} connected={connection === "connected"} />}
        {connection === "disconnected" && (
          <div role="alert" className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 bg-card/95 p-3 text-center text-[12px] text-ink-secondary">
            <span>{t("desktopViewer.disconnected")}</span>
            <button type="button" onClick={() => setAttempt((value) => value + 1)} className="flex items-center gap-1.5 rounded-md bg-control px-3 py-1.5 text-ink hover:bg-raised-hover">
              <RefreshCw size={13} aria-hidden="true" />
              {t("desktopViewer.reconnect")}
            </button>
          </div>
        )}
      </div>
      {expanded && (
        <div className="flex shrink-0 justify-center px-3 pb-5 pt-2">
          <DesktopPill control onAction={onHandBack} busy={handingBack} noDragStyle={noDragStyle} />
        </div>
      )}
    </div>
  );
}
