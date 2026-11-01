# -*- coding: utf-8 -*-
"""Deterministically match a request to the competition catalogue.

The matcher is deliberately offline and catalogue-only.  It never creates a
competition record or infers a competition outside ``data/competitions.json``.

Examples::

    python match_competition.py --request "我想参加数模国赛，提交参赛论文"
    python match_competition.py --file 用户需求.txt --markdown 输出/赛事匹配.md

JSON is always printed to stdout.  ``--markdown`` writes an optional human
reviewable rendering to the requested path.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
from typing import Any, Dict, Iterable, List, Sequence, Tuple


ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
CATALOG_PATH = os.path.join(ROOT, "data", "competitions.json")
TRACKS_PATH = os.path.join(ROOT, "data", "tracks.json")

# Generic words make every competition look relevant and therefore do not
# contribute to the keyword score.  This list is intentionally small and
# conservative; catalogue content remains the source of truth.
_STOPWORDS = {
    "大学生", "全国", "国际", "中国", "比赛", "竞赛", "大赛", "系列赛", "作品", "项目",
    "想做", "想参加", "参加", "报名", "希望", "需要", "一个", "相关", "方向", "类型", "类别",
    "提交", "制作", "需要做", "帮我做", "学生", "高校", "学校", "比赛项目", "赛事",
    "国赛", "省赛", "校赛", "决赛", "复赛", "初赛", "赛道", "赛方", "年度",
    "创业", "创新", "计划", "展示", "路演", "汇报", "ppt",
}
_GENERIC_SUFFIXES = ("竞赛", "比赛", "大赛", "国赛", "省赛", "校赛", "决赛", "复赛", "初赛")
_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_ASCII_RE = re.compile(r"[a-z0-9][a-z0-9+.#_-]*", re.I)
_PUNCT_RE = re.compile(r"[\s\u3000，。、“”‘’；：？！\-—（）()【】\[\]《》<>/\\|_]+")


def _text(value: Any) -> str:
    return str(value or "").strip()


def _normalise(value: Any) -> str:
    return _PUNCT_RE.sub("", _text(value)).lower()


def _tokens(value: Any) -> List[str]:
    """Return conservative Chinese n-grams and ASCII tokens.

    Chinese bigrams/trigrams let ``数学建模`` and ``建模`` match without an
    external tokenizer.  Short generic words are removed to avoid broad noise.
    """
    raw = _normalise(value)
    result: List[str] = []
    cjk = "".join(ch for ch in raw if _CJK_RE.match(ch))
    for n in (3, 2):
        for i in range(0, max(0, len(cjk) - n + 1)):
            token = cjk[i:i + n]
            if (token not in _STOPWORDS
                    and not any(token.endswith(x) and token != x for x in _GENERIC_SUFFIXES)
                    and not (len(token) == 2 and (token.endswith("竞") or token.startswith("赛")))):
                result.append(token)
    result.extend(t for t in _ASCII_RE.findall(raw) if t not in _STOPWORDS)
    # Stable de-duplication keeps scoring easy to explain.
    return list(dict.fromkeys(result))


def _flatten(value: Any) -> List[str]:
    if value is None:
        return []
    if isinstance(value, dict):
        out: List[str] = []
        for v in value.values():
            out.extend(_flatten(v))
        return out
    if isinstance(value, (list, tuple, set)):
        out = []
        for v in value:
            out.extend(_flatten(v))
        return out
    return [_text(value)]


def _field_texts(comp: Dict[str, Any]) -> Dict[str, List[str]]:
    return {
        "name": [_text(comp.get("name"))],
        "alias": [_text(x) for x in (comp.get("aliases") or []) if _text(x)],
        "category": [_text(comp.get("category"))],
        "pipeline": [_text(comp.get("pipeline"))],
        "deliverable": [x for x in _flatten(comp.get("deliverables_required")) if x],
    }


def _contains_phrase(query: str, phrase: str) -> bool:
    q, p = _normalise(query), _normalise(phrase)
    return bool(p) and (p in q or q in p and len(q) >= 2)


def _score(query: str, comp: Dict[str, Any]) -> Dict[str, Any]:
    fields = _field_texts(comp)
    q_norm = _normalise(query)
    q_tokens = set(_tokens(query))
    score = 0.0
    reasons: List[str] = []
    matched: Dict[str, List[str]] = {}
    strong = 0

    # A direct name or alias is the most reliable signal.  Exact alias/name
    # hits dominate all generic keyword overlap and receive high confidence.
    if _contains_phrase(query, fields["name"][0]):
        score += 100
        strong += 1
        matched["name"] = [fields["name"][0]]
        reasons.append("需求直接提到赛事名称：%s" % fields["name"][0])
    aliases = [x for x in fields["alias"] if _contains_phrase(query, x)]
    if aliases:
        score += min(90, 72 + 6 * min(len(aliases) - 1, 3))
        strong += 1
        matched["alias"] = aliases
        reasons.append("需求命中赛事别名：%s" % "、".join(aliases[:3]))

    def add_phrase_field(field: str, weight: float, label: str) -> None:
        nonlocal score
        hits = [v for v in fields[field] if _contains_phrase(query, v)]
        if hits:
            score += weight * min(len(hits), 2)
            matched[field] = hits
            reasons.append("需求命中%s：%s" % (label, "、".join(hits[:3])))

    add_phrase_field("category", 22, "类别")
    add_phrase_field("pipeline", 18, "流程标签")

    # Overlap with informative terms in each field gives useful behaviour for
    # natural-language requests that do not name a competition explicitly.
    field_weights = {"name": 13, "alias": 11, "category": 8, "pipeline": 7, "deliverable": 5}
    for field, values in fields.items():
        hits: List[str] = []
        for value in values:
            terms = set(_tokens(value))
            overlap = sorted(q_tokens & terms, key=lambda x: (-len(x), x))
            hits.extend(overlap)
        hits = list(dict.fromkeys(hits))
        if hits:
            # Longer tokens carry more information; cap each field to avoid a
            # long deliverables list overwhelming a name/category signal.
            contribution = min(30.0, sum(field_weights[field] * min(1.5, len(t) / 2.0) for t in hits))
            score += contribution
            matched.setdefault(field, [])
            matched[field].extend(hits[:6])
            if field == "deliverable":
                reasons.append("需求包含交付物关键词：%s" % "、".join(hits[:4]))
            elif field in ("name", "alias") and not reasons:
                reasons.append("需求与赛事名称关键词相符：%s" % "、".join(hits[:4]))

    # Keep scores comparable and deterministic.  A direct name/alias can be
    # 100+, but is explicitly labelled high confidence below.
    score = round(min(score, 100.0), 2)
    if strong or score >= 72:
        confidence = "high"
    elif score >= 38:
        confidence = "medium"
    else:
        confidence = "low"
    if not reasons:
        reasons.append("未命中名称、别名、类别、流程或交付物关键词")
    return {
        "score": score,
        "confidence": confidence,
        "reasons": list(dict.fromkeys(reasons)),
        "matched_fields": {k: list(dict.fromkeys(v)) for k, v in matched.items()},
    }


def _load_catalog(path: str = CATALOG_PATH) -> List[Dict[str, Any]]:
    with io.open(path, encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list) or not data:
        raise ValueError("赛事目录必须是非空数组：%s" % path)
    for i, item in enumerate(data, 1):
        if not isinstance(item, dict) or not item.get("id") or not item.get("name"):
            raise ValueError("赛事目录第 %d 条缺少 id/name" % i)
    return data


def _load_tracks(path: str = TRACKS_PATH) -> List[Dict[str, Any]]:
    if not os.path.isfile(path):
        return []
    with io.open(path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("entries", []) if isinstance(data, dict) else []


def _attach_tracks(candidates: List[Dict[str, Any]], query: str, entries: Sequence[Dict[str, Any]]) -> None:
    """Attach catalogue-backed track and deliverable hints for handoff."""
    by_comp: Dict[int, List[Dict[str, Any]]] = {}
    for entry in entries:
        try:
            by_comp.setdefault(int(entry.get("competition_id")), []).append(entry)
        except (TypeError, ValueError):
            continue
    for candidate in candidates:
        options = by_comp.get(int(candidate["id"]), [])
        tracks = []
        for item in options:
            track = _text(item.get("track"))
            if not track or track in {x.get("track") for x in tracks}:
                continue
            deliverables = [str(x) for x in (item.get("default_deliverables") or [])]
            tracks.append({
                "track": track,
                "pipeline": _text(item.get("pipeline")) or candidate.get("pipeline", ""),
                "deliverable_count": len(deliverables),
                "deliverables_preview": deliverables[:4],
                "notes": _text(item.get("notes")),
            })
        candidate["track_options"] = tracks
        direct = [x for x in tracks if _contains_phrase(query, x["track"])]
        candidate["recommended_track"] = (direct[0] if direct else (tracks[0] if tracks else None))


def match(query: str, catalog: Sequence[Dict[str, Any]], limit: int = 3,
          track_entries: Sequence[Dict[str, Any]] = ()) -> Dict[str, Any]:
    query = _text(query)
    if not query:
        raise ValueError("需求文本不能为空")
    scored: List[Dict[str, Any]] = []
    for comp in catalog:
        detail = _score(query, comp)
        # Preserve only catalogue facts plus computed explanation fields.
        scored.append({
            "id": comp.get("id"),
            "name": comp.get("name"),
            "level": comp.get("level", ""),
            "category": comp.get("category", ""),
            "pipeline": comp.get("pipeline", ""),
            "official_url": comp.get("official_url", ""),
            **detail,
        })
    scored.sort(key=lambda x: (-float(x["score"]), 0 if x["confidence"] == "high" else 1 if x["confidence"] == "medium" else 2, int(x["id"])))
    candidates = scored[: max(1, min(3, int(limit)))]
    _attach_tracks(candidates, query, track_entries)
    top = candidates[0] if candidates else None
    low = not top or top["confidence"] == "low" or float(top["score"]) < 25
    warnings = []
    if low:
        warnings.append("匹配置信度低：请确认赛事名称、别名、赛道或交付物；结果仅来自现有赛事目录，未新增赛事。")
    elif top["confidence"] == "medium":
        warnings.append("当前为中等置信度：正式产出前请人工确认赛事章程、赛道和交付物。")
    return {
        "schema_version": "1.0",
        "query": query,
        "catalog": os.path.relpath(CATALOG_PATH, ROOT).replace("\\", "/"),
        "track_catalog": os.path.relpath(TRACKS_PATH, ROOT).replace("\\", "/"),
        "candidates": candidates,
        "top_confidence": top["confidence"] if top else "low",
        "warnings": warnings,
    }


def _markdown(result: Dict[str, Any]) -> str:
    lines = ["# Ares 赛事匹配", "", "需求：%s" % result["query"], "", "| 排名 | 赛事 | 等级 | 类别 | Pipeline | 分数 | 置信度 |", "|---:|---|---|---|---|---:|---|"]
    for i, item in enumerate(result["candidates"], 1):
        lines.append("| %d | %s | %s | %s | %s | %.2f | %s |" % (i, item["name"], item["level"], item["category"], item["pipeline"], item["score"], item["confidence"]))
        lines.append("|  | 理由 | %s |  |  |  |  |" % "；".join(item["reasons"]))
    lines.extend(["", "数据目录：`%s`" % result["catalog"]])
    if result["warnings"]:
        lines.extend(["", "**提示**：" + "；".join(result["warnings"])])
    return "\n".join(lines) + "\n"


def main(argv: Sequence[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="从 Ares 现有赛事目录确定性匹配用户需求")
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--request", help="用户需求文本")
    source.add_argument("--file", help="包含用户需求文本的 UTF-8 文件")
    ap.add_argument("--catalog", default=CATALOG_PATH, help=argparse.SUPPRESS)
    ap.add_argument("--limit", type=int, default=3, choices=(1, 2, 3), help="最多返回候选数（默认 3）")
    ap.add_argument("--markdown", help="可选：写入 Markdown 审阅结果路径")
    args = ap.parse_args(argv)
    try:
        if args.file:
            with io.open(args.file, encoding="utf-8") as f:
                query = f.read().strip()
        else:
            query = _text(args.request)
        catalog_path = os.path.abspath(args.catalog)
        track_path = os.path.join(os.path.dirname(catalog_path), "tracks.json")
        result = match(query, _load_catalog(catalog_path), args.limit, _load_tracks(track_path))
        # Keep the catalogue path truthful when a test or caller passes an
        # explicit catalogue file.
        result["catalog"] = os.path.relpath(catalog_path, ROOT).replace("\\", "/")
        result["track_catalog"] = (os.path.relpath(track_path, ROOT).replace("\\", "/")
                                    if os.path.isfile(track_path) else "")
        if args.markdown:
            md_path = os.path.abspath(args.markdown)
            os.makedirs(os.path.dirname(md_path) or ".", exist_ok=True)
            with io.open(md_path, "w", encoding="utf-8") as f:
                f.write(_markdown(result))
            result["markdown_path"] = md_path
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        print("赛事匹配失败：%s" % exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
