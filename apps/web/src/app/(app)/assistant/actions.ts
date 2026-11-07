"use server";

import Anthropic from "@anthropic-ai/sdk";
import { redirect } from "next/navigation";
import { ask, AssistantError } from "@ft/assistant";
import { householdScope, requireViewer } from "@/lib/auth";
import { scope } from "@/lib/db";
import { env } from "@/lib/env";
import { members } from "@/lib/queries";

export async function askAction(form: FormData): Promise<void> {
  // asking is reading: read-only members may ask too
  const viewer = await requireViewer();
  if (!env.aiEnabled) redirect("/assistant");
  const question = String(form.get("question") ?? "").trim().slice(0, 2000);
  const conversationId = String(form.get("conversationId") ?? "") || null;
  if (!question) redirect(conversationId ? `/assistant?c=${conversationId}` : "/assistant");

  let target: string;
  try {
    const result = await scope(householdScope(viewer), async (tx) => {
      const people = await members(tx, viewer.householdId);
      return ask(
        new Anthropic(),
        {
          db: tx,
          householdId: viewer.householdId,
          memberId: viewer.memberId,
          members: people.map((p) => ({ id: p.id, name: p.displayName })),
          today: new Date().toISOString().slice(0, 10),
        },
        { question, conversationId },
      );
    });
    target = `/assistant?c=${result.conversationId}`;
  } catch (e) {
    if (!(e instanceof AssistantError)) throw e;
    target = `/assistant?${new URLSearchParams({ ...(conversationId ? { c: conversationId } : {}), error: e.code })}`;
  }
  redirect(target);
}
