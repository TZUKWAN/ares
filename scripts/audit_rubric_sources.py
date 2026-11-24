"""Inventory all archive fields; initialization never certifies a source URL."""
import argparse
import json
from pathlib import Path
from rubric_evidence import initial_provenance, validate_provenance, evidence_summary


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--initialize-unverified", action="store_true")
    parser.add_argument("--report")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    rows = []
    for path in sorted((root / "data" / "rubrics").glob("*.json")):
        rubric = json.loads(path.read_text(encoding="utf-8"))
        if args.initialize_unverified and "provenance" not in rubric:
            rubric["provenance"] = initial_provenance(rubric, "2026-11-18")
            rubric["confidence"] = "low"
            path.write_text(json.dumps(rubric, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        rows.append({"file": path.name, **evidence_summary(rubric), "errors": validate_provenance(rubric, root)})
    report = {"schemaVersion": 1, "archives": len(rows), "entries": rows,
              "passed": len(rows) == 132 and all(not row["errors"] for row in rows),
              "meaning": "结构与来源状态检查通过不等于所有内容已获当届官方确认"}
    text = json.dumps(report, ensure_ascii=False, indent=2) + "\n"
    if args.report:
        Path(args.report).write_text(text, encoding="utf-8", newline="\n")
    print(json.dumps({k: v for k, v in report.items() if k != "entries"}, ensure_ascii=False))
    for row in rows:
        for error in row["errors"]:
            print(row["file"] + ": " + error)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
