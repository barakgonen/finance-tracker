import { he, type Messages } from "../messages/he";

/** Hebrew is the primary language; other locales fall back to it until translated. */
export function messages(_locale = "he"): Messages {
  return he;
}
