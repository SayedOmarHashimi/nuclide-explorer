{{ config(materialized='view') }}

/*
  IAEA ships decay data WIDE - decay_1..decay_3 as separate columns. This
  unpivots it TALL, one row per nuclide per branch, which is the shape the
  decay-chain graph needs. 1,460 nuclides have a second branch and 334 a third,
  so branching is mainstream, not an edge case: a decay "chain" is really a tree.

  Modes resolve in two ways:

  1. Named modes come from the decay_rules seed, generated from physics.py.

  2. Cluster decay is parsed from the mode code. Heavy nuclei occasionally emit
     an entire light nucleus - Ra-226 sheds a whole carbon-14 at a branching
     ratio near 3e-9% - and the emitted species is named in the code itself
     ("14C", "24NE", or "{+22}Ne" when ENSDF's superscript markup leaks through
     the API). Deriving the deltas from the code rather than enumerating every
     isotope means a species IAEA publishes later still resolves.

  Named lookup deliberately wins over cluster parsing: "N" is neutron emission
  and "P" is proton emission, but both would otherwise parse as element symbols
  (nitrogen, phosphorus).
*/

with base as (

    select * from {{ ref('stg_ground_states') }}

),

elements as (

    -- Symbol -> Z, taken from the data itself rather than a hardcoded table.
    -- Z = 0 is excluded: the free neutron's symbol is "n", which would let a
    -- cluster code resolve to a zero-proton "element".
    select distinct upper(element_symbol) as symbol, z
    from base
    where element_symbol is not null and z > 0

),

unpivoted as (

    select z, n, 1 as branch_index, decay_1 as mode_code, decay_1_pct as branching_pct
    from base where decay_1 is not null

    union all

    select z, n, 2, decay_2, decay_2_pct
    from base where decay_2 is not null

    union all

    select z, n, 3, decay_3, decay_3_pct
    from base where decay_3 is not null

),

parsed as (

    select
        unpivoted.*,
        upper(unpivoted.mode_code) as code,
        substring(upper(unpivoted.mode_code) from '^\{?\+?([0-9]+)\}?[A-Z]{1,2}$')::int
            as cluster_mass,
        substring(upper(unpivoted.mode_code) from '^\{?\+?[0-9]*\}?([A-Z]{1,2})$')
            as cluster_symbol
    from unpivoted

),

resolved as (

    select
        parsed.z,
        parsed.n,
        parsed.branch_index,
        parsed.mode_code,
        parsed.branching_pct,
        parsed.cluster_mass,

        rules.mode is not null                                  as is_named_mode,
        rules.mode is null and elements.z is not null           as is_cluster_mode,

        coalesce(
            rules.mode_label,
            case when elements.z is not null then
                'cluster emission ('
                || coalesce(parsed.cluster_mass::text, '')
                || initcap(lower(parsed.cluster_symbol)) || ')'
            end
        )                                                       as mode_label,

        coalesce(rules.is_terminal, false)                      as is_terminal,
        coalesce(rules.is_fission, false)                       as is_fission,

        -- Known process, uncomputable daughter: a cluster code with no mass
        -- number, such as the bare "Mg" on U-234. Kept separate from
        -- "unmapped", which means we have no rule at all.
        coalesce(
            rules.is_indeterminate,
            elements.z is not null and parsed.cluster_mass is null,
            false
        )                                                       as is_indeterminate,

        coalesce(rules.delta_z, -elements.z)                    as delta_z,
        coalesce(rules.delta_n, -(parsed.cluster_mass - elements.z)) as delta_n

    from parsed
    left join {{ ref('decay_rules') }} as rules
        on rules.mode = parsed.code
    left join elements
        on elements.symbol = parsed.cluster_symbol
       and rules.mode is null

)

select
    z,
    n,
    branch_index,
    mode_code,
    mode_label,
    branching_pct,
    is_terminal,
    is_fission,
    is_indeterminate,
    not (is_named_mode or is_cluster_mode) as is_unmapped_mode,

    case
        when is_terminal or is_indeterminate then null
        when not (is_named_mode or is_cluster_mode) then null
        when z + delta_z < 0 or n + delta_n < 0 then null
        else z + delta_z
    end as daughter_z,

    case
        when is_terminal or is_indeterminate then null
        when not (is_named_mode or is_cluster_mode) then null
        when z + delta_z < 0 or n + delta_n < 0 then null
        else n + delta_n
    end as daughter_n

from resolved
