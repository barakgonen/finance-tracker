// Auth pages read the database (does a user exist? is this session verified?) on every request.
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
