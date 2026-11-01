# -*- coding: utf-8 -*-
"""Create a non-destructive migration report for an existing project.json.

The report identifies legacy source lists and evidence claims that still need
formal provenance fields. It never invents quotes, hashes, URLs or rubric
links, so a failing report is an actionable queue rather than a fake upgrade.
"""
import argparse
import io
import json
import os
import sys


STRICT_FIELDS = ("supporting_quote", "retrieved_at", "content_hash", "rubric_refs", "output_refs")


def _load(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def migrate(path):
    profile = _load(path)
    base = os.path.dirname(os.path.abspath(path))
    evidence = profile.get("evidence") or {}
    sources = evidence.get("sources") or []
    claims = evidence.get("claims") or []
    gaps = []
    legacy = []
    for index, source in enumerate((profile.get("market") or {}).get("sources") or [], 1):
        if isinstance(source, dict) and source.get("url"):
            continue
        legacy.append({"index": index, "value": source})
    if legacy:
        gaps.append({"type": "legacy_market_sources", "count": len(legacy), "action": "为每条来源建立 evidence.sources 对象并补 URL/访问日期/权威度/独立来源组"})
    source_ids = {str(s.get("id")) for s in sources if isinstance(s, dict) and s.get("id")}
    for index, claim in enumerate(claims, 1):
        if not isinstance(claim, dict) or claim.get("status") not in ("real", "estimated"):
            continue
        missing = [field for field in STRICT_FIELDS if not claim.get(field)]
        unknown = [str(x) for x in (claim.get("source_ids") or []) if str(x) not in source_ids]
        files = []
        for raw in (claim.get("evidence_files") or []):
            resolved = raw if os.path.isabs(str(raw)) else os.path.join(base, str(raw))
            if not os.path.exists(os.path.normpath(resolved)):
                files.append(str(raw))
        if missing or unknown or files:
            gaps.append({"type": "claim_gap", "claim_id": claim.get("id", index),
                         "field": claim.get("field", ""), "missing": missing,
                         "unknown_source_ids": unknown, "missing_evidence_files": files,
                         "action": "由原始材料补齐字段后重新运行 validate_evidence.py --strict"})
    for index, source in enumerate(sources, 1):
        if not isinstance(source, dict):
            gaps.append({"type": "source_gap", "source_index": index, "action": "来源必须为对象"})
            continue
        if source.get("kind", "web") == "artifact" and source.get("path"):
            resolved = source["path"] if os.path.isabs(str(source["path"])) else os.path.join(base, str(source["path"]))
            if not os.path.exists(os.path.normpath(resolved)):
                gaps.append({"type": "source_gap", "source_id": source.get("id", index), "action": "补齐真实 artifact 文件", "path": source.get("path")})
    return {
        "schema_version": "1.0",
        "profile": os.path.abspath(path),
        "source_count": len(sources),
        "claim_count": len(claims),
        "legacy_market_sources": legacy,
        "gaps": gaps,
        "migration_complete": not gaps,
        "formal_ready": False,
        "note": "报告只列缺口，不修改 project.json；必须重新运行 validate_evidence.py --strict 和 build_scorecard.py --strict 才能判断正式就绪。",
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    try:
        report = migrate(args.profile)
        out = os.path.abspath(args.out)
        os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
        with io.open(out, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
            f.write("\n")
        print("迁移报告：%s；缺口=%d；migration_complete=%s；formal_ready=False（需严格门禁）" % (out, len(report["gaps"]), report["migration_complete"]))
        return 0 if report["migration_complete"] else 1
    except (OSError, ValueError, TypeError) as exc:
        print("迁移报告失败：%s" % exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
