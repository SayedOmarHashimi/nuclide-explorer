-- Stable nuclides must not carry a half-life, and unstable ones that are not
-- limits must. Catches the stability flag and the half-life parse drifting
-- out of agreement.
select nuclide_id, stability, half_life_seconds
from {{ ref('nuclides') }}
where (stability = 'stable' and half_life_seconds is not null)
   or (stability = 'unknown' and half_life_seconds is not null)
