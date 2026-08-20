"""Pure functions for interpreting IAEA Livechart ground-state fields.

Everything here is deliberately side-effect free so it can be unit tested
without a network or a database. The IAEA CSV encodes several physically
distinct situations in overlapping columns; this module is where those are
untangled once, so nothing downstream has to guess.
"""

from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Optional

# --- Half-life units -------------------------------------------------------
#
# `unit_hl` mixes time units spanning 26 orders of magnitude with *energy*
# units. The single most dangerous entry is "m": it is minutes, not
# milliseconds ("ms"). Getting that wrong is a silent factor-of-60000 error
# on ~550 nuclides.

SECONDS_PER_UNIT: dict[str, float] = {
    "as": 1e-18,   # attoseconds
    "fs": 1e-15,   # femtoseconds (not present today; cheap to support)
    "ps": 1e-12,
    "ns": 1e-9,
    "us": 1e-6,    # ASCII stand-in for microseconds
    "ms": 1e-3,
    "s": 1.0,
    "m": 60.0,     # MINUTES
    "h": 3600.0,
    "d": 86400.0,
    "Y": 365.242_198_7 * 86400.0,  # tropical year, matching IAEA to ~1e-9
}

EV_PER_ENERGY_UNIT: dict[str, float] = {"eV": 1.0, "keV": 1e3, "MeV": 1e6}

# Reduced Planck constant in eV*s (CODATA 2018). IAEA's own precomputed
# half_life_sec uses the older CODATA 2006 value (6.58211899e-16), so our
# width-derived half-lives differ from theirs by ~1 part in 1e7. We keep the
# current value and widen the validation tolerance rather than freeze a stale
# constant.
HBAR_EV_S = 6.582_119_569e-16

# Qualifiers found in `operator_hl`. A value carrying one of these is a bound
# or an estimate, not a measurement, and must not be presented as exact.
HALF_LIFE_OPERATORS = {"LT", "GT", "GE", "LE", "AP"}

STABILITY_STABLE = "stable"
STABILITY_UNSTABLE = "unstable"
STABILITY_UNKNOWN = "unknown"


def width_to_half_life_seconds(value: float, energy_unit: str) -> float:
    """Convert a resonance width to a half-life via t(1/2) = hbar * ln2 / gamma.

    Very short-lived states are measured as the energy width of the resonance
    rather than as a duration; the uncertainty principle relates the two.
    """
    gamma_ev = value * EV_PER_ENERGY_UNIT[energy_unit]
    if gamma_ev <= 0:
        raise ValueError(f"non-positive width: {value} {energy_unit}")
    return HBAR_EV_S * math.log(2) / gamma_ev


@dataclass(frozen=True)
class HalfLife:
    seconds: Optional[float]
    stability: str
    operator: Optional[str]      # LT / GT / GE / LE / AP, else None
    is_limit: bool               # True when the value is a bound, not a measurement
    from_width: bool             # True when derived from an energy width
    raw_value: str
    raw_unit: str


def parse_half_life(
    half_life: str, unit_hl: str, operator_hl: str = ""
) -> HalfLife:
    """Interpret the (half_life, unit_hl, operator_hl) triple.

    Three different situations all leave IAEA's precomputed `half_life_sec`
    empty and must be distinguished here:
      "STABLE" -> stable, no half-life
      "?"      -> exists, decay mode known, lifetime never measured
      ""       -> nothing known
    """
    value = (half_life or "").strip()
    unit = (unit_hl or "").strip()
    operator = (operator_hl or "").strip().upper() or None
    if operator is not None and operator not in HALF_LIFE_OPERATORS:
        operator = None

    if value.upper() == "STABLE":
        return HalfLife(None, STABILITY_STABLE, None, False, False, value, unit)

    if value in ("", "?"):
        return HalfLife(None, STABILITY_UNKNOWN, operator, False, False, value, unit)

    try:
        magnitude = float(value)
    except ValueError:
        # Unrecognised encoding: record it as unknown rather than crashing or,
        # worse, coercing it to a number.
        return HalfLife(None, STABILITY_UNKNOWN, operator, False, False, value, unit)

    if unit in SECONDS_PER_UNIT:
        seconds = magnitude * SECONDS_PER_UNIT[unit]
        from_width = False
    elif unit in EV_PER_ENERGY_UNIT:
        seconds = width_to_half_life_seconds(magnitude, unit)
        from_width = True
    else:
        return HalfLife(None, STABILITY_UNKNOWN, operator, False, False, value, unit)

    return HalfLife(
        seconds=seconds,
        stability=STABILITY_UNSTABLE,
        operator=operator,
        is_limit=operator in {"LT", "GT", "GE", "LE"},
        from_width=from_width,
        raw_value=value,
        raw_unit=unit,
    )


# --- Decay modes -----------------------------------------------------------
#
# Each mode is a (delta_Z, delta_N) transform on the parent. Modes that do not
# yield a single well-defined daughter must terminate a chain walk:
#   SF  - spontaneous fission, splits into a distribution of fragments
#   IT  - isomeric transition, same nuclide (a self-loop; would recurse forever)

TERMINAL_MODES = {"SF", "IT", "B-SF"}

# Light-element symbols, needed to resolve cluster decay (see below). Cluster
# emission never involves anything heavier than silicon, so this table does not
# need the full periodic system.
ELEMENT_Z: dict[str, int] = {
    "H": 1, "HE": 2, "LI": 3, "BE": 4, "B": 5, "C": 6, "N": 7, "O": 8,
    "F": 9, "NE": 10, "NA": 11, "MG": 12, "AL": 13, "SI": 14, "P": 15,
    "S": 16, "CL": 17, "AR": 18, "K": 19, "CA": 20,
}

