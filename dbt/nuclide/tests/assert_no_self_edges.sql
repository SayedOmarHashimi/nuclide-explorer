-- A self-edge (daughter == parent) would make the recursive chain walk loop
-- forever. IT is the mode that produces one; it is marked terminal upstream,
-- and this asserts none leaked through.
select parent_nuclide_id
from {{ ref('decay_chain_edges') }}
where parent_z = daughter_z and parent_n = daughter_n
