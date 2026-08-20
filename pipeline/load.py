"""Load a raw snapshot into Postgres and record what changed since last run.

The raw layer stores every column as text, exactly as IAEA sent it. Nothing is
cast, cleaned, or dropped here - that is dbt's job. The only liberty taken is
renaming columns to legal SQL identifiers (`decay_1_%` cannot be an unquoted
identifier); values are untouched.

Change detection runs *before* the new snapshot replaces the old one:
  1. load the incoming snapshot into a staging table
  2. diff it against the current table on the (z, n) key
  3. append inserts / updates / deletes to raw.change_log
  4. swap the staging table into place
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from db import connect

RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"


def normalise(column: str) -> str:
    """Turn an IAEA header into a legal, stable SQL identifier."""
    cleaned = column.replace("%", "pct")
    cleaned = re.sub(r"[^0-9a-zA-Z]+", "_", cleaned)
    return cleaned.strip("_").lower()


def read_snapshot(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    """Parse the CSV, skipping the trailing blank line IAEA emits."""
    with path.open(newline="", encoding="utf-8-sig") as handle:
        reader = csv.reader(handle)
        header = [normalise(c) for c in next(reader)]
        rows = []
        for record in reader:
            if not record or all(field == "" for field in record):
                continue  # trailing blank line
            if len(record) != len(header):
                raise ValueError(
                    f"row has {len(record)} fields, expected {len(header)}: {record[:5]}"
                )
            rows.append(dict(zip(header, record)))
    return header, rows


def row_hash(row: dict[str, str], columns: list[str]) -> str:
    payload = "\x1f".join(row[c] for c in columns)
    return hashlib.md5(payload.encode()).hexdigest()


DDL = """
create schema if not exists raw;

create table if not exists raw.snapshots (
    sha256      text primary key,
    dataset     text        not null,
    run_date    date        not null,
    fetched_at  timestamptz not null,
    bytes       bigint      not null,
    row_count   integer     not null,
    loaded_at   timestamptz not null default now()
);

create table if not exists raw.change_log (
    id          bigserial primary key,
    dataset     text        not null,
    run_date    date        not null,
    change_type text        not null check (change_type in ('insert','update','delete')),
    z           integer     not null,
    n           integer     not null,
    changed_columns text[],
    old_row     jsonb,
    new_row     jsonb,
    detected_at timestamptz not null default now()
);

