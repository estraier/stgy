import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export const config = { matcher: ["/"] };

export default function middleware(req: NextRequest) {
  const hasSession = req.cookies.has("session_id");
  if (hasSession) {
    return NextResponse.redirect(new URL("/posts", req.url));
  }
  return NextResponse.next();
}
