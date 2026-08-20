-- Every decay mode IAEA publishes must have a (dZ, dN) rule in the
-- decay_rules seed. A failure here means IAEA introduced a mode we do not
-- model, and the chain graph is silently incomplete until physics.py is
-- updated. This is the test most likely to catch a future data revision.
select mode_code, count(*) as occurrences
from {{ ref('decay_modes') }}
where is_unmapped_mode
group by mode_code
