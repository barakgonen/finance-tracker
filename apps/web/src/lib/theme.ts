export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
export const THEME_LABELS: Record<Theme, string> = { system: "אוטומטי", light: "בהיר", dark: "כהה" };
