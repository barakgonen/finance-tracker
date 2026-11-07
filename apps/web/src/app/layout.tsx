import type { Metadata } from "next";
import { currentSession } from "@/lib/auth";
import "./fonts.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "הכספים שלנו",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // a signed-in user's choice; otherwise (and for "system") the device setting decides, in CSS
  const theme = (await currentSession())?.user.theme;
  return (
    <html lang="he" dir="rtl" data-theme={theme === "light" || theme === "dark" ? theme : undefined}>
      <body>{children}</body>
    </html>
  );
}
