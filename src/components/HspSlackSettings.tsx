import { cn } from "@/lib/cn";
import { bridgeReporting, recentSlackErrors, slackSummary, type HspSlack, type HspSlackBot } from "@/lib/hsp-slack";
import { intlLocale, t } from "@/lib/i18n";
import { relativeTime } from "@/lib/memory";
import type { LocaleKey } from "@/locales";
import { useStore, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";

const WHY = new Set(["admin", "owner", "chat", "edit"]);

function personLabel(person: HspSlackBot["people"][number]): string {
  return WHY.has(person.why) ? `${person.name} (${t(`hspSlack.why.${person.why}` as LocaleKey)})` : person.name;
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[12px] text-ink-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] text-ink">{children}</dd>
    </div>
  );
}

export function SlackBotRow({ entry, bot, now = Date.now(), onManage }: {
  entry: HspSlackBot;
  bot?: Bot;
  now?: number;
  onManage: (botId: string) => void;
}) {
  const errors = recentSlackErrors(entry, now);
  const last = entry.slack.lastMessageAt ? Date.parse(entry.slack.lastMessageAt) : NaN;
  return (
    <li data-slack-bot={entry.botId} className="flex flex-col gap-3 rounded-xl border border-hairline/40 bg-card p-4">
      <div className="flex items-center gap-3">
        {bot && <BotAvatar bot={bot} size={32} animated={false} label="" />}
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">{entry.name}</span>
        <span
          data-slack-connected={entry.slack.connected}
          className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", entry.slack.connected ? "bg-accent/15 text-accent" : "bg-control text-ink-secondary")}
        >
          {entry.slack.connected ? t("hspSlack.connected") : t("hspSlack.notConnected")}
        </span>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact label={t("hspSlack.whoCanUse")}>
          {entry.people.length === 0 ? t("hspSlack.nobody") : entry.people.map(personLabel).join(", ")}
          {" "}
          <button type="button" onClick={() => onManage(entry.botId)} className="cursor-pointer text-accent hover:underline">
            {t("hspSlack.manageSharing")}
          </button>
        </Fact>
        <Fact label={t("hspSlack.where")}>
          {[t("hspSlack.dms"), ...entry.slack.channels.map((channel) => `#${channel.name}`)].join(", ")}
        </Fact>
        <Fact label={t("hspSlack.lastMessage")}>{Number.isFinite(last) ? relativeTime(last, now) : t("hspSlack.never")}</Fact>
        <Fact label={t("hspSlack.errors")}>
          {errors.length === 0 ? t("hspSlack.noErrors") : t("hspSlack.errorCount", { count: errors.length, text: errors[0]!.text })}
        </Fact>
      </dl>
    </li>
  );
}

export function SlackRows({ entries, now }: { entries: HspSlackBot[]; now?: number }) {
  const { state, dispatch } = useStore();
  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <SlackBotRow
          key={entry.botId}
          entry={entry}
          bot={state.bots.find((candidate) => candidate.id === entry.botId)}
          now={now}
          onManage={(botId) => dispatch({ type: "toggleSettings", open: true, section: "access", botId })}
        />
      ))}
    </ul>
  );
}

export function HspSlackSettings({ data, now }: { data: HspSlack; now?: number }) {
  const summary = slackSummary(data);
  const reporting = bridgeReporting(data);
  const since = reporting && data.bridge.startedAt ? Date.parse(data.bridge.startedAt) : NaN;
  return (
    <div className="flex flex-col gap-4" data-hsp-slack>
      <header className="flex flex-col gap-1">
        <h3 className="text-[15px] font-medium text-ink">{t("hspSlack.connectedCount", { connected: summary.connected, total: summary.total })}</h3>
        {reporting ? (
          <p className="text-[13px] text-ink-secondary">
            {Number.isFinite(since) && <>{t("hspSlack.runningSince", { time: new Date(since).toLocaleString(intlLocale(), { dateStyle: "medium", timeStyle: "short" }) })} · </>}
            {t("hspSlack.today", { handled: summary.handled, refused: summary.refused })}
          </p>
        ) : (
          <p data-slack-stale className="text-[13px] text-ink-secondary">
            <span className="font-medium text-ink">{t("hspSlack.notReporting")}</span> {t("hspSlack.notReportingNote")}
          </p>
        )}
      </header>
      {data.bots.length === 0 ? <p className="text-[13px] text-ink-secondary">{t("hspSlack.empty")}</p> : <SlackRows entries={data.bots} now={now} />}
      <p className="text-[12px] text-ink-secondary">{t("hspSlack.footer", { bot: data.bots[0]?.name ?? "bot" })}</p>
    </div>
  );
}
