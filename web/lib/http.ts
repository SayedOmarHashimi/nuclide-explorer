import { NextResponse } from "next/server";
import { rateLimit, clientKey, type RateLimitResult } from "./rateLimit";

/**
 * CORS is an explicit allow-list, not a wildcard. In development anything on
 * localhost is permitted; in production only the deployed origins are, which
 * are supplied through ALLOWED_ORIGINS.
 */
function allowedOrigins(): string[] {
  const configured = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.NODE_ENV !== "production") {
    configured.push("http://localhost:3000", "http://127.0.0.1:3000");
  }
  return configured;
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get("origin");
  if (!origin || !allowedOrigins().includes(origin)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function rateLimitHeaders(result: RateLimitResult): Record<string, string> {
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(Math.ceil((result.resetAt - Date.now()) / 1000)),
  };
}

export function json(
  request: Request,
  body: unknown,
  init: { status?: number; rateLimit?: RateLimitResult; cacheSeconds?: number } = {},
): NextResponse {
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(request),
    ...(init.rateLimit ? rateLimitHeaders(init.rateLimit) : {}),
  };
  if (init.cacheSeconds) {
    // The underlying dataset is revised on the order of months, so long cache
    // lifetimes are safe and keep the database out of the hot path.
    headers["Cache-Control"] =
      `public, s-maxage=${init.cacheSeconds}, stale-while-revalidate=86400`;
  }
  return NextResponse.json(body, { status: init.status ?? 200, headers });
}

/**
 * Apply the rate limit, returning a 429 response when the caller is over.
 *
 * The bucket key includes the route, not just the caller. Routes have
 * different budgets - chain walks are the expensive endpoint and get a tighter
 * one - and a single shared counter would let traffic to the cheap endpoint
 * exhaust the expensive endpoint's allowance and vice versa.
 */
export function guard(request: Request, limit = 120): RateLimitResult | NextResponse {
  const route = new URL(request.url).pathname.split("/").slice(0, 4).join("/");
  const result = rateLimit(`${route}|${clientKey(request)}`, limit);
  if (result.ok) return result;
  return NextResponse.json(
    { error: "rate_limited", message: "Too many requests. Try again shortly." },
    {
      status: 429,
      headers: {
        ...corsHeaders(request),
        ...rateLimitHeaders(result),
        "Retry-After": String(result.retryAfterSeconds),
      },
    },
  );
}

export function badRequest(request: Request, issues: unknown): NextResponse {
  return NextResponse.json(
    { error: "invalid_request", issues },
    { status: 400, headers: corsHeaders(request) },
  );
}

export function notFound(request: Request, message: string): NextResponse {
  return NextResponse.json(
    { error: "not_found", message },
    { status: 404, headers: corsHeaders(request) },
  );
}

/** Never leak a driver error or connection string to the client. */
export function serverError(request: Request, error: unknown): NextResponse {
  console.error("api_error", error);
  return NextResponse.json(
    { error: "internal_error", message: "Something went wrong." },
    { status: 500, headers: corsHeaders(request) },
  );
}
