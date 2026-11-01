# -*- coding: utf-8 -*-
"""Validate a project's structured evidence ledger.

Usage:
    python validate_evidence.py <project.json>
    python validate_evidence.py <project.json> --check-url
    python validate_evidence.py <project.json> --strict

The default mode is offline and validates the ledger structure and URL syntax.
``--check-url`` additionally performs bounded HTTP checks for each source URL.
``--strict`` is the formal-submission gate: every real/estimated claim must
carry a quote, retrieval date, SHA-256 content hash, rubric reference and
deliverable reference. This is intentionally opt-in so legacy drafts can
still be inspected and migrated instead of being silently rejected.
"""
import io
import json
import os
import sys
import urllib.error
import urllib.request
import re
import hashlib
from datetime import date

from validate_profile import validate_evidence


_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}(?:[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:Z|[+-][0-9]{2}:[0-9]{2})?)?)?$")


def _strict_provenance(profile, base_dir):
    """Return formal-mode errors without weakening the legacy validator."""
    errors = []
    evidence = profile.get("evidence") or {}
    claims = evidence.get("claims") or []
    for index, claim in enumerate(claims, 1):
        if not isinstance(claim, dict) or claim.get("status") not in ("real", "estimated"):
            continue
        prefix = "evidence.claims[%d]" % index
        quote = str(claim.get("supporting_quote", "")).strip()
        if len(quote) < 10:
            errors.append("%s.supporting_quote 必须保留至少 10 个字符的原文依据" % prefix)
        retrieved = str(claim.get("retrieved_at", "")).strip()
        if not retrieved or not _DATE_RE.match(retrieved):
            errors.append("%s.retrieved_at 必须为 YYYY-MM-DD 或 ISO 时间" % prefix)
        try:
            date.fromisoformat(retrieved[:10])
        except ValueError:
            errors.append("%s.retrieved_at 日期非法" % prefix)
        digest = str(claim.get("content_hash", "")).strip()
        if not _SHA256_RE.match(digest):
            errors.append("%s.content_hash 必须为 64 位 SHA-256" % prefix)
        for field in ("rubric_refs", "output_refs"):
            refs = claim.get(field)
            if not isinstance(refs, list) or not any(str(x).strip() for x in refs):
                errors.append("%s.%s 不能为空（正式模式必须绑定评分点和产物）" % (prefix, field))
        evidence_files = claim.get("evidence_files") or []
        if not evidence_files:
            errors.append("%s.evidence_files 不能为空（正式模式必须保留原文/证据快照）" % prefix)
        file_hashes = set()
        for raw in evidence_files:
            path = str(raw).strip()
            if not path:
                errors.append("%s.evidence_files 不能包含空路径" % prefix)
                continue
            resolved = path if os.path.isabs(path) else os.path.join(base_dir, path)
            if not os.path.exists(os.path.normpath(resolved)):
                errors.append("%s.evidence_files 不存在：%s" % (prefix, path))
            elif os.path.isfile(os.path.normpath(resolved)):
                with open(os.path.normpath(resolved), "rb") as evidence_stream:
                    file_hashes.add(hashlib.sha256(evidence_stream.read()).hexdigest())
        if file_hashes and digest not in file_hashes:
            errors.append("%s.content_hash 与 evidence_files 中任何文件的 SHA-256 均不匹配" % prefix)
    grouped = {}
    for index, claim in enumerate(claims, 1):
        if not isinstance(claim, dict) or claim.get("status") not in ("real", "estimated"):
            continue
        if "normalized_value" not in claim:
            continue
        field = str(claim.get("field", "")).strip()
        unit = str(claim.get("value_unit", "")).strip()
        value = json.dumps(claim.get("normalized_value"), ensure_ascii=False, sort_keys=True)
        grouped.setdefault((field, unit), []).append((value, claim.get("id", index)))
    for (field, unit), values in grouped.items():
        distinct = {value for value, _claim_id in values}
        if len(distinct) > 1:
            details = "、".join("%s=%s" % (claim_id, value) for value, claim_id in values)
            errors.append("同一字段 %s（单位=%s）存在互相矛盾的 normalized_value：%s" % (field, unit or "未标单位", details))
    return errors


def _check_urls(profile):
    problems = []
    sources = ((profile.get("evidence") or {}).get("sources") or [])
    for src in sources:
        if str(src.get("kind", "web")) == "artifact":
            continue
        url = str(src.get("url", ""))
        if not url:
            continue
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": "ARES-evidence-check/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=8) as response:
                if int(getattr(response, "status", 200)) >= 400:
                    problems.append("%s HTTP %s" % (src.get("id", url), response.status))
        except urllib.error.HTTPError as exc:
            # Some public sites reject HEAD; retry a bounded GET before failing.
            try:
                get_req = urllib.request.Request(url, method="GET",
                                                 headers={"User-Agent": "ARES-evidence-check/1.0"})
                with urllib.request.urlopen(get_req, timeout=8) as response:
                    if int(getattr(response, "status", 200)) >= 400:
                        problems.append("%s HTTP %s" % (src.get("id", url), response.status))
            except Exception as get_exc:
                problems.append("%s URL 不可访问：%s / %s" % (src.get("id", url), exc, get_exc))
        except Exception as exc:
            problems.append("%s URL 不可访问：%s" % (src.get("id", url), exc))
    return problems


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 2
    path = argv[1]
    try:
        profile = json.load(io.open(path, encoding="utf-8"))
    except (OSError, ValueError) as exc:
        print("档案无法读取：%s" % exc)
        return 2
    base_dir = os.path.dirname(os.path.abspath(path))
    errors, warnings = validate_evidence(profile, base_dir)
    if "--strict" in argv and not errors:
        errors.extend(_strict_provenance(profile, base_dir))
    if "--check-url" in argv and not errors:
        errors.extend(_check_urls(profile))
    if errors:
        print("证据校验失败（%d 项）：" % len(errors))
        for item in errors:
            print("  - " + item)
    else:
        print("证据校验通过。")
    for item in warnings:
        print("[警告] " + item)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