create index if not exists change_log_run_date_idx on raw.change_log (run_date desc);
"""


def ensure_table(cur, table: str, columns: list[str]) -> None:
    cols = ",\n    ".join(f'"{c}" text' for c in columns)
    cur.execute(
        f"""
        create table if not exists {table} (
            {cols},
            _row_hash text not null,
            _run_date date not null,
            _source_sha256 text not null
        );
        """
    )


def copy_rows(cur, table: str, columns: list[str], rows: list[dict[str, str]],
              run_date: str, sha256: str) -> None:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    for row in rows:
        writer.writerow(
            [row[c] for c in columns] + [row_hash(row, columns), run_date, sha256]
        )
    buffer.seek(0)
    all_cols = ", ".join(f'"{c}"' for c in columns + ["_row_hash", "_run_date", "_source_sha256"])
    with cur.copy(f"copy {table} ({all_cols}) from stdin with (format csv)") as copy:
        copy.write(buffer.getvalue())


def diff(cur, columns: list[str], run_date: str) -> dict[str, int]:
    """Compare incoming vs current on (z, n) and append to raw.change_log.

    Rows are compared as jsonb rather than column by column. The obvious
    approach - jsonb_build_object('z', z, 'n', n, ...) - fails on this table:
    55 columns means 110 function arguments and Postgres caps functions at 100.
    to_jsonb(row) has no such limit, and it also makes "which columns changed"
    a set operation over the two objects instead of 55 CASE expressions.
    """
    cur.execute("select count(*) from raw.ground_states")
    if cur.fetchone()[0] == 0:
        return {"insert": 0, "update": 0, "delete": 0, "first_load": 1}

    # Bookkeeping columns are ours, not IAEA's; they must not show up as data
    # changes. _row_hash in particular changes whenever any value does, which
    # would make every diff report itself.
    strip = "- '_row_hash' - '_run_date' - '_source_sha256'"
    inc_json = f"(to_jsonb(inc) {strip})"
    cur_json = f"(to_jsonb(cur) {strip})"

    cur.execute(
        f"""
        insert into raw.change_log
            (dataset, run_date, change_type, z, n, changed_columns, old_row, new_row)
        select 'ground_states', %(run_date)s::date, 'insert',
               inc.z::int, inc.n::int, null, null, {inc_json}
        from raw.ground_states_incoming inc
        left join raw.ground_states cur on cur.z = inc.z and cur.n = inc.n
        where cur.z is null
        """,
        {"run_date": run_date},
    )
    inserts = cur.rowcount

    cur.execute(
        f"""
        insert into raw.change_log
            (dataset, run_date, change_type, z, n, changed_columns, old_row, new_row)
        select 'ground_states', %(run_date)s::date, 'delete',
               cur.z::int, cur.n::int, null, {cur_json}, null
        from raw.ground_states cur
        left join raw.ground_states_incoming inc on cur.z = inc.z and cur.n = inc.n
        where inc.z is null
        """,
        {"run_date": run_date},
    )
    deletes = cur.rowcount

    cur.execute(
        f"""
        insert into raw.change_log
            (dataset, run_date, change_type, z, n, changed_columns, old_row, new_row)
        select 'ground_states', %(run_date)s::date, 'update',
               inc.z::int, inc.n::int,
               array(
                   select key
                   from jsonb_each_text({inc_json}) as incoming(key, value)
                   where value is distinct from ({cur_json} ->> incoming.key)
                   order by key
               ),
               {cur_json}, {inc_json}
        from raw.ground_states_incoming inc
        join raw.ground_states cur on cur.z = inc.z and cur.n = inc.n
        where cur._row_hash is distinct from inc._row_hash
        """,
        {"run_date": run_date},
    )
    updates = cur.rowcount

    return {"insert": inserts, "update": updates, "delete": deletes, "first_load": 0}


def load(run_date: str | None = None) -> dict:
    path = RAW_DIR / "ground_states.csv"
    if not path.exists():
        raise FileNotFoundError(f"{path} - run pipeline/ingest.py first")

    body = path.read_bytes()
    sha256 = hashlib.sha256(body).hexdigest()
    run_date = run_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    columns, rows = read_snapshot(path)

    with connect() as conn, conn.cursor() as cur:
        cur.execute(DDL)
        ensure_table(cur, "raw.ground_states", columns)
        cur.execute("drop table if exists raw.ground_states_incoming")
        ensure_table(cur, "raw.ground_states_incoming", columns)
        copy_rows(cur, "raw.ground_states_incoming", columns, rows, run_date, sha256)

        stats = diff(cur, columns, run_date)

        cur.execute("truncate raw.ground_states")
        cur.execute(
            "insert into raw.ground_states select * from raw.ground_states_incoming"
        )
        cur.execute("drop table raw.ground_states_incoming")
        cur.execute(
            """
            insert into raw.snapshots (sha256, dataset, run_date, fetched_at, bytes, row_count)
            values (%s, 'ground_states', %s, now(), %s, %s)
            on conflict (sha256) do nothing
            """,
            (sha256, run_date, len(body), len(rows)),
        )
        conn.commit()

    return {"run_date": run_date, "rows": len(rows), "sha256": sha256[:12], **stats}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Load raw snapshot into Postgres")
    parser.add_argument("--run-date")
    args = parser.parse_args(argv)
    print(json.dumps(load(args.run_date), indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
