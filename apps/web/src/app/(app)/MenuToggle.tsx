"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * On a phone the menu folds behind this button (on wider screens the button is hidden and the
 * menu always shows). It closes again after navigating. Without JavaScript the menu stays open.
 */
export function MenuToggle({ label, pending }: { label: string; pending: number }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const body = document.getElementById("sidebar-body");
    if (body) body.dataset.open = String(open);
  }, [open]);
  return (
    <button type="button" className="menu-toggle btn" aria-expanded={open} aria-controls="sidebar-body" onClick={() => setOpen((o) => !o)}>
      {label}
      {pending > 0 && !open ? <span className="chip warn">{pending}</span> : null}
    </button>
  );
}
