import type { NextConfig } from "next";

/**
 * Headers applied to every response. The CSP itself is set in middleware.ts
 * because it needs a per-request nonce; everything here is static.
 */
const securityHeaders = [
  // Belt-and-braces with the CSP frame-ancestors directive, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  // Stop browsers guessing content types and executing a response as script.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Do not leak the full URL of this app to third parties.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // This app needs none of these device APIs.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Two years, preloadable. Vercel serves HTTPS only.
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-DNS-Prefetch-Control", value: "off" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
