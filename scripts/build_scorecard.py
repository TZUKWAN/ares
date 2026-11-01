# -*- coding: utf-8 -*-
"""Build a deterministic rubric-to-evidence-to-deliverable coverage matrix.

Usage:
    python build_scorecard.py --profile project.json --output-dir 输出/项目名
    python build_scorecard.py --profile project.json --output-dir 输出/项目名 --strict

The tool never guesses coverage. Claims must explicitly declare ``rubric_refs``
in the evidence ledger. This makes a low-context model produce a reviewable
gap list instead of silently claiming that a section is covered. Only
``--strict`` can set ``formal_ready`` to true, after provenance and output
existence checks pass.
"""
import argparse
import io
import json
import os
import re
import sys

from validate_profile import validate_evidence


def _load(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def _rubric_path(root, competition_id):
    return os.path.join(root, "data", "rubrics", "%03d.json" % int(competition_id))


def _normalise(value):
    return re.sub(r"\s+", "", str(value or "")).lower()


def _claim_text(claim):
    return " ".join(str(claim.get(k, "")) for k in ("id", "field", "supporting_quote", "method", "rationale"))


def _claim_refs(claim):
    refs = claim.get("rubric_refs") or []
    return {_normalise(x) for x in refs if str(x).strip()}


def _match_claims(claims, dimension, point):
    dim_key, point_key = _normalise(dimension), _normalise(point)
    result = []
    for claim in claims:
        if not isinstance(claim, dict):
            continue
        refs = _claim_refs(claim)
        if dim_key in refs or point_key in refs:
            result.append(claim)
            continue
        # Allow a stable prefix such as ``innovation`` to be used as a rubric ref.
        if any(ref and (ref in dim_key or ref in point_key) for ref in refs):
            result.append(claim)
    return result


def _requires_strong_evidence(point):
    text = _normalise(point)
    return any(token in text for token in (
        "第三方检测", "查新报告", "合同订单", "真实营收", "税收", "市场容量测算有一手调研",
    ))


def _has_strong_claim(claims, source_by_id):
    for claim in claims:
        if claim.get("status") != "real" or not claim.get("output_refs"):
            continue
        if claim.get("strong_evidence"):
            return True
        authorities = {str(source_by_id.get(str(s), {}).get("authority", ""))
                       for s in (claim.get("source_ids") or [])}
        if authorities.intersection({"A", "B"}):
            return True
    return False


def _deliverable_status(output_dir, item):
    clean = re.sub(r"（.*?）|\(.*?\)", "", str(item)).strip()
    if not clean:
        return {"item": item, "required": False, "exists": True, "path": ""}
    path = os.path.join(output_dir, clean)
    exists = os.path.exists(path)
    return {"item": item, "required": True, "exists": exists,
            "path": clean, "status": "present" if exists else "missing"}


def _output_ref_exists(ref, output_dir, profile_dir, root):
    raw = str(ref or "").strip()
    if not raw:
        return False
    candidates = [raw] if os.path.isabs(raw) else [
        os.path.join(output_dir, raw) if output_dir else "",
        os.path.join(profile_dir, raw),
        os.path.join(root, raw),
    ]
    return any(path and os.path.exists(os.path.normpath(path)) for path in candidates)


def build(profile_path, output_dir=None, strict=False, root=None):
    profile = _load(profile_path)
    root = os.path.abspath(root or os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
    profile_dir = os.path.dirname(os.path.abspath(profile_path))
    if strict:
        evidence_errors, _warnings = validate_evidence(profile, profile_dir)
        if evidence_errors:
            raise ValueError("正式提交门禁失败：证据台账结构不合格；%s" % "；".join(evidence_errors))
        # The strict provenance rules live in validate_evidence.py so the
        # standalone validator and scorecard gate cannot silently diverge.
        strict_validator = os.path.join(os.path.dirname(os.path.abspath(__file__)), "validate_evidence.py")
        import subprocess
        completed = subprocess.run([sys.executable, strict_validator, profile_path, "--strict"],
                                   capture_output=True, text=True, encoding="utf-8", errors="replace")
        if completed.returncode != 0:
            raise ValueError("正式提交门禁失败：严格证据校验未通过；%s" % (completed.stdout + completed.stderr).strip())
    competition = profile.get("competition") or {}
    cid = competition.get("id")
    if cid is None:
        raise ValueError("competition.id 缺失，无法加载 rubric")
    rubric_path = _rubric_path(root, cid)
    if not os.path.isfile(rubric_path):
        raise FileNotFoundError("rubric 不存在：%s" % rubric_path)
    rubric = _load(rubric_path)
    claims = [c for c in ((profile.get("evidence") or {}).get("claims") or []) if isinstance(c, dict)]
    source_by_id = {str(s.get("id")): s for s in ((profile.get("evidence") or {}).get("sources") or [])
                    if isinstance(s, dict) and s.get("id")}
    dimensions = []
    uncovered = []
    for dimension in rubric.get("judging_dimensions", []):
        name = dimension.get("dimension", "未命名维度")
        points = []
        for point in dimension.get("scoring_points", []):
            matches = _match_claims(claims, name, point)
            usable = [c for c in matches if c.get("status") in ("real", "estimated")]
            linked = [c for c in usable if c.get("output_refs")]
            strong_required = _requires_strong_evidence(point)
            strong = _has_strong_claim(linked, source_by_id)
            status = "covered" if linked and (not strong_required or strong) else ("blocked" if linked else "uncovered")
            blocking_reason = ""
            if status == "blocked":
                blocking_reason = "该评分点要求原始/第三方凭证，当前 claim 只有 DEMO/估算或非强来源"
            if status == "uncovered":
                uncovered.append("%s：%s" % (name, point))
            elif status == "blocked":
                uncovered.append("%s：%s（%s）" % (name, point, blocking_reason))
            points.append({
                "point": point,
                "status": status,
                "strong_evidence_required": strong_required,
                "blocking_reason": blocking_reason,
                "claim_ids": [str(c.get("id")) for c in matches if c.get("id")],
                "usable_claim_ids": [str(c.get("id")) for c in usable if c.get("id")],
                "output_refs": sorted({str(ref) for c in linked for ref in (c.get("output_refs") or [])}),
            })
        dimensions.append({"dimension": name, "weight": dimension.get("weight", ""), "points": points})
    deliverables = []
    if output_dir:
        track_entries = _load(os.path.join(root, "data", "tracks.json")).get("entries", [])
        track = competition.get("track")
        candidates = [e for e in track_entries if e.get("competition_id") == cid and (not track or e.get("track") == track)]
        if candidates:
            deliverables = [_deliverable_status(os.path.abspath(output_dir), x) for x in candidates[0].get("default_deliverables", [])]
    total = sum(len(d["points"]) for d in dimensions)
    covered = sum(sum(p["status"] == "covered" for p in d["points"]) for d in dimensions)
    coverage_ready = not uncovered and all(d.get("exists", True) for d in deliverables)
    result = {
        "schema_version": "1.0",
        "competition": competition,
        "rubric_path": os.path.relpath(rubric_path, root).replace("\\", "/"),
        "dimensions": dimensions,
        "deliverables": deliverables,
        "coverage": {"covered_points": covered, "total_points": total, "ratio": covered / total if total else 0},
        "uncovered_points": uncovered,
        # A non-strict matrix is an inspection artifact. It can show complete
        # coverage, but it must never claim formal readiness before the strict
        # provenance gate has run.
        "coverage_ready": coverage_ready,
        "formal_ready": bool(strict and coverage_ready),
    }
    if strict and not result["formal_ready"]:
        raise ValueError("正式提交门禁失败：未覆盖评分点 %d 项或缺少交付物" % len(uncovered))
    if strict:
        refs = sorted({str(ref) for c in claims for ref in (c.get("output_refs") or []) if str(ref).strip()})
        missing_refs = [ref for ref in refs if not _output_ref_exists(ref, os.path.abspath(output_dir or ""), profile_dir, root)]
        if missing_refs:
            raise ValueError("正式提交门禁失败：claim.output_refs 不存在；%s" % "，".join(missing_refs))
    return result


def write_outputs(result, output_dir):
    os.makedirs(output_dir, exist_ok=True)
    json_path = os.path.join(output_dir, "评分覆盖矩阵.json")
    md_path = os.path.join(output_dir, "评分覆盖矩阵.md")
    with io.open(json_path, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")
    lines = ["# 评分覆盖矩阵", "", "赛事：%s" % result["competition"].get("name", "未命名"),
             "覆盖率：%d/%d（%.1f%%）" % (result["coverage"]["covered_points"], result["coverage"]["total_points"], result["coverage"]["ratio"] * 100),
             "正式提交就绪：%s" % ("是" if result["formal_ready"] else "否"), ""]
    for dimension in result["dimensions"]:
        lines.append("## %s（%s）" % (dimension["dimension"], dimension["weight"]))
        for point in dimension["points"]:
            marker = "✅" if point["status"] == "covered" else ("⚠️" if point["status"] == "blocked" else "❌")
            claims = ", ".join(point["claim_ids"]) or "无"
            reason = ("；" + point["blocking_reason"]) if point.get("blocking_reason") else ""
            lines.append("- %s %s；claims：%s%s" % (marker, point["point"], claims, reason))
        lines.append("")
    if result["deliverables"]:
        lines.append("## 交付物")
        for item in result["deliverables"]:
            lines.append("- %s %s" % ("✅" if item["exists"] else "❌", item["item"]))
    for path, content in ((json_path, json.dumps(result, ensure_ascii=False, indent=2)), (md_path, "\n".join(lines) + "\n")):
        if path == json_path:
            continue
        with io.open(path, "w", encoding="utf-8") as f:
            f.write(content)
    print("已生成：%s" % json_path)
    print("已生成：%s" % md_path)
    print("覆盖率：%d/%d；正式提交就绪=%s" % (result["coverage"]["covered_points"], result["coverage"]["total_points"], result["formal_ready"]))


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--output-dir", default=None)
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args(argv)
    try:
        result = build(args.profile, args.output_dir, args.strict)
        if args.output_dir:
            write_outputs(result, os.path.abspath(args.output_dir))
        else:
            print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, FileNotFoundError) as exc:
        print("评分覆盖矩阵失败：%s" % exc)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
