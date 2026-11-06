"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function Nav({ items }: { items: { href: string; label: string; badge?: number; separatorBefore?: boolean }[] }) {
  const path = usePathname();
  return (
    <>
      {items.map((i) => {
        const active = i.href === "/" ? path === "/" : path.startsWith(i.href);
        return (
          <div key={i.href} style={{ display: "contents" }}>
            {i.separatorBefore && <div className="nav-sep" />}
            <Link className="navlink" href={i.href} aria-current={active ? "page" : undefined}>
              {i.label}
              {i.badge ? <span className="chip warn">{i.badge}</span> : null}
            </Link>
          </div>
        );
      })}
    </>
  );
}
