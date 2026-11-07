# Finance Tracker

A private, self-hosted household finance app (Hebrew, RTL): imports Israeli bank and credit-card
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

Back up `.env` (especially `FILE_ENCRYPTION_KEY`): without it, stored statements and two-factor
enrollments can't be read. The app listens on this computer only; set `HOST=0.0.0.0` in `.env` to
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
