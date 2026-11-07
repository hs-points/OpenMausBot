import { useEffect, useRef, useState } from "react";
import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/cn";
import { appendComposerDraft } from "@/lib/drafts";
import { skillAuthoringEnabled } from "@/lib/feature-flags";
import { t } from "@/lib/i18n";
import { randomUuid } from "@/lib/random-uuid";
import { onTeachRecordingRequest, takeTeachRecordingRequest, teachRecordingRequested } from "@/lib/teach-request";
import { useStore, type Bot } from "@/state/store";
import { takeDesktop, type ComputerTakeover } from "./computer-takeover";
import type { TeachSession } from "./TeachOnComputer";

/** The computer card's Teach on computer action: takes the Local VM desktop full size with the teach banner over it. */
export function useTeachOnComputer({ bot, takeover, live, ready, busy, setPending, setError, handBack, showComputer }: {
  bot: Bot;
  takeover: ComputerTakeover;
  /** This view has a live desktop to drive. */
  live: boolean;
  /** The bot's computer is a running Local VM. */
  ready: boolean;
  busy: boolean;
  setPending: (pending: boolean) => void;
  setError: (error: Error | string | null) => void;
  handBack: () => void;
  /** Brings the panel to its computer tab, where the desktop a waiting request records on is shown. */
  showComputer: () => void;
}) {
  const { state, dispatch } = useStore();
  const [teaching, setTeaching] = useState(false);
  const liveHere = takeover.here && live;
  const wasLive = useRef(false);
  useEffect(() => {
    if (wasLive.current && !liveHere) setTeaching(false);
    wasLive.current = liveHere;
  }, [liveHere]);

  const start = async () => {
    setTeaching(true);
    if (!await takeDesktop(takeover, true, setPending, setError)) setTeaching(false);
  };

  // The composer's Teach a task: shows the computer tab at once, then starts as this action would once the desktop is live.
  const [requests, setRequests] = useState(0);
  useEffect(() => onTeachRecordingRequest(() => setRequests((count) => count + 1)), []);
  const shown = useRef(-1);
  useEffect(() => {
    if (!teachRecordingRequested(bot.id)) return;
    if (shown.current !== requests) showComputer();
    shown.current = requests;
    if (ready && live && !busy && takeTeachRecordingRequest(bot.id)) void start();
  });

  const session: TeachSession | undefined = teaching ? {
    botId: bot.id,
    botName: bot.name,
    leaseId: takeover.leaseId,
    onClose: () => setTeaching(false),
    onTeach: (prompt) => {
      const draftId = `bot:${bot.id}:${bot.threadId}`;
      dispatch({ type: "send", botId: bot.id, threadId: bot.threadId, text: prompt, sendId: randomUuid(), onError: () => appendComposerDraft(draftId, prompt) });
      setTeaching(false);
      handBack();
    },
  } : undefined;

  const button = (layout: string) => ready && skillAuthoringEnabled(state.config) ? (
    <button
      type="button"
      onClick={() => void start()}
      disabled={busy || !live}
      className={cn(layout, "items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-control px-3 py-2 text-[13px] text-ink hover:bg-raised-hover disabled:opacity-50")}
      title={t("teach.actionTitle", { name: bot.name })}
      data-testid="teach-on-computer"
    >
      <GraduationCap size={14} />
      {t("teach.action")}
    </button>
  ) : null;

  return { session, button };
}
