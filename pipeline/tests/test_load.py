"""Tests for raw-snapshot parsing. No database required."""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from load import normalise, read_snapshot, row_hash  # noqa: E402

SNAPSHOT = Path(__file__).resolve().parents[2] / "data" / "raw" / "ground_states.csv"


class TestColumnNormalisation:
    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("decay_1_%", "decay_1_pct"),
            ("ENSDFpublicationcut-off", "ensdfpublicationcut_off"),
            ("Extraction_date", "extraction_date"),
            ("z", "z"),
        ],
    )
    def test_headers_become_legal_identifiers(self, raw, expected):
        assert normalise(raw) == expected

    def test_result_is_a_valid_sql_identifier(self):
        import re
        for header in ["decay_1_%", "ENSDFpublicationcut-off", "unc_qbmn"]:
            assert re.fullmatch(r"[a-z_][a-z0-9_]*", normalise(header))


@pytest.mark.skipif(not SNAPSHOT.exists(), reason="raw snapshot not fetched")
class TestSnapshotParsing:
    def test_trailing_blank_line_is_skipped(self):
        """IAEA's CSV ends with a blank line that would become a junk row."""
        _, rows = read_snapshot(SNAPSHOT)
        assert all(row["z"] != "" for row in rows)

    def test_expected_shape(self):
        columns, rows = read_snapshot(SNAPSHOT)
        assert len(columns) == 55
        assert 3000 < len(rows) < 4000

    def test_row_hash_is_stable_and_sensitive(self):
        columns, rows = read_snapshot(SNAPSHOT)
        first = rows[0]
        assert row_hash(first, columns) == row_hash(dict(first), columns)
        mutated = dict(first)
        mutated["half_life"] = "999"
        assert row_hash(mutated, columns) != row_hash(first, columns)

    def test_known_nuclides_present(self):
        _, rows = read_snapshot(SNAPSHOT)
        index = {(r["z"], r["n"]): r for r in rows}
        assert index[("92", "146")]["symbol"] == "U"     # U-238
        assert index[("1", "0")]["half_life"] == "STABLE"
        assert index[("42", "40")]["half_life"] == "?"   # Mo-82
