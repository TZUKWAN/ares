# -*- coding: utf-8 -*-
"""
make_docx.py — ares-docx 统一版式模板函数库 + 样例生成（T3.3 DoD 样例脚本）

直接运行生成 ares-docx 的格式基准样张：
    python skills/ares-docx/scripts/make_docx.py [输出路径.docx]

生产线脚本可 import 本模块复用 new_document/add_cover/add_toc/add_heading/add_body/
add_figure/add_table_numbered/add_reference_gbt7714/finalize。

版式规范（与 skills/ares-docx/SKILL.md 第二节一致）：
正文宋体小四 1.5 倍行距首行缩进 2 字符；一级黑体三号；二级黑体四号；三级黑体小四；
页眉项目名小五宋体；页脚第X页共Y页；目录为 Word 自动目录域。
"""
import os
import sys
import tempfile

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.enum.section import WD_SECTION
from docx.enum.table import WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor

try:
    from PIL import Image
except ImportError:  # pragma: no cover - python-docx normally brings Pillow
    Image = None


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


def _set_keep_with_next(paragraph):
    paragraph.paragraph_format.keep_with_next = True
    paragraph.paragraph_format.keep_together = True


def _set_alt_text(inline_shape, alt_text):
    if not alt_text:
        return
    doc_pr = inline_shape._inline.docPr
    doc_pr.set("descr", str(alt_text))
    doc_pr.set("title", str(alt_text))


def _image_dpi(image_path):
    if Image is None:
        return None
    with Image.open(image_path) as image:
        dpi = image.info.get("dpi")
        if not dpi:
            return None
        return float(dpi[0]), float(dpi[1])


def add_figure(doc, chapter_no, fig_no, caption, image_path, source="", width_inches=None,
               height_inches=None, alt_text="", dpi_min=300):
    """Embed a real figure and bind its caption/source to the same block.

    ``image_path`` is mandatory. Missing files, unsupported/undetermined DPI or
    a low-resolution image fail before the document is written, preventing an
    output that only pretends to contain a figure.
    """
    if not image_path or not os.path.isfile(image_path):
        raise FileNotFoundError("图片素材不存在：%s" % image_path)
    dpi = _image_dpi(image_path)
    if dpi is None:
        raise ValueError("图片缺少 DPI 元数据（至少 %.0f dpi）：%s" % (dpi_min, image_path))
    if min(dpi) + 0.01 < dpi_min:
        raise ValueError("图片 DPI %.1fx%.1f 低于要求 %.0f：%s" % (dpi[0], dpi[1], dpi_min, image_path))

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = None
    _set_keep_with_next(p)
    run = p.add_run()
    kwargs = {}
    if width_inches is not None:
        kwargs["width"] = Inches(float(width_inches))
    if height_inches is not None:
        kwargs["height"] = Inches(float(height_inches))
    inline = run.add_picture(image_path, **kwargs)
    _set_alt_text(inline, alt_text or caption)

    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = None
    p.paragraph_format.keep_with_next = bool(source)
    _set_font(p.add_run("图%d-%d  %s" % (chapter_no, fig_no, caption)), "宋体", 10.5)
    if source:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.first_line_indent = None
        _set_font(p.add_run("来源：" + str(source)), "宋体", 9)
    return inline


def add_figure_placeholder(doc, chapter_no, fig_no, caption, hint="（此处插入图片，300dpi 起）"):
    """Removed placeholder API kept only to fail loudly for old producers."""
    raise ValueError(
        "禁止生成插图占位符；请调用 add_figure(..., image_path=真实素材路径)。"
    )


