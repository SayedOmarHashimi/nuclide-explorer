"""Render the physics constants in physics.py as dbt seed files.

The unit factors and decay rules are needed in two places: Python (for tests
and validation) and SQL (for the dbt transformations). Rather than maintain
two copies that can silently drift apart, physics.py is the single source of
truth and this script projects it into dbt/nuclide/seeds/.
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from physics import (  # noqa: E402
    DECAY_RULES,
    EV_PER_ENERGY_UNIT,
    HBAR_EV_S,
    SECONDS_PER_UNIT,
)

SEED_DIR = Path(__file__).resolve().parent.parent / "dbt" / "nuclide" / "seeds"


def write_unit_factors() -> Path:
    """One row per half-life unit: how to turn a magnitude into seconds.

    Time units carry a direct multiplier. Energy units are resonance widths and
    carry the eV multiplier instead; SQL applies hbar*ln2/gamma to those.
    """
    path = SEED_DIR / "unit_factors.csv"
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["unit_hl", "unit_kind", "seconds_per_unit", "ev_per_unit"])
        for unit, factor in SECONDS_PER_UNIT.items():
            writer.writerow([unit, "time", repr(factor), ""])
        for unit, factor in EV_PER_ENERGY_UNIT.items():
            writer.writerow([unit, "energy", "", repr(factor)])
    return path


def write_decay_rules() -> Path:
    """One row per named decay mode: the (dZ, dN) transform and whether it ends a chain.

    Cluster-decay codes ("14C", "{+22}Ne", ...) are deliberately absent. Their
    deltas are derived from the code itself, in SQL, so a species IAEA has not
    published yet still resolves without a code change.
    """
    path = SEED_DIR / "decay_rules.csv"
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "mode", "delta_z", "delta_n", "mode_label",
                "is_terminal", "is_fission", "is_indeterminate",
            ]
        )
        for mode, rule in DECAY_RULES.items():
            writer.writerow(
                [
                    mode,
                    rule.delta_z,
                    rule.delta_n,
                    rule.label,
                    "true" if rule.terminal else "false",
                    "true" if rule.fission else "false",
                    "true" if rule.indeterminate else "false",
                ]
            )
    return path


def write_constants() -> Path:
    path = SEED_DIR / "physical_constants.csv"
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["name", "value", "units", "source"])
        writer.writerow(["hbar", repr(HBAR_EV_S), "eV*s", "CODATA 2018"])
    return path


def main() -> int:
    SEED_DIR.mkdir(parents=True, exist_ok=True)
    for path in (write_unit_factors(), write_decay_rules(), write_constants()):
        print(f"wrote {path.relative_to(SEED_DIR.parent.parent.parent)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
