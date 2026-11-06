# Plan: Household Finance Tracker (per `plan.md`)

## Context
`plan.md` (repo root) specifies a Hebrew-first, RTL, ILS-based personal/household finance platform: statement ingestion, categorization, merchant intelligence, dashboards, insights, health score, forecasting, an AI assistant, and household (couple) management. The repo is greenfield (only `plan.md`). This plan covers plan.md's Phases 1–6 (discovery → implementation roadmap). Coding starts only after you approve it.

**Decisions so far (from you):**
- Self-hosted and private, one household (you + partner). `household_id` is still on every row so multi-tenant stays possible.
- Phase-1 ingestion: **CSV/XLSX and PDF** uploads. Bank scrapers come later as another source adapter.
- Stack: **TypeScript full-stack**, Next.js + PostgreSQL + Drizzle.
- AI: **Claude API, tool-calling only**. No raw tables in prompts, every number comes from a tool result, and a feature flag turns it off.
- Institutions: **Isracard, Max, Cal**, plus bank accounts (exact banks to be confirmed from your sample files).

---

## 1. Discovery: gaps, challenges, and where I disagree with plan.md
Missing requirements I'm adding:
1. **What "savings" means.** Savings = income − real expenses. Transfers to savings or investment accounts count as savings, not expenses. Otherwise the savings rate is wrong.
2. **Card settlement de-duplication.** The monthly "ישראכרט/מקס/כאל" debit in the bank account must be matched to that card's billing-cycle total and marked `card_settlement`, which is excluded from expenses. This is the biggest correctness risk.
3. **Installments (תשלומים).** By default, expenses are counted when each installment is charged (cash basis). The original purchase amount and installment n/m are stored, and a setting can switch to the purchase-date view.
4. **Foreign-currency charges.** Card exports show the original amount and currency plus the billed ILS amount. Store both, and report in ILS using the billed amount (not a FX recalculation).
5. **Pending vs. posted (בקליטה).** Pending rows get replaced when the posted version arrives. Duplicate detection has to handle this.
6. **Purchase date vs. billing date.** Analytics use the purchase date. Cash flow uses the bank debit date.
7. **Bit / PayBox / cash withdrawals.** These are mostly opaque. Each gets its own kind and review queue: transfer to a person, split-the-bill income, cash spend.
8. **Balances.** The emergency-savings score and balance projection need opening/current balances. Bank exports often include a running balance. Where they don't, the user enters a manual balance snapshot. Without a balance, the feature shows "insufficient data" instead of a number.
9. **Backup, restore, and export.** Encrypted DB dump plus CSV export of all data. This is non-negotiable for a self-hosted finance app.
10. **PDF reliability.** PDF parsing is brittle. Every PDF import is **reconciled against the statement total printed on the PDF**. An import that doesn't reconcile can't be committed without explicit user override.

Where I disagree:
- "Learns from corrections" is done with deterministic rules plus nearest-neighbour matching on your history, not a trained ML model. It's explainable and works with little data.
- The health score refuses to show a total until there are ≥3 full months of data. Each dimension can show "insufficient data" on its own.
- "Upcoming known payments" come only from recurring detection and user-entered items. Nothing is invented.

## 2. Functional design

**Modules** (packages with one-way dependencies):
`ingestion → normalization → classification (merchants + categories + kinds) → ledger → analytics → {recurring, anomalies, forecasting} → health-score / insights → assistant`
Household scoping is a cross-cutting `Scope` value (household + view: individual/household/comparison + member) passed into every query.

