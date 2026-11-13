# Per-bot app accounts: design (2026-11-13, against OMB v0.1.152)

1. Several accounts per app: yes, already there. OMB creates its Composio session with multi-account on (up to 5 accounts per app), and the team Apps page "Add account" uses it.
2. Pinning an account in a grant: no. A bot's grant (`connectorTools`) only lists tools. Today the model itself names the account in each call (`account` on a `COMPOSIO_MULTI_EXECUTE_TOOL` item), so any bot can use any account.
3. Smallest change: a new per-bot setting `connectorAccounts: { <app>: { account: <id>, exclusive?: true } }`, enforced in the one place every bot's app call already passes through (`POST /api/internal/connectors/mcp` in the server, which knows the calling bot).
4. A bot with an account assigned: the server writes that account into every call for that app, whatever the model asked for. If the account is gone or signed out, the call is refused; it never falls back to another account.
5. "Only this bot" (`exclusive`): other bots can no longer use that account, by id or by alias. A bot with nothing assigned keeps using the remaining accounts.
6. Calls the server cannot check (Composio's remote workbench/bash/proxy code) are refused for a bot with an assigned account, and for every bot while any exclusive account exists.
7. App-event automations ("triggers") follow the same rule, so a bot cannot watch another bot's account.
8. Default is unchanged: with no account assigned anywhere, no code path changes.
9. UI: Bot Settings → Access → Apps gets an "Accounts" list: one dropdown per app (Any account / each connected account) plus an "Only this bot" checkbox. "Connect another account" opens the existing team Apps page; the new account then shows up in the dropdown.
10. Who may change it: owners/admins only (members who can edit a bot cannot reassign accounts).
11. Known limit: Composio's own search/connection tools may still show a bot the alias names of other accounts. It cannot use them.
12. Effort: one patch, about a day including tests. No Composio or data migration needed.

---

# What was built (2026-11-13)

Patch: `~/work/omb-hsp/patches/0008-feat-apps-a-bot-can-be-assigned-its-own-connected-ac.patch` (19 files, +887/−11), against pure v0.1.152. Working tree: `~/work/omb-accounts`, branch `hsp-accounts`. Nothing was pushed, restarted or deployed.

## What changed
- **Setting.** Each bot can carry `connectorAccounts`, for example `{ "github": { "account": "<account id>", "exclusive": true } }`. Saved through the normal bot PATCH; the server rejects an account that is not connected for that app. `null` or `{}` clears it.
- **Enforcement** (`server/connector-accounts.ts`, called from the relay in `server/index.ts`):
  - Assigned bot: every call for that app is sent with the assigned account, even if the model names another. If that account is gone or signed out, the call is refused. It never falls back.
  - "Only this bot": no other bot can use that account, by id or alias. A bot with nothing assigned uses what is left: the single remaining account automatically, or it must name one if several remain.
  - Refused while account rules apply to a bot: Composio remote workbench/bash/proxy code, direct tool calls for a ruled app, batched requests, and disconnecting an account through Composio's connection tool. These refusals apply to every bot as soon as one exclusive account exists.
  - If the account list cannot be read, the call is refused.
- **Automations** (app-event triggers) use the same choice, so a bot cannot watch another bot's account.
- **Chief-created bots** inherit the Chief's assignment.
- **Prompt.** An assigned bot is told the account is already chosen (no account id in the prompt).
- **UI.** Bot Settings → Access → Apps → "Accounts": a dropdown per app (Any account / each account) and an "Only this bot" checkbox. "Connect another account" opens the team Apps page. English text only; other languages fall back to English.
- **Unchanged by default.** With no assignment on any bot, the new code does not run; the end-to-end test checks calls reach Composio byte-for-byte as sent.

## Things to know before using it
- Picking an account without "Only this bot" restricts only that bot. Other bots can still use that account. Tick the box to keep it private.
- Once any exclusive account exists, no bot can run Composio workbench/bash code. That is the price of the guarantee.
- An automation created before an account was made exclusive keeps running on that account. Check existing automations when you first assign accounts.
- A new account is open to unassigned bots between connecting it and ticking "Only this bot".
- Composio's search/connection tools may still show alias names of other accounts. They cannot be used.
- On a Team Cloud only owners/admins can change assignments. Assignments are not included in bot exports or team backups (account ids are local to one installation).
- I could not test against real Composio. The `account` field on a multi-execute entry is what OMB itself already sends (`server/connected-reads.ts`) and Composio's docs say it accepts an id or alias, but a first live check with two real GitHub accounts is worth doing.

## Test results
- Passing: type checks (`tsc -b`, `tsc -p tsconfig.server.json`), lint (`oxlint --deny-warnings .`), locale check.
- Passing: the new tests and the neighbouring ones (24 files, 266 tests): account rules unit tests, an end-to-end test against a real server with a fake Composio, the picker, triggers, inherited apps, bot settings, trust controls.
- Full suite (`vitest run`, 2563 files, about 6 hours on this machine): IN PROGRESS, restarted 17:21 UTC after the session was killed. Log: `/tmp/claude-1003/-home-huzefa-work/10913f3d-3d27-44c1-878b-3bf83ce95fcc/scratchpad/vitest-full3.log`.
- Not run: `broker:test`, `test:electron`, `test:packaged-server` (the other parts of `pnpm test`).

## How to deploy (only after Huzefa says yes; rides with the 0.1.152 switch)
1. The patch is already in `omb-hsp/patches` as 0008 (untracked, not committed there). Commit it with the rest of the queue when the 0.1.152 rebase lands. It applies on pure v0.1.152 and patch 0007 still applies on top of it; it has not been tried against the rebased 0001–0006.
2. Build and release through the normal `omb-hsp` pipeline. No config, data migration or Composio change is needed.
3. After deploy: open Milo → Settings → Access → Accounts, pick its GitHub account and tick "Only this bot"; do the same for MausBot. Ask each bot "which GitHub user am I?" to confirm.
4. Rollback: clear the assignments, or drop the patch. A build without the patch ignores the saved setting, which means bots go back to using any account.
