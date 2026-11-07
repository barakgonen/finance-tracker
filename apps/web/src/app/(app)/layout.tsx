import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { messages } from "@/lib/i18n";
import { reviewCount } from "@/lib/queries";
import { logoutAction } from "../(auth)/actions";
import { Nav } from "./Nav";
import { ThemeSwitch } from "./ThemeSwitch";
import { MenuToggle } from "./MenuToggle";
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
          <MenuToggle label="תפריט" pending={pending} />
        </div>
        <noscript>
          <style>{"#sidebar-body { display: flex !important; }"}</style>
        </noscript>
        <div className="sidebar-body" id="sidebar-body">
          <Nav
            items={[
              { href: "/", label: t.nav.dashboard },
              { href: "/transactions", label: "תנועות" },
              { href: "/review", label: t.nav.review, badge: pending },
              { href: "/expenses", label: "הוצאות" },
              { href: "/income", label: "הכנסות" },
              { href: "/cashflow", label: "תזרים" },
              { href: "/recurring", label: "חיובים קבועים" },
              { href: "/insights", label: "תובנות" },
              { href: "/health", label: "בריאות פיננסית" },
              { href: "/budgets", label: "תקציבים" },
              { href: "/goals", label: "יעדים" },
              { href: "/forecast", label: "תחזית" },
              { href: "/assistant", label: "שאלו את הכספים" },
              { href: "/import", label: t.nav.import, separatorBefore: true },
              { href: "/settings/accounts", label: t.nav.accounts },
            ]}
          />
          <div className="nav-sep" />
          <ThemeSwitch current={viewer.theme} />
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
