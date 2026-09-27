# -*- coding: utf-8 -*-
"""
validate_profile.py — Ares 插件 project.json 完整性校验（T1.4）

用法：
    python validate_profile.py <project.json路径>
    python validate_profile.py <project.json路径> --quiet

行为：
    空档案  → 输出全部缺失项清单，退出码 1
    完整档案 → 输出校验通过摘要，退出码 0
    字段存在但为空（空串/空列表/0/None）视为缺失；例外：论文/获奖/合作伙伴/其他社会价值
    允许为空列表（"无相关成果"是合法状态），为空时给警告。
    --quiet 只输出一行结果。

同时交叉核对 competition.id 是否存在于 data/competitions.json（能找到数据文件时）。
"""
import json
import io
import os
import sys

# 字段 → 说明（与 skills/ares/references/profile-schema.json 保持一致）
REQUIRED_SCALAR = {
    "project_name": "项目全称",
    "one_liner": "一句话简介",
    "slogan": "口号",
}
REQUIRED_OBJECTS = {
    "competition": {
        "id": "赛事id（competitions.json）",
        "name": "赛事全称",
        "level": "赛事等级 A1/A2/A3/B1/B2",
        "track": "赛道",
    },
    "solution": {
        "features": "核心功能列表",
        "tech_stack": "技术栈",
        "innovations": "创新点",
        "performance_metrics": "性能指标",
    },
    "market": {
        "tam": "总市场规模",
        "sam": "可服务市场",
        "som": "初期可获得市场",
        "growth": "增速及预测",
        "sources": "数据来源清单",
    },
    "business_model": {
        "revenue_streams": "收入来源及占比",
        "pricing": "定价体系",
        "costs": "成本结构",
    },
    "financials": {
        "revenue_start_wan": "起始年营收（万元）",
        "growth_rate_range": "年增长率区间",
        "margin_ratio_vs_industry": "利润率相对行业均值倍数",
        "years": "预测年数（默认6）",
    },
    "achievements": {
        "patents": "专利",
        "pilots": "试点/签约",
    },
    "social_value": {
        "employment": "带动就业",
        "education": "教育引领",
    },
    "data_confidence": {
        "real": "用户提供真实数据清单",
        "estimated": "AI估算数据清单",
        "placeholder": "占位待填清单",
    },
}
# 子字段必须存在，但允许空列表（"无相关成果"是合法状态），为空时给警告
ALLOW_EMPTY_WITH_WARNING = {
    "achievements.papers": "论文",
    "achievements.awards": "获奖",
    "achievements.partners": "合作伙伴",
    "social_value.others": "其他社会价值",
}
REQUIRED_LISTS = {
    "pain_points": "痛点清单",
    "competitors": "竞品清单",
    "advantages": "相对优势",
    "team": "团队成员",
    "milestones": "里程碑",
}
OPTIONAL = {"policy": "政策清单", "advisors": "指导老师", "competition.deadline": "截止时间"}

LEVELS = {"A1", "A2", "A3", "B1", "B2"}


def is_empty(v):
    if v is None:
        return True
    if isinstance(v, str) and not v.strip():
        return True
    if isinstance(v, (list, dict)) and len(v) == 0:
        return True
    return False


def validate(profile, data_dir=None):
    missing, warnings = [], []
    for key, label in REQUIRED_SCALAR.items():
        if key not in profile or is_empty(profile.get(key)):
            missing.append("%s（%s）" % (key, label))
    for obj, subfields in REQUIRED_OBJECTS.items():
        sub = profile.get(obj)
        if not isinstance(sub, dict):
            missing.append("%s（整个对象缺失）" % obj)
            continue
        for k, label in subfields.items():
            if k not in sub or is_empty(sub.get(k)):
                missing.append("%s.%s（%s）" % (obj, k, label))
    for dotted, label in ALLOW_EMPTY_WITH_WARNING.items():
        obj, k = dotted.split(".")
        sub = profile.get(obj)
        if not isinstance(sub, dict) or k not in sub:
            missing.append("%s.%s（%s，字段须存在，可为空列表）" % (obj, k, label))
        elif is_empty(sub.get(k)):
            warnings.append("%s.%s 为空（%s），若确无相关成果可忽略" % (obj, k, label))
    for key, label in REQUIRED_LISTS.items():
        if key not in profile or is_empty(profile.get(key)):
            missing.append("%s（%s）" % (key, label))

    comp = profile.get("competition") or {}
    level = comp.get("level")
    if level and level not in LEVELS:
        missing.append("competition.level（等级 %s 不在 A1/A2/A3/B1/B2 内）" % level)

    fin = profile.get("financials") or {}
    if fin.get("years") not in (None, ""):
        try:
            if int(fin["years"]) < 3:
                warnings.append("financials.years=%s 少于 3 年，创业赛默认 6 年" % fin["years"])
        except (TypeError, ValueError):
            missing.append("financials.years（须为整数）")

    dc = profile.get("data_confidence") or {}
    if isinstance(dc, dict) and all(is_empty(dc.get(k)) for k in ("real", "estimated", "placeholder")):
        warnings.append("data_confidence 三类登记全空，关键数据未做真实性登记")

    if data_dir:
        comps_path = os.path.join(data_dir, "competitions.json")
        if os.path.exists(comps_path) and comp.get("id") is not None:
            try:
                db = json.load(io.open(comps_path, encoding="utf-8"))
                ids = {c["id"] for c in db}
                if comp["id"] not in ids:
                    missing.append("competition.id=%s 不在 competitions.json 中" % comp["id"])
                else:
                    match = next(c for c in db if c["id"] == comp["id"])
                    if comp.get("name") and comp["name"] != match["name"]:
                        warnings.append(
                            "competition.name=%r 与主库 %r 不一致" % (comp["name"], match["name"]))
            except (ValueError, KeyError) as e:
                warnings.append("competitions.json 无法解析：%s" % e)
    return missing, warnings


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path = argv[1]
    quiet = "--quiet" in argv
    if not os.path.exists(path):
        print("文件不存在：%s" % path)
        return 2
    try:
        profile = json.load(io.open(path, encoding="utf-8"))
    except ValueError as e:
        print("JSON 解析失败：%s" % e)
        return 2
    data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data")
    missing, warnings = validate(profile, data_dir)
    if quiet:
        print("[PASS]" if not missing else "[FAIL] 缺失 %d 项" % len(missing))
    else:
        if missing:
            print("缺失项清单（%d 项）：" % len(missing))
            for m in missing:
                print("  - %s" % m)
        else:
            print("校验通过：必填字段齐全。")
        for w in warnings:
            print("[警告] %s" % w)
        print("可选字段未填不阻断：%s" % "、".join(OPTIONAL.values()))
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
