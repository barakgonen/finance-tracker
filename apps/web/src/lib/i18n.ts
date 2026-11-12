import { he, type Messages } from "../messages/he";
import { en } from "../messages/en";
import { asLocale } from "./locale";

/** Hebrew is the primary language; English has the same keys (checked by the Messages type). */
export function messages(locale = "he"): Messages {
  return asLocale(locale) === "en" ? en : he;
}
