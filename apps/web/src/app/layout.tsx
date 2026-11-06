import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import "./globals.css";

// self-hosted at build time: no request to Google when the app runs
const heebo = Heebo({ subsets: ["hebrew", "latin"], weight: ["400", "500", "600", "700"], variable: "--font-heebo" });

export const metadata: Metadata = {
  title: "הכספים שלנו",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body>{children}</body>
    </html>
  );
}
