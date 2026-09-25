"""Extract the downloaded WHO expanded tables without changing their values."""
import hashlib
import json
from pathlib import Path

import openpyxl

root = Path(__file__).resolve().parent
data = {"version": 1, "source": "WHO Child Growth Standards", "retrieved": "2026-09-13", "rangeDays": [0, 730], "tables": {}}
checks = []
manifest = []
for metric, prefix in [("weight", "wfa"), ("length", "lhfa"), ("head", "hcfa")]:
    data["tables"][metric] = {}
    for sex in ["girls", "boys"]:
        path = root / "raw" / f"{prefix}-{sex}.xlsx"
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        sheet = workbook.active
        rows = iter(sheet.values)
        header = next(rows)
        assert header[:4] == ("Day", "L", "M", "S"), (path.name, header)
        values = []
        for row in rows:
            day = row[0]
            if not isinstance(day, (int, float)) or day > 730:
                continue
            assert day == len(values), (path.name, day)
            assert all(isinstance(x, (int, float)) for x in row[:4])
            assert row[2] > 0 and row[3] > 0
            values.append(list(row[:4]))
            if day in (0, 120, 365, 730):
                checks.append({"metric": metric, "sex": sex, "day": day, "median": row[2], "sd0": row[header.index("SD0")], "sd1": row[header.index("SD1")]})
        assert len(values) == 731, (path.name, len(values))
        data["tables"][metric][sex] = values
        manifest.append({"file": path.name, "sheet": sheet.title, "rowsExtracted": len(values), "sha256": hashlib.sha256(path.read_bytes()).hexdigest()})
        workbook.close()

for filename, value in [("who-growth.json", data), ("who-checks.json", checks), ("source-checksums.json", manifest)]:
    (root / filename).write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
print(json.dumps(manifest, indent=2))
print("Extracted 6 tables, 4386 daily LMS rows, 24 independent WHO check rows.")
