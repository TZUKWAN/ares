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
import re
import sys
from datetime import date

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
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
URL_RE = re.compile(r"^https?://[^\s]+$", re.IGNORECASE)
AUTHORITIES = {"A", "B", "C"}
CONFIDENCE = {"real", "estimated", "placeholder"}


def _valid_date(value):
    if not DATE_RE.match(str(value or "")):
        return False
    try:
        date.fromisoformat(str(value))
        return True
    except ValueError:
        return False


def _get_field(profile, dotted):
    """Resolve a simple dotted profile path; list indices are accepted as [N]."""
    cur = profile
    for part in str(dotted).split("."):
        m = re.match(r"^([^\[]+)(?:\[(\d+)\])?$", part)
        if not m or not isinstance(cur, dict) or m.group(1) not in cur:
            return None, False
        cur = cur[m.group(1)]
        if m.group(2) is not None:
            idx = int(m.group(2))
            if not isinstance(cur, list) or idx >= len(cur):
                return None, False
            cur = cur[idx]
    return cur, True


def validate_evidence(profile, base_dir=None):
    """Validate the structured evidence ledger used by all production outputs.

    The legacy ``market.sources`` list remains accepted as content, but it is
    deliberately not treated as auditable provenance. Profiles with any real
    or estimated data must provide ``evidence.sources`` and ``evidence.claims``.
    """
    errors, warnings = [], []
    dc = profile.get("data_confidence") or {}
    needs_ledger = bool(dc.get("real") or dc.get("estimated"))
    evidence = profile.get("evidence")
    if not needs_ledger:
        return errors, warnings
    if not isinstance(evidence, dict):
        return ["evidence（含 real/estimated 数据时必须提供来源与结论台账）"], warnings

    sources = evidence.get("sources")
    claims = evidence.get("claims")
    if not isinstance(sources, list) or not sources:
        errors.append("evidence.sources（至少 1 条结构化来源）")
        sources = []
    if not isinstance(claims, list) or not claims:
        errors.append("evidence.claims（至少 1 条字段级结论）")
        claims = []

    source_ids = set()
    source_groups = {}
    for i, src in enumerate(sources, 1):
        if not isinstance(src, dict):
            errors.append("evidence.sources[%d] 必须是对象" % i)
            continue
        sid = str(src.get("id", "")).strip()
        if not sid:
            errors.append("evidence.sources[%d].id 缺失" % i)
        elif sid in source_ids:
            errors.append("evidence.sources[%d].id 重复：%s" % (i, sid))
        else:
            source_ids.add(sid)
            source_groups[sid] = str(src.get("independent_group", "")).strip()
        for key in ("title", "org", "accessed", "authority", "independent_group"):
            if not str(src.get(key, "")).strip():
                errors.append("evidence.sources[%d].%s 缺失" % (i, key))
        kind = str(src.get("kind", "web")).strip() or "web"
        if kind not in ("web", "artifact"):
            errors.append("evidence.sources[%d].kind 须为 web/artifact" % i)
        if kind == "web":
            if not str(src.get("url", "")).strip():
                errors.append("evidence.sources[%d].url 缺失" % i)
            elif not URL_RE.match(str(src["url"])):
                errors.append("evidence.sources[%d].url 不是 http(s) URL" % i)
        elif not str(src.get("path", "")).strip():
            errors.append("evidence.sources[%d].path 缺失" % i)
        elif base_dir:
            raw_path = str(src.get("path", "")).strip()
            resolved = raw_path if os.path.isabs(raw_path) else os.path.join(base_dir, raw_path)
            if not os.path.exists(os.path.normpath(resolved)):
                errors.append("evidence.sources[%d].path 不存在：%s" % (i, raw_path))
        if src.get("accessed") and not _valid_date(src.get("accessed")):
            errors.append("evidence.sources[%d].accessed 日期非法" % i)
        if src.get("published") and not _valid_date(src.get("published")):
            errors.append("evidence.sources[%d].published 日期非法" % i)
        if src.get("authority") not in AUTHORITIES:
            errors.append("evidence.sources[%d].authority 须为 A/B/C" % i)

    claim_ids = set()
    for i, claim in enumerate(claims, 1):
        if not isinstance(claim, dict):
            errors.append("evidence.claims[%d] 必须是对象" % i)
            continue
        cid = str(claim.get("id", "")).strip()
        if not cid:
            errors.append("evidence.claims[%d].id 缺失" % i)
        elif cid in claim_ids:
            errors.append("evidence.claims[%d].id 重复：%s" % (i, cid))
        else:
            claim_ids.add(cid)
        field = str(claim.get("field", "")).strip()
        status = str(claim.get("status", "")).strip()
        if not field:
            errors.append("evidence.claims[%d].field 缺失" % i)
        elif field not in ("free_text", "derived"):
            _value, exists = _get_field(profile, field)
            if not exists:
                errors.append("evidence.claims[%d].field 不存在：%s" % (i, field))
        if status not in CONFIDENCE:
            errors.append("evidence.claims[%d].status 须为 real/estimated/placeholder" % i)
        source_refs = claim.get("source_ids", [])
        if not isinstance(source_refs, list):
            errors.append("evidence.claims[%d].source_ids 必须为列表" % i)
            source_refs = []
        unknown = [str(s) for s in source_refs if str(s) not in source_ids]
        if unknown:
            errors.append("evidence.claims[%d] 引用了不存在的 source_id：%s" % (i, ",".join(unknown)))
        if status in ("real", "estimated") and not source_refs:
            errors.append("evidence.claims[%d] 的 %s 结论必须绑定 source_ids" % (i, status))
        if status == "placeholder" and not str(claim.get("rationale", "")).strip():
            errors.append("evidence.claims[%d] 为 placeholder 时必须填写 rationale" % i)
        if status == "estimated" and not str(claim.get("method", "")).strip():
            errors.append("evidence.claims[%d] 为 estimated 时必须填写 method" % i)
        if claim.get("critical"):
            unique_refs = set(str(s) for s in source_refs)
            if len(unique_refs) < 2:
                errors.append("evidence.claims[%d] 标记 critical 时至少需要 2 个 source_id" % i)
            elif len({source_groups.get(s) for s in unique_refs}) < 2:
                errors.append("evidence.claims[%d] 标记 critical 时必须来自至少 2 个 independent_group" % i)
        if claim.get("evidence_files") and not isinstance(claim["evidence_files"], list):
            errors.append("evidence.claims[%d].evidence_files 必须为列表" % i)
        if claim.get("rubric_refs") and not isinstance(claim["rubric_refs"], list):
            errors.append("evidence.claims[%d].rubric_refs 必须为列表" % i)
        if claim.get("output_refs") and not isinstance(claim["output_refs"], list):
            errors.append("evidence.claims[%d].output_refs 必须为列表" % i)
        if claim.get("supporting_quote") and not str(claim.get("supporting_quote")).strip():
            errors.append("evidence.claims[%d].supporting_quote 不能为空" % i)

    if source_ids and claims:
        referenced = {str(s) for c in claims if isinstance(c, dict)
                      for s in (c.get("source_ids") or [])}
        unused = sorted(source_ids - referenced)
        if unused:
            warnings.append("evidence.sources 有未被结论引用的来源：%s" % ",".join(unused))
    return errors, warnings


