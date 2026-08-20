"""Scheduled incremental refresh: fetch, diff, load, transform, report.

ENSDF is revised when new nuclear evaluations are published - on the order of
months, not days. So this is a scheduled job that does real change detection,
not a poller. It is safe to run daily; on a day with no upstream revision it
short-circuits at the hash check and does nothing.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from db import connect  # noqa: E402
from ingest import ingest_ground_states  # noqa: E402
from load import load  # noqa: E402

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DBT_DIR = PROJECT_ROOT / "dbt" / "nuclide"


def already_loaded(sha256: str) -> bool:
    """Has this exact payload been loaded before?

    The cheapest possible change detection: if the bytes are identical to a
    previous run there is nothing to diff, load, or rebuild.
    """
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            "select 1 from raw.snapshots where sha256 = %s",
            (sha256,),
        )
        return cur.fetchone() is not None


def run_dbt(command: list[str]) -> int:
    result = subprocess.run(
        [sys.executable, "-m", "dbt.cli.main", *command],
        cwd=DBT_DIR,
        env={**__import__("os").environ, "DBT_PROFILES_DIR": str(DBT_DIR)},
    )
    return result.returncode


def change_summary(run_date: str) -> list[dict]:
    with connect() as conn, conn.cursor() as cur:
        cur.execute(
            """
            select change_type, count(*)
              from raw.change_log
             where run_date = %s
             group by change_type
             order by change_type
            """,
            (run_date,),
        )
        rows = cur.fetchall()
        cur.execute(
            """
            select z, n, changed_columns
              from raw.change_log
             where run_date = %s and change_type = 'update'
             limit 20
            """,
            (run_date,),
        )
        examples = cur.fetchall()
    return [
        {"counts": {row[0]: row[1] for row in rows}},
        {"example_updates": [
            {"z": z, "n": n, "columns": columns} for z, n, columns in examples
        ]},
    ]


def refresh(force: bool = False, skip_dbt: bool = False) -> dict:
    started = datetime.now(timezone.utc)
    manifest = ingest_ground_states()
    run_date = manifest["run_date"]

    if not force and already_loaded(manifest["sha256"]):
        return {
            "status": "unchanged",
            "run_date": run_date,
            "sha256": manifest["sha256"][:12],
            "message": "Upstream payload identical to a previous run; nothing to do.",
            "duration_seconds": (datetime.now(timezone.utc) - started).total_seconds(),
        }

    load_stats = load(run_date)

    dbt_status = "skipped"
    if not skip_dbt:
        for command in (["seed"], ["run"], ["test"]):
            code = run_dbt(command)
            if code != 0:
                return {
                    "status": "failed",
                    "stage": f"dbt {command[0]}",
                    "exit_code": code,
                    "run_date": run_date,
                    "load": load_stats,
                }
        dbt_status = "ok"

    return {
        "status": "refreshed",
        "run_date": run_date,
        "load": load_stats,
        "dbt": dbt_status,
        "changes": change_summary(run_date),
        "duration_seconds": (datetime.now(timezone.utc) - started).total_seconds(),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Incremental refresh of nuclide data")
    parser.add_argument(
        "--force", action="store_true", help="reload even if the payload is unchanged"
    )
    parser.add_argument("--skip-dbt", action="store_true", help="load only, no transform")
    args = parser.parse_args(argv)

    report = refresh(force=args.force, skip_dbt=args.skip_dbt)
    print(json.dumps(report, indent=2, default=str))
    return 0 if report["status"] in {"refreshed", "unchanged"} else 1


if __name__ == "__main__":
    sys.exit(main())
