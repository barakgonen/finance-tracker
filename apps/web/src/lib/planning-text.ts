import type { BudgetState } from "@ft/core";
import { L } from "./locale";

// labels are getters: they're read while rendering, in the request's language
export const BUDGET_STATE: Record<BudgetState, { label: string; tone: string; icon: string }> = {
  over: { get label() { return L("חריגה", "Over"); }, tone: "warn", icon: "▲" },
  near: { get label() { return L("קרוב לגבול", "Near the limit"); }, tone: "warn", icon: "●" },
  on_pace_to_exceed: { get label() { return L("בקצב לחריגה", "On pace to exceed"); }, tone: "info", icon: "↗" },
  ok: { get label() { return L("תקין", "OK"); }, tone: "ok", icon: "✓" },
};

export const GOAL_STATE = {
  achieved: { get label() { return L("הושג", "Achieved"); }, tone: "ok" },
  on_track: { get label() { return L("בדרך", "On track"); }, tone: "ok" },
  behind: { get label() { return L("מפגר", "Behind"); }, tone: "warn" },
  no_data: { get label() { return L("אין עדיין נתונים", "No data yet"); }, tone: "" },
} as const;

export const GOAL_TYPE = {
  get save_amount() { return L("חיסכון לסכום", "Save an amount"); },
  get savings_rate() { return L("שיעור חיסכון", "Savings rate"); },
  get reduce_category() { return L("צמצום הוצאה", "Reduce spending"); },
};
