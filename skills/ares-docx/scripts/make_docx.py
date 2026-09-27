# -*- coding: utf-8 -*-
"""
make_docx.py — ares-docx 统一版式模板函数库 + 样例生成（T3.3 DoD 样例脚本）

直接运行生成 ares-docx 的格式基准样张：
    python skills/ares-docx/scripts/make_docx.py [输出路径.docx]

生产线脚本可 import 本模块复用 new_document/add_cover/add_toc/add_heading/add_body/
add_figure_placeholder/add_table_numbered/add_reference_gbt7714/finalize。

版式规范（与 skills/ares-docx/SKILL.md 第二节一致）：
正文宋体小四 1.5 倍行距首行缩进 2 字符；一级黑体三号；二级黑体四号；三级黑体小四；
页眉项目名小五宋体；页脚第X页共Y页；目录为 Word 自动目录域。
"""
import os
import sys

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.section import WD_SECTION
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor


def _set_font(run, cn_font, size_pt, bold=False, en_font="Times New Roman"):
    run.font.name = en_font
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.color.rgb = RGBColor(0, 0, 0)
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.append(rfonts)
    rfonts.set(qn("w:eastAsia"), cn_font)


def _add_field(paragraph, instr):
    """插入 Word 域代码（目录/页码等），打开文档后 F9 更新。"""
    run = paragraph.add_run()
    for tag, attrs, text in (
        ("w:fldChar", {"w:fldCharType": "begin"}, None),
        ("w:instrText", {"xml:space": "preserve"}, instr),
        ("w:fldChar", {"w:fldCharType": "separate"}, None),
        ("w:fldChar", {"w:fldCharType": "end"}, None),
    ):
        el = OxmlElement(tag)
        for k, v in attrs.items():
            el.set(qn(k), v)
        if text:
            el.text = text
        run._element.append(el)
    return run


def new_document(project_name):
    doc = Document()
    normal = doc.styles["Normal"]
    normal.font.name = "Times New Roman"
    normal.font.size = Pt(12)
    normal._element.rPr.rFonts.set(qn("w:eastAsia"), "宋体")
    pf = normal.paragraph_format
    pf.line_spacing_rule = WD_LINE_SPACING.ONE_POINT_FIVE
    pf.first_line_indent = Pt(24)
    pf.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY

    for level, (size, name) in {1: (16, "黑体"), 2: (14, "黑体"), 3: (12, "黑体")}.items():
        st = doc.styles["Heading %d" % level]
        st.font.name = "Times New Roman"
        st.font.size = Pt(size)
        st.font.bold = (level <= 2)
        st.font.color.rgb = RGBColor(0, 0, 0)
        st._element.rPr.rFonts.set(qn("w:eastAsia"), name)
        st.paragraph_format.first_line_indent = None
        st.paragraph_format.alignment = WD_ALIGN_PARAGRAPH.LEFT
        st.paragraph_format.space_before = Pt(13 if level == 1 else 6)
        st.paragraph_format.space_after = Pt(13 if level == 1 else 6)

    section = doc.sections[0]
    section.different_first_page_header_footer = True
    header = section.header.paragraphs[0]
    header.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(header.add_run(project_name), "宋体", 9)
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(footer.add_run("第 "), "宋体", 9)
    _add_field(footer, "PAGE")
    _set_font(footer.add_run(" 页 共 "), "宋体", 9)
    _add_field(footer, "NUMPAGES")
    _set_font(footer.add_run(" 页"), "宋体", 9)
    return doc


def add_cover(doc, title, subtitle, meta_lines):
    for _ in range(5):
        doc.add_paragraph()
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(p.add_run(title), "黑体", 26, bold=True)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(p.add_run(subtitle), "宋体", 16)
    for _ in range(4):
        doc.add_paragraph()
    for line in meta_lines:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run(line), "宋体", 14)
    doc.add_page_break()


def add_toc(doc, note="（目录为自动域：全选后按 F9 更新）"):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(p.add_run("目  录"), "黑体", 16, bold=True)
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = None
    _add_field(p, r'TOC \o "1-3" \h \z \u')
    p = doc.add_paragraph()
    _set_font(p.add_run(note), "宋体", 9)
    doc.add_page_break()


def add_heading(doc, text, level):
    h = doc.add_heading("", level=level)
    size = {1: 16, 2: 14, 3: 12}[level]
    _set_font(h.add_run(text), "黑体", size, bold=(level <= 2))
    return h


def add_body(doc, text, indent=True):
    p = doc.add_paragraph()
    if not indent:
        p.paragraph_format.first_line_indent = None
    _set_font(p.add_run(text), "宋体", 12)
    return p


