"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { appUser } from "@ft/db";
import { requireViewer } from "@/lib/auth";
import { db } from "@/lib/db";
import { THEMES, type Theme } from "@/lib/theme";

/** Saves the viewer's light/dark choice; it applies on every device they sign in on. */
export async function setThemeAction(form: FormData): Promise<void> {
  const viewer = await requireViewer();
  const theme = form.get("theme");
  if (!THEMES.includes(theme as Theme)) return;
  await db().update(appUser).set({ theme: theme as Theme, updatedAt: new Date() }).where(eq(appUser.id, viewer.userId));
  revalidatePath("/", "layout");
}
