import type { BudgetState } from "@ft/core";

export const BUDGET_STATE: Record<BudgetState, { label: string; tone: string; icon: string }> = {
  over: { label: "חריגה", tone: "warn", icon: "▲" },
  near: { label: "קרוב לגבול", tone: "warn", icon: "●" },
  on_pace_to_exceed: { label: "בקצב לחריגה", tone: "info", icon: "↗" },
  ok: { label: "תקין", tone: "ok", icon: "✓" },
};

export const GOAL_STATE = {
  achieved: { label: "הושג", tone: "ok" },
  on_track: { label: "בדרך", tone: "ok" },
  behind: { label: "מפגר", tone: "warn" },
  no_data: { label: "אין עדיין נתונים", tone: "" },
} as const;

export const GOAL_TYPE = { save_amount: "חיסכון לסכום", savings_rate: "שיעור חיסכון", reduce_category: "צמצום הוצאה" } as const;
