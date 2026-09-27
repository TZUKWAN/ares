# -*- coding: utf-8 -*-
"""
consistency_check.py — Ares 跨文件关键数字一致性扫描（ares-judge 第一道质检，T3.7）

用法：
    python consistency_check.py <产出目录或文件...> --profile <project.json>

扫描对象：.docx（含表格）/ .pptx（含表格）/ .xlsx / .md / .html / .txt

核对逻辑：从 project.json 提取关键数字（团队人数、专利数、试点数、获奖数、性能指标、
起始营收、市场规模三值），在产出物文本中按句检索：
  每类关键数字绑定专属单位（人/项/万/亿/%/个家件），句中只与同单位数字比对，
  避免同句其他论断的数字交叉误报。
  - 同单位数字与档案不一致 → 不一致项（错误）
  - 关键数字在全部产出物中从未出现 → 警告
列表型成果（专利/试点/获奖）口径：条目文本含 "N个/N项" 显式计数取 N，否则取列表长度。

退出码：0 零矛盾；1 存在不一致；2 参数错误。
"""
import io
import json
import os
import re
import sys

SENT_SPLIT = re.compile(r"[。；;！!？?\n\r]+")
NUM_RE = re.compile(r"(\d+(?:\.\d+)?)\s*(万亿元|万元|亿|万|个百分点|%|元|项|个|人|家|件|岁)?")
UNIT_ALIASES = {"万元": "万", "万亿元": "亿", "亿元": "亿", "％": "%"}


def canonical_claims(profile):
    """返回 [(claim_id, value, unit, note, keywords_or_None, required)]"""
    claims = []
    team = profile.get("team") or []
    claims.append(("team_size", float(len(team)), "人", "team 列表长度", ("团队", "成员", "队伍"), True))
    ach = profile.get("achievements") or {}
    for key, kws, unit in (("patents", ("专利",), "项"), ("pilots", ("试点", "签约", "社区"), None),
                           ("awards", ("获奖", "奖项", "金奖", "冠军"), "项")):
        items = ach.get(key) or []
        explicit = []
        for it in items:
            m = re.search(r"(\d+)\s*[个项家件]", str(it))
            if m:
                explicit.append(float(m.group(1)))
        value = max(explicit) if explicit else float(len(items))
        note = "条目显式计数" if explicit else "%s 列表长度" % key
        claims.append((key, value, unit, note, kws, False))
    fin = profile.get("financials") or {}
    try:
        claims.append(("revenue_start_wan", float(fin.get("revenue_start_wan")), "万",
                       "financials.revenue_start_wan", ("营收", "营业收入", "销售收入"), True))
    except (TypeError, ValueError):
        pass
    market = profile.get("market") or {}
    for key, kws in (("tam", ("总市场", "TAM", "市场规模")), ("sam", ("可服务市场", "SAM")), ("som", ("可获得市场", "SOM"))):
        m = re.search(r"([\d.,]+)\s*(万亿|亿元|亿)", str(market.get(key, "")))
        if m:
            val = float(m.group(1).replace(",", ""))
            if m.group(2) == "万亿":
                val *= 10000.0
            claims.append((key, val, "亿", "market.%s" % key, kws, False))
    for met in (profile.get("solution", {}).get("performance_metrics", []) or []):
        m = re.search(r"(\d+(?:\.\d+)?)\s*(%|万元|万|元)?", str(met.get("value", "")))
        if m and met.get("metric"):
            unit = UNIT_ALIASES.get(m.group(2), m.group(2)) or ""
            claims.append(("metric:%s" % met["metric"], float(m.group(1)), unit,
                           "性能指标 %s" % met["metric"], None, False))
    return claims


def extract_texts(paths):
    for p in paths:
        ext = os.path.splitext(p)[1].lower()
        try:
            if ext == ".docx":
                from docx import Document
                doc = Document(p)
                parts = [par.text for par in doc.paragraphs]
                for tbl in doc.tables:
                    for row in tbl.rows:
                        for cell in row.cells:
                            parts.append(cell.text)
                yield p, "\n".join(parts)
            elif ext == ".pptx":
                from pptx import Presentation
                prs = Presentation(p)
                buf = []
                for slide in prs.slides:
                    for shape in slide.shapes:
                        if shape.has_text_frame:
                            buf.append(shape.text_frame.text)
                        if getattr(shape, "has_table", False) and shape.has_table:
                            for row in shape.table.rows:
                                for cell in row.cells:
                                    buf.append(cell.text)
                yield p, "\n".join(buf)
            elif ext == ".xlsx":
                import openpyxl
                wb = openpyxl.load_workbook(p, data_only=True, read_only=True)
                buf = []
                for ws in wb.worksheets:
                    for row in ws.iter_rows(values_only=True):
                        buf.extend(str(c) for c in row if c is not None)
                wb.close()
                yield p, "\n".join(buf)
            else:
                raw = io.open(p, encoding="utf-8", errors="replace").read()
                if ext == ".html":
                    raw = re.sub(r"<[^>]+>", " ", raw)
                yield p, raw
        except Exception as e:
            sys.stderr.write("[跳过] %s 无法解析：%s\n" % (p, e))


