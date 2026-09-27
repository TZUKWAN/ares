# -*- coding: utf-8 -*-
"""
validate_rubrics.py — Ares 插件 132 项赛事评审标准档案（rubrics/NNN.json）校验（T2.0/T2 总DoD）

用法：
    python scripts/validate_rubrics.py            # 全量校验 1-132
    python scripts/validate_rubrics.py 1 5 83     # 抽查指定 id

校验项：
    文件存在、JSON 合法、必填字段齐全、judging_dimensions 非空且 weight 非空、
    sources ≥2 且含 accessed 日期与 authority 等级、confidence 取值合法、
    last_updated 为日期、标★赛事（1,2,3,4,5,6,10,12,21,51,72,83）含 past_winning_patterns。
"""
import io
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RUBRIC_DIR = os.path.join(HERE, "..", "data", "rubrics")
STARRED = {1, 2, 3, 4, 5, 6, 10, 12, 21, 51, 72, 83}   # 任务清单批次表标★赛事
REQUIRED = ["competition_id", "competition_name", "judging_dimensions", "deliverable_requirements",
            "process_stages", "review_format", "sources", "confidence", "last_updated"]
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
WEIGHT_RE = re.compile(r"\d+(\.\d+)?\s*%|定性|一票|通过制|客观题|分数", re.IGNORECASE)


def check_one(cid, strict_star=True):
    errs = []
    path = os.path.join(RUBRIC_DIR, "%03d.json" % cid)
    if not os.path.exists(path):
        return ["文件不存在: %s" % path]
    try:
        r = json.load(io.open(path, encoding="utf-8"))
    except ValueError as e:
        return ["JSON 解析失败: %s" % e]
    for k in REQUIRED:
        if k not in r:
            errs.append("缺字段 %s" % k)
    if r.get("competition_id") != cid:
        errs.append("competition_id=%r 与文件 id %d 不一致" % (r.get("competition_id"), cid))
    jd = r.get("judging_dimensions") or []
    if not jd:
        errs.append("judging_dimensions 为空")
    for d in jd:
        if not d.get("dimension"):
            errs.append("judging_dimensions 有条目缺 dimension")
            break
        if not d.get("weight") or not WEIGHT_RE.search(str(d.get("weight"))):
            errs.append("维度 %r 权重缺失或格式异常: %r" % (d.get("dimension"), d.get("weight")))
            break
        if not d.get("official_wording"):
            errs.append("维度 %r 缺 official_wording（须有官方原文或推断依据）" % d.get("dimension"))
            break
    srcs = r.get("sources") or []
    if len(srcs) < 2:
        errs.append("sources 少于 2 个（当前 %d）" % len(srcs))
    for s in srcs:
        if not s.get("url") or not s.get("accessed") or not DATE_RE.match(str(s.get("accessed", ""))):
            errs.append("来源 %r 缺 url/accessed 或日期格式错" % s.get("title", "")[:30])
            break
        if s.get("authority") not in ("A", "B", "C"):
            errs.append("来源 %r authority 须为 A/B/C" % s.get("title", "")[:30])
            break
    if r.get("confidence") not in ("high", "medium", "low"):
        errs.append("confidence 取值非法: %r" % r.get("confidence"))
    if not DATE_RE.match(str(r.get("last_updated", ""))):
        errs.append("last_updated 须为 YYYY-MM-DD")
    if strict_star and cid in STARRED and not (r.get("past_winning_patterns") or []):
        errs.append("标★赛事缺 past_winning_patterns（获奖作品共性分析）")
    return errs


def main(argv):
    ids = [int(a) for a in argv] if argv else list(range(1, 133))
    total_err = 0
    for cid in ids:
        errs = check_one(cid)
        if errs:
            total_err += len(errs)
            print("[%03d] FAIL" % cid)
            for e in errs:
                print("   - " + e)
        else:
            print("[%03d] PASS" % cid)
    print()
    print("校验 %d 份，失败 %d 份，问题 %d 个。" % (len(ids), sum(1 for c in ids if check_one(c)), total_err))
    return 0 if total_err == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
