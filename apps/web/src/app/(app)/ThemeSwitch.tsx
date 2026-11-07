import { THEME_LABELS, THEMES, type Theme } from "@/lib/theme";
import { setThemeAction } from "./theme-actions";

/** Light / dark / follow the device. A plain form, so it works before any script loads. */
export function ThemeSwitch({ current }: { current: Theme }) {
  return (
    <form action={setThemeAction} className="theme-switch" aria-label="ערכת צבעים">
      <span className="small muted">תצוגה</span>
      <div className="seg" role="group" aria-label="ערכת צבעים">
        {THEMES.map((t) => (
          <button key={t} type="submit" name="theme" value={t} aria-pressed={current === t}>
            {THEME_LABELS[t]}
          </button>
        ))}
      </div>
    </form>
  );
}
