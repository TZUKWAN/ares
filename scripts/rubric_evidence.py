"""Fail-closed, field-level provenance for the historical competition archive.

A listed URL, a reachable homepage and the old confidence label are not proof
of a clause. Verified official claims require a pinned local source excerpt,
an exact locator, explicit edition/track/group and a reviewer record.
"""
import hashlib
import ipaddress
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

SCHEMA_VERSION = 1
CATEGORIES = {"official-rule", "official-supplement", "supported-interpretation", "advice", "unverified"}
STATES = {"unverified", "verified", "withdrawn"}
SHA = re.compile(r"^[a-f0-9]{64}$")
ADVICE = {"scoring_points", "common_deductions", "judge_preferences", "past_winning_patterns", "notes"}


def sha(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def field_values(rubric):
    def walk(value, path, advice=False):
        if isinstance(value, str):
            yield path, value, advice
        elif isinstance(value, list):
            for index, child in enumerate(value):
                yield from walk(child, path + "/" + str(index), advice)
        elif isinstance(value, dict):
            for key, child in value.items():
                if key not in {"provenance", "sources", "confidence", "last_updated"}:
                    yield from walk(child, path + "/" + key, advice or key in ADVICE)
    return list(walk(rubric, ""))


def source_locator(url):
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
            return "invalid"
        hostname = parsed.hostname.lower()
        if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
            return "invalid"
        try:
            if not ipaddress.ip_address(hostname).is_global:
                return "invalid"
        except ValueError:
            pass
        if any(token in hostname for token in ("google.", "bing.", "so.com", "baidu.com")):
            return "search"
        if hostname == "web.archive.org":
            return "archive"
        return "homepage" if parsed.path in {"", "/"} else "document"
    except (ValueError, TypeError):
        return "invalid"


def initial_provenance(rubric, assessed_at):
    return {
        "schemaVersion": SCHEMA_VERSION,
        "assessedAt": assessed_at,
        "method": "field-inventory-and-source-status-audit; no original-clause verification",
        "legacyConfidence": rubric["confidence"],
        "scope": {"competitionId": rubric["competition_id"], "edition": None, "tracks": [], "groups": []},
        "ruleVersion": rubric["last_updated"],
        "sourceChecks": [
            {"id": "source-" + str(index + 1), "urlSha256": sha(source["url"]),
             "locatorKind": source_locator(source["url"]), "state": "unverified"}
            for index, source in enumerate(rubric["sources"])
        ],
        "fields": {
            path: {"sha256": sha(value), "category": "advice" if advice else "unverified",
                   "state": "unverified", "sourceIds": []}
            for path, value, advice in field_values(rubric)
        },
        "note": "来源候选尚未逐条对应原文；历届说明、推断权重和建议不能作为已确认的当届官方标准。空届次、赛道和组别表示未确定适用范围，不表示通用。",
    }


def validate_provenance(rubric, root):
    errors = []
    provenance = rubric.get("provenance")
    if not isinstance(provenance, dict) or provenance.get("schemaVersion") != SCHEMA_VERSION:
        return ["缺少字段级来源状态 provenance schemaVersion=1"]
    scope = provenance.get("scope", {})
    if provenance.get("ruleVersion") != rubric.get("last_updated"):
        errors.append("档案版本已变化，须重新核验来源状态")
    if scope.get("competitionId") != rubric.get("competition_id"):
        errors.append("来源范围 competitionId 与档案不一致")
    if not isinstance(scope.get("tracks"), list) or not isinstance(scope.get("groups"), list):
        errors.append("来源适用赛道/组别必须显式登记，空列表表示未知")
    checks = provenance.get("sourceChecks", [])
    sources = rubric.get("sources", [])
    if not isinstance(checks, list) or len(checks) != len(sources):
        errors.append("来源检查清单未覆盖全部候选 URL")
        checks = []
    source_ids = set()
    for index, check in enumerate(checks):
        expected_id = "source-" + str(index + 1)
        source_ids.add(expected_id)
        if check.get("id") != expected_id or check.get("urlSha256") != sha(sources[index].get("url", "")):
            errors.append("来源 URL 已变化，须重新核验：" + expected_id)
        if check.get("locatorKind") != source_locator(sources[index].get("url", "")) or check.get("state") not in STATES:
            errors.append("来源定位或状态无效：" + expected_id)
    values = {path: value for path, value, _ in field_values(rubric)}
    fields = provenance.get("fields", {})
    if not isinstance(fields, dict) or set(fields) != set(values):
        errors.append("字段来源清单与实际内容不一致")
        fields = fields if isinstance(fields, dict) else {}
    for path, field in fields.items():
        if not isinstance(field, dict):
            errors.append("字段来源结构无效：" + path)
            continue
        if field.get("category") not in CATEGORIES or field.get("state") not in STATES:
            errors.append("字段来源类型/状态无效：" + path)
        if path not in values or field.get("sha256") != sha(values.get(path, "")):
            errors.append("字段内容已变化，核验版本失效：" + path)
        refs = field.get("sourceIds")
        if not isinstance(refs, list) or any(ref not in source_ids for ref in refs):
            errors.append("字段引用了不存在的来源：" + path)
        if field.get("state") == "verified":
            actual_scope = field.get("scope", scope)
            if not actual_scope.get("edition") or not actual_scope.get("tracks") or not actual_scope.get("groups"):
                errors.append("已核验条款缺少具体届次/赛道/组别：" + path)
            evidence = field.get("evidence", {})
            try:
                if not refs or evidence.get("sourceId") not in refs or not evidence.get("locator") or not evidence.get("reviewer"):
                    raise ValueError("缺少具体来源、条款定位或核验人")
                source_check = next(row for row in checks if row.get("id") == evidence["sourceId"])
                if source_check.get("state") != "verified" or source_check.get("locatorKind") != "document":
                    raise ValueError("首页、搜索入口和未核验来源不能证明具体条款")
                relative = evidence.get("snapshotPath", "")
                directory = (Path(root) / "data" / "rule-sources").resolve()
                target = (Path(root) / relative).resolve()
                if not target.is_relative_to(directory) or target == directory or not SHA.fullmatch(evidence.get("snapshotSha256", "")):
                    raise ValueError("原文快照路径或 SHA256 无效")
                candidate = Path(root) / relative
                for parent in [candidate, *candidate.parents]:
                    if parent == Path(root):
                        break
                    if parent.is_symlink() or getattr(parent, "is_junction", lambda: False)():
                        raise ValueError("原文快照不能穿过链接")
                raw = target.read_bytes()
                if hashlib.sha256(raw).hexdigest() != evidence["snapshotSha256"]:
                    raise ValueError("原文快照变化")
                if not evidence.get("quote") or evidence["quote"] not in raw.decode("utf-8"):
                    raise ValueError("快照中不存在核验摘录")
                if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", evidence.get("verifiedAt", "")):
                    raise ValueError("缺少核验日期")
            except (OSError, ValueError, StopIteration, UnicodeError, TypeError, KeyError) as error:
                errors.append("条款核验证据无效：%s（%s）" % (path, error))
        weight = field.get("officialWeight")
        if weight is not None and (field.get("state") != "verified" or field.get("category") != "official-rule"
                                   or not path.endswith("/weight") or isinstance(weight, bool)
                                   or not isinstance(weight, (int, float)) or not 0 <= weight <= 100):
            errors.append("未核验的官方权重或权重范围无效：" + path)
    if any(field.get("state") != "verified" for field in fields.values() if field.get("category") != "advice") and rubric.get("confidence") == "high":
        errors.append("含未核验条款的档案不能标为高置信度官方档案")
    return errors


def evidence_summary(rubric, scope=None):
    provenance = rubric.get("provenance", {})
    fields = provenance.get("fields", {})
    return {
        "schemaVersion": provenance.get("schemaVersion"),
        "competitionId": rubric.get("competition_id"),
        "status": "invalid" if not fields else "unverified" if any(x.get("state") != "verified" and x.get("category") != "advice" for x in fields.values()) else "verified",
        "fieldCount": len(fields),
        "verifiedFields": sum(x.get("state") == "verified" for x in fields.values()),
        "adviceFields": sum(x.get("category") == "advice" for x in fields.values()),
        "unverifiedFields": sum(x.get("state") != "verified" and x.get("category") != "advice" for x in fields.values()),
        "sourceCount": len(provenance.get("sourceChecks", [])),
        "scope": provenance.get("scope"),
        "note": provenance.get("note"),
    }


def field_status(rubric, path, requested):
    field = rubric.get("provenance", {}).get("fields", {}).get(path, {})
    values = {key: value for key, value, _ in field_values(rubric)}
    if path not in values or field.get("sha256") != sha(values[path]):
        return "stale"
    if field.get("state") != "verified":
        return field.get("state", "unverified")
    scope = field.get("scope", rubric.get("provenance", {}).get("scope", {}))
    if (scope.get("competitionId") != requested.get("id") or not scope.get("edition")
            or scope.get("edition") != requested.get("edition")
            or requested.get("track") not in scope.get("tracks", [])
            or not requested.get("group") or requested.get("group") not in scope.get("groups", [])):
        return "out-of-scope"
    return "verified"