def _set_cell_shading(cell, fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = tc_pr.find(qn("w:shd"))
    if shd is None:
        shd = OxmlElement("w:shd")
        tc_pr.append(shd)
    shd.set(qn("w:fill"), fill)


def _set_cell_border(cell, **kwargs):
    tc = cell._tc
    tc_pr = tc.get_or_add_tcPr()
    borders = tc_pr.first_child_found_in("w:tcBorders")
    if borders is None:
        borders = OxmlElement("w:tcBorders")
        tc_pr.append(borders)
    for edge in ("top", "left", "bottom", "right", "insideH", "insideV"):
        if edge not in kwargs:
            continue
        tag = "w:%s" % edge
        element = borders.find(qn(tag))
        if element is None:
            element = OxmlElement(tag)
            borders.append(element)
        for key in ("val", "sz", "space", "color"):
            if key in kwargs[edge]:
                element.set(qn("w:%s" % key), str(kwargs[edge][key]))


def _set_repeat_table_header(row):
    tr_pr = row._tr.get_or_add_trPr()
    tbl_header = OxmlElement("w:tblHeader")
    tbl_header.set(qn("w:val"), "true")
    tr_pr.append(tbl_header)


def _set_row_cant_split(row):
    tr_pr = row._tr.get_or_add_trPr()
    cant_split = OxmlElement("w:cantSplit")
    tr_pr.append(cant_split)


def add_table_numbered(doc, chapter_no, tab_no, caption, header_row, rows, source="", col_widths=None):
    p = doc.add_paragraph()
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    p.paragraph_format.first_line_indent = None
    _set_font(p.add_run("表%d-%d  %s" % (chapter_no, tab_no, caption)), "宋体", 10.5)
    table = doc.add_table(rows=1 + len(rows), cols=len(header_row))
    # Do not rely on locale-specific table style names; borders/shading below
    # define the visual system explicitly.
    table.autofit = False
    if col_widths is None:
        lengths = []
        for j, head in enumerate(header_row):
            vals = [str(head)] + [str(row[j]) for row in rows if j < len(row)]
            lengths.append(max(1, max(len(v) for v in vals)))
        total = sum(lengths) or 1
        col_widths = [6.4 * n / total for n in lengths]
    if len(col_widths) != len(header_row):
        raise ValueError("col_widths 数量必须与 header_row 一致")
    for j, cell_text in enumerate(header_row):
        cell = table.cell(0, j)
        cell.width = Inches(float(col_widths[j]))
        cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
        _set_cell_shading(cell, "1F4E79")
        _set_cell_border(cell, top={"val": "single", "sz": "12", "color": "1F4E79"},
                         bottom={"val": "single", "sz": "8", "color": "1F4E79"})
        cell.paragraphs[0].paragraph_format.first_line_indent = None
        p = cell.paragraphs[0]
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        _set_font(p.add_run(cell_text), "宋体", 10.5, bold=True)
    _set_repeat_table_header(table.rows[0])
    _set_row_cant_split(table.rows[0])
    for i, row in enumerate(rows, 1):
        _set_row_cant_split(table.rows[i])
        for j, cell_text in enumerate(row):
            cell = table.cell(i, j)
            cell.width = Inches(float(col_widths[j]))
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.CENTER
            _set_cell_border(cell, bottom={"val": "single" if i == len(rows) else "nil",
                                            "sz": "8" if i == len(rows) else "0",
                                            "color": "1F4E79"})
            cell.paragraphs[0].paragraph_format.first_line_indent = None
            _set_font(cell.paragraphs[0].add_run(str(cell_text)), "宋体", 10.5)
    if source:
        p = doc.add_paragraph()
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
        p.paragraph_format.first_line_indent = None
        _set_font(p.add_run("来源：" + str(source)), "宋体", 9)
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
    """Run structural guards before a document is handed to the caller."""
    placeholders = [p.text for p in doc.paragraphs if "此处插入图片" in p.text]
    if placeholders:
        raise ValueError("文档仍含插图占位符，请补入真实素材后再交付")
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
    figure_path = os.path.join(tempfile.gettempdir(), "ares_docx_sample_architecture.png")
    if Image is None:
        raise RuntimeError("生成样例插图需要 Pillow")
    image = Image.new("RGB", (1800, 900), "white")
    from PIL import ImageDraw
    draw = ImageDraw.Draw(image)
    boxes = [(120, 260, 480, 520, "感知层\n60GHz 毫米波雷达"),
             (720, 260, 1080, 520, "边缘层\n特征提取与识别"),
             (1320, 260, 1680, 520, "应用层\n告警与档案")]
    for x1, y1, x2, y2, label in boxes:
        draw.rounded_rectangle((x1, y1, x2, y2), radius=32, fill="#DEEBF7", outline="#1F4E79", width=8)
        draw.multiline_text(((x1 + x2) // 2, (y1 + y2) // 2), label, fill="#1F4E79", anchor="mm", align="center", spacing=18)
    draw.line((480, 390, 720, 390), fill="#2E75B6", width=14)
    draw.line((1080, 390, 1320, 390), fill="#2E75B6", width=14)
    image.save(figure_path, dpi=(300, 300))
    try:
        add_figure(doc, 2, 1, "系统总体架构", figure_path,
                   source="样例架构图，生成于模板验收；正式项目需替换为项目证据图",
                   width_inches=6.1, alt_text="毫米波雷达跌倒监测系统三层架构")
    finally:
        try:
            os.unlink(figure_path)
        except OSError:
            pass
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
