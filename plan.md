# Project: Personal Finance Management Platform

## 1. Vision & Goals

I want to design and build a modern personal finance management application (web-based dashboard).

The application's purpose is to provide a comprehensive picture of my financial situation by consolidating financial data from multiple sources, analyzing spending and income patterns, and providing actionable financial planning recommendations.

Think of it as a combination of:
- Personal Finance Manager
- Expense & Income Tracker
- Financial Analytics Dashboard
- Personal Financial Advisor

The application should help me understand:
- Where does my money go?
- How much do I actually earn?
- How much do I spend every month?
- Which categories and merchants consume most of my budget?
- How does my financial behavior change over time?
- Where can I save money?
- Am I financially progressing or falling behind?
- What should I change to improve my financial situation?

**Important:** At this stage, focus on planning and designing the application. Do not start implementing code until we have agreed on the requirements, architecture, data model, and UX.

---

## 2. Data Sources & Ingestion

The application should support importing financial data from multiple sources.

### Credit Cards
I want to upload credit card statements and transaction reports.

Potential formats:
- CSV
- Excel (XLSX)
- PDF

The application should extract:
- Transaction date
- Transaction description
- Merchant name
- Amount
- Currency
- Transaction type
- Installment information (if available)
- Credit card identifier
- Transaction status

I may have multiple credit cards from different providers.

### Bank Accounts

I also want to upload bank account transaction reports.

These should include:
- Salaries
- Bank transfers
- Standing orders
- Direct debits
- Deposits
- Withdrawals
- Account fees
- Other bank transactions

Extract:
- Transaction date
- Value date (if available)
- Description
- Amount
- Debit / Credit
- Account identifier
- Balance (if available)

### Data Ingestion Requirements

Design a robust ingestion mechanism that:
1. Supports multiple file formats and financial institutions.
2. Normalizes transactions into a unified internal data model.
3. Detects duplicate transactions.
4. Preserves the original imported data.
5. Allows reprocessing files when parsing logic improves.
6. Tracks the source of every transaction.
7. Allows manual correction of incorrectly parsed transactions.
8. Supports importing additional statements over time without duplicating existing records.

Importing should be a separate workflow with an import history and validation results.

---

## 3. Transaction Classification & Categorization

Every transaction should be automatically classified.

### Expense Categories

Examples:
- Groceries
- Restaurants & Dining
- Shopping
- Transportation
- Fuel
- Housing
- Utilities
- Insurance
- Healthcare
- Entertainment
- Travel & Vacations
- Subscriptions
- Personal Care
- Electronics
- Other

### Income Categories

Examples:
- Salary
- Bonuses
- Freelance / Additional Income
- Investment Income
- Refunds
- Other Income

### Merchant Intelligence

The system should identify merchants and normalize their names.

For example:
- Different representations of the same supermarket should map to one merchant.
- Transactions from the same restaurant should be grouped together.
- Payment processors should not necessarily be treated as the actual merchant.

I want to be able to:
- Change a transaction's category.
- Create custom categories.
- Define automatic categorization rules.
- Assign merchants to specific categories.
- Apply corrections to historical transactions.
- Review transactions that the system cannot confidently classify.

The system should learn from my manual corrections.

---

## 4. Financial Dashboard

Design a modern, intuitive dashboard with the following sections.

### A. Financial Overview

Display:
- Total monthly income
- Total monthly expenses
- Net monthly cash flow
- Savings amount
- Savings rate (%)
- Spending compared to previous months

Include clear visual indicators of financial trends.

### B. Expense Analytics

I want to analyze expenses from different perspectives:

**By Category**
- Pie / donut chart
- Monthly spending per category
- Percentage of total expenses
- Comparison with previous months

**By Merchant**
- Top 10 merchants
- Total spending per merchant
- Number of transactions
- Average transaction amount
- Spending trends per merchant

**By Time**
- Daily expenses
- Weekly expenses
- Monthly expenses
- Year-over-year comparisons

Allow drilling down from a category into individual transactions.

### C. Income Analytics

Display:
- Total monthly income
- Income by source
- Salary history
- Additional income
- Income stability
- Monthly and yearly trends

### D. Cash Flow

Provide a clear picture of money entering and leaving my accounts.

Display:
- Income vs. expenses
- Monthly net cash flow
- Savings over time
- Large or unusual transactions
- Upcoming known payments (when available)

### E. Recurring Expenses

Identify:
- Monthly subscriptions
- Recurring bills
- Insurance payments
- Loan repayments
- Other recurring expenses

Show their monthly and annual cost.

---

## 5. Financial Insights & Recommendations

This is one of the most important features.

