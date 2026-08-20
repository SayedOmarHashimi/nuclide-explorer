import { query } from "@/lib/db";
import { badRequest, guard, json, notFound, serverError } from "@/lib/http";
import {
  decayChainQuerySchema,
  nuclideIdSchema,
  searchParamsToObject,
} from "@/lib/validation";
import type { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Walk the decay tree to stability.
 *
 * Three things make this safe to run on a public endpoint:
 *  - depth is bounded by maxDepth (validated 1..60)
 *  - the accumulated `path` array blocks revisiting a nuclide, so even if a
 *    future data revision introduced a cycle the walk still terminates
 *  - decay_chain_edges already excludes SF and IT, the two modes with no
 *    single daughter, so every edge here is followable
 */
const CHAIN_SQL = `
with recursive walk as (
    select
        e.parent_nuclide_id,
        e.daughter_nuclide_id,
        e.mode_code,
        e.mode_label,
        e.branching_pct,
        1 as depth,
        array[e.parent_nuclide_id, e.daughter_nuclide_id] as path
    from marts.decay_chain_edges e
    where e.parent_nuclide_id = $1
      and coalesce(e.branching_pct, 0) >= $3

    union all

    select
        e.parent_nuclide_id,
        e.daughter_nuclide_id,
        e.mode_code,
        e.mode_label,
        e.branching_pct,
        w.depth + 1,
        w.path || e.daughter_nuclide_id
    from marts.decay_chain_edges e
    join walk w on e.parent_nuclide_id = w.daughter_nuclide_id
    where w.depth < $2
      and not (e.daughter_nuclide_id = any(w.path))
      and coalesce(e.branching_pct, 0) >= $3
)
select distinct
    parent_nuclide_id,
    daughter_nuclide_id,
    mode_code,
    mode_label,
    branching_pct,
    min(depth) over (partition by parent_nuclide_id, daughter_nuclide_id, mode_code) as depth
from walk
order by depth, parent_nuclide_id, daughter_nuclide_id
`;

type Edge = {
  parent_nuclide_id: string;
  daughter_nuclide_id: string;
  mode_code: string;
  mode_label: string | null;
  branching_pct: string | number | null;
  depth: number;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // Chain walks are the most expensive endpoint, so they get a tighter budget.
  const limited = guard(request, 60);
  if ("status" in limited) return limited;

  const idParsed = nuclideIdSchema.safeParse((await context.params).id);
  if (!idParsed.success) return badRequest(request, idParsed.error.issues);

  const optionsParsed = decayChainQuerySchema.safeParse(
    searchParamsToObject(new URL(request.url).searchParams),
  );
  if (!optionsParsed.success) return badRequest(request, optionsParsed.error.issues);

  const id = idParsed.data;
  const { maxDepth, minBranchingPct } = optionsParsed.data;

  try {
    const [root] = await query(
      `select nuclide_id, z, n, mass_number, element_symbol, stability,
              half_life_seconds, half_life_raw, half_life_unit, half_life_is_limit,
              primary_decay_mode, has_fission_branch
         from marts.nuclides where nuclide_id = $1`,
      [id],
    );
    if (!root) return notFound(request, `No nuclide with id '${id}'.`);

    const edges = await query<Edge>(CHAIN_SQL, [id, maxDepth, minBranchingPct]);

    const ids = Array.from(
      new Set([id, ...edges.flatMap((e) => [e.parent_nuclide_id, e.daughter_nuclide_id])]),
    );
    const nodes = await query(
      `select nuclide_id, z, n, mass_number, element_symbol, stability,
              half_life_seconds, log10_half_life_seconds, half_life_raw,
              half_life_unit, half_life_is_limit, primary_decay_mode,
              has_fission_branch, decay_branch_count
         from marts.nuclides
        where nuclide_id = any($1::text[])`,
      [ids],
    );

    const terminals = nodes.filter(
      (node) =>
        !edges.some((edge) => edge.parent_nuclide_id === node["nuclide_id"]),
    );

    return json(
      request,
      {
        root,
        maxDepth,
        minBranchingPct,
        truncated: edges.some((edge) => edge.depth >= maxDepth),
        nodeCount: nodes.length,
        edgeCount: edges.length,
        terminalNuclides: terminals.map((node) => node["nuclide_id"]),
        nodes,
        edges,
      },
      { rateLimit: limited, cacheSeconds: 3600 },
    );
  } catch (error) {
    return serverError(request, error);
  }
}
