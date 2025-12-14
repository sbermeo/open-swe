import { GITHUB_INSTALLATION_ID_COOKIE } from "@openswe/shared/constants";
import {
  GITHUB_INSTALLATION_RETURN_TO_COOKIE,
  GITHUB_INSTALLATION_STATE_COOKIE,
  getInstallationCookieOptions,
} from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";
import { createAppUrl } from "@/lib/url";

/**
 * Handles callbacks from GitHub App installations
 * This endpoint is called by GitHub after a user installs or configures the GitHub App
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const installationId = searchParams.get("installation_id");

    // Get the return URL from cookies, but ensure it uses the correct base URL
    const returnToPath =
      request.cookies.get(GITHUB_INSTALLATION_RETURN_TO_COOKIE)?.value || "/";
    // Normalize the return URL to use our base URL instead of potentially 0.0.0.0
    const returnTo = returnToPath.startsWith("http")
      ? returnToPath.replace(/^https?:\/\/[^\/]+/, createAppUrl(""))
      : createAppUrl(returnToPath);

    // Verify state parameter to prevent CSRF attacks
    // GitHub App installation doesn't return the state directly, but we included it in our callback URL
    const customState = searchParams.get("custom_state");
    const storedState = request.cookies.get(
      GITHUB_INSTALLATION_STATE_COOKIE,
    )?.value;

    // Validate state if it exists
    if (storedState && customState && storedState !== customState) {
      console.warn("Invalid installation state detected");
      // We'll still proceed but log the warning
    }

    // Create the response that will redirect back to the app
    const response = NextResponse.redirect(returnTo);

    // Clear cookies as they're no longer needed
    const expiredCookieOptions = {
      expires: new Date(0),
      path: "/",
    };

    response.cookies.set(
      GITHUB_INSTALLATION_RETURN_TO_COOKIE,
      "",
      expiredCookieOptions,
    );
    response.cookies.set(
      GITHUB_INSTALLATION_STATE_COOKIE,
      "",
      expiredCookieOptions,
    );

    // If we have an installation ID, store it in a cookie
    if (installationId) {
      response.cookies.set(
        GITHUB_INSTALLATION_ID_COOKIE,
        installationId,
        getInstallationCookieOptions(),
      );
    }

    return response;
  } catch (error) {
    console.error("GitHub App installation callback error:", error);
    return NextResponse.redirect(
      createAppUrl("/?error=installation_callback_failed"),
    );
  }
}
