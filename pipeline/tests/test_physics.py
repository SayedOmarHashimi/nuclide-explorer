"""Unit tests for the physics interpretation layer.

The reference values are IAEA's own precomputed half_life_sec column, so these
tests check our conversions against the source of truth rather than against
numbers we made up.
"""

import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from physics import (  # noqa: E402
    DECAY_RULES,
    SECONDS_PER_UNIT,
    STABILITY_STABLE,
    STABILITY_UNKNOWN,
    STABILITY_UNSTABLE,
    daughter_of,
    parse_half_life,
    rule_for,
    width_to_half_life_seconds,
)


class TestUnitConversion:
    def test_minutes_are_not_milliseconds(self):
        """The single highest-risk bug in this pipeline: 'm' is minutes."""
        assert SECONDS_PER_UNIT["m"] == 60.0
        assert SECONDS_PER_UNIT["ms"] == 1e-3
        assert SECONDS_PER_UNIT["m"] / SECONDS_PER_UNIT["ms"] == 60_000

    @pytest.mark.parametrize(
        "value,unit,expected",
        [
            ("613.9", "s", 613.9),                  # free neutron
            ("12.32", "Y", 388_781_328.007),        # tritium
            ("2.6", "m", 156.0),
            ("2.6", "ms", 0.0026),
            ("1.0", "d", 86_400.0),
        ],
    )
    def test_time_units(self, value, unit, expected):
        got = parse_half_life(value, unit).seconds
        assert got == pytest.approx(expected, rel=1e-8)

    def test_energy_width_matches_iaea(self):
        """n-4: IAEA reports 2.6 MeV -> 1.7547604425822527e-22 s."""
        got = width_to_half_life_seconds(2.6, "MeV")
        assert got == pytest.approx(1.7547604425822527e-22, rel=1e-6)

    def test_width_conversion_is_flagged(self):
        result = parse_half_life("2.6", "MeV")
        assert result.from_width is True
        assert result.stability == STABILITY_UNSTABLE

    def test_unknown_unit_does_not_crash(self):
        result = parse_half_life("5.0", "parsecs")
        assert result.seconds is None
        assert result.stability == STABILITY_UNKNOWN


class TestStability:
    def test_stable(self):
        result = parse_half_life("STABLE", "")
        assert result.stability == STABILITY_STABLE
        assert result.seconds is None

    def test_question_mark_is_unknown_not_stable(self):
        """Mo-82: decay mode known, lifetime never measured."""
        result = parse_half_life("?", "")
        assert result.stability == STABILITY_UNKNOWN

    def test_blank_is_unknown(self):
        assert parse_half_life("", "").stability == STABILITY_UNKNOWN

    def test_stable_and_unknown_are_distinguishable(self):
        """Both leave IAEA's half_life_sec empty; we must not collapse them."""
        assert parse_half_life("STABLE", "").stability != parse_half_life("", "").stability


class TestOperators:
    @pytest.mark.parametrize("operator", ["LT", "GT", "GE", "LE"])
    def test_bounds_are_flagged_as_limits(self, operator):
        assert parse_half_life("2.6", "MeV", operator).is_limit is True

    def test_approximate_is_not_a_limit(self):
        result = parse_half_life("2.6", "s", "AP")
        assert result.operator == "AP"
        assert result.is_limit is False

    def test_no_operator(self):
        assert parse_half_life("2.6", "s").operator is None


