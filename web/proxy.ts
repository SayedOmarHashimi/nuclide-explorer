import { NextResponse, type NextRequest } from "next/server";

/**
* Content-Security-Policy with a per-request nonce.
 *
 * The alternative - putting a static CSP in next.config.ts - forces
 * `script-src 'unsafe-inline'`, because Next injects inline bootstrap scripts
 * for hydration. That effectively disables the main protection CSP offers.
 * Generating a nonce here and pairing it with `strict-dynamic` keeps inline
 * script execution restricted to scripts this server vouched for.
 *
 * `style-src` still allows inline styles: Next and Tailwind both inject style
 * tags during development, and styles are a much smaller attack surface than
 * scripts.
 */
export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);

  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets; they are served straight from the CDN and do not
    // need a per-request nonce.
    { source: "/((?!_next/static|_next/image|favicon.ico).*)" },
  ],
};
