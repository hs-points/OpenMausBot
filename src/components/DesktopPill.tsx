import { Hand, Loader2, MousePointer2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";

/**
 * The floating pill under a full-screen computer. Left, who is driving; right, the one button that changes it: "I'm done"
 * hands the computer back to the bot, and "Take control" takes it from a working bot.
 */
export function DesktopPill({ control, busy, disabled, onAction, noDragStyle, buttonRef }: {
  /** Whether the person is driving the computer. */
  control: boolean;
  /** The request is in flight. */
  busy?: boolean;
  disabled?: boolean;
  onAction: () => void;
  noDragStyle?: React.CSSProperties;
  buttonRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <div data-desktop-pill={control ? "control" : "bot"} style={noDragStyle} className="flex shrink-0 items-center gap-1 rounded-full bg-white p-1 pl-4 text-[15px] text-neutral-900 shadow-lg">
      {control ? <MousePointer2 size={16} aria-hidden="true" /> : <span className="size-2 animate-pulse rounded-full bg-emerald-500" aria-hidden="true" />}
      <span className="px-1.5 font-normal">{t(control ? "computer.inControl" : "computer.pill.botWorking")}</span>
      <button
        ref={buttonRef}
        type="button"
        onClick={onAction}
        disabled={disabled || busy}
        title={t(control ? "computer.handBack" : "computer.takeControlTitle")}
        className="flex items-center gap-1.5 rounded-full bg-neutral-900 px-4 py-1.5 text-[15px] text-white hover:bg-neutral-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-60"
      >
        {busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : control ? null : <Hand size={14} aria-hidden="true" />}
        {t(control ? "computer.pill.done" : "computer.takeControl")}
      </button>
    </div>
  );
}

/** The near-black frame both full-screen views sit in; the desktop is the only rounded, lit thing in it. */
export const FRAME = "fixed inset-0 z-[65] flex flex-col bg-[#0d0d0e] outline-none";
export const STAGE = "relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 pb-2 pt-12 sm:px-12";
export const exitIcon = cn("absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-md text-neutral-300 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-focus");