class TestDecayRules:
    @pytest.mark.parametrize(
        "z,n,mode,expected",
        [
            (92, 146, "A", (90, 144)),      # U-238 -> Th-234
            (1, 2, "B-", (2, 1)),           # H-3 -> He-3
            (42, 40, "EC+B+", (41, 41)),    # Mo-82 -> Nb-82
            (6, 5, "B+", (5, 6)),           # C-11 -> B-11
            (2, 3, "N", (2, 2)),            # He-5 -> He-4
        ],
    )
    def test_daughters(self, z, n, mode, expected):
        assert daughter_of(z, n, mode) == expected

    def test_mass_number_conservation(self):
        """Every mode's mass change must equal the nucleons it emits."""
        # Stated explicitly rather than derived from the rule itself, so this
        # is an independent statement of what each mode emits.
        expected_delta_a = {
            # No nucleons emitted: beta, electron capture, isomeric transition,
            # and the fission modes (which are terminal and carry no daughter).
            "B-": 0, "2B-": 0, "B+": 0, "2B+": 0, "EC": 0, "EC+B+": 0,
            "2EC": 0, "IT": 0, "SF": 0, "ECSF": 0, "B-SF": 0, "SF+EC+B+": 0,
            # One nucleon
            "P": -1, "N": -1, "ECP": -1, "B+P": -1, "B-N": -1, "B-P": -1,
            # Two
            "2P": -2, "2N": -2, "B-2N": -2, "EC2P": -2, "B+2P": -2,
            # Three or more neutrons
            "B-3N": -3, "B-4N": -4, "B-5N": -5, "B-6N": -6, "B-7N": -7,
            # Alpha (4 nucleons), plain or beta-delayed
            "A": -4, "B-A": -4, "ECA": -4, "B+A": -4,
        }
        for mode, rule in DECAY_RULES.items():
            assert rule.delta_z + rule.delta_n == expected_delta_a[mode], mode

    def test_fission_terminates_the_chain(self):
        assert daughter_of(98, 154, "SF") is None

    def test_isomeric_transition_does_not_self_loop(self):
        """IT maps a nuclide onto itself; returning it would recurse forever."""
        assert DECAY_RULES["IT"].delta_z == 0
        assert DECAY_RULES["IT"].delta_n == 0
        assert daughter_of(43, 56, "IT") is None

    def test_unknown_mode_returns_none(self):
        assert daughter_of(50, 70, "NOT_A_MODE") is None

    def test_daughter_never_negative(self):
        assert daughter_of(1, 0, "A") is None


class TestClusterDecay:
    """Heavy nuclei occasionally emit an entire light nucleus.

    Every case below lands on or near doubly-magic Pb-208 (Z=82, N=126), which
    is exactly why these modes exist: the daughter is unusually tightly bound.
    That makes them a good end-to-end check of the parsing.
    """

    @pytest.mark.parametrize(
        "z,n,mode,expected",
        [
            (88, 138, "14C", (82, 130)),        # Ra-226 -> Pb-212
            (88, 135, "14C", (82, 127)),        # Ra-223 -> Pb-209
            (90, 140, "24NE", (80, 126)),       # Th-230 -> Hg-206
            (96, 146, "34SI", (82, 126)),       # Cm-242 -> Pb-208
            (92, 138, "{+22}Ne", (82, 126)),    # U-230 -> Pb-208, ENSDF markup
            (92, 143, "{+25}Ne", (82, 128)),    # U-235 -> Pb-210
        ],
    )
    def test_cluster_daughters(self, z, n, mode, expected):
        assert daughter_of(z, n, mode) == expected

    def test_markup_and_plain_spellings_agree(self):
        assert daughter_of(92, 140, "24Ne") == daughter_of(92, 140, "{+24}Ne")

    def test_case_insensitive(self):
        assert daughter_of(88, 138, "14c") == daughter_of(88, 138, "14C")

    def test_missing_mass_number_is_indeterminate_not_guessed(self):
        """U-234 lists a bare "Mg" - the isotope is not stated, so the daughter
        cannot be derived. The rule must exist (so it is not reported as an
        unknown mode) but must refuse to invent a daughter."""
        rule = rule_for("Mg")
        assert rule is not None
        assert rule.indeterminate is True
        assert daughter_of(92, 142, "Mg") is None

    def test_named_modes_win_over_element_symbols(self):
        """"N" is neutron emission, not nitrogen; "P" is proton emission, not
        phosphorus. A cluster parser that ran first would corrupt 86 nuclides."""
        assert daughter_of(2, 3, "N") == (2, 2)
        assert daughter_of(50, 70, "P") == (49, 70)

    def test_unknown_element_symbol_is_not_a_cluster(self):
        assert rule_for("ZZ") is None
