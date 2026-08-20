/**
 * Fixed-window rate limiter.
 *
 * State lives in the process, which is the right trade-off here and worth
 * being explicit about: on Vercel each serverless instance keeps its own
 * counters, so the effective global limit is (limit x warm instances). That is
 * fine for this app - the data is public and read-only, and the goal is to
 * blunt accidental hammering and cheap scraping, not to enforce a precise
 * quota. A strict global limit would need shared state (Upstash Redis or
 * Vercel KV); the interface below is deliberately shaped so that swapping the
 * backing store does not change any call site.
 */

type Window = { count: number; resetAt: number };

const WINDOW_MS = 60_000;
const MAX_TRACKED_KEYS = 10_000;

const windows = new Map<string, Window>();

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
};

function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Bound memory even under a spray of unique keys.
  if (windows.size > MAX_TRACKED_KEYS) windows.clear();
}

export function rateLimit(key: string, limit: number): RateLimitResult {
  const now = Date.now();
  if (windows.size > 256) sweep(now);

  const existing = windows.get(key);
  const window =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + WINDOW_MS };

  window.count += 1;
  windows.set(key, window);

  const remaining = Math.max(0, limit - window.count);
  return {
    ok: window.count <= limit,
    limit,
    remaining,
    resetAt: window.resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((window.resetAt - now) / 1000)),
  };
}

/**
 * Identify the caller. Behind Vercel's proxy the socket address is the proxy,
 * so the left-most x-forwarded-for entry is used. That header is client
 * -settable in general, which is acceptable for abuse-blunting but is the
 * reason this must never be used for authorisation.
 */
export function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip") ?? "unknown";
}