# Cluster decay codes look like "14C", "24NE", or - once ENSDF's superscript
# markup leaks through the API - "{+22}Ne". A few carry no mass number at all
# ("Mg" on U-234), which makes the daughter genuinely indeterminate: the
# process is known, the emitted isotope is not stated.
CLUSTER_PATTERN = re.compile(r"^\{?\+?(?P<mass>[0-9]*)\}?(?P<symbol>[A-Z]{1,2})$")


@dataclass(frozen=True)
class DecayRule:
    delta_z: int
    delta_n: int
    label: str
    terminal: bool = False
    fission: bool = False
    # True when the mode is understood but the daughter cannot be computed from
    # what the data states. Distinct from "unmapped", which means we have no
    # rule at all and the pipeline needs updating.
    indeterminate: bool = False


DECAY_RULES: dict[str, DecayRule] = {
    "B-":    DecayRule(+1, -1, "beta minus"),
    "2B-":   DecayRule(+2, -2, "double beta minus"),
    "B-N":   DecayRule(+1, -2, "beta-delayed neutron"),
    "B-2N":  DecayRule(+1, -3, "beta-delayed 2-neutron"),
    "B-A":   DecayRule(-1, -3, "beta-delayed alpha"),
    "B+":    DecayRule(-1, +1, "beta plus"),
    "2B+":   DecayRule(-2, +2, "double beta plus"),
    "EC":    DecayRule(-1, +1, "electron capture"),
    "EC+B+": DecayRule(-1, +1, "electron capture / beta plus"),
    "2EC":   DecayRule(-2, +2, "double electron capture"),
    "ECP":   DecayRule(-2, +1, "EC-delayed proton"),
    "B+P":   DecayRule(-2, +1, "beta-delayed proton"),
    "A":     DecayRule(-2, -2, "alpha"),
    "P":     DecayRule(-1, 0, "proton emission"),
    "2P":    DecayRule(-2, 0, "2-proton emission"),
    "N":     DecayRule(0, -1, "neutron emission"),
    "2N":    DecayRule(0, -2, "2-neutron emission"),
    "B-P":   DecayRule(0, -1, "beta-delayed proton"),
    "B-3N":  DecayRule(+1, -4, "beta-delayed 3-neutron"),
    "B-4N":  DecayRule(+1, -5, "beta-delayed 4-neutron"),
    "B-5N":  DecayRule(+1, -6, "beta-delayed 5-neutron"),
    "B-6N":  DecayRule(+1, -7, "beta-delayed 6-neutron"),
    "B-7N":  DecayRule(+1, -8, "beta-delayed 7-neutron"),
    "ECA":   DecayRule(-3, -1, "EC-delayed alpha"),
    "B+A":   DecayRule(-3, -1, "beta-delayed alpha"),
    "EC2P":  DecayRule(-3, +1, "EC-delayed 2-proton"),
    "B+2P":  DecayRule(-3, +1, "beta-delayed 2-proton"),
    "IT":    DecayRule(0, 0, "isomeric transition", terminal=True),
    "SF":    DecayRule(0, 0, "spontaneous fission", terminal=True, fission=True),
    "B-SF":  DecayRule(0, 0, "beta-delayed fission", terminal=True, fission=True),
    "SF+EC+B+": DecayRule(-1, +1, "spontaneous fission / EC / beta plus", fission=True),
    # Compound: the EC branch has a daughter, the SF branch does not.
    "ECSF":  DecayRule(-1, +1, "electron capture / spontaneous fission", fission=True),
}


def cluster_rule(mode: str) -> Optional[DecayRule]:
    """Resolve a cluster-decay code into a rule.

    In cluster decay the nucleus emits an entire light nucleus - Ra-226 shedding
    a whole carbon-14, for instance, at a branching ratio around 3e-9%. The
    emitted species is named in the mode code itself, so rather than enumerate
    every isotope IAEA might publish, parse it: the daughter is the parent minus
    the cluster's protons and neutrons.
    """
    match = CLUSTER_PATTERN.match(mode.upper())
    if match is None:
        return None
    symbol = match.group("symbol")
    cluster_z = ELEMENT_Z.get(symbol)
    if cluster_z is None:
        return None

    mass = match.group("mass")
    if not mass:
        # e.g. bare "Mg": the process is cluster emission but the isotope is
        # unstated, so the daughter cannot be derived. Say so rather than guess.
        return DecayRule(0, 0, f"cluster emission ({symbol.title()})", indeterminate=True)

    cluster_a = int(mass)
    if cluster_a < cluster_z:
        return None
    return DecayRule(
        -cluster_z,
        -(cluster_a - cluster_z),
        f"cluster emission ({cluster_a}{symbol.title()})",
    )


def rule_for(mode: str) -> Optional[DecayRule]:
    """Look up a decay mode, falling back to cluster parsing."""
    code = (mode or "").strip().upper()
    if not code:
        return None
    return DECAY_RULES.get(code) or cluster_rule(code)


def daughter_of(z: int, n: int, mode: str) -> Optional[tuple[int, int]]:
    """Return the daughter (Z, N) for a decay mode, or None if the chain ends.

    None means "no single daughter exists" - fission fragments, or an isomeric
    transition that would map the nuclide onto itself.
    """
    rule = rule_for(mode)
    if rule is None or rule.terminal or rule.indeterminate:
        return None
    dz, dn = z + rule.delta_z, n + rule.delta_n
    if dz < 0 or dn < 0:
        return None
    return dz, dn