**Import workflow:** Upload → store an encrypted original file and its SHA-256 (the same file can't be imported twice) → detect institution and format → parser emits `raw_rows` (kept forever) → normalize → dedup check → classify → **preview screen** (row counts, reconciliation against the statement total, duplicates, low-confidence rows) → commit, or discard.
Reprocessing: when the parser version is bumped, re-run on the stored raw rows. Manual overrides are never overwritten.

**Transaction lifecycle:** `imported(pending) → posted → classified → (reviewed) → [superseded | split | merged]`. Every edit writes to `audit_log`.

**Transaction kinds** (separate from category): `expense, income, refund, reversal, internal_transfer, card_settlement, savings_investment, fee, cash_withdrawal, p2p_transfer, loan_payment`. Only `expense`/`fee` (minus refunds) count toward spending, and only `income` counts toward income.

**Categorization pipeline** (first match wins, and each result records its source and confidence):
1. Manual override on the transaction
2. User rules (merchant / description regex / amount range / account → category, kind, member)
3. Merchant's assigned category
4. Seeded Israeli merchant dictionary plus the card's industry field (ענף), which Isracard/Max/Cal exports include
5. Nearest neighbour over your corrected history (normalized-description token similarity)
6. Claude Haiku fallback: only the merchant string goes to the API, never amounts or identity
7. Anything with confidence below the threshold goes to the **Review queue**. When you correct a transaction, the app offers "apply to all past and future for this merchant", which creates a rule or merchant mapping.

**Merchant normalization:** a cleaning pipeline strips processor prefixes (PAYPAL *, SQ *, BIT, PAYBOX), branch numbers, cities, and digits → `merchant_alias` lookup → canonical `merchant`. Merge, split, and rename write alias rows, so future imports learn from them.

**Insights workflow:** a nightly job (and one after each import) runs detectors (category vs. 3-month median, subscriptions total, merchant price increases, duplicate charges, MAD-based anomaly, budget thresholds) → each `recommendation` gets what / why / impact ₪ / action / confidence / evidence transaction ids → ranked by impact × confidence. A detector emits nothing if it doesn't have its minimum history.

## 3. Data model (PostgreSQL via Drizzle)
Conventions: UUID primary keys. Money is stored as `bigint` agorot (minor units) plus a `currency` char(3); never floats. Every domain table has `household_id`, `created_at`, `updated_at`. RLS policies on `household_id` act as a second safety net even when self-hosted.

| Entity | Key fields / notes |
|---|---|
| `household`, `user`, `household_member` | member role: `admin / member / viewer` |
| `account` | type `bank / credit_card / savings / investment / cash`, institution, masked number (last 4), `owner_member_id` (nullable = shared), `visibility` (`shared/private`), `settles_to_account_id` for cards |
| `import_file` | sha256 unique, encrypted blob path, institution, parser + version, status, reconciliation result, stats |
| `raw_row` | import_file_id, row_index, JSON payload (immutable) |
| `transaction` | account_id, raw_row_id, `fingerprint` (unique per account), purchase_date, posting_date, amount, currency, original_amount/currency, description_raw, description_norm, merchant_id, category_id, kind, status (`pending/posted`), installment_no/total, member_id, is_shared, classification_source + confidence, `superseded_by`, `settlement_group_id` |
| `transaction_split` | split one transaction across categories or members |
| `merchant`, `merchant_alias` | alias pattern + match type; merge history |
| `category` | tree (parent_id), type `expense/income`, system or custom, i18n names (he/en) |
| `categorization_rule` | priority, conditions JSON, actions JSON, created_from_correction |
| `card_settlement` | links a bank transaction ↔ card account + billing cycle; matched_amount, diff |
| `recurring_series` | merchant/pattern, cadence, expected amount ± tolerance, next_expected_date, status |
| `balance_snapshot` | account, date, balance, source (`import/manual`) |
| `budget`, `budget_period` | category/member/household scope, monthly limit, alert thresholds |
| `goal` | type `save_amount / category_cap / reduce_pct / savings_rate`, target, deadline, shared/member |
| `recommendation` | detector, payload, impact, confidence, evidence ids, status (`new/dismissed/done`) |
| `health_score_snapshot` | month, total (nullable), per-dimension JSON, config version |
| `forecast_run`, `scenario` | assumptions JSON, monthly output series with P10/P50/P90 |
| `assistant_conversation`, `assistant_message` | tool calls + results stored for traceability |
| `audit_log` | actor, entity, before/after JSON, reason |

Key indexes: `transaction(household_id, purchase_date)`, `(household_id, category_id, purchase_date)`, `(household_id, merchant_id, purchase_date)`, `(account_id, fingerprint)` unique, trigram GIN index on `description_norm`. Monthly aggregates live in a materialized view `monthly_agg(household, member, category, merchant, kind, month)`, refreshed after commits.

Dedup fingerprint = hash(account, purchase_date, amount, normalized description, same-key occurrence index). A second fuzzy pass matches pending→posted (±3 days, same amount, similar description) and cross-file overlaps.

## 4. Architecture
- **Monorepo** (pnpm + Turborepo):
  - `apps/web`: Next.js App Router, server actions + route handlers, Auth.js
  - `apps/worker`: pg-boss jobs (parse, classify, aggregates, insights, forecasts)
  - `packages/db`: Drizzle schema, migrations, RLS, seed
  - `packages/parsers`: one adapter per institution/format behind a `SourceAdapter` interface (`detect()`, `parse()`, `statementTotals()`)
  - `packages/core`: normalization, classification, ledger rules, settlement matcher, analytics queries, recurring, anomalies, health score, forecasting. Pure TypeScript, unit-testable.
  - `packages/assistant`: Claude tool definitions and orchestration
  - `packages/ui`: shared components
- **File processing:** XLSX via `exceljs`, CSV via `papaparse` (handles Windows-1255 and UTF-8 BOM), PDF via `pdfjs-dist` text extraction with x/y positions → per-institution layout rules. Optional Claude PDF extraction fallback, used only if its output reconciles with the statement total.
- **Analytics engine:** SQL over `monthly_agg` plus typed query functions shared by the dashboards **and** the assistant tools, so both always report the same numbers.
- **Forecasting:** deterministic components: known recurring series + user-entered expected items + per-category median of variable spend with seasonal adjustment (month-of-year factor once ≥12 months of data exist). P10/P90 bands come from bootstrapping historical residuals. Scenarios are applied as overlays on the base run.
- **Health score:** a configurable JSON of weights and thresholds per dimension (savings rate, income/expense ratio, cash-flow volatility, fixed-costs % of income, spending consistency, debt, emergency months, goal progress). Each dimension returns `{score|null, inputs, explanation}`, and the total is reweighted over the dimensions that have data.
- **AI assistant:** Claude (`claude-opus-5-5` for chat, `claude-haiku-5-5` for categorization fallback) with tools: `query_transactions`, `aggregate_spending`, `compare_periods`, `get_recurring`, `get_forecast`, `run_scenario`, `get_budgets_goals`, `get_health_score`. Tools are enforced server-side to the caller's Scope and permissions. The system prompt requires every figure to cite a tool result. Answers render claims tagged as fact / estimate / prediction / recommendation, with "show transactions" links. A post-check flags any number in the answer that doesn't appear in the tool outputs.
- **Security:** Docker Compose (web, worker, postgres), bound to localhost/LAN or behind Tailscale. Auth.js credentials with argon2 + mandatory TOTP. Uploaded files AES-256-GCM encrypted with a key from env. Postgres volume on an encrypted disk. Strict CSP. No third-party analytics. Every outbound call goes only to the Anthropic API, behind a feature flag. Audit log for imports and edits. Encrypted nightly `pg_dump`.
- **i18n/RTL:** `next-intl`, Hebrew default with `dir="rtl"`, English toggle. Tailwind logical properties (`ms-`/`pe-`). Formatting via `Intl.NumberFormat('he-IL', {currency:'ILS'})`. Charts via ECharts (good RTL and locale support); numbers keep LTR isolation.

## 5. UI/UX
**Sitemap:** Dashboard · Transactions (table, filters, bulk edit, splits) · Review queue · Expenses (category / merchant / time) · Income · Cash flow · Recurring · Merchants → Merchant detail · Insights · Budgets & Goals · Forecast & Scenarios · Health score · Assistant (full page + side drawer) · Imports (upload, preview, history) · Settings (accounts, members, categories, rules, aliases, permissions, AI toggle, backup).

**Global header:** a view switcher (Household / me / partner / Compare) and a date-range picker that every screen and the assistant follow.

**Dashboard layout:** row 1 is KPI tiles (income, expenses, net, savings rate, each vs. the 3-month average) plus the health-score gauge. Row 2 is the top 3 insights as action cards. Row 3 is a category donut + month-over-month bars and income vs. expenses with the forecast drawn dashed. Row 4 is budgets nearing their limit, upcoming recurring payments, and the review-queue count.

Wireframes and mockups are the first task in Milestone 1 (HTML mockups to review before building screens). The component breakdown follows the sitemap: `KpiTile`, `InsightCard`, `CategoryDonut`, `TrendChart`, `TxTable`, `MerchantBadge`, `ScopeSwitcher`, `ImportPreview`, `ScoreGauge`, `ScenarioEditor`, `ChatPanel`.

## 6. Roadmap
The schema includes household, member ownership, `kind`, and settlement fields **from the first migration**, so later phases don't require a remodel.

**MVP = A + B + C-core**
- **A – Data foundation:** monorepo, Docker, auth + TOTP, the full core schema, Isracard/Max/Cal CSV/XLSX + PDF adapters, bank adapter(s) from your samples plus a generic column-mapping CSV adapter, import preview and reconciliation, dedup, merchant normalization, categorization pipeline (steps 1–5 and 7), review queue, rules UI, audit log, card-settlement matcher.
  *Acceptance:* re-importing the same or overlapping files creates 0 duplicates. Every PDF import reconciles to the statement total. Card settlements are excluded from expenses. ≥85% of transactions are auto-classified after 1 month of corrections.
- **B – Core dashboard:** overview KPIs, category / merchant / time analytics with drill-down, income, cash flow, large transactions, Hebrew/RTL.
  *Acceptance:* dashboard totals equal the sum of the underlying ledger in tests, with category drill-down at parity.
- **C-core – Household:** two members, account ownership → automatic transaction ownership, shared flag, individual/household/comparison views, admin/member/viewer permissions, private-account visibility.

**Incremental**
- **D – Intelligence:** recurring detection, anomaly and duplicate-charge detectors, merchant detail page with merge/split, recommendations engine, health score + history.
- **E – Planning:** budgets with alerts, goals, forecasting with bands, what-if scenarios, balance snapshots / projected balance.
- **F – AI assistant:** tool layer over the shared analytics functions, chat UI, citations, number-verification check, Haiku categorization fallback (step 6).
- **Later:** israeli-bank-scrapers adapter, mobile polish, multi-household.

For each phase, implementation will produce: the migration(s), `packages/core` functions with unit tests, the API surface (server actions), the screens, and the acceptance tests listed above.

## Prerequisite from you
**Anonymized sample exports** (1–2 months) from each institution, in every format you have (CSV/XLSX/PDF), including at least one bank statement that shows a card settlement debit. Parsers and their golden tests are built from these, and they also tell us which banks to support.

## Verification
- **Unit (Vitest):** parsers via golden fixtures (sample file → expected normalized JSON), money math, fingerprint/dedup property tests (fast-check), settlement matcher, categorization precedence, health score with insufficient-data cases, forecast determinism.
- **Integration:** Testcontainers Postgres. Import → commit → aggregates; reprocess after a parser bump keeps manual overrides; RLS blocks cross-household reads; assistant tools respect Scope.
- **E2E (Playwright):** upload → preview → commit → dashboard numbers; correct a category → rule applied historically; RTL snapshot tests in Hebrew and English.
- **Assistant evals:** a fixed question set over a seeded dataset. Every number in an answer must match a tool output, and "insufficient data" cases must be refused.
- **Manual:** `docker compose up`, import your real files, and reconcile one month against your bank/card statements by hand.
