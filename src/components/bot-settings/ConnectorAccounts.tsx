import { useEffect, useState } from "react";

import { preloadConnectedApps } from "@/lib/connected-apps";
import { t } from "@/lib/i18n";
import type { ConnectorStatus } from "@/lib/connector-status";
import type { Bot } from "@/state/store";
import type { ConnectorAccountPin } from "../../../shared/wire";

export type ConnectorAccounts = Record<string, ConnectorAccountPin>;

export interface AccountChoice {
  id: string;
  name: string;
  /** Names of the other bots that keep this account to themselves. */
  keptFor: string[];
}

export interface AccountRow {
  slug: string;
  label: string;
  /** The assigned account's ID, or "" for any account. */
  value: string;
  exclusive: boolean;
  /** The assigned account is no longer among the app's accounts. */
  missing: boolean;
  choices: AccountChoice[];
}

const ACTIVE = /^active$/i;

/** One row per app that has a working account or an assignment: the accounts to choose from and who keeps which. */
export function accountRows(
  bot: Pick<Bot, "id" | "connectorAccounts">,
  bots: ReadonlyArray<Pick<Bot, "id" | "name" | "connectorAccounts">>,
  services: Record<string, ConnectorStatus>,
  labels: Record<string, string> = {},
): AccountRow[] {
  const pins = bot.connectorAccounts ?? {};
  const slugs = new Set(Object.keys(pins));
  for (const [slug, status] of Object.entries(services)) if (status.accounts?.some((account) => ACTIVE.test(account.status))) slugs.add(slug);
  return [...slugs].sort((a, b) => a.localeCompare(b)).map((slug) => {
    const pin = Object.hasOwn(pins, slug) ? pins[slug] : undefined;
    const accounts = (Object.hasOwn(services, slug) ? services[slug]!.accounts ?? [] : []).filter((account) => ACTIVE.test(account.status) || account.id === pin?.account);
    const choices = accounts.map((account) => ({
      id: account.id,
      name: account.alias || account.id,
      keptFor: bots.filter((other) => {
        const theirs = other.id !== bot.id && other.connectorAccounts && Object.hasOwn(other.connectorAccounts, slug) ? other.connectorAccounts[slug] : undefined;
        return theirs?.exclusive === true && theirs.account === account.id;
      }).map((other) => other.name),
    }));
    return {
      slug,
      label: labels[slug] ?? slug,
      value: pin?.account ?? "",
      exclusive: pin?.exclusive === true,
      missing: Boolean(pin) && !accounts.some((account) => account.id === pin!.account && ACTIVE.test(account.status)),
      choices,
    };
  });
}

/** The assignments with one app changed; `account` "" lets the app use any account again. */
export function withAccount(current: ConnectorAccounts | undefined, slug: string, account: string, exclusive: boolean): ConnectorAccounts {
  const next = { ...current };
  if (!account) delete next[slug];
  else next[slug] = exclusive ? { account, exclusive: true } : { account };
  return next;
}

export function ConnectorAccountsControl({ bot, bots, labels, onChange, onConnect }: {
  bot: Bot;
  bots: readonly Bot[];
  labels?: Record<string, string>;
  onChange: (accounts: ConnectorAccounts) => void;
  onConnect: () => void;
}) {
  // The same 30-second inventory the apps list above reads.
  const [services, setServices] = useState<Record<string, ConnectorStatus> | null>(null);
  useEffect(() => {
    let cancelled = false;
    void preloadConnectedApps().then((inventory) => { if (!cancelled && inventory.authoritative) setServices(inventory.services); });
    return () => { cancelled = true; };
  }, []);
  if (!services) return null;
  const rows = accountRows(bot, bots, services, labels);
  if (!rows.length) return null;
  return <div className="mt-4" data-testid="connector-accounts">
    <div className="text-[12px] font-medium text-ink">{t("botAccess.accounts.header")}</div>
    <div className="mt-0.5 text-[12px] text-ink-secondary">{t("botAccess.accounts.hint", { name: bot.name })}</div>
    <div className="mt-2 flex flex-col divide-y divide-hairline/20 rounded-lg bg-inset">
      {rows.map((row) => <div key={row.slug} className="flex flex-wrap items-center justify-between gap-3 px-3 py-1.5">
        <span className="min-w-0 text-[13px] text-ink">
          {row.label}
          {row.missing && <span className="ml-2 text-[11px] text-danger">{t("botAccess.accounts.missing")}</span>}
        </span>
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          {row.value && <label className="flex items-center gap-1.5 text-[12px] text-ink-secondary" title={t("botAccess.accounts.exclusiveHint")}>
            <input
              type="checkbox"
              checked={row.exclusive}
              onChange={(event) => onChange(withAccount(bot.connectorAccounts, row.slug, row.value, event.target.checked))}
            />
            {t("botAccess.accounts.exclusive")}
          </label>}
          <select
            value={row.value}
            aria-label={t("botAccess.accounts.selectLabel", { app: row.label })}
            onChange={(event) => onChange(withAccount(bot.connectorAccounts, row.slug, event.target.value, event.target.value ? row.exclusive : false))}
            className="max-w-[220px] rounded-md bg-card px-2 py-1 text-[12px] text-ink"
          >
            <option value="">{t("botAccess.accounts.any")}</option>
            {row.value && !row.choices.some((choice) => choice.id === row.value) && <option value={row.value}>{row.value}</option>}
            {row.choices.map((choice) => <option key={choice.id} value={choice.id}>
              {choice.keptFor.length ? t("botAccess.accounts.keptFor", { account: choice.name, bots: choice.keptFor.join(", ") }) : choice.name}
            </option>)}
          </select>
        </div>
      </div>)}
    </div>
    <button type="button" onClick={onConnect} className="mt-2 text-[12px] text-ink-secondary underline hover:text-ink">
      {t("botAccess.accounts.connectAnother")}
    </button>
  </div>;
}
