"""Build the VECTOR SQLite database from schema.sql + seed.sql."""
from pathlib import Path
import sqlite3

ROOT = Path(__file__).resolve().parent
DB = ROOT / "vehicle.db"

conn = sqlite3.connect(DB)
try:
    conn.executescript((ROOT / "schema.sql").read_text(encoding="utf-8"))
    conn.executescript((ROOT / "seed.sql").read_text(encoding="utf-8"))
    conn.commit()
    counts = {
        table: conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in ("projects", "media", "detections", "tasks", "versions", "version_items")
    }
    print("built", DB)
    print(counts)
finally:
    conn.close()
