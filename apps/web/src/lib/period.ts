import "server-only";
import { latestMonth, shiftMonth, type Filters } from "@ft/analytics";
import type { Db } from "@ft/db";
import type { Viewer } from "./auth";
import { members } from "./queries";

export interface Period {
  month: string;
  /** member id for the individual view; undefined = whole household */
  view?: string;
  filters: Filters;
  people: Awaited<ReturnType<typeof members>>;
}

/** Reads ?month=YYYY-MM&view=<memberId>, defaulting to the latest month with data. */
export async function resolvePeriod(tx: Db, viewer: Viewer, params: { month?: string; view?: string }): Promise<Period> {
  const people = await members(tx, viewer.householdId);
  const view = people.find((p) => p.id === params.view)?.id;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "")
    ? params.month!
    : ((await latestMonth(tx, viewer.householdId)) ?? new Date().toISOString().slice(0, 7));
  return { month, view, people, filters: { householdId: viewer.householdId, memberId: view, viewerMemberId: viewer.memberId } };
}

/** Builds a link to `path` keeping the period, with overrides. */
export function periodHref(path: string, p: { month: string; view?: string }, extra: Record<string, string | undefined> = {}): string {
  const q = new URLSearchParams();
  q.set("month", p.month);
  if (p.view) q.set("view", p.view);
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) q.set(k, v);
  return `${path}?${q}`;
}

export const lastNMonths = (month: string, n: number) => ({ first: shiftMonth(month, -(n - 1)), last: month });
