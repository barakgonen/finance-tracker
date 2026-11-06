"use client";

import { useEffect, useRef } from "react";

/**
 * One tooltip for every chart on the page. Marks carry their readout in `data-tip` (lines
 * separated by "\n") and are focusable, so hover and keyboard focus show the same details.
 * Text is inserted with textContent: labels come from statement data.
 */
export function ChartTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tip = ref.current!;
    const show = (target: EventTarget | null, x?: number, y?: number) => {
      const el = (target as Element | null)?.closest?.("[data-tip]") as HTMLElement | SVGElement | null;
      if (!el) return hide();
      tip.replaceChildren(
        ...(el.getAttribute("data-tip") ?? "").split("\n").map((line, i) => {
          const div = document.createElement("div");
          div.textContent = line;
          if (i === 0) div.style.fontWeight = "600";
          return div;
        }),
      );
      const box = el.getBoundingClientRect();
      const px = x ?? box.left + box.width / 2;
      const py = y ?? box.top;
      tip.hidden = false;
      const w = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(8, px - w / 2), window.innerWidth - w - 8)}px`;
      tip.style.top = `${Math.max(8, py - tip.offsetHeight - 12)}px`;
    };
    const hide = () => {
      tip.hidden = true;
    };
    const onMove = (e: PointerEvent) => show(e.target, e.clientX, e.clientY);
    const onFocus = (e: FocusEvent) => show(e.target);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, []);
  return <div ref={ref} className="chart-tip" role="tooltip" hidden />;
}
