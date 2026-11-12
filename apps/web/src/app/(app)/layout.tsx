import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { messages } from "@/lib/i18n";
import { reviewCount } from "@/lib/queries";
import { logoutAction } from "../(auth)/actions";
import { Nav } from "./Nav";
import { ThemeSwitch } from "./ThemeSwitch";
import { MenuToggle } from "./MenuToggle";
import { asLocale, L } from "@/lib/locale";
import { ChartTooltip } from "@/components/ChartTooltip";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const viewer = await requireViewer();
  const t = messages(viewer.locale);
  const pending = await scope(householdScope(viewer), (tx) =>
    reviewCount(tx, viewer.householdId, viewer.memberId),
  );
  return (
    <div className="shell">
      <nav className="sidebar" aria-label={t.nav.main}>
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              style={{ color: "var(--on-accent)" }}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 17l6-6 4 4 8-8" />
              <path d="M15 7h6v6" />
            </svg>
          </span>
          {t.app.name}
          <MenuToggle label={L("תפריט", "Menu")} pending={pending} />
        </div>
        <noscript>
          <style>{"#sidebar-body { display: flex !important; }"}</style>
        </noscript>
        <div className="sidebar-body" id="sidebar-body">
          <Nav
            items={[
              { href: "/", label: t.nav.dashboard },
              { href: "/transactions", label: L("תנועות", "Transactions") },
              { href: "/review", label: t.nav.review, badge: pending },
              { href: "/expenses", label: L("הוצאות", "Expenses") },
              { href: "/income", label: L("הכנסות", "Income") },
              { href: "/cashflow", label: L("תזרים", "Cash flow") },
              { href: "/recurring", label: L("חיובים קבועים", "Recurring") },
              { href: "/insights", label: L("תובנות", "Insights") },
              { href: "/health", label: L("בריאות פיננסית", "Financial health") },
              { href: "/budgets", label: L("תקציבים", "Budgets") },
              { href: "/goals", label: L("יעדים", "Goals") },
              { href: "/forecast", label: L("תחזית", "Forecast") },
              { href: "/assistant", label: L("שאלו את הכספים", "Ask your finances") },
              { href: "/import", label: t.nav.import, separatorBefore: true },
              { href: "/settings/accounts", label: t.nav.accounts },
              { href: "/settings/categories", label: L("קטגוריות", "Categories") },
            ]}
          />
          <div className="nav-sep" />
          <ThemeSwitch current={viewer.theme} locale={asLocale(viewer.locale)} />
          <form action={logoutAction}>
            <button
              className="navlink"
              type="submit"
              style={{
                border: 0,
                background: "transparent",
                font: "inherit",
                inlineSize: "100%",
                cursor: "pointer",
              }}
            >
              {t.nav.logout} · {viewer.displayName}
            </button>
          </form>
        </div>
      </nav>
      <main className="content">{children}</main>
      <ChartTooltip />
    </div>
  );
}
