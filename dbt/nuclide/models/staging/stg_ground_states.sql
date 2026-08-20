{{ config(materialized='view') }}

/*
  Raw text -> typed columns, plus the three interpretations that the raw data
  makes ambiguous:

  1. half_life_seconds  - one number from a column that mixes 10 time units
                          (note "m" is MINUTES) with 3 energy units that are
                          resonance widths, not durations.
  2. stability          - a three-state flag. "STABLE", "?" and "" all leave
                          IAEA's own half_life_sec empty but mean different
                          things: stable, lifetime-unmeasured, and nothing
                          known respectively.
  3. half_life_is_limit - 166 nuclides carry an LT/GT/GE/AP qualifier. Their
                          half-life is a bound or estimate, not a measurement,
                          and must not be rendered as though it were exact.
*/

with source as (

    select * from {{ source('raw', 'ground_states') }}

),

hbar as (

    select value as hbar_ev_s
    from {{ ref('physical_constants') }}
    where name = 'hbar'

),

typed as (

    select
        ({{ try_numeric('z') }})::int                       as z,
        ({{ try_numeric('n') }})::int                       as n,
        nullif(symbol, '')                                  as element_symbol,
        nullif(jp, '')                                      as spin_parity,

        nullif(half_life, '')                               as half_life_raw,
        nullif(unit_hl, '')                                 as half_life_unit,
        nullif(upper(operator_hl), '')                      as half_life_operator,
        {{ try_numeric('half_life') }}                      as half_life_value,
        {{ try_numeric('half_life_sec') }}                  as iaea_half_life_seconds,

        nullif(decay_1, '')                                 as decay_1,
        {{ try_numeric('decay_1_pct') }}                    as decay_1_pct,
        nullif(decay_2, '')                                 as decay_2,
        {{ try_numeric('decay_2_pct') }}                    as decay_2_pct,
        nullif(decay_3, '')                                 as decay_3,
        {{ try_numeric('decay_3_pct') }}                    as decay_3_pct,

        {{ try_numeric('abundance') }}                      as natural_abundance_pct,
        {{ try_numeric('atomic_mass') }}                    as atomic_mass_micro_u,
        {{ try_numeric('massexcess') }}                     as mass_excess_kev,
        {{ try_numeric('binding') }}                        as binding_energy_per_nucleon_kev,
        {{ try_numeric('qa') }}                             as q_alpha_kev,
        {{ try_numeric('qbm') }}                            as q_beta_minus_kev,
        {{ try_numeric('qec') }}                            as q_electron_capture_kev,
        {{ try_numeric('radius') }}                         as charge_radius_fm,
        {{ try_numeric('discovery') }}::int                 as discovery_year,

        nullif(ensdfauthors, '')                            as ensdf_authors,
        nullif(extraction_date, '')::date                   as extraction_date,
        _run_date                                           as run_date,
        _source_sha256                                      as source_sha256

    from source
    where z ~ '^[0-9]+$' and n ~ '^[0-9]+$'

),

interpreted as (

    select
        typed.*,
        typed.z + typed.n as mass_number,

        case
            when upper(coalesce(typed.half_life_raw, '')) = 'STABLE' then 'stable'
            when typed.half_life_value is null                       then 'unknown'
            when factors.unit_hl is null                             then 'unknown'
            else 'unstable'
        end as stability,

        case
            when typed.half_life_value is null then null
            when factors.unit_kind = 'time'
                then (typed.half_life_value * factors.seconds_per_unit)::double precision
            when factors.unit_kind = 'energy' and typed.half_life_value > 0
                -- resonance width -> lifetime, t(1/2) = hbar * ln2 / gamma
                then (hbar.hbar_ev_s * ln(2.0)
                      / (typed.half_life_value * factors.ev_per_unit))::double precision
        end as half_life_seconds,

        coalesce(factors.unit_kind = 'energy', false)  as half_life_from_width,
        coalesce(typed.half_life_operator in ('LT', 'GT', 'GE', 'LE'), false)
                                                       as half_life_is_limit

    from typed
    left join {{ ref('unit_factors') }} as factors
        on factors.unit_hl = typed.half_life_unit
    cross join hbar

)

select
    *,
    case
        when half_life_seconds > 0 then log(10.0, half_life_seconds::numeric)
    end as log10_half_life_seconds
from interpreted
