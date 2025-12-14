import {
  GITHUB_AUTH_STATE_COOKIE,
  GITHUB_INSTALLATION_ID_COOKIE,
  GITHUB_TOKEN_TYPE_COOKIE,
  GITHUB_TOKEN_COOKIE,
} from "@openswe/shared/constants";
import { getInstallationCookieOptions } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createAppUrl } from "@/lib/url";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const installationId = searchParams.get("installation_id");

    // Handle GitHub App errors
    if (error) {
      return NextResponse.redirect(
        createAppUrl(`/?error=${encodeURIComponent(error)}`),
      );
    }

    // Validate required parameters
    if (!code) {
      return NextResponse.redirect(
        createAppUrl("/?error=missing_code_parameter"),
      );
    }

    // Verify state parameter to prevent CSRF attacks
    const storedState = request.cookies.get(GITHUB_AUTH_STATE_COOKIE)?.value;

    if (storedState && state !== storedState) {
      return NextResponse.redirect(
        createAppUrl("/?error=invalid_state"),
      );
    }

    const clientId = process.env.NEXT_PUBLIC_GITHUB_APP_CLIENT_ID;
    const clientSecret = process.env.GITHUB_APP_CLIENT_SECRET;
    const redirectUri = process.env.GITHUB_APP_REDIRECT_URI;

    if (!clientId || !clientSecret || !redirectUri) {
      return NextResponse.redirect(
        createAppUrl("/?error=configuration_missing"),
      );
    }

    // Exchange authorization code for access token
    const tokenResponse = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code: code,
          redirect_uri: redirectUri,
        }),
      },
    );

    if (!tokenResponse.ok) {
      console.error("Token exchange failed:", await tokenResponse.text());
      return NextResponse.redirect(
        createAppUrl("/?error=token_exchange_failed"),
      );
    }

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      return NextResponse.redirect(
        createAppUrl(`/?error=${encodeURIComponent(tokenData.error)}`),
      );
    }

    // Create the success response
    const response = NextResponse.redirect(createAppUrl("/chat"));

    // Clear the state cookie as it's no longer needed
    response.cookies.set(GITHUB_AUTH_STATE_COOKIE, "", {
      expires: new Date(0),
      path: "/",
    });

    // Set token cookies directly on the response
    response.cookies.set(GITHUB_TOKEN_COOKIE, tokenData.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    response.cookies.set(
      GITHUB_TOKEN_TYPE_COOKIE,
      tokenData.token_type || "bearer",
      {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30, // 30 days
        path: "/",
      },
    );

    // If there's an installation_id, store that as well for future API calls
    if (installationId) {
      response.cookies.set(
        GITHUB_INSTALLATION_ID_COOKIE,
        installationId,
        getInstallationCookieOptions(),
      );
    }

    return response;
  } catch (error) {
    console.error("GitHub App callback error:", error);
    return NextResponse.redirect(
      createAppUrl("/?error=callback_failed"),
    );
  }
}
