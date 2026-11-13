#!/usr/bin/env bash
# Runs the whole app locally.
#   ./start.sh          set up (first run) and start: database, migrations, build, web app
#   ./start.sh stop     stop the database (the web app stops with Ctrl+C)
#   ./start.sh reset    delete ALL data: database and stored statements (asks first)
#   ./start.sh backup   save an encrypted backup of the database and statements to backups/
#   ./start.sh restore <file>   replace all data with a backup (asks first)
#   ./start.sh schedule-backups   back up every night at 03:00 (macOS; prints a cron line elsewhere)
#   ./start.sh phone    open the app from your phone over Tailscale (private HTTPS); "phone off" stops it
# NO_OPEN=1 skips opening the browser.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required ($2)"; }
port_free() { ! (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
free_port() { local p=$1; while ! port_free "$p"; do p=$((p + 1)); done; echo "$p"; }
# URL-safe random secret
secret() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32; }

need docker "https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 || die "Docker is installed but not running. Start Docker Desktop and try again."

load_env() {
  [ -f .env ] || die "No .env yet: run ./start.sh first."
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
}

# Backups: one file holding a database dump and the stored statements (already encrypted on
# disk), encrypted with BACKUP_PASSPHRASE from .env. Restoring also needs FILE_ENCRYPTION_KEY,
# so keep a copy of .env somewhere safe (a password manager), apart from the backups.
BACKUP_KEEP=14
# temporary directories (they can hold a decrypted dump) are removed however the script ends
TMP_DIRS=""
trap 'for d in $TMP_DIRS; do rm -rf "$d"; done' EXIT
# sets WORK (not via $(...), whose subshell would lose the TMP_DIRS update)
new_tmpdir() { WORK=$(mktemp -d); TMP_DIRS="$TMP_DIRS $WORK"; }
ensure_backup_passphrase() {
  if [ -z "${BACKUP_PASSPHRASE:-}" ]; then
    BACKUP_PASSPHRASE=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-40)
    printf '# encrypts backups (./start.sh backup); without it a backup cannot be restored\nBACKUP_PASSPHRASE=%s\n' "$BACKUP_PASSPHRASE" >> .env
    export BACKUP_PASSPHRASE
  fi
}
has_data() {
  [ "$(docker compose exec -T postgres psql -U finance -d finance -tAc "select to_regclass('public.transaction') is not null" 2>/dev/null)" = "t" ]
}
backup() {
  ensure_backup_passphrase
  local dir="${BACKUP_DIR:-$ROOT/backups}" stamp work file
  stamp=$(date +%Y%m%d-%H%M%S)
  mkdir -p "$dir"
  new_tmpdir
  work=$WORK
  docker compose exec -T postgres pg_dump -U finance -d finance -Fc > "$work/database.dump" || die "The database dump failed"
  [ -d "${BLOB_DIR:-}" ] && cp -R "$BLOB_DIR" "$work/blobs"
  printf 'created=%s\nformat=1\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$work/manifest"
  file="$dir/finance-$stamp.tar.enc"
  (umask 077 && tar -C "$work" -cf - . | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_PASSPHRASE -out "$file") || die "Writing the backup failed"
  # keep the newest $BACKUP_KEEP
  ls -1t "$dir"/finance-*.tar.enc 2>/dev/null | tail -n +$((BACKUP_KEEP + 1)) | while read -r old; do rm -f "$old"; done
  say "Backup saved: $file"
}
latest_backup_age_hours() {
  local newest
  newest=$(ls -1t "${BACKUP_DIR:-$ROOT/backups}"/finance-*.tar.enc 2>/dev/null | head -1)
  [ -n "$newest" ] || { echo 999999; return; }
  echo $(( ($(date +%s) - $(stat -f %m "$newest" 2>/dev/null || stat -c %Y "$newest")) / 3600 ))
}
restore() {
  local file="${1:-}"
  [ -n "$file" ] && [ -f "$file" ] || die "Usage: ./start.sh restore backups/finance-YYYYMMDD-HHMMSS.tar.enc"
  [ -n "${BACKUP_PASSPHRASE:-}" ] || die "BACKUP_PASSPHRASE is missing from .env, so the backup can't be decrypted"
  port_free "${PORT:-3000}" || die "The app is running. Stop it (Ctrl+C) before restoring."
  printf 'This replaces ALL current data with the backup %s. Type "restore" to continue: ' "$(basename "$file")"
  read -r answer
  [ "$answer" = "restore" ] || die "Cancelled"
  local work
  new_tmpdir
  work=$WORK
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_PASSPHRASE -in "$file" | tar -C "$work" -xf - || die "Couldn't decrypt the backup (wrong BACKUP_PASSPHRASE?)"
  [ -f "$work/database.dump" ] || die "This file isn't a backup made by ./start.sh backup"
  docker compose up -d --wait --quiet-pull postgres || die "The database didn't start"
  # a safety copy of what is about to be replaced
  if has_data; then say "Saving the current data first"; backup; fi
  # the app role is cluster-wide; on a fresh database it doesn't exist yet
  docker compose exec -T postgres psql -U finance -d finance -qc "DO \$\$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'finance_app') THEN CREATE ROLE finance_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; END IF; END \$\$;" >/dev/null
  docker compose exec -T postgres psql -U finance -d finance -qc "SET client_min_messages = warning; DROP SCHEMA public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;" >/dev/null
  docker compose exec -T postgres pg_restore -U finance -d finance --no-owner --exit-on-error < "$work/database.dump" || die "Restoring the database failed"
  if [ -d "$work/blobs" ]; then
    [ -d "$BLOB_DIR" ] && mv "$BLOB_DIR" "$BLOB_DIR.before-restore-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$(dirname "$BLOB_DIR")" && cp -R "$work/blobs" "$BLOB_DIR"
  fi
  say "Restored. Run ./start.sh to start the app."
}
schedule_backups() {
  if [ "$(uname)" = "Darwin" ]; then
    local label="local.finance-tracker.backup" plist="$HOME/Library/LaunchAgents/local.finance-tracker.backup.plist"
    mkdir -p "$HOME/Library/LaunchAgents" "$ROOT/backups"
    cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key><array><string>$ROOT/start.sh</string><string>backup</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>0</integer></dict>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string></dict>
  <key>StandardOutPath</key><string>$ROOT/backups/backup.log</string>
  <key>StandardErrorPath</key><string>$ROOT/backups/backup.log</string>
</dict></plist>
PLIST
    launchctl unload "$plist" 2>/dev/null || true
    launchctl load "$plist"
    say "Nightly backups scheduled at 03:00 (log: backups/backup.log). If the Mac is asleep then, it runs on wake."
    say "To stop them: launchctl unload $plist && rm $plist"
  else
    say "Add this line with 'crontab -e' for a nightly backup at 03:00:"
    echo "0 3 * * * cd $ROOT && ./start.sh backup >> $ROOT/backups/backup.log 2>&1"
  fi
}

