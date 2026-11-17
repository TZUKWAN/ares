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
from workflow_contracts import check_deliverable
from rubric_evidence import evidence_summary, validate_provenance, field_status


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
    return check_deliverable(output_dir,item)


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
    source_errors = validate_provenance(rubric, root)
    if source_errors and (strict or "provenance" in rubric):
        raise ValueError("规则档案来源状态无效；" + "；".join(source_errors))
    rule_evidence = evidence_summary(rubric, competition)
    if source_errors:
        rule_evidence.update(status="unverified", issues=source_errors)
    claims = [c for c in ((profile.get("evidence") or {}).get("claims") or []) if isinstance(c, dict)]
    source_by_id = {str(s.get("id")): s for s in ((profile.get("evidence") or {}).get("sources") or [])
                    if isinstance(s, dict) and s.get("id")}
    dimensions = []
    uncovered = []
    for dimension_index, dimension in enumerate(rubric.get("judging_dimensions", [])):
        name = dimension.get("dimension", "未命名维度")
        points = []
        for raw_point in dimension.get("scoring_points", []):
            point=raw_point.get('text','') if isinstance(raw_point,dict) else raw_point
            mandatory=isinstance(raw_point,dict) and raw_point.get('requirement')=='mandatory'
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
                "requirement": "mandatory" if mandatory else "recommendation",
                "status": status,
                "strong_evidence_required": strong_required,
                "blocking_reason": blocking_reason,
                "claim_ids": [str(c.get("id")) for c in matches if c.get("id")],
                "usable_claim_ids": [str(c.get("id")) for c in usable if c.get("id")],
                "output_refs": sorted({str(ref) for c in linked for ref in (c.get("output_refs") or [])}),
            })
        weight_path = "/judging_dimensions/%d/weight" % dimension_index
        weight_state = field_status(rubric, weight_path, competition)
        weight_evidence = rubric.get("provenance", {}).get("fields", {}).get(weight_path, {})
        official_weight = weight_evidence.get("officialWeight") if weight_state == "verified" and weight_evidence.get("category") == "official-rule" else None
        dimensions.append({"dimension": name, "weight": dimension.get("weight", ""),
                           "weightStatus": weight_state, "officialWeight": official_weight, "points": points})
    deliverables = []
    if output_dir:
        track_entries = _load(os.path.join(root, "data", "tracks.json")).get("entries", [])
        track = competition.get("track")
        candidates = [e for e in track_entries if e.get("competition_id") == cid and (not track or e.get("track") == track)]
        if candidates:
            items=candidates[0].get('default_deliverables',[])
            parent=next((re.sub(r'（.*?）|\(.*?\)','',x).strip() for x in items if isinstance(x,str) and '.docx' in x),None)
            deliverables=[check_deliverable(os.path.abspath(output_dir),x,parent) for x in items]
    total = sum(len(d["points"]) for d in dimensions)
    covered = sum(sum(p["status"] == "covered" for p in d["points"]) for d in dimensions)
    mandatory_gaps=[p['point'] for d in dimensions for p in d['points'] if p['requirement']=='mandatory' and p['status']!='covered']
    coverage_ready = not mandatory_gaps and all(not d.get('required',True) or d.get('exists',False) for d in deliverables)
    result = {
        "schema_version": "1.0",
        "competition": competition,
        "rubric_path": os.path.relpath(rubric_path, root).replace("\\", "/"),
        "dimensions": dimensions,
        "ruleEvidence": rule_evidence,
        "officialScore": None,
        "scoreNote": "本表只检查证据覆盖，不计算官方得分。历史权重未逐条核验，不能生成当届正式评分结论。",
        "deliverables": deliverables,
        "coverage": {"covered_points": covered, "total_points": total, "ratio": covered / total if total else 0},
        "uncovered_points": uncovered,
        # A non-strict matrix is an inspection artifact. It can show complete
        # coverage, but it must never claim formal readiness before the strict
        # provenance gate has run.
        "coverage_ready": coverage_ready,
        "strict_checks_ready": bool(strict and coverage_ready),
        "formal_ready": False,
        "readiness_note": "旧评分矩阵仅为证据与结构检查；正式项目请迁移至 .ares/ 并核验当届规则及内容。评分建议不作为一律必过项。",
        "mandatory_gaps": mandatory_gaps,
    }
    if strict and not result["strict_checks_ready"]:
        raise ValueError("必需要求检查失败：硬性要求缺口 %d 项或必需产物缺失/无效" % len(mandatory_gaps))
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
        lines.append("## %s" % dimension["dimension"])
        lines.append("权重依据（%s）：%s" % ("已核验本范围官方条款" if dimension["weightStatus"] == "verified" else "历史参考，未确认本范围官方分值", dimension["weight"]))
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
