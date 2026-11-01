# -*- coding: utf-8 -*-
"""Turn scorecard gaps into an actionable evidence request packet.

The packet is deliberately non-generative: it lists what the team must
provide, but never creates a source, number, quote or credential. ``--strict``
returns 1 while any scorecard point remains uncovered or blocked.
"""
import argparse
import io
import json
import os
import sys


def _load(path):
    with io.open(path, encoding="utf-8") as f:
        return json.load(f)


def _kind(point):
    text = str(point)
    rules = [
        (("第三方检测", "查新"), "third_party_test", "CMA/CNAS检测报告、查新报告或正式实验记录"),
        (("合同订单", "真实营收", "税收", "市场份额"), "commercial_proof", "合同、订单、发票、银行流水、纳税或市场份额原始凭证"),
        (("一手调研", "市场容量"), "first_hand_research", "问卷原件、抽样方案、原始数据、访谈记录与测算底稿"),
        (("团队", "指导教师", "成员真实", "成长轨迹"), "team_proof", "成员身份/学校证明、分工记录、指导记录和阶段日志"),
        (("红旅", "公益", "职教", "产业命题"), "track_proof", "赛道报名/活动记录、公益成效或命题企业需求与确认材料"),
        (("专创", "学科交叉", "产教融合", "教育"), "education_proof", "课程/科研训练记录、学生贡献日志、校企合作或教学成果材料"),
    ]
    for tokens, kind, description in rules:
        if any(token in text for token in tokens):
            return kind, description
    return "source_proof", "与该评分点直接对应的原始来源、原文摘录、访问日期和文件快照"


def build(profile_path, scorecard_path):
    profile = _load(profile_path)
    scorecard = _load(scorecard_path)
    items = []
    for dimension in scorecard.get("dimensions", []):
        for point in dimension.get("points", []):
            if point.get("status") == "covered":
                continue
            kind, required = _kind(point.get("point", ""))
            items.append({
                "id": "gap-%03d" % (len(items) + 1),
                "dimension": dimension.get("dimension", ""),
                "point": point.get("point", ""),
                "status": point.get("status", "uncovered"),
                "blocking_reason": point.get("blocking_reason", ""),
                "evidence_kind": kind,
                "required_material": required,
                "claim_template": {
                    "field": "待由项目负责人确认",
                    "status": "real",
                    "source_ids": [],
                    "supporting_quote": "待从原始材料逐字摘录",
                    "retrieved_at": "YYYY-MM-DD",
                    "content_hash": "待对 evidence_files 计算 SHA-256",
                    "evidence_files": [],
                    "rubric_refs": [point.get("point", "")],
                    "output_refs": [],
                    "normalized_value": "数值结论必填",
                    "value_unit": "数值结论必填",
                },
            })
    return {
        "schema_version": "1.0",
        "profile": os.path.abspath(profile_path),
        "scorecard": os.path.abspath(scorecard_path),
        "competition": profile.get("competition", {}),
        "gap_count": len(items),
        "formal_ready": False,
        "items": items,
        "note": "本清单只请求真实材料，不生成或填充事实；补齐后重新运行 migrate_profile、validate_evidence --strict 和 build_scorecard --strict。",
    }


def write_outputs(result, out):
    out = os.path.abspath(out)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with io.open(out, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
        f.write("\n")
    md = os.path.splitext(out)[0] + ".md"
    lines = ["# 证据补交清单", "", "赛事：%s" % result["competition"].get("name", "未命名"),
             "缺口数量：%d" % result["gap_count"], "正式就绪：否", ""]
    for item in result["items"]:
        lines.extend(["## %s · %s" % (item["id"], item["dimension"]),
                      "- 状态：%s" % item["status"],
                      "- 评分点：%s" % item["point"],
                      "- 证据类型：%s" % item["evidence_kind"],
                      "- 需要材料：%s" % item["required_material"],
                      "- claim 模板：补齐原文、日期、SHA-256、证据文件和产物位置后再写入 project.json。", ""])
    with io.open(md, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("已生成：%s" % out)
    print("已生成：%s" % md)
    print("缺口：%d；正式就绪=False" % result["gap_count"])


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--scorecard", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--strict", action="store_true")
    args = ap.parse_args(argv)
    try:
        result = build(args.profile, args.scorecard)
        write_outputs(result, args.out)
        return 1 if args.strict and result["gap_count"] else 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("证据补交清单失败：%s" % exc)
        return 1


if __name__ == "__main__":
    sys.exit(main())
