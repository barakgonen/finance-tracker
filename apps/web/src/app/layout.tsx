import type { Metadata } from "next";
import { cookies } from "next/headers";
import { currentSession } from "@/lib/auth";
import { messages } from "@/lib/i18n";
import { asLocale, isRtl, LOCALE_COOKIE } from "@/lib/locale";
import "./fonts.css";
import "./globals.css";

export async function generateMetadata(): Promise<Metadata> {
  const user = (await currentSession())?.user;
  const locale = asLocale(user?.locale ?? (await cookies()).get(LOCALE_COOKIE)?.value);
  return { title: messages(locale).app.name, robots: { index: false, follow: false } };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // a signed-in user's choice; otherwise (and for "system") the device setting decides, in CSS
  const user = (await currentSession())?.user;
  const theme = user?.theme;
  const locale = asLocale(user?.locale ?? (await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale} dir={isRtl(locale) ? "rtl" : "ltr"} data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
