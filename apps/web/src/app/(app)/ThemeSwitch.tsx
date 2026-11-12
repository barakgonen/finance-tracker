import { L, type Locale } from "@/lib/locale";
import { THEMES, type Theme } from "@/lib/theme";
import { setLocaleAction, setThemeAction } from "./theme-actions";

const themeLabel = (t: Theme) => ({ system: L("אוטומטי", "Auto"), light: L("בהיר", "Light"), dark: L("כהה", "Dark") })[t];

/** Display settings: light / dark / follow the device, and the language. Plain forms, no script. */
export function ThemeSwitch({ current, locale }: { current: Theme; locale: Locale }) {
  return (
    <div className="theme-switch">
      <form action={setThemeAction} className="stack" style={{ "--gap": "6px" } as React.CSSProperties}>
        <span className="small muted" id="theme-label">{L("תצוגה", "Display")}</span>
        <div className="seg" role="group" aria-labelledby="theme-label">
          {THEMES.map((t) => (
            <button key={t} type="submit" name="theme" value={t} aria-pressed={current === t}>
              {themeLabel(t)}
            </button>
          ))}
        </div>
      </form>
      <form action={setLocaleAction} className="seg" role="group" aria-label={L("שפה", "Language")}>
        <button type="submit" name="locale" value="he" lang="he" aria-pressed={locale === "he"}>עברית</button>
        <button type="submit" name="locale" value="en" lang="en" aria-pressed={locale === "en"}>English</button>
      </form>
    </div>
  );
}
