import { query } from "@/lib/db";
import { badRequest, guard, json, notFound, serverError } from "@/lib/http";
import { nuclideIdSchema } from "@/lib/validation";
import type { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const limited = guard(request, 120);
  if ("status" in limited) return limited;

  const parsed = nuclideIdSchema.safeParse((await context.params).id);
  if (!parsed.success) return badRequest(request, parsed.error.issues);
  const id = parsed.data;

  try {
    const [nuclide] = await query(
      `select * from marts.nuclides where nuclide_id = $1`,
      [id],
    );
    if (!nuclide) return notFound(request, `No nuclide with id '${id}'.`);

    const decayModes = await query(
      `select branch_index, mode_code, mode_label, branching_pct,
              is_terminal, is_fission,
              daughter_nuclide_id, daughter_z, daughter_n,
              daughter_element_symbol, daughter_mass_number, daughter_is_unknown
         from marts.decay_modes
        where nuclide_id = $1
        order by branch_index`,
      [id],
    );

    const parents = await query(
      `select parent_nuclide_id, mode_code, mode_label, branching_pct
         from marts.decay_chain_edges
        where daughter_nuclide_id = $1
        order by branching_pct desc nulls last
        limit 25`,
      [id],
    );

    return json(
      request,
      { nuclide, decayModes, parents },
      { rateLimit: limited, cacheSeconds: 3600 },
    );
  } catch (error) {
    return serverError(request, error);
  }
}
