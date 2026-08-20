import { query } from "@/lib/db";
import { badRequest, guard, json, serverError } from "@/lib/http";
import { nuclideQuerySchema, searchParamsToObject } from "@/lib/validation";
import type { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT = `
  select
    nuclide_id, z, n, mass_number, element_symbol, spin_parity,
    stability, half_life_seconds, log10_half_life_seconds,
    half_life_raw, half_life_unit, half_life_operator, half_life_is_limit,
    primary_decay_mode, primary_decay_pct, decay_branch_count,
    natural_abundance_pct, discovery_year
  from marts.nuclides
`;

export async function GET(request: Request): Promise<NextResponse> {
  const limited = guard(request, 120);
  if ("status" in limited) return limited;

  const parsed = nuclideQuerySchema.safeParse(
    searchParamsToObject(new URL(request.url).searchParams),
  );
  if (!parsed.success) return badRequest(request, parsed.error.issues);
  const f = parsed.data;

  // Filters are assembled as numbered placeholders. Only the placeholder
  // markers are interpolated into the SQL text; every value travels as a bind
  // parameter, so no user input can alter the statement.
  const clauses: string[] = [];
  const values: unknown[] = [];
  const bind = (value: unknown): string => {
    values.push(value);
    return `$${values.length}`;
  };

  if (f.zMin !== undefined) clauses.push(`z >= ${bind(f.zMin)}`);
  if (f.zMax !== undefined) clauses.push(`z <= ${bind(f.zMax)}`);
  if (f.nMin !== undefined) clauses.push(`n >= ${bind(f.nMin)}`);
  if (f.nMax !== undefined) clauses.push(`n <= ${bind(f.nMax)}`);
  if (f.element !== undefined) {
    clauses.push(`lower(element_symbol) = lower(${bind(f.element)})`);
  }
  if (f.stability !== undefined) clauses.push(`stability = ${bind(f.stability)}`);
  if (f.decayMode !== undefined) {
    clauses.push(
      `exists (select 1 from marts.decay_modes dm
                where dm.nuclide_id = marts.nuclides.nuclide_id
                  and dm.mode_code = ${bind(f.decayMode)})`,
    );
  }
  if (f.halfLifeLogMin !== undefined) {
    clauses.push(`log10_half_life_seconds >= ${bind(f.halfLifeLogMin)}`);
  }
  if (f.halfLifeLogMax !== undefined) {
    clauses.push(`log10_half_life_seconds <= ${bind(f.halfLifeLogMax)}`);
  }

  const where = clauses.length ? `where ${clauses.join(" and ")}` : "";
  const sql = `${SELECT} ${where} order by z, n limit ${bind(f.limit)} offset ${bind(f.offset)}`;

  try {
    const rows = await query(sql, values);
    return json(
      request,
      { count: rows.length, limit: f.limit, offset: f.offset, nuclides: rows },
      { rateLimit: limited, cacheSeconds: 3600 },
    );
  } catch (error) {
    return serverError(request, error);
  }
}
