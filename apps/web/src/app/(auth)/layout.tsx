import { authLocale } from "@/lib/auth";
// Auth pages read the database (does a user exist? is this session verified?) on every request.
export const dynamic = "force-dynamic";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  await authLocale();
  return children;
}
