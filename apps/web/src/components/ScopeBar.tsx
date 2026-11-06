import Link from "next/link";
import { shiftMonth } from "@ft/analytics";
import { monthName } from "@/lib/format";
import { periodHref, type Period } from "@/lib/period";

/** The one filter row above an analysis page: month and household/member scope. */
export function ScopeBar({ path, period, title }: { path: string; period: Period; title: string }) {
  const { month, view, people } = period;
  return (
    <header className="filters">
      <div className="stack" style={{ "--gap": "2px" } as React.CSSProperties}>
        <span className="muted small">{title}</span>
        <div className="row" style={{ "--gap": "8px" } as React.CSSProperties}>
          <Link className="btn" href={periodHref(path, { month: shiftMonth(month, -1), view })} aria-label="החודש הקודם">→</Link>
          <h1>{monthName(month)}</h1>
          <Link className="btn" href={periodHref(path, { month: shiftMonth(month, 1), view })} aria-label="החודש הבא">←</Link>
        </div>
      </div>
      <nav className="seg" aria-label="תצוגה">
        <Link href={periodHref(path, { month })} aria-current={!view}>משק הבית</Link>
        {people.map((p) => (
          <Link key={p.id} href={periodHref(path, { month, view: p.id })} aria-current={view === p.id}>{p.displayName}</Link>
        ))}
      </nav>
    </header>
  );
}
