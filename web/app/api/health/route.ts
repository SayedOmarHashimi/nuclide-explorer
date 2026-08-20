import { query } from "@/lib/db";
import { guard, json, serverError } from "@/lib/http";
import type { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const limited = guard(request, 30);
  if ("status" in limited) return limited;
  try {
    const [row] = await query<{ nuclides: string; refreshed: Date | null }>(
      `select (select count(*) from marts.nuclides)::text as nuclides,
              (select max(loaded_at) from raw.snapshots) as refreshed`,
    );
    return json(request, { status: "ok", ...row }, { rateLimit: limited });
  } catch (error) {
    return serverError(request, error);
  }
}