def is_empty(v):
    if v is None:
        return True
    if isinstance(v, str) and not v.strip():
        return True
    if isinstance(v, (list, dict)) and len(v) == 0:
        return True
    return False


def validate(profile, data_dir=None, evidence_base_dir=None):
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

    evidence_errors, evidence_warnings = validate_evidence(profile, evidence_base_dir)
    missing.extend(evidence_errors)
    warnings.extend(evidence_warnings)

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
        tracks_path = os.path.join(data_dir, "tracks.json")
        if os.path.exists(tracks_path) and comp.get("id") is not None and comp.get("track"):
            try:
                tracks = json.load(io.open(tracks_path, encoding="utf-8"))["entries"]
                valid = {e["track"] for e in tracks if e["competition_id"] == comp["id"]}
                if valid and comp["track"] not in valid:
                    warnings.append("competition.track=%r 不在该赛事 tracks.json 赛道列表 %s 中"
                                    % (comp["track"], sorted(valid)))
            except (ValueError, KeyError) as e:
                warnings.append("tracks.json 无法解析：%s" % e)
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
    missing, warnings = validate(profile, data_dir, os.path.dirname(os.path.abspath(path)))

    # 非商业类生产线（L2建模/L5艺术/L6程序/E1人文/E2技能/E3模拟纯训练）：
    # 商业性字段降级为警告，避免调研类项目被迫填"不适用"
    pipeline = None
    try:
        tracks = json.load(io.open(os.path.join(data_dir, "tracks.json"), encoding="utf-8"))["entries"]
        cid = (profile.get("competition") or {}).get("id")
        for e in tracks:
            if e.get("competition_id") == cid:
                pipeline = e.get("pipeline")
                break
    except (ValueError, KeyError, OSError):
        pass
    if pipeline in ("L2", "L5", "L6", "E1", "E2"):
        biz_prefixes = ("financials.", "business_model.", "competitors", "advantages")
        downgraded = [m for m in missing if m.startswith(biz_prefixes)]
        if downgraded:
            missing = [m for m in missing if not m.startswith(biz_prefixes)]
            warnings.append("非商业类生产线（%s）跳过商业性必填项 %d 个：%s"
                            % (pipeline, len(downgraded), "、".join(downgraded)))
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
