# -*- coding: utf-8 -*-
"""
check_style.py — Ares 写作纪律机扫初筛（配合 skills/ares-writing-style/SKILL.md 第五节自检清单）

用法：
    python check_style.py <文件.docx|md|txt> [--strict] [--allow-questions]

    --strict           额外拦截 AI 味标点（正文破折号/引号/冒号密度超限）
    --allow-questions  跳过疑问句式检查（答辩 QA 预案类文档使用）

退出码：0 通过，1 存在违禁项，2 文件无法解析。
机扫只覆盖词表层违规；数据三要素、首句等长规则等语义层由 ares-judge 按 SKILL.md 人工判定。
"""
import io
import os
import re
import sys

BANNED_CONNECTIVES = ["首先", "其次", "再次", "最后", "综上所述", "值得注意的是", "总而言之",
                      "第一方面", "第二方面", "第三方面"]
BANNED_BOAST = ["重构", "重建", "填补", "颠覆性", "革命性", "全球首创", "业界第一", "遥遥领先",
                "国际首创"]
BANNED_EXAMPLE = ["例如", "比如", "举例来说", "譬如"]
BANNED_QUESTIONS = ["如何", "何以", "为何", "为什么", "怎样才能", "怎么才能"]
GENERIC = ["年轻有活力", "经验丰富", "技术过硬", "国内领先", "国际先进", "国际领先", "行业领先水平",
           "有很大潜力", "前景广阔", "意义重大", "影响深远"]
HEADING_RE = re.compile(r"^\s*(#|\d+(\.\d+)*\s|[一二三四五六七八九十]+\s*、|[（(][一二三四五六七八九十一二三]+[)）]|附录)")
DASH_RE = re.compile(r"——|——|—|―")
QUOTE_RE = re.compile(r"[“”\"«»『』]")


def read_paragraphs(path):
    """返回 [(段落序号, 是否章节标题, 文本)]"""
    ext = os.path.splitext(path)[1].lower()
    paras = []
    if ext == ".docx":
        from docx import Document
        doc = Document(path)
        idx = 0
        for p in doc.paragraphs:
            idx += 1
            style = (p.style.name if p.style is not None else "") or ""
            is_heading = "heading" in style.lower() or "标题" in style
            paras.append((idx, is_heading, p.text))
    else:
        with io.open(path, encoding="utf-8", errors="replace") as f:
            for idx, line in enumerate(f.read().splitlines(), 1):
                paras.append((idx, bool(HEADING_RE.match(line)), line))
    return paras


def scan(path, strict=False, allow_questions=False):
    violations = []
    try:
        paras = read_paragraphs(path)
    except Exception as e:
        return violations, "文件无法解析：%s" % e

    body_chars = 0
    body_dashes = 0
    body_quotes = 0
    body_colons = 0
    for idx, is_heading, text in paras:
        t = text.strip()
        if not t:
            continue
        for w in BANNED_CONNECTIVES:
            if w in t:
                violations.append("第%d段 命中机械连接词「%s」：%s" % (idx, w, t[:50]))
        for w in BANNED_BOAST:
            if w in t:
                violations.append("第%d段 命中夸张吹嘘「%s」：%s" % (idx, w, t[:50]))
        for w in BANNED_EXAMPLE:
            if w in t:
                violations.append("第%d段 命中举例式写法「%s」：%s" % (idx, w, t[:50]))
        for w in GENERIC:
            if w in t:
                violations.append("第%d段 命中泛泛表述「%s」：%s" % (idx, w, t[:50]))
        if not is_heading:
            # 短行（封面主/副标题等）不参与标点密度统计，避免误伤获奖标题惯用的破折号
            short_line = len(t) <= 20
            body_chars += len(t)
            if not short_line:
                body_dashes += len(DASH_RE.findall(t))
                body_quotes += len(QUOTE_RE.findall(t))
                body_colons += t.count("：") + t.count(":")
            if not allow_questions:
                for w in BANNED_QUESTIONS:
                    if w in t:
                        violations.append("第%d段 正文出现疑问字样「%s」：%s" % (idx, w, t[:50]))
    if strict and body_chars > 0:
        if body_dashes > 0:
            violations.append("正文破折号 %d 个（纪律要求 0 个）" % body_dashes)
        if body_quotes > 12:
            violations.append("正文引号 %d 个，超密度阈值 12（仅法定名称与直接引语可用）" % body_quotes)
        if body_colons > max(6, body_chars // 400):
            violations.append("正文冒号 %d 个，超密度（仅表格/图注/标题可用）" % body_colons)
    return violations, None


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    strict = "--strict" in argv
    allow_q = "--allow-questions" in argv
    if not args:
        print(__doc__)
        return 2
    violations, err = scan(args[0], strict, allow_q)
    if err:
        print(err)
        return 2
    if violations:
        print("发现 %d 处违禁项：" % len(violations))
        for v in violations:
            print("  - " + v)
        return 1
    print("写作纪律机扫通过（词表层 0 违禁）。")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
