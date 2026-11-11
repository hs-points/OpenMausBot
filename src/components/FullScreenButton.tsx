import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useModalDialog } from "@/hooks/use-modal-dialog";
import { DesktopPill, FRAME, STAGE, exitIcon } from "./DesktopPill";
import { useCaptionChrome, useDesktopCapabilities } from "./DesktopCapabilities";

/**
 * Full screen under the bot's screen. Without control it only watches: the bot keeps working and the picture fills
 * the window, with Take control as its own button. With control held it goes on into the live desktop, as before.
 */
export function FullScreenButton({ held, frame, name, disabled, takeDisabled, error, onTakeControl }: {
  held: boolean;
  /** The latest watched frame of the bot's screen. */
  frame: string | null;
  name: string;
  disabled: boolean;
  /** The overlay's Take control is off for the same reasons as the panel's own Take control. */
  takeDisabled: boolean;
  /** Why the last control request failed, shown over the picture so a refused Take control keeps watching. */
  error: string | null;
  /** Take control; `true` opens the live desktop full screen. */
  onTakeControl: (expand: boolean) => void;
}) {
  const [watching, setWatching] = useState(false);
  const stopWatching = useCallback(() => setWatching(false), []);

  // Once control is held the live desktop takes over; handing it back returns to the panel, not to this view.
  useEffect(() => {
    if (held) setWatching(false);
  }, [held]);

  return (
    <>
      <button
        type="button"
        onClick={() => (held ? onTakeControl(true) : setWatching(true))}
        disabled={disabled}
        className="flex flex-auto items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50"
        title={t(held ? "computer.openLiveDesktop" : "computer.watchFullScreenTitle")}
      >
        <Maximize2 size={14} />
        {t("computer.fullScreen")}
      </button>
      {watching && !held && (
        <WatchFullScreen
          frame={frame} name={name} takeDisabled={takeDisabled} error={error}
          onClose={stopWatching} onTakeControl={() => onTakeControl(true)}
        />
      )}
    </>
  );
}

/** The watch-only view: Tab stays inside it, and focus goes back to Full screen when it closes. */
function WatchFullScreen({ frame, name, takeDisabled, error, onClose, onTakeControl }: {
  frame: string | null;
  name: string;
  takeDisabled: boolean;
  error: string | null;
  onClose: () => void;
  onTakeControl: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const exitRef = useRef<HTMLButtonElement>(null);
  const { dragProps, noDragStyle } = useCaptionChrome();
  const macInset = useDesktopCapabilities().capabilities.windowChrome === "mac-inset";
  const takeRef = useRef<HTMLButtonElement>(null);
  const [tried, setTried] = useState(false);
  useModalDialog(dialogRef, onClose);
  // After the dialog has noted Full screen as the place to return to, so autoFocus can't take that place.
  useEffect(() => exitRef.current?.focus(), []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (!(event.target instanceof Node) || !dialogRef.current?.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  // A disabled button loses focus to the page, where Escape would no longer reach this view.
  useEffect(() => {
    const active = document.activeElement;
    if (takeDisabled && (active === takeRef.current || active === document.body)) dialogRef.current?.focus();
  }, [takeDisabled]);

  const label = t("computer.screenOf", { name });
  return (
    <div ref={dialogRef} tabIndex={-1} data-watch-full-screen role="dialog" aria-modal="true" aria-label={label} className={FRAME}>
      <header {...dragProps} className={cn("absolute inset-x-0 top-0 z-10 h-12", macInset && "pl-[86px]")}>
        <button ref={exitRef} type="button" style={noDragStyle} onClick={onClose} title={t("desktopViewer.exitFullscreen")} aria-label={t("desktopViewer.exitFullscreen")} className={exitIcon}>
          <Minimize2 size={16} aria-hidden="true" />
        </button>
      </header>
      <div className={STAGE}>
        {frame ? (
          <img src={frame} alt={label} className="max-h-full max-w-full rounded-2xl object-contain" />
        ) : (
          <span role="status" className="flex items-center gap-2 text-[12px] text-neutral-400">
            <Loader2 size={16} className="animate-spin" aria-hidden="true" />
            {t("computer.waitingFrame")}
          </span>
        )}
      </div>
      {tried && error && (
        <div role="alert" className="mx-auto mb-2 max-w-md shrink-0 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-center text-[12px] text-danger">{error}</div>
      )}
      <div className="flex shrink-0 justify-center px-3 pb-5 pt-1">
        <DesktopPill control={false} disabled={takeDisabled} noDragStyle={noDragStyle} onAction={() => { setTried(true); onTakeControl(); }} buttonRef={takeRef} />
      </div>
    </div>
  );
}