def collect(paths):
    out = []
    for p in paths:
        if os.path.isdir(p):
            for base, _dirs, files in os.walk(p):
                for f in files:
                    if os.path.splitext(f)[1].lower() in (".docx", ".pptx", ".xlsx", ".md", ".html", ".txt"):
                        out.append(os.path.join(base, f))
        elif os.path.exists(p):
            out.append(p)
    return out


def candidates(nums, unit):
    """按档案单位筛选句内可比数字，避免同句其他论断数字的交叉误报。
    nums: [(value, unit, followed_by_ascii)]"""
    if unit:
        # 任意显式单位（人/项/万/亿/%/元/个百分点…）精确匹配
        return [v for (v, u, _s) in nums if u == unit]
    # 无单位约束（试点类）：优先 个/家/件
    picked = [v for (v, u, _s) in nums if u in ("个", "家", "件")]
    if picked:
        return picked
    # 裸数字兜底（仅当句内唯一）：排除年份与后跟ASCII字母的型号数（60GHz/5G/3.2s）
    bare = [v for (v, u, suf) in nums if u is None and not suf and not (1900 <= v <= 2100)]
    if len(nums) == 1 and bare:
        return bare
    return []


def main(argv):
    if "--profile" not in argv:
        print(__doc__)
        return 2
    idx = argv.index("--profile")
    profile_path = argv[idx + 1]
    args = [a for i, a in enumerate(argv) if i not in (idx, idx + 1)]
    if not args:
        print("未指定产出目录或文件")
        return 2
    profile = json.load(io.open(profile_path, encoding="utf-8"))
    claims = canonical_claims(profile)
    files = collect(args)
    if not files:
        print("未找到可扫描文件")
        return 2
    docs = list(extract_texts(files))
    print("扫描 %d 个文件，核对 %d 项关键数字。" % (len(docs), len(claims)))
    mismatches, warnings = [], []
    for name, value, unit, note, keywords, required in claims:
        if value == 0:
            warnings.append("%s（%s）档案值为 0，跳过比对（无相关成果是合法状态）" % (name, note))
            continue
        is_metric = name.startswith("metric:")
        metric_name = name.split(":", 1)[1] if is_metric else None
        found_any = False
        for path, text in docs:
            for sent in SENT_SPLIT.split(text):
                if len(sent.strip()) < 2:
                    continue
                hit = (is_metric and metric_name in sent) or \
                      (not is_metric and any(k in sent for k in keywords))
                if not hit:
                    continue
                nums = []
                for m in NUM_RE.finditer(sent):
                    u = UNIT_ALIASES.get(m.group(2), m.group(2))
                    nxt = sent[m.end():m.end() + 1]
                    try:
                        nums.append((float(m.group(1)), u, bool(nxt and re.match(r"[A-Za-z]", nxt))))
                    except ValueError:
                        continue
                for num in candidates(nums, unit):
                    tol = max(0.05, abs(value) * 0.001)
                    if abs(num - value) > tol:
                        try:
                            loc = os.path.relpath(path)
                        except ValueError:
                            loc = path
                        mismatches.append("%s：档案值 %g（%s），产出物写 %g —— %s ｜ %s"
                                          % (name, value, note, num, loc, sent.strip()[:60]))
                    else:
                        found_any = True
        if not found_any and not mismatches:
            msg = "%s（档案值 %g，%s）在产出物中未出现" % (name, value, note)
            (mismatches if required else warnings).append(msg)
    if mismatches:
        print("\n不一致项 %d 处：" % len(mismatches))
        for m in mismatches:
            print("  ✗ " + m)
    else:
        print("\n一致性：零矛盾。")
    for w in warnings:
        print("  △ 警告：%s" % w)
    return 1 if mismatches else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
