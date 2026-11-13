# OpenMausBot rebase, cleanup and feature cut — 2026-11-13

## Owner decisions (answer yes/no)

1. **Push?** May I push `hsp/rebase-2026-11-13` as a new branch on `hs-points/OpenMausBot`? Nothing else would be touched.
2. **Local VM room turns** (`a6819d8a2`): drop it from the next line? No bot uses a Local VM and production cannot run one. Confirmed by a refuter.
3. **Remote-VPS file secrets**: production (hsp15) still runs this; hsp18 and this branch drop it. Confirm no bot (Riya's WeCom one-time-code flow was the example) still needs a file secret delivered to its VPS computer.
4. **`vm_exec` on a VPS** (`3ffa87043`): it is filtered out of every bot's tool list on the Team server, so it does nothing in production. Fix it so VPS bots really get it (yes) or drop it (no)?
5. **Per-bot connection WIP** (`b5daf904d`): keep and finish it with a test (yes) or drop it (no)?
6. **Patch 0008, per-bot app accounts** (new today in `omb-hsp/patches`, not in the brief): add it to this line now?
7. **Mutual bot pairs** (PR7, PR5): still wanted? It needs a re-port; nothing has shipped it in 18 builds.
8. **Sidebar restyle and "Channels" rename** (draft PR6): still wanted? The workspace has zero channels today.
9. **Hide call text behind the call record** (draft PR1): still wanted?
10. **Slack settings page** (uncommitted Mac work): port it now? The live bridge keeps working either way.
11. **Cloud PC pill UI** (Mac branch, 2 commits, never deployed, no tests): include it?
12. **Paperclip ticket tool** (Mac branch, 1 commit, never run against real Paperclip): include it?
13. **Stale PRs and branches**: close PR8 and PR9 and delete the duplicate branches listed below? I did not touch them.

## Summary

- **Rebase done, local only.** `hsp/rebase-2026-11-13` = upstream `main` `d65513718` + 39 commits (96 files, +4,322 / -293). Nothing is pushed. `main`, remote branches, PRs and servers are untouched.
- **Checks pass**: typecheck, lint and build exit 0. Targeted tests: 1,636 of 1,637 pass across 249 suites; the one failure also fails on pure upstream.
- **Not finished**, because the first run hit the usage limit and the second was killed at 17:19 UTC:
  - no cleanup commits (two candidates are listed below);
  - the three Mac lines were not ported to a branch, and the uncommitted Slack work is still only in the rescue folder;
  - the branch was not moved onto the v0.1.155 tag;
  - the independent review of the four conflict resolutions was started but its conclusions were lost.
- **How many features can go**: of 17 feature groups on the line, 12 are KEEP, 2 are confirmed DROP (already neutralised on the tip), and 3 need your answer. Outside the line, 2 patches are replaced by upstream, 4 groups of duplicate branches carry nothing new, and 7 unshipped features need your answer.

## Drift

| Item | Value |
|---|---|
| Fork `main` | upstream at v0.1.96-24 (`8b01f6f06`), **0 commits of our own**, 6,746 behind upstream `main` |
| Upstream `main` at rebase | `d65513718` = v0.1.154 + 437 commits |
| Newest release | v0.1.155 (today 11:33 UTC); the rebase base is that tag + 9 commits |
| Production | hsp15 = v0.1.150 + 28 HSP commits (`959092859`) |
| Staged, not live | hsp18 = v0.1.154 + 36 HSP commits (`b44e47625`), coordinator's repo |
| `omb-hsp` | `BASE` still says v0.1.145; patches 0001–0006 are older copies of line commits; 0007 and 0008 are new and untracked |
| Open PRs on the fork | #1 (draft), #5, #6 (draft), #7, #8, #9 |

The real patch line is not in the fork: it lives in the coordinator's root-owned repo. I imported it read-only as local refs `refs/hsp-live/0.1.154` and `refs/hsp-live/hsp15`.

Upstream now ships these of ours: the VPS live-desktop tunnel fix (in v0.1.150), a longer phone-pairing code (in v0.1.150), the Local VM refusal inside the bot box (v0.1.153), and secret cards (v0.1.154).

## What is on the branch

- 35 of the 36 line commits, cherry-picked with `-x`. Skipped: `db0d07530` (regenerated goldens, stale on this base).
- Patch 0007 (`f0e59ab6e`, steer a message with a picture into the running Codex turn) plus a size-ratchet fix-up (`c1f4cbf18`).
- Fresh goldens and budgets (`ddf80ebf5`).
- One new fix (`33e659c1a`): Teach on a shared Local VM checked the wrong lease key. It has 7 new tests. The same bug is on hsp15 and hsp18, but it only affects Local VMs, which production does not use.
- Conflicts in 4 commits: `server/index.ts` (Local VM room turns), locale JSON (Teach, key-level union), and generated goldens twice (upstream's taken, then regenerated).

A commit-by-commit list is in `/home/huzefa/work/REBASE-OMB-README.md`.

## Feature cut table

Every DROP and REPLACE below was sent to an independent agent told to refute it. "Confirmed" means it could not.

### On the live line

| Feature | Commits (0.1.154 line) | Verdict | Evidence |
|---|---|---|---|
| Boxed Codex screen tools for a VPS via the host bridge, ON_HOST child, visible Codex failure | `95d375152`, `6d5d7b5e9`, `5e4cfed8b`, `76f53d9da`, part of `dd955dbf1` | KEEP | Upstream still starts the VPS tool child inside the box. All five VPS bots depend on it. |
| Refuse MCP servers that run the Codex or Claude CLI | `c8e71b43b` | KEEP | No such check upstream. In production. |
| Relay token for guarded Slack routes | `eb6dbea09` | KEEP | Upstream docs call it "the planned fix". The live Slack bridge sends the token. |
| Relays may name the exact Auto/Edits level | `a43553692` | KEEP | Upstream still accepts only ask/full. The deployed bridge uses it. |
| Teach on computer | `168ece53c` … `75568ec5d`, `8eaae5d15`, `e95ad4b22` | KEEP | Nothing like it upstream. Largest feature (about +2,650 lines). Whether anyone has recorded a session could not be established. |
| Pointer visible on the live desktop | `c3b5fc634` | KEEP | Two lines; no upstream equivalent. |
| Editors see, watch and steer a bot's cloud screen | `aeb93fff4`, `88c13af66` | KEEP | Upstream keeps this admin-only. It widens an auth boundary, so re-review it on each upgrade. |
| Root-capable VPS computers, CPU/RAM, coding tools, paste | `781a206cc`, `927dd18c2`, `3bbc89c75` | KEEP | You already decided this. Dropping it would make all five containers "unsafe" until recreated. |
| VPS `/home/cua` named volume | `709001f3a` | KEEP | Upstream refuses any mount; dropping would refuse existing computers. |
| Stop attaching tool screenshots to replies | `5592c3e1f` | KEEP | Upstream still attaches them. Side effect: images an MCP tool returns on purpose are not attached either. |
| Steer a message with a picture (patch 0007) | on branch `f0e59ab6e` | KEEP | Upstream Codex steer is still text-only. Not in production yet. |
| Size-ratchet fitting | `f2f4d4772`, `3bbc89c75`, `7fcc76a6f` | KEEP | `index.ts`, `wire.ts` and `vps-computer.ts` sit exactly on upstream's limits. Redo per base. |
| Local VM room turns on a Cloud home | `8d0c7daa4` | DROP — confirmed | No bot has a Local VM; the server user cannot reach Docker; upstream refuses twice. Question 2. |
| Boxed Local VM bridge (Local VM half) | `dd955dbf1` part, `f0099574c`, `d950f4c2c`, `b18315373`, `b44e47625` | DROP — confirmed | Already reverted by you. Residue remains (see Cleanup). |
| Remote-VPS file secrets + code-card guidance | `26dc723a8`, `ea3387f32`, `08d6e3d3a` | NEEDS OWNER DECISION — DROP was refuted | Net zero on the tip, but the feature is live on hsp15 and was built for a real job. Question 3. |
| `vm_exec` on a VPS | `bb2816fc7` | NEEDS OWNER DECISION | Inert on the Team server: the tool is filtered out for Cloud homes. Causes about 220 lines of golden churn. Question 4. |
| Per-bot connection WIP | `ae72aab87` | NEEDS OWNER DECISION | No test; usage not established. Question 5. |
| Golden regenerations | `db0d07530`, `ea3387f32` | DROP — confirmed | Derived test data; regenerate on each base. |

### Not on the live line

| Feature | Source | Verdict | Evidence |
|---|---|---|---|
| VPS live-desktop tunnel fix | PR9, patch 0006 | REPLACE WITH UPSTREAM — confirmed twice | Upstream `5610b7dbe`, in v0.1.150. Production already runs it. |
| Configurable phone-pairing lifetime | `milo/team-pairing-ttl` | REPLACE WITH UPSTREAM — confirmed | Upstream raised the code to 10 minutes (`d818c28aa`, v0.1.150). The setting never shipped and its PR was closed unmerged. Upstream has no setting. |
| Duplicate branches: `hsp/teach-on-computer`, `milo/boxed-vm-screen`, `milo/boxed-vps-screen` (PR8), `milo/room-local-vm`, `milo/transcript-review-base`, `milo/pairs-base-v137-pr3`, `milo/sidebar-base-v137` | origin | DROP (port nothing) — confirmed | Every commit has a twin on the line. Order matters: these are bases of PR1, PR6, PR7, PR8 and PR9, so decide those PRs first. |
| `mac/hsp/slack-bridge`, committed part | Mac | DROP (port nothing) — confirmed | 9 older copies of line commits. Keep the local ref: the uncommitted diff applies only on it. |
| Slack bridge worker (`hsp/slack-bridge/` folder) | Mac, uncommitted | KEEP | A newer version (624 lines) of the worker running in production (444 lines). Upstream has no self-hosted Slack worker. |
| Slack settings page | Mac, uncommitted | NEEDS OWNER DECISION | Never deployed. The diff fails to apply on the new line (settings UI changed). Question 10. |
| Cloud PC pill UI | `mac/hsp/cloudpc-pill-ui` (`68658765a`, `c77dce7af`) | NEEDS OWNER DECISION | UI only; depends on Teach; no tests; breaks one existing test. Question 11. |
| Paperclip ticket tool | `mac/hsp/paperclip-ticket-tool` (`6761a191d`) | NEEDS OWNER DECISION | Would replace Riya's node helper. Adds to the tool catalog and to `index.ts`, which is at its size limit. Question 12. |
| Mutual bot pairs | PR7 (PR5 superseded) | NEEDS OWNER DECISION | Upstream's `personal-reach.ts` covers a narrower case only. Question 7. |
| Sidebar restyle, "Channels" | draft PR6 | NEEDS OWNER DECISION | Cosmetic; needs a re-port. Question 8. |
| Hide call text | draft PR1 | NEEDS OWNER DECISION | Needs a re-port. Question 9. |
| Per-bot app accounts | patch 0008 | NEEDS OWNER DECISION | +887 lines, built on pure v0.1.152, untested against real Composio. Question 6. |

## Test results

Run on the branch at `ddf80ebf5`, before the Teach fix. After the fix I re-ran typecheck, lint and three test files (26 tests): all pass.

| Check | Result |
|---|---|
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm build` | exit 0 |
| Locale check | valid, 16 languages |
| Targeted vitest, 249 suites | 1,636 passed, 1 failed |
| Full vitest suite | not run (about 5 hours) |

Failures:

| Test | On pure upstream `d65513718` | Class |
|---|---|---|
| `cloud-home-server.test.ts` "never hands the included tokens…" | fails too (6 of 14 fail there) | environmental |
| `server/index.test.ts`: 324 of 339 fail | 323 of 339 fail | environmental |

The one extra `index.test.ts` failure on the branch is "restores a live unanswered provider question after a server restart". The verifier was running it in isolation when it was killed; I believe the saved log showing one test passing alone is that test, but the conclusion was not recorded. Treat it as unresolved.

## Cleanup

No cleanup commits were made. Two candidates, both residue of the dropped Local VM bridge:

- `server/testing/boxed-local-vm-hooks.mjs` has no importer left. Safe to delete.
- `localVmComputerTools()` in `server/index.ts` still wraps the boxed case, so upstream's refusal fires at the first tool call instead of at mount. Restoring upstream's three direct call sites frees about 11 lines of `index.ts`, but it changes when the refusal appears, so it is not a pure cleanup.

## Open questions and next steps

- Move the branch onto v0.1.155 for a deployable build. Only three files overlap between the 9 unreleased upstream commits and ours: `server/index.ts`, `en.json`, `pt-br.json`.
- Finish the review of the four conflict resolutions and resolve the one extra `index.test.ts` failure.
- Commit the uncommitted Slack work on a branch so it is no longer only in the rescue folder.
- `omb-hsp/BASE` says v0.1.145 while production is on 0.1.150 and the staged build on 0.1.154; the patch folder no longer matches the live line.
- Deploy stays with the coordinator: hsp18 is staged and waits for a human to switch.
