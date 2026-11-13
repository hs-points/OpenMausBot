# Deploying to the hsp server from GitHub Actions

`.github/workflows/deploy-hsp.yml` deploys an openmausbot release to the hsp
server without SSH. A GitHub Actions runner on the server picks up the job and
does what you do by hand today:

1. Install `openmausbot@<version>` from npm into a new `/opt/hsp-openmausbot/hspNN`
   folder, as `omb-hsp`. Or skip this and take a folder that already exists.
2. Back up `team.conf` as `team.conf.bak-<old>-pre-<new>-<date-time>`, point it
   at the new folder, `daemon-reload`, restart `openmausbot-hsp`.
3. Check: the service is active and runs from the new folder, no restarts
   during a settle window (default 60 s), the site and `/api/health` answer
   200, the folder holds the expected version, then every script in
   `/etc/omb-hsp-deploy/checks.d` passes (your box self-check and Ada's cua
   checks go there).
4. If anything fails, restore the backup, restart the old folder, check it
   again, and mark the run failed.

The runner runs as its own user, `omb-runner`, not root. Its only sudo right is
the root-owned helper `/usr/local/sbin/omb-hsp-deploy`, limited to six
subcommands (`current`, `next`, `install`, `swap`, `rollback`, `checks`), and
the helper checks every argument against a strict pattern. The runner cannot
edit the helper, its config, or the checks. Changes to those reach the server
only when you copy them by hand.

| File in this folder | Goes to | Owner, mode |
| --- | --- | --- |
| `omb-hsp-deploy` | `/usr/local/sbin/omb-hsp-deploy` | root, 0755 |
| `deploy.env.example` | `/etc/omb-hsp-deploy/deploy.env` | root, 0644 |
| `sudoers` | `/etc/sudoers.d/omb-hsp-deploy` | root, 0440 |
| `checks.d/*.example` | `/etc/omb-hsp-deploy/checks.d/<name>` | root, 0755 |
| `health-check.sh` | stays in the repo; the workflow runs it | |

## One-time setup on the server

Run these on the server as a user with sudo. Nothing here touches the running
service.

### 1. The runner user

```sh
sudo useradd --system --create-home --home-dir /opt/actions-runner --shell /bin/bash omb-runner
```

Optional: `sudo usermod -aG systemd-journal omb-runner` lets a failed health
check print the service's last journal lines into the run log. Skip it if the
journal holds anything you don't want in Actions logs.

### 2. The helper, its config, sudo rule and checks

From a checkout of this branch on the server (or copy the files over):

```sh
cd deploy/hsp-runner
sudo install -o root -g root -m 0755 omb-hsp-deploy /usr/local/sbin/omb-hsp-deploy
sudo install -d -o root -g root -m 0755 /etc/omb-hsp-deploy /etc/omb-hsp-deploy/checks.d
sudo install -o root -g root -m 0644 deploy.env.example /etc/omb-hsp-deploy/deploy.env
sudo visudo -cf sudoers && sudo install -o root -g root -m 0440 sudoers /etc/sudoers.d/omb-hsp-deploy
```

Edit `/etc/omb-hsp-deploy/deploy.env`. The values that matter:

- `NPM_BIN`: the npm that goes with the Node in the service's `ExecStart`.
  `sudo -u omb-hsp bash -lc 'command -v npm'` tells you.
- `PORT`: 8890, or whatever the instance you're deploying listens on.

### 3. Your own checks

Copy the two examples and put in the commands you run by hand today:

```sh
sudo install -o root -g root -m 0755 checks.d/10-box-selfcheck.example /etc/omb-hsp-deploy/checks.d/10-box-selfcheck
sudo install -o root -g root -m 0755 checks.d/20-cua.example /etc/omb-hsp-deploy/checks.d/20-cua
sudoedit /etc/omb-hsp-deploy/checks.d/10-box-selfcheck /etc/omb-hsp-deploy/checks.d/20-cua
```

Each script runs as root with `SERVICE`, `HSP_DIR`, `HSP_FOLDER`,
`EXPECTED_VERSION` and `PORT` set, and must exit 0 to pass. A check still
holding `REPLACE_WITH_...` fails, so a deploy can't pass by accident. To deploy
before you've written them, leave `checks.d` empty: the run then says
`0 server check(s) ran`.

Try them against what's live now:

```sh
sudo /usr/local/sbin/omb-hsp-deploy current            # prints hsp15
sudo /usr/local/sbin/omb-hsp-deploy checks hsp15 0.1.150
```

### 4. Register the runner

On GitHub: **hs-points/OpenMausBot → Settings → Actions → Runners → New
self-hosted runner → Linux x64**. Use the download commands it shows (they carry
the current version and checksum), run as `omb-runner`:

```sh
sudo -iu omb-runner
# paste the "Download" commands from the GitHub page here, then:
./config.sh --url https://github.com/hs-points/OpenMausBot --token <TOKEN FROM THE PAGE> \
  --name hsp-server --labels omb-hsp --unattended
exit
cd /opt/actions-runner
sudo ./svc.sh install omb-runner
sudo ./svc.sh start
```

The runner only makes outbound HTTPS connections to GitHub. No port opens.

Check it from the runner's side:

```sh
sudo -u omb-runner sudo -n /usr/local/sbin/omb-hsp-deploy current   # hsp15
sudo -u omb-runner sudo -n systemctl restart openmausbot-hsp         # must be refused
```

### 5. Repository settings (the repo is public)

A self-hosted runner on a public repo runs whatever workflow a job sends it,
and a pull request from a fork can carry its own workflow. Before the runner
goes online:

- **Settings → Actions → General → Approval for running fork pull request
  workflows from contributors**: pick **Require approval for all external
  contributors**. Then no stranger's workflow runs until you click approve.
  Don't approve a fork PR that touches `.github/workflows/`.
- Optional: **Settings → Environments → hsp-server** (the first run creates it):
  add yourself as a required reviewer so every deploy waits for your click,
  and limit deployment branches to `main` and tags `hsp-deploy-v*`.

## Deploying

**Actions → Deploy to hsp server → Run workflow**, from `main`:

| version | folder | What happens |
| --- | --- | --- |
| `0.1.154` | `hsp18` | `hsp18` exists: checks it holds 0.1.154, swaps it in |
| empty | `hsp18` | swaps in `hsp18` with whatever version it holds |
| `0.1.155` | empty | installs 0.1.155 into the next free `hspNN`, swaps it in |
| `0.1.155` | `hsp19` | installs 0.1.155 into `hsp19` (must not exist yet), swaps it in |

Or push a tag: `git tag hsp-deploy-v0.1.155 && git push origin hsp-deploy-v0.1.155`
installs 0.1.155 into the next folder and deploys it.

The run summary lists the old and new folders and the `team.conf` backup.

**First run:** version `0.1.154`, folder `hsp18`. That's the pending
hsp15 → hsp18 switch.

### Rolling back by hand

Every swap leaves its backup in `/etc/systemd/system/openmausbot-hsp.service.d/`:

```sh
ls /etc/systemd/system/openmausbot-hsp.service.d/team.conf.bak-*
sudo /usr/local/sbin/omb-hsp-deploy rollback team.conf.bak-hsp15-pre-hsp18-<date-time>
```

Or deploy the old folder through the workflow with just `folder: hsp15`.

### Updating the helper

The workflow and `health-check.sh` update with the repo. `omb-hsp-deploy`,
`deploy.env`, `sudoers` and `checks.d` don't. When this folder changes them,
repeat step 2 (or 3) by hand.