The application should not simply display charts. It should analyze the data and proactively provide useful financial recommendations.

Examples:

**Spending Optimization**
- "You spent 25% more on restaurants this month compared to your 3-month average."
- "You spend approximately ₪1,200 per month on food deliveries."
- "Your subscriptions cost ₪450 per month. Consider reviewing unused subscriptions."

**Financial Planning**
- "Your average monthly savings rate is 18%."
- "Based on your current spending, you could save an additional ₪1,500 per month."
- "Your expenses have increased by 12% over the last 3 months."

**Anomaly Detection**
- Detect unusual transactions.
- Identify unexpected increases in spending.
- Detect potential duplicate charges.
- Highlight merchants with significant price increases.

**Actionable Recommendations**

Every recommendation should include:
- What was identified?
- Why does it matter?
- What is the potential financial impact?
- What action should I take?
- How confident is the system in this recommendation?

Recommendations should be data-driven, explainable, and prioritized by potential impact.

Do not invent financial conclusions when insufficient data is available.

---

## 6. Financial Goals & Budgeting

Allow me to define financial goals.

Examples:
- Save ₪50,000 over the next 12 months.
- Keep restaurant expenses below ₪2,000 per month.
- Reduce shopping expenses by 15%.
- Maintain a monthly savings rate of at least 20%.

The system should:
- Track progress toward goals.
- Compare actual spending against budgets.
- Alert me when approaching budget limits.
- Suggest realistic adjustments based on historical behavior.

---

## 7. Technical & Data Considerations

Design the system with the following principles:

- Modular and extensible architecture.
- Clean separation between ingestion, normalization, classification, analytics, and recommendations.
- Support for multiple financial accounts and credit cards.
- Support for multiple currencies, with ILS (₪) as the primary currency.
- Proper handling of refunds, reversals, installments, and transfers.
- Avoid double-counting credit card expenses and their corresponding bank account payments.
- Maintain historical transaction data.
- Support configurable rules and manual overrides.
- Secure storage and processing of highly sensitive financial information.
- Full audit trail for imports and manual modifications.

The system must distinguish between:
- Actual expenses
- Transfers between my own accounts
- Credit card settlement payments
- Income
- Refunds
- Investments and asset movements

These distinctions are essential for accurate financial reporting.

---

## 8. UI / UX Requirements

Design a clean, modern financial dashboard.

Visual direction:
- Professional fintech product.
- Minimalistic and modern.
- Clear charts and data visualizations.
- Easy-to-understand financial metrics.
- Responsive design (desktop first, mobile friendly).

The application should support Hebrew and English, with Hebrew as the primary interface language and full RTL support.

Use ILS formatting by default.

The dashboard should prioritize actionable insights rather than overwhelming users with raw data.

---

## 9. Planning & Design Deliverables

Before writing any code, I want you to work with me through the following phases:

### Phase 1 – Product Discovery
Analyze the requirements and identify:
- Missing requirements
- Potential challenges
- Important use cases
- Edge cases
- Additional features worth considering

Ask me questions when necessary.

### Phase 2 – Functional Design
Define:
- Application modules
- User workflows
- Main screens
- Dashboard structure
- Data ingestion workflow
- Transaction lifecycle
- Categorization workflow
- Financial insights workflow

### Phase 3 – Data Model
Design the database schema.

Include entities such as:
- Accounts
- Credit Cards
- Import Files
- Transactions
- Merchants
- Categories
- Categorization Rules
- Budgets
- Financial Goals
- Recommendations

Define relationships, constraints, and indexing strategies.

### Phase 4 – System Architecture
Propose:
- Frontend architecture
- Backend architecture
- Database technology
- File processing strategy
- Categorization engine
- Analytics engine
- AI integration (if appropriate)
- Security model

Explain the reasoning behind each decision.

### Phase 5 – UI/UX Design
Create:
- Application sitemap
- Wireframes
- Dashboard mockups
- Main user flows
- Component breakdown

### Phase 6 – Implementation Plan
Break the project into manageable milestones.

Define:
- MVP scope
- Development phases
- Technical dependencies
- Testing strategy
- Acceptance criteria

---

## 10. How I Want You to Work

Act as a combination of:
- Senior Product Manager
- Fintech Solution Architect
- UX/UI Designer
- Senior Software Engineer
- Financial Data Analyst

Be proactive and challenge my assumptions.

Do not blindly accept every idea. Suggest better approaches when appropriate.

Prioritize accuracy, maintainability, security, and usability.

**Most importantly: Do not start coding yet.**

Start with Phase 1. Help me refine the product vision, identify missing requirements, and establish the right foundation before moving to architecture and implementation.