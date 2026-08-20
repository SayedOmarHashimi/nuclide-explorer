{{ config(
    materialized='table',
    indexes=[
      {'columns': ['parent_nuclide_id']},
      {'columns': ['daughter_nuclide_id']}
    ]
) }}

/*
  The traversable edge list: only branches that lead to a nuclide we actually
  know about. Everything without a resolvable daughter is excluded here rather
  than filtered at query time, so the recursive walk in the API can assume every
  edge is followable and terminates.

  Self-edges are excluded defensively. IT (isomeric transition) is already
  marked terminal upstream, but a self-edge reaching the graph would make the
  recursive CTE loop forever, so it is blocked at both layers.
*/

select
    nuclide_id                                              as parent_nuclide_id,
    z                                                       as parent_z,
    n                                                       as parent_n,
    daughter_nuclide_id,
    daughter_z,
    daughter_n,
    mode_code,
    mode_label,
    branching_pct,
    branch_index
from {{ ref('decay_modes') }}
where daughter_nuclide_id is not null
  and not (daughter_z = z and daughter_n = n)