def add_figure_placeholder(doc, chapter_no, fig_no, caption, hint="（此处插入图片，300dpi 起）"):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(p.add_run(hint), "宋体", 10.5)
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = None
    _set_font(p.add_run("图%d-%d  %s" % (chapter_no, fig_no, caption)), "宋体", 10.5)


def add_table_numbered(doc, chapter_no, tab_no, caption, header_row, rows):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = None
    _set_font(p.add_run("表%d-%d  %s" % (chapter_no, tab_no, caption)), "宋体", 10.5)
    table = doc.add_table(rows=1 + len(rows), cols=len(header_row))
    table.style = "Table Grid"
    for j, cell_text in enumerate(header_row):
        cell = table.cell(0, j)
        cell.paragraphs[0].paragraph_format.first_line_indent = None
        _set_font(cell.paragraphs[0].add_run(cell_text), "宋体", 10.5, bold=True)
    for i, row in enumerate(rows, 1):
        for j, cell_text in enumerate(row):
            cell = table.cell(i, j)
            cell.paragraphs[0].paragraph_format.first_line_indent = None
            _set_font(cell.paragraphs[0].add_run(str(cell_text)), "宋体", 10.5)
    return table


def add_formula(doc, chapter_no, eq_no, formula, note=""):
    p = doc.add_paragraph()
    p.paragraph_format.first_line_indent = None
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    _set_font(p.add_run(formula + "        (%d-%d)" % (chapter_no, eq_no)), "宋体", 12)
    if note:
        p2 = doc.add_paragraph()
        _set_font(p2.add_run(note), "宋体", 12)


def add_reference_gbt7714(doc, refs):
    """refs: GB/T 7714 顺序编码制条目列表，按引用顺序。"""
    add_heading(doc, "参考文献", 1)
    for i, ref in enumerate(refs, 1):
        p = doc.add_paragraph()
        pf = p.paragraph_format
        pf.first_line_indent = None
        pf.left_indent = Pt(21)
        pf.first_line_indent = Pt(-21)
        _set_font(p.add_run("[%d] %s" % (i, ref)), "宋体", 10.5)


def finalize(doc):
    return doc


def build_sample(out_path):
    doc = new_document("毫米波雷达跌倒监测守护系统")
    add_cover(doc, "毫米波雷达跌倒监测守护系统", "商业计划书",
              ["赛事：中国国际大学生创新大赛", "院校：示例大学", "团队：守护者团队", "2026 年 9 月"])
    add_toc(doc)
    add_heading(doc, "一、摘要", 1)
    add_heading(doc, "1.1 市场背景", 2)
    add_body(doc, "养老健康市场过去三年保持 18% 的年均增速（艾媒咨询，2025）。全国 60 岁以上人口达 3.1 亿，"
                  "其中独居与空巢老人约 1.18 亿，跌倒是该人群意外伤害的首要原因，现有点位式紧急呼叫设备依赖"
                  "老人主动触发，失能场景下形同虚设。")
    add_body(doc, "毫米波雷达模组成本同期下降 62%，让非接触式全天候监测进入家用价格区间，本系统在该窗口期"
                  "以 599 元的单套成本提供 96.5% 的跌倒识别准确率。")
    add_heading(doc, "1.2 项目介绍", 2)
    add_body(doc, "本系统基于 60GHz 毫米波雷达与边缘 AI 算法，实现跌倒自动识别、呼吸心率非接触监测与秒级"
                  "多渠道告警，已在 3 个社区完成试点，累计守护 217 位老人。")
    add_heading(doc, "二、核心技术", 1)
    add_body(doc, "系统采用点云特征与时序注意力相结合的两级识别架构，在自建 2000 段真实场景数据集上训练。")
    add_formula(doc, 2, 1, "Acc = (TP + TN) / (TP + TN + FP + FN) = 96.5%",
                note="式中 TP 为真阳性样本数，其余同惯例，数据集划分与基线对比见附录。")
    add_figure_placeholder(doc, 2, 1, "系统总体架构")
    add_table_numbered(doc, 2, 1, "与对标方案性能对比",
                       ["指标", "本系统", "视觉方案", "穿戴方案"],
                       [["识别准确率", "96.5%", "91.2%", "88.7%"],
                        ["单套成本", "599元", "899元", "1299元"],
                        ["隐私性", "无摄像头", "存在泄露风险", "无"]])
    add_reference_gbt7714(doc, [
        "艾媒咨询. 2025年中国养老产业发展研究报告[R]. 广州: 艾媒咨询, 2025.",
        "国家统计局. 2025年国民经济和社会发展统计公报[R]. 北京: 国家统计局, 2026.",
        "ZHANG W, LI X. Fall detection using mmWave radar and temporal attention[J]. IEEE Sensors Journal, 2024, 24(8): 11203-11215.",
    ])
    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    doc.save(out_path)
    return out_path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "样例输出", "ares-docx样例.docx")
    print("生成样张：", build_sample(out))