# set KEY=value in .env (replacing an existing line)
set_env() {
  if grep -q "^$1=" .env; then
    sed -i.bak "s|^$1=.*|$1=$2|" .env && rm -f .env.bak
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

# Phone access through Tailscale: a private network between your own devices. `tailscale serve`
# gives this computer an HTTPS address reachable only from devices signed in to your Tailscale
# account, and forwards it to the app, which keeps listening on this computer only.
tailscale_cli() {
  if command -v tailscale >/dev/null 2>&1; then command -v tailscale
  elif [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ]; then echo /Applications/Tailscale.app/Contents/MacOS/Tailscale
  else return 1
  fi
}
phone() {
  local ts name
  ts=$(tailscale_cli) || die "Tailscale isn't installed. Install it on this computer and on your phone (https://tailscale.com/download), sign in to the same account on both, then run ./start.sh phone again."
  if [ "${1:-}" = "off" ]; then
    "$ts" serve --https=443 off >/dev/null 2>&1 || true
    set_env ALLOWED_ORIGINS ""
    say "Phone access stopped. Restart the app (Ctrl+C, then ./start.sh) to apply."
    return
  fi
  "$ts" status >/dev/null 2>&1 || die "Tailscale is installed but not connected. Open it, sign in, and try again."
  name=$("$ts" status --json | node -e 'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(((JSON.parse(s).Self||{}).DNSName||"").replace(/\.$/,"")))')
  [ -n "$name" ] || die "Couldn't read this computer's Tailscale name. Turn on MagicDNS in the Tailscale admin console (DNS page) and try again."
  "$ts" serve --bg "http://127.0.0.1:${PORT:-3000}" || die "Tailscale couldn't set up HTTPS. In the Tailscale admin console (DNS page) turn on MagicDNS and HTTPS certificates, then try again."
  set_env ALLOWED_ORIGINS "$name"
  say "On your phone (Tailscale on, same account), open: https://$name"
  say "Restart the app now (Ctrl+C, then ./start.sh) so it accepts that address. To stop: ./start.sh phone off"
}

case "${1:-start}" in
  stop)
    say "Stopping the database"
    docker compose stop
    exit 0
    ;;
  reset)
    printf 'This deletes the database and every stored statement. Type "delete" to continue: '
    read -r answer
    [ "$answer" = "delete" ] || die "Cancelled"
    docker compose down -v
    rm -rf "$ROOT/data/blobs"
    say "All data deleted. Your settings in .env were kept; run ./start.sh to start fresh."
    exit 0
    ;;
  backup)
    load_env
    docker compose up -d --wait --quiet-pull postgres || die "The database didn't start"
    backup
    exit 0
    ;;
  restore)
    load_env
    restore "${2:-}"
    exit 0
    ;;
  schedule-backups)
    load_env
    schedule_backups
    exit 0
    ;;
  phone)
    load_env
    need node "https://nodejs.org (version 22 or newer)"
    phone "${2:-}"
    exit 0
    ;;
  start) ;;
  *) die "Unknown command: $1 (use start, stop, reset, backup, restore, schedule-backups or phone)" ;;
