import { NextRequest, NextResponse } from "next/server";
import {
  GITHUB_TOKEN_COOKIE,
  GITHUB_INSTALLATION_ID_COOKIE,
} from "@openswe/shared/constants";
import { verifyGithubUser } from "@openswe/shared/github/verify-user";
import { createAppUrl } from "@/lib/url";

export async function middleware(request: NextRequest) {
  const token = request.cookies.get(GITHUB_TOKEN_COOKIE)?.value;
  const installationId = request.cookies.get(
    GITHUB_INSTALLATION_ID_COOKIE,
  )?.value;
  const user = token && installationId ? await verifyGithubUser(token) : null;

  if (request.nextUrl.pathname === "/") {
    if (user) {
      return NextResponse.redirect(createAppUrl("/chat"));
    }
  }

  if (request.nextUrl.pathname.startsWith("/chat")) {
    if (!user) {
      return NextResponse.redirect(createAppUrl("/"));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/chat/:path*"],
};
