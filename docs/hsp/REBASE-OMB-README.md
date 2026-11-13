# What is on `hsp/rebase-2026-11-13`

Status on 2026-11-13: local branch in `/home/huzefa/work/OpenMausBot`, **not pushed, not deployed, not yet independently verified** (verification is running; results go in `REBASE-CLEANUP-REPORT.md`).

- Base: upstream `main` at `d65513718` (v0.1.154 + 437 commits). Our fork's `main` had no commits of its own, so it simply fast-forwards.
- On top: 38 commits, 95 files, +4,229 / -293 lines.
- Source: the 36 HSP commits of the coordinator's `hsp/0.1.154` line (staged as hsp18), plus patch 0007 from `omb-hsp`, plus 2 fix-ups.
- One source commit was skipped: `db0d07530` (regenerated goldens), replaced by a fresh regeneration at the end.
- Conflicts: 4 of 36. `server/index.ts` (Local VM room turns), locale JSON (Teach), and generated goldens/budgets twice.

## Features, in commit order

| # | Feature | Commits on the branch | Note |
|---|---|---|---|
| 1 | Bot-owned Local VM turns in rooms on a Cloud home | `a6819d8a2` | Analyst proposes DROP (no bot uses a Local VM); refuter pending |
| 2 | Codex stops the turn when the computer tools fail to start (test + guard) | `ff5f6c399` | Part of the VPS bridge |
| 3 | Boxed computer tools through the host bridge, Local VM half | `545497cdc`, `5a9084c12`, `5c24926ad`, then reverted by `7fc647a8c`, test removed by `2fa3b8321` | Net effect: follows upstream's refusal. Residue is a cleanup candidate |
| 4 | Boxed Codex screen tools for a self-hosted VPS through the host bridge | `a8b553691`, `c60801be2`, `6aa93d520` | In use by the five VPS bots |
| 5 | Refuse MCP servers that run the Codex or Claude CLI | `886723344` | |
| 6 | Relay token for the guarded Slack routes; relays may name the exact Auto/Edits level | `bb17b93a5`, `c8d157f6a` | |
| 7 | Teach on computer (record your steps, bot writes a skill): Local VM, VPS, Cloud team machine, editors may teach | `0a91310fb`, `4e9f67346`, `4c1ac0bf8`, `93dc37a22`, `33f528410`, `9a9e04849`, `597e809f6` | Largest feature |
| 8 | Keep the pointer visible on the live desktop | `c431dd353` | |
| 9 | Members see a bot's cloud desktop; editors may watch and steer it | `1b1caac18`, `b8c9efc70` | |
| 10 | WIP: a bot's owner may add a connection only their bot uses | `b5daf904d` | Marked WIP, no dedicated test |
| 11 | Root-capable Cloud PCs, CPU/RAM settings, pasted text; drop NET_RAW | `cc3c1ee53`, `f4a798d1d` | Owner chose to keep `rootCapable` |
| 12 | Stop attaching tool screenshots to bot replies | `9575a0100` | |
| 13 | `vm_exec` runs hidden on a self-hosted VPS computer | `3ffa87043` | |
| 14 | VPS computers keep `/home/cua` on a named volume | `3aa1accba` | |
| 15 | Remote-VPS file secrets + one-time-code guidance | `e2fbcbbc8`, `0cd302e46`, then dropped by `31fce6936` | Net effect: upstream secret cards are used |
| 16 | Steer a message with a picture into the running Codex turn | `f0e59ab6e` | New today (patch 0007) |
| 17 | Maintenance: size ratchets, test fits, goldens and budgets | `36ccf1815`, `914325459`, `1c6e83793`, `c1f4cbf18`, `ddf80ebf5` | No feature; needed to keep upstream's checks green |

## Not on this branch

- Open PR branches on the fork: mutual bot pairs (#5, #7), sidebar/Channels rename (#6), hide call messages (#1), pairing lifetime, and the stale duplicates (#8, #9). They are judged in the feature-cut table only.
- The three Mac-only lines from the addendum (Slack bridge with its uncommitted work, Cloud-PC pill UI, Paperclip ticket tool). They are being ported to a separate local branch `hsp/rebase-2026-11-13-mac`, so this branch stays equal to the live line until you decide on them.
