# -*- coding: utf-8 -*-
"""
count_words.py — 章节字数审计（ares-entrepreneurship bp-outline.md 字数区间的度量工具）

用法：
    python scripts/count_words.py <文档.docx或.md>

按一级/二级标题分节统计正文字符数（不含标题本身与空白），输出每节字数，便于对照
bp-outline.md 的字数区间自查。退出码恒为 0（审计工具，不做判定）。
"""
import io
import os
import re
import sys


def sections_from_docx(path):
    from docx import Document
    doc = Document(path)
    cur = "（封面/前言）"
    out = []
    for p in doc.paragraphs:
        style = (p.style.name if p.style is not None else "") or ""
        text = p.text.strip()
        if not text:
            continue
        if "heading" in style.lower() or "标题" in style:
            cur = text
            out.append([cur, 0])
        else:
            if not out:
                out.append([cur, 0])
            out[-1][1] += len(re.sub(r"\s", "", text))
    return out


def sections_from_md(path):
    out = []
    cur = "（前言）"
    for line in io.open(path, encoding="utf-8", errors="replace"):
        s = line.rstrip("\n")
        if re.match(r"^#{1,2}\s", s):
            cur = s.lstrip("#").strip()
            out.append([cur, 0])
        else:
            t = re.sub(r"\s|[#*`>\-]", "", s)
            if not out:
                out.append([cur, 0])
            out[-1][1] += len(t)
    return out


def main(argv):
    if not argv or not os.path.exists(argv[0]):
        print(__doc__)
        return 2
    path = argv[0]
    if path.lower().endswith(".docx"):
        rows = sections_from_docx(path)
    else:
        rows = sections_from_md(path)
    total = 0
    for title, n in rows:
        print("%6d  %s" % (n, title[:50]))
        total += n
    print("合计正文字符：%d" % total)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
