"""Fetch raw IAEA Livechart data and land it untransformed on disk.

The staging layer is deliberately dumb: fetch bytes, write bytes, record a
hash. No parsing, no casting, no cleaning. That separation is what lets us
tell later whether a surprising number came from IAEA or from our own code,
and it is what makes the incremental refresh diff meaningful.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE_URL = "https://nds.iaea.org/relnsd/v1/data"
RAW_DIR = Path(__file__).resolve().parent.parent / "data" / "raw"

# IAEA rejects some default client user-agents. Identify ourselves honestly:
# this is a low-volume scheduled job against a public dataset.
USER_AGENT = "nuclide-explorer/1.0 (+https://github.com/SayedOmarHashimi/nuclide-explorer)"

REQUEST_TIMEOUT = 120


def fetch(fields: str, **params: str) -> bytes:
    """Fetch one Livechart dataset and return the raw response body."""
    query = {"fields": fields, **params}
    response = requests.get(
        BASE_URL,
        params=query,
        headers={"User-Agent": USER_AGENT},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    body = response.content

    # The API answers 200 with a short error string rather than an HTTP error
    # code for some bad requests, so a status check alone is not enough.
    if len(body) < 200:
        raise RuntimeError(
            f"suspiciously small response for {query!r}: {body[:200]!r}"
        )
    return body


def land(body: bytes, name: str, run_date: str) -> Path:
    """Write bytes into a dated snapshot directory and refresh the 'latest' copy."""
    snapshot_dir = RAW_DIR / run_date
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    path = snapshot_dir / name
    path.write_bytes(body)
    (RAW_DIR / name).write_bytes(body)
    return path


def ingest_ground_states(run_date: str | None = None) -> dict:
    run_date = run_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    body = fetch("ground_states", nuclides="all")
    path = land(body, "ground_states.csv", run_date)
    digest = hashlib.sha256(body).hexdigest()

    manifest = {
        "dataset": "ground_states",
        "run_date": run_date,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "bytes": len(body),
        "lines": body.count(b"\n"),
        "sha256": digest,
        "path": str(path.relative_to(RAW_DIR.parent.parent)),
    }
    (path.parent / "ground_states.manifest.json").write_text(
        json.dumps(manifest, indent=2) + "\n"
    )
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Ingest IAEA Livechart data")
    parser.add_argument("--run-date", help="override snapshot date (YYYY-MM-DD)")
    args = parser.parse_args(argv)

    manifest = ingest_ground_states(args.run_date)
    print(json.dumps(manifest, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
