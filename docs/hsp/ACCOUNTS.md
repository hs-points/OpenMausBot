# Per-bot app accounts in OMB (brief from Huzefa, 2026-11-13)

## Goal
Each OMB bot can use its OWN account for an app. Example: Milo uses one GitHub login and Huzefa's MausBot uses a different one. Today, connected logins belong to a person ("own:<user>") or the team ("managed"), and each bot only gets an app on/off switch plus a per-action grant. Huzefa wants the account choice per bot, set from that bot's page.

What done looks like:
- In a bot's Settings → Access (or a per-bot Apps view), each app shows which account the bot uses. You can pick one of the connected accounts or connect a new one just for that bot.
- At runtime a bot only ever gets the token of the account assigned to it. Bot A must never see bot B's account. Restricted data must not leak between bots.
- Existing bots keep working unchanged until an account is assigned (default = today's behaviour).

## Where to look (OMB v0.1.152)
- server/composio-share.ts (own/managed account modes, connectedApps)
- src/components/bot-settings/AccessSection.tsx, useBotApps.ts, useBotSettingsDerived.ts
- src/components/PluginsPanel*.ts (team Apps page, "Add account")
- src/lib/connector-grants.ts, shared/wire.ts (ConnectorToolGrant)

Source: you can't read /root/omb-rebase/omb. Clone upstream into ~/work/omb-accounts:
`git clone --filter=blob:none https://github.com/milind-soni/OpenMausBot.git ~/work/omb-accounts && git -C ~/work/omb-accounts checkout v0.1.152`
Then apply the HSP patch queue from ~/work/omb-hsp/patches if they apply cleanly.

## Steps
1. Design first. Write ~/work/ACCOUNTS-REPORT.md in at most 15 plain lines:
   - Does Composio already support several connected accounts per app (the "Add account" button)?
   - Can a bot's grant pin one connected account id?
   - The smallest change that gives per-bot accounts.
   - Effort.
   Then continue straight on. Don't wait.
2. Implement it as a patch in ~/work/omb-hsp/patches, against v0.1.152, with tests. Run the test suite. Note that 4 test files fail on pure upstream 0.1.152 for environmental reasons; that's known.
3. Stop and report. Update ACCOUNTS-REPORT.md with what changed, the test results and how to deploy.

## Rules
- Do NOT restart OMB, and do not touch /var/lib/openmausbot or live config.
- Do not push, and do not touch /root/omb-rebase.
- hsp-omb (the 0.1.152 switch) and omb-steer (the steering bug) are other sessions working in ~/work/omb-hsp. Only add your own new patch file there; don't edit theirs.
- Never print tokens or API keys (Composio key, GitHub tokens, etc.).
- Deployment rides along with the 0.1.152 switch, only after Huzefa says yes.
- Commits end with: Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
