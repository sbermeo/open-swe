/**
 * Gets the base URL of the application
 * Uses NEXT_PUBLIC_API_URL if available, otherwise falls back to localhost
 * This ensures consistent URLs even when the server is listening on 0.0.0.0
 */
export function getBaseUrl(): string {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL;
  
  if (apiUrl) {
    // Extract base URL from NEXT_PUBLIC_API_URL (remove /api suffix if present)
    return apiUrl.replace(/\/api\/?$/, "");
  }
  
  // Fallback to localhost for development
  return "http://localhost:3000";
}

/**
 * Creates a URL with the correct base URL
 * @param path - The path to append to the base URL (should start with /)
 * @returns A full URL string
 */
export function createAppUrl(path: string): string {
  const baseUrl = getBaseUrl();
  // Ensure path starts with /
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

