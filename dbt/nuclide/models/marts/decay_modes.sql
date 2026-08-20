{{ config(
    materialized='table',
    indexes=[
      {'columns': ['nuclide_id']},
      {'columns': ['z', 'n']},
      {'columns': ['daughter_nuclide_id']}
    ]
) }}

/*
  Tall decay table: one row per nuclide per branch, with the daughter resolved
  to a real nuclide where one exists.

  `daughter_nuclide_id` is NULL for three distinct reasons, kept apart because
  the chain walker treats them differently:
    is_terminal          - SF / IT, no single daughter by definition
    is_unmapped_mode     - a mode code we have no rule for (should be zero;
                           tested below, and a non-zero count means IAEA added
                           a mode and our rules need updating)
    daughter_is_unknown  - the computed (Z, N) is not in the nuclide table
*/

with modes as (

    select * from {{ ref('stg_decay_modes') }}

),

parents as (

    select z, n, nuclide_id, element_symbol, mass_number
    from {{ ref('nuclides') }}

)

select
    parents.nuclide_id,
    modes.z,
    modes.n,
    modes.branch_index,
    modes.mode_code,
    modes.mode_label,
    modes.branching_pct,
    modes.is_terminal,
    modes.is_fission,
    modes.is_unmapped_mode,
    modes.is_indeterminate,

    modes.daughter_z,
    modes.daughter_n,
    daughters.nuclide_id                                    as daughter_nuclide_id,
    daughters.element_symbol                                as daughter_element_symbol,
    daughters.mass_number                                   as daughter_mass_number,

    (modes.daughter_z is not null and daughters.nuclide_id is null)
                                                            as daughter_is_unknown

from modes
join parents
    on parents.z = modes.z
   and parents.n = modes.n
left join parents as daughters
    on daughters.z = modes.daughter_z
   and daughters.n = modes.daughter_n