esac

need node "https://nodejs.org (version 22 or newer)"
need pnpm "npm install -g pnpm"
need openssl "it ships with macOS and most Linux distributions"

# 1. settings: generated once, then reused (the database keeps the password it was created with)
if [ ! -f .env ]; then
  project=$(basename "$ROOT" | tr '[:upper:]' '[:lower:]')
  if docker volume inspect "${COMPOSE_PROJECT_NAME:-$project}_pgdata" >/dev/null 2>&1; then
    die "A database from an earlier setup exists but .env is missing, so its password is unknown. Restore .env, or run ./start.sh reset."
  fi
  say "First run: creating .env with generated passwords and keys"
  pg_password=$(secret)
  app_password=$(secret)
  db_port=$(free_port 5432)
  app_port=$(free_port 3000)
  umask 077
  cat > .env <<ENV
# Generated by start.sh. Keep this file private, and back up FILE_ENCRYPTION_KEY:
# without it, stored statements and two-factor enrollments can't be read.
POSTGRES_PASSWORD=$pg_password
DB_PORT=$db_port
MIGRATION_DATABASE_URL=postgres://finance:$pg_password@127.0.0.1:$db_port/finance
APP_DB_PASSWORD=$app_password
DATABASE_URL=postgres://finance_app:$app_password@127.0.0.1:$db_port/finance
FILE_ENCRYPTION_KEY=$(openssl rand -base64 32)
BLOB_DIR=$ROOT/data/blobs
# plain http on localhost; set to true behind HTTPS
COOKIE_SECURE=false
# 127.0.0.1 = this computer only. 0.0.0.0 makes it reachable from your network.
HOST=127.0.0.1
PORT=$app_port
# The assistant ("שאלו את הכספים") is off by default. To turn it on, set a Claude API key and
# AI_ENABLED=true. Questions and the data the assistant retrieves are then sent to Anthropic.
# ANTHROPIC_API_KEY=sk-ant-...
AI_ENABLED=false
ENV
fi
set -a
# shellcheck disable=SC1091
source .env
set +a
export NEXT_TELEMETRY_DISABLED=1
PORT=${PORT:-3000}
port_free "$PORT" || die "Port $PORT is in use (is the app already running?). Change PORT in .env or stop the other process."

# 2. database
say "Starting the database"
# --wait blocks until the healthcheck in docker-compose.yml passes
docker compose up -d --wait --quiet-pull postgres || die "The database didn't start; see: docker compose logs postgres"

# 3. code
say "Installing dependencies"
pnpm install --frozen-lockfile --reporter=silent
say "Building (a minute the first time, fast afterwards)"
pnpm build >/tmp/finance-tracker-build.log 2>&1 || { tail -30 /tmp/finance-tracker-build.log; die "Build failed (full log: /tmp/finance-tracker-build.log)"; }

# 4. schema and the restricted app role, after a backup when the last one is over a day old
if has_data && [ "$(latest_backup_age_hours)" -ge 24 ]; then
  say "Backing up before updating the database"
  backup
fi
say "Updating the database schema"
pnpm --silent --filter @ft/db migrate

# 5. run
mkdir -p "$BLOB_DIR"
URL="http://localhost:$PORT"
say "Starting the app at $URL  (Ctrl+C to stop)"
(
  for _ in $(seq 1 60); do
    curl -s -o /dev/null "$URL/login" && break
    sleep 1
  done
  [ -n "${NO_OPEN:-}" ] && exit 0
  if command -v open >/dev/null 2>&1; then open "$URL"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"; fi
) &
cd apps/web
# this machine only by default; HOST=0.0.0.0 in .env exposes it to your network (use HTTPS then)
exec pnpm exec next start -p "$PORT" -H "${HOST:-127.0.0.1}"
