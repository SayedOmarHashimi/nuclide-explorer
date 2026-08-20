{{ config(
    materialized='table',
    indexes=[
      {'columns': ['nuclide_id'], 'unique': True},
      {'columns': ['z', 'n'], 'unique': True},
      {'columns': ['stability']},
      {'columns': ['half_life_seconds']}
    ]
) }}

/*
  One row per nuclide - the table the chart reads. `nuclide_id` is the public
  key used in URLs ("u-238"); (z, n) remains the physical key used for graph
  joins.
*/

with base as (

    select * from {{ ref('stg_ground_states') }}

),

branch_summary as (

    select
        z,
        n,
        count(*)                                            as decay_branch_count,
        bool_or(is_fission)                                 as has_fission_branch,
        bool_or(is_unmapped_mode)                           as has_unmapped_mode
    from {{ ref('stg_decay_modes') }}
    group by z, n

)

select
    lower(base.element_symbol) || '-' || base.mass_number   as nuclide_id,
    base.z,
    base.n,
    base.mass_number,
    base.element_symbol,
    base.spin_parity,

    base.stability,
    base.half_life_seconds,
    base.log10_half_life_seconds,
    base.half_life_raw,
    base.half_life_unit,
    base.half_life_operator,
    base.half_life_is_limit,
    base.half_life_from_width,
    base.iaea_half_life_seconds,

    base.decay_1                                            as primary_decay_mode,
    base.decay_1_pct                                        as primary_decay_pct,
    coalesce(branch_summary.decay_branch_count, 0)          as decay_branch_count,
    coalesce(branch_summary.has_fission_branch, false)      as has_fission_branch,
    coalesce(branch_summary.has_unmapped_mode, false)       as has_unmapped_mode,

    base.natural_abundance_pct,
    base.atomic_mass_micro_u,
    base.mass_excess_kev,
    base.binding_energy_per_nucleon_kev,
    base.q_alpha_kev,
    base.q_beta_minus_kev,
    base.q_electron_capture_kev,
    base.charge_radius_fm,
    base.discovery_year,
    base.ensdf_authors,
    base.extraction_date,
    base.run_date

from base
left join branch_summary
    on branch_summary.z = base.z
   and branch_summary.n = base.n
where base.element_symbol is not null
