// The interface language for the current request. Every app page and layout starts with
// requireViewer() (auth pages with authLocale()), which records the language here, so text
// helpers can pick a language without it being passed through every call.
import { cache } from "react";
import { SYSTEM_CATEGORIES } from "@ft/core";

export const LOCALES = ["he", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const LOCALE_COOKIE = "ft_locale";

export const asLocale = (v: unknown): Locale => (v === "en" ? "en" : "he");

const current = cache(() => ({ locale: "he" as Locale }));

export function setRequestLocale(locale: string): void {
  current().locale = asLocale(locale);
}

export function requestLocale(): Locale {
  return current().locale;
}

/** Text in the request's language: L("תנועות", "Transactions"). */
export function L(he: string, en: string): string {
  return current().locale === "en" ? en : he;
}

export const isRtl = (locale: Locale = requestLocale()) => locale === "he";

const CATEGORY_EN = new Map([...SYSTEM_CATEGORIES.map((c) => [c.he, c.en] as const), ["ללא קטגוריה", "Uncategorized"] as const]);

/** A category's name in the request's language (categories are stored with their Hebrew name). */
export function categoryName(hebrewName: string): string {
  return current().locale === "en" ? (CATEGORY_EN.get(hebrewName) ?? hebrewName) : hebrewName;
}
