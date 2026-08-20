-- Independent check of our unit conversion against IAEA's own precomputed
-- half_life_sec. Tolerance is 1e-6 relative, not exact equality: IAEA derives
-- width-based half-lives with the CODATA 2006 value of hbar while we use
-- CODATA 2018, a ~1e-7 difference. Anything larger than 1e-6 is our bug -
-- most likely the "m" = minutes vs milliseconds trap.
select
    nuclide_id,
    half_life_seconds,
    iaea_half_life_seconds,
    abs(half_life_seconds - iaea_half_life_seconds)
        / nullif(abs(iaea_half_life_seconds), 0) as relative_error
from {{ ref('nuclides') }}
where half_life_seconds is not null
  and iaea_half_life_seconds is not null
  and iaea_half_life_seconds <> 0
  and abs(half_life_seconds - iaea_half_life_seconds)
      / abs(iaea_half_life_seconds) > 1e-6
