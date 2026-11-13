#!/usr/bin/env bash
# Post-deploy health check, run by the GitHub Actions runner as its own
# (unprivileged) user after omb-hsp-deploy swaps a folder in. Exits non-zero
# on the first failure; the workflow then rolls back.
#
#   health-check.sh <hspNN> [expected-version]
#
# Checks: the service is active and its main process runs from <hspNN>; it
# stays up with no restarts for SETTLE_SECONDS; the site and /api/health
# answer 200; the installed package has the expected version. The server's
# own checks (box self-check, Ada's cua checks) run afterwards through
# `sudo omb-hsp-deploy checks`, from /etc/omb-hsp-deploy/checks.d.
set -euo pipefail

folder=${1:?usage: health-check.sh <hspNN> [expected-version]}
expected=${2:-}
[[ "$folder" =~ ^hsp[0-9]{1,4}$ ]] || { echo "bad folder '$folder'" >&2; exit 2; }

# deploy.env holds no secrets and is world-readable.
# shellcheck source=deploy.env.example
. /etc/omb-hsp-deploy/deploy.env
PACKAGE=${PACKAGE:-openmausbot}
PORT=${PORT:?PORT missing from deploy.env}
SITE_URL=${SITE_URL:-http://127.0.0.1:$PORT/}
API_URL=${API_URL:-http://127.0.0.1:$PORT/api/health}
START_TIMEOUT=${START_TIMEOUT:-120}
SETTLE_SECONDS=${SETTLE_SECONDS:-60}

fail() { echo "FAIL: $*"; echo "--- last journal lines"; journalctl -u "$SERVICE" -n 60 --no-pager 2>/dev/null || true; exit 1; }
pass() { echo "PASS: $*"; }
prop() { systemctl show "$SERVICE" -p "$1" --value; }

# 1. Expected version is what the folder holds.
pkg="$BASE_DIR/$folder/node_modules/$PACKAGE/package.json"
[ -f "$pkg" ] || fail "$pkg is missing"
installed=$(sed -n 's/^  "version": *"\([^"]*\)".*/\1/p' "$pkg" | head -1)
if [ -n "$expected" ]; then
  [ "$installed" = "$expected" ] || fail "$folder holds $PACKAGE $installed, expected $expected"
fi
pass "$folder holds $PACKAGE $installed"

# 2. The service comes up and its health endpoint answers.
deadline=$((SECONDS + START_TIMEOUT))
until [ "$(prop ActiveState)" = active ] && curl -fsS -o /dev/null --max-time 5 "$API_URL"; do
  [ $SECONDS -lt $deadline ] || fail "$SERVICE not active with a healthy API after ${START_TIMEOUT}s (state $(prop ActiveState)/$(prop SubState))"
  sleep 2
done
pass "$SERVICE active, API answering"

# 3. The running process is the new folder's.
pid=$(prop MainPID)
[ "$pid" != 0 ] || fail "$SERVICE has no main process"
cmdline=$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)
case "$cmdline" in
  *"$BASE_DIR/$folder/"*) pass "main process $pid runs from $folder" ;;
  *) fail "main process $pid does not run from $BASE_DIR/$folder: $cmdline" ;;
esac

# 4. No crash loop: same pid and restart count after a settle window.
restarts=$(prop NRestarts)
echo "waiting ${SETTLE_SECONDS}s for a crash loop to show"
sleep "$SETTLE_SECONDS"
[ "$(prop ActiveState)" = active ] || fail "$SERVICE left active during the settle window"
[ "$(prop MainPID)" = "$pid" ] || fail "main process changed $pid -> $(prop MainPID) (it restarted)"
[ "$(prop NRestarts)" = "$restarts" ] || fail "restart count went $restarts -> $(prop NRestarts)"
pass "no restarts in ${SETTLE_SECONDS}s"

# 5. Site and API both 200.
for url in "$SITE_URL" "$API_URL"; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$url" || echo 000)
  [ "$code" = 200 ] || fail "$url answered $code"
  pass "$url 200"
done
curl -fsS --max-time 10 "$API_URL" | grep -q '"app":"openmausbot"' || fail "$API_URL is not an openmausbot server"
pass "API identifies as openmausbot"
