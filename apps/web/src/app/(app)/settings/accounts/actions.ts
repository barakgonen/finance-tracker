"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { addAccount, ImportError, updateAccount, type NewAccount } from "@ft/ingest";
import { householdScope, requireEditor } from "@/lib/auth";
import { scope } from "@/lib/db";
import type { Db } from "@ft/db";
import { accounts, members } from "@/lib/queries";

const TYPES = ["bank", "credit_card", "savings", "investment", "cash"] as const;

/** Reads the account form, accepting only ids that belong to this household. */
async function readForm(tx: Db, householdId: string, form: FormData): Promise<Partial<NewAccount>> {
  const [people, accts] = [await members(tx, householdId), await accounts(tx, householdId)];
  const owner = String(form.get("ownerMemberId") ?? "");
  const settles = String(form.get("settlesToAccountId") ?? "");
  const last4 = String(form.get("numberLast4") ?? "").trim();
  const pattern = String(form.get("billDescriptionPattern") ?? "").trim();
  return {
    name: String(form.get("name") ?? "").trim(),
    institution: String(form.get("institution") ?? "").trim(),
    numberLast4: last4 || null,
    ownerMemberId: people.some((p) => p.id === owner) ? owner : null,
    settlesToAccountId: accts.some((a) => a.id === settles && a.type === "bank") ? settles : null,
    tracksStatements: form.get("tracksStatements") === "on",
    billDescriptionPattern: pattern || null,
    visibility: form.get("visibility") === "private" ? "private" : "shared",
  };
}

function done(error?: string): never {
  revalidatePath("/", "layout");
  redirect(`/settings/accounts${error ? `?error=${encodeURIComponent(error)}` : "?saved=1"}`);
}

export async function addAccountAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  const type = String(form.get("type"));
  let error: string | undefined;
  try {
    error = await scope(householdScope(viewer), async (tx) => {
      const values = await readForm(tx, viewer.householdId, form);
      if (!values.name || !values.institution || !(TYPES as readonly string[]).includes(type)) return "missing";
      await addAccount(tx, viewer.householdId, { ...values, type: type as (typeof TYPES)[number], name: values.name, institution: values.institution });
      return undefined;
    });
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  done(error);
}

export async function updateAccountAction(form: FormData): Promise<void> {
  const viewer = await requireEditor();
  let error: string | undefined;
  try {
    error = await scope(householdScope(viewer), async (tx) => {
      const values = await readForm(tx, viewer.householdId, form);
      if (!values.name || !values.institution) return "missing";
      await updateAccount(tx, viewer.householdId, String(form.get("accountId")), values);
      return undefined;
    });
  } catch (e) {
    if (!(e instanceof ImportError)) throw e;
    error = e.message;
  }
  done(error);
}
