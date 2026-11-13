# Finance Tracker

A private, self-hosted household finance app (Hebrew and English): imports Israeli bank and credit-card
statements (Leumi, Isracard, Cal, Max), categorizes transactions, and shows where the money goes.

## Run it

Requirements: Docker (running), Node.js 22+, pnpm.

```bash
./start.sh
```

The first run creates `.env` with generated passwords and keys, starts Postgres, builds the app,
applies migrations and opens http://localhost:3000. Later runs reuse the same settings.

- `./start.sh stop`: stop the database (stop the app with Ctrl+C)
- `./start.sh reset`: delete all data (database and stored statements); asks first

### Backing up

- `./start.sh backup`: save an encrypted backup (database + stored statements) to `backups/`;
  the newest 14 are kept. One is also taken automatically before the database is updated, when
  the last one is over a day old.
- `./start.sh schedule-backups`: back up every night at 03:00 (macOS launchd; prints a cron
  line on Linux).
- `./start.sh restore backups/finance-….tar.enc`: replace all data with a backup (stop the app
  first; asks first, and backs up the current data before replacing it).

Backups are encrypted with `BACKUP_PASSPHRASE`, and restored statements need
`FILE_ENCRYPTION_KEY`; both live in `.env`. Keep a copy of `.env` somewhere safe (a password
manager), separate from the backups: without it a backup can't be used. Copy `backups/` to
another disk or cloud folder from time to time; a backup on the same disk doesn't survive that
disk.

### From your phone

`./start.sh phone` makes the app reachable from your phone over [Tailscale](https://tailscale.com/download),
a free private network between your own devices: install it on this computer and on the phone and
sign in to the same account on both (in the Tailscale admin console, DNS page: turn on MagicDNS
and HTTPS certificates). The command prints a private `https://…ts.net` address; restart the app,
open the address on the phone, and use "Add to Home Screen" to open it like an app. The app keeps
listening on this computer only, so it isn't exposed to your Wi-Fi or the internet, and only
devices signed in to your Tailscale account can reach it. `./start.sh phone off` stops it.

The app listens on this computer only; set `HOST=0.0.0.0` in `.env` to
reach it from your network, and put it behind HTTPS (then also set `COOKIE_SECURE=true`).

## The assistant

"שאלו את הכספים" answers questions about your data using Claude (`claude-opus-5-5`). It is off by
default; to enable it add `ANTHROPIC_API_KEY=...` and `AI_ENABLED=true` to `.env` and restart.
It only reads data, through the same analytics the screens use, and every number in an answer is
checked against the data it retrieved. Questions and the retrieved data are sent to Anthropic;
statement files and account numbers are not.

## Develop

```bash
pnpm test        # all packages (integration tests start Postgres in Docker)
pnpm typecheck
```

Design and roadmap: [docs/design.md](docs/design.md).
