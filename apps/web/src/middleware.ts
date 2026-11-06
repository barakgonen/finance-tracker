import { NextResponse, type NextRequest } from "next/server";

// Cheap gate: without a session cookie, app pages go to login. The session itself (expiry,
// TOTP) is validated server-side by requireViewer() on every page and action.
const PUBLIC = ["/login", "/setup", "/invite"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return NextResponse.next();
  if (!req.cookies.get("ft_session")) return NextResponse.redirect(new URL("/login", req.url));
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
