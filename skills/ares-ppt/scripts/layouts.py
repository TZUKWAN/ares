# -*- coding: utf-8 -*-
"""
layouts.py — ares-ppt 版式引擎（内容驱动自动选版式，18 种可复用版式函数）

每个版式函数签名：def layout_xxx(slide, theme, c) -> None
c 为该页内容字典。所有函数从统一助手取字体/字号/留白，保证全套一致。
溢出风险检测：关键文本框在放入文本时调用 _fit 检查，超限记入 OVERFLOWS，
由 build_ppt.py 汇总输出（DoD：逐页检查无溢出）。
"""
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
from pptx.util import Emu, Pt

from theme import FONT, SIZES, MARGIN, TITLE_BAND_H, FOOTER_H, SLIDE_W, SLIDE_H

IN = 914400
OVERFLOWS = []
NOTES = []   # 版式级提示（如柱状图数值跨度过大），由 build_ppt 汇总打印


def In(x):
    return Emu(int(x * IN))


def _fit(page_no, label, text, box_w_in, box_h_in, size_pt, extra_lines=0):
    """粗算 CJK 文本在框内行数与高度，超限记溢出。"""
    if not text:
        return
    lines = 0
    for seg in str(text).split("\n"):
        char_w = size_pt / 72.0
        per_line = max(1, int(box_w_in / char_w))
        lines += max(1, -(-len(seg) // per_line))
    need = (lines + extra_lines) * (size_pt * 1.35 / 72.0)
    if need > box_h_in + 0.01:
        OVERFLOWS.append("第%d页 [%s] 溢出风险：需 %.2f 英寸 > 框高 %.2f 英寸" % (page_no, label, need, box_h_in))


def _tf(shape):
    tf = shape.text_frame
    tf.word_wrap = True
    return tf


def _para(tf, text, size, color, bold=False, align=PP_ALIGN.LEFT, first=False, spacing=1.15):
    p = tf.paragraphs[0] if first and not tf.paragraphs[0].runs else tf.add_paragraph()
    p.alignment = align
    p.line_spacing = spacing
    r = p.add_run()
    r.text = str(text)
    r.font.name = FONT
    r.font.size = size if isinstance(size, Pt.__class__) else Pt(size)
    r.font.bold = bold
    r.font.color.rgb = color
    return p


def _box(slide, x, y, w, h, wrap=True):
    tb = slide.shapes.add_textbox(In(x), In(y), In(w), In(h))
    tb.text_frame.word_wrap = wrap
    return tb


def _rect(slide, x, y, w, h, fill, shape=MSO_SHAPE.RECTANGLE, line_color=None, shadow=False):
    sp = slide.shapes.add_shape(shape, In(x), In(y), In(w), In(h))
    if fill is None:
        sp.fill.background()
    else:
        sp.fill.solid()
        sp.fill.fore_color.rgb = fill
    if line_color is None:
        sp.line.fill.background()
    else:
        sp.line.color.rgb = line_color
        sp.line.width = Pt(1)
    sp.shadow.inherit = False
    return sp


def page_chrome(slide, theme, title, page_no, total, project_name):
    """统一页题带与页脚。封面/结束页不调用。"""
    _rect(slide, 0, 0, 13.333, 0.12, theme["accent"])
    tb = _box(slide, 0.9166, 0.32, 11.5, 0.85)
    _para(_tf(tb), title, 32, theme["primary"], bold=True, first=True)
    _fit(page_no, "页题", title, 11.5, 0.85, 32)
    tb = _box(slide, 0.9166, 7.05, 11.5, 0.3)
    _para(_tf(tb), "%s ｜ %d / %d" % (project_name, page_no, total), 10, theme["muted"], first=True)


def kpi_strip(slide, theme, page_no, kpis, y, height=1.35):
    """kpis: [(数字, 标签)] 横向等分。"""
    n = len(kpis)
    gap = 0.25
    w = (13.333 - 2 * 0.9166 - (n - 1) * gap) / n
    for i, (num, label) in enumerate(kpis):
        x = 0.9166 + i * (w + gap)
        card = _rect(slide, x, y, w, height, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        tf = _tf(card)
        _para(tf, str(num), 28, theme["primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        _para(tf, str(label), 12, theme["muted"], align=PP_ALIGN.CENTER)


# ---------------------------------------------------------------- 1 封面/结束
def cover(slide, theme, c):
    _rect(slide, 0, 0, 13.333, 7.5, theme["primary"])
    _rect(slide, 0, 5.9, 13.333, 1.6, _shade(theme["primary"]))
    tb = _box(slide, 1.2, 2.0, 10.93, 1.6)
    _para(_tf(tb), c["title"], 44, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
    _fit(1, "封面主标题", c["title"], 10.93, 1.6, 44)
    tb = _box(slide, 1.2, 3.7, 10.93, 0.8)
    _para(_tf(tb), c["slogan"], 24, theme["on_primary"], align=PP_ALIGN.CENTER, first=True)
    tb = _box(slide, 1.2, 6.15, 10.93, 1.1)
    tf = _tf(tb)
    for i, line in enumerate(c.get("meta_lines", [])):
        _para(tf, line, 14, theme["on_primary"], align=PP_ALIGN.CENTER, first=(i == 0))


def _shade(primary):
    return Emu(primary) if False else primary  # 简化：同色分层靠形状叠加


def closing(slide, theme, c):
    _rect(slide, 0, 0, 13.333, 7.5, theme["primary"])
    tb = _box(slide, 1.2, 2.4, 10.93, 1.2)
    _para(_tf(tb), c.get("slogan", ""), 36, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
    tb = _box(slide, 1.2, 3.9, 10.93, 0.7)
    _para(_tf(tb), c.get("thanks", "恳请各位评委专家批评指正"), 20, theme["on_primary"], align=PP_ALIGN.CENTER, first=True)
    tb = _box(slide, 1.2, 6.2, 10.93, 0.6)
    _para(_tf(tb), c.get("contact", ""), 14, theme["on_primary"], align=PP_ALIGN.CENTER, first=True)


# ---------------------------------------------------------------- 2 目录
def agenda(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    items = c["items"]
    col_split = 5
    for col, group in enumerate((items[:col_split], items[col_split:])):
        for i, it in enumerate(group):
            x = 0.9166 + col * 5.9
            y = 1.6 + i * 0.95
            num = _rect(slide, x, y, 0.62, 0.62, theme["accent"], shape=MSO_SHAPE.OVAL)
            _para(_tf(num), str(col * col_split + i + 1), 18, theme["on_primary"], bold=True,
                  align=PP_ALIGN.CENTER, first=True)
            tb = _box(slide, x + 0.85, y + 0.05, 4.8, 0.6)
            _para(_tf(tb), it, 18, theme["text"], first=True)


# ---------------------------------------------------------------- 3 三栏要点
def three_columns(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    cols = c["columns"]
    n = len(cols)
    gap = 0.35
    w = (13.333 - 2 * 0.9166 - (n - 1) * gap) / n
    # 卡片高度自适应内容，避免大面积空置
    est = []
    for col in cols:
        n_lines = sum(max(1, -(-len(str(line)) // 18)) for line in col.get("lines", [])) or 1
        h = 0.95 + 0.36 * n_lines + (1.0 if col.get("metric") else 0.25)
        est.append(h)
    card_h = max(2.2, min(4.9, max(est)))
    top = 1.7 + max(0.0, (4.9 - card_h) / 2)
    for i, col in enumerate(cols):
        x = 0.9166 + i * (w + gap)
        _rect(slide, x, top, w, card_h, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        head = _rect(slide, x, top, w, 0.85, theme["primary"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        _para(_tf(head), col["head"], 18, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        body_h = card_h - 0.95 - (1.05 if col.get("metric") else 0.25)
        tb = _box(slide, x + 0.25, top + 0.95, w - 0.5, max(0.5, body_h))
        tf = _tf(tb)
        for j, line in enumerate(col.get("lines", [])):
            _para(tf, line, 14, theme["text"], first=(j == 0))
        _fit(c["page_no"], "三栏%d" % (i + 1), "\n".join(col.get("lines", [])), w - 0.5, max(0.5, body_h), 14)
        if col.get("metric"):
            m = _box(slide, x + 0.25, top + card_h - 0.95, w - 0.5, 0.8)
            _para(_tf(m), col["metric"], 24, theme["accent"], bold=True, align=PP_ALIGN.CENTER, first=True)


# ---------------------------------------------------------------- 4-6 数据图表页
def _chart_note(slide, theme, c, chart):
    note = c.get("note_lines") or []
    tb = _box(slide, 8.6, 1.9, 3.9, 4.6)
    tf = _tf(tb)
    tf.vertical_anchor = MSO_ANCHOR.MIDDLE
    for i, line in enumerate(note):
        _para(tf, line, 14, theme["text"], first=(i == 0))
    _fit(c["page_no"], "图表页侧注", "\n".join(note), 3.9, 4.6, 14)
    if c.get("conclusion"):
        band = _rect(slide, 0.9166, 6.35, 11.5, 0.62, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        _para(_tf(band), c["conclusion"], 14, theme["primary"], bold=True, align=PP_ALIGN.CENTER, first=True)


def chart_bar(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    values = [abs(v) for v in c["values"] if v]
    if values and max(values) / max(min(values), 1e-9) >= 50:
        NOTES.append("第%d页柱状图数值跨度超过50倍：若为市场分层/漏斗（同量纲）可忽略；"
                     "若为不同量纲指标混排，请改用对比矩阵或拆分同量纲多页" % c["page_no"])
    data = CategoryChartData()
    data.categories = c["categories"]
    data.add_series(c["series_name"], c["values"])
    gframe = slide.shapes.add_chart(XL_CHART_TYPE.COLUMN_CLUSTERED, In(0.9), In(1.8), In(7.4), In(4.4), data)
    chart = gframe.chart
    chart.has_legend = False
    plot = chart.plots[0]
    plot.series[0].format.fill.solid()
    plot.series[0].format.fill.fore_color.rgb = theme["accent"]
    chart.value_axis.tick_labels.font.size = Pt(12)
    chart.category_axis.tick_labels.font.size = Pt(12)
    chart.category_axis.tick_labels.font.name = FONT
    _chart_note(slide, theme, c, chart)


def chart_line(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    data = CategoryChartData()
    data.categories = [str(x) for x in c["categories"]]
    for name, values in c["series"]:
        data.add_series(name, values)
    gframe = slide.shapes.add_chart(XL_CHART_TYPE.LINE_MARKERS, In(0.9), In(1.8), In(7.4), In(4.4), data)
    chart = gframe.chart
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.legend.include_in_layout = False
    chart.legend.font.size = Pt(12)
    for s, color in zip(chart.series, (theme["primary"], theme["accent"], theme["muted"])):
        s.format.line.color.rgb = color
        s.format.line.width = Pt(2.5)
    chart.value_axis.tick_labels.font.size = Pt(12)
    chart.category_axis.tick_labels.font.size = Pt(12)
    _chart_note(slide, theme, c, chart)


def chart_pie(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    data = CategoryChartData()
    data.categories = c["categories"]
    data.add_series(c["series_name"], c["values"])
    gframe = slide.shapes.add_chart(XL_CHART_TYPE.PIE, In(1.3), In(1.8), In(6.6), In(4.5), data)
    chart = gframe.chart
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.RIGHT
    chart.legend.include_in_layout = False
    chart.legend.font.size = Pt(13)
    plot = chart.plots[0]
    plot.has_data_labels = True
    labels = plot.data_labels
    labels.show_percentage = True
    labels.show_value = False
    labels.number_format = "0%"
    labels.number_format_is_linked = False
    labels.font.size = Pt(13)
    labels.font.name = FONT
    series = chart.plots[0].series[0]
    palette = (theme["primary"], theme["accent"], theme["muted"], theme["light"])
    for i, point in enumerate(series.points):
        point.format.fill.solid()
        point.format.fill.fore_color.rgb = palette[i % len(palette)]
    _chart_note(slide, theme, c, chart)


# ---------------------------------------------------------------- 7 对比矩阵
def comparison_matrix(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    dims = c["dimensions"]
    cols = [col for col in c["columns"]
            if not all(str(v).strip() in ("—", "-", "", "无", "N/A") for v in col[2])]
    cols = cols or c["columns"]  # 兜底：全部占位时保留原列
    rows, cols_n = len(dims) + 1, len(cols) + 1
    tbl_shape = slide.shapes.add_table(rows, cols_n, In(0.9), In(1.8), In(11.5), In(4.6))
    table = tbl_shape.table
    header = ["对比维度"] + [col[0] for col in cols]
    for j, text in enumerate(header):
        cell = table.cell(0, j)
        cell.fill.solid()
        cell.fill.fore_color.rgb = theme["primary"] if j <= 1 or cols[j - 1][1] else theme["muted"]
        para = cell.text_frame.paragraphs[0]
        para.alignment = PP_ALIGN.CENTER
        r = para.add_run()
        r.text = text
        r.font.name = FONT
        r.font.size = Pt(14)
        r.font.bold = True
        r.font.color.rgb = theme["on_primary"]
    for i, dim in enumerate(dims, 1):
        cell = table.cell(i, 0)
        cell.fill.solid()
        cell.fill.fore_color.rgb = theme["light"]
        para = cell.text_frame.paragraphs[0]
        para.alignment = PP_ALIGN.CENTER
        r = para.add_run()
        r.text = dim
        r.font.name = FONT
        r.font.size = Pt(13)
        r.font.bold = True
        r.font.color.rgb = theme["primary"]
        for j, col in enumerate(cols, 1):
            cell = table.cell(i, j)
            cell.fill.solid()
            cell.fill.fore_color.rgb = theme["light"] if col[1] else theme["bg"]
            para = cell.text_frame.paragraphs[0]
            para.alignment = PP_ALIGN.CENTER
            r = para.add_run()
            r.text = str(col[2][i - 1])
            r.font.name = FONT
            r.font.size = Pt(13)
            r.font.color.rgb = theme["text"]
    if c.get("note_lines"):
        tb = _box(slide, 0.9166, 6.42, 11.5, 0.45)
        _para(_tf(tb), " ｜ ".join(str(x) for x in c["note_lines"]), 11, theme["muted"],
              align=PP_ALIGN.CENTER, first=True)
    if c.get("conclusion"):
        band = _rect(slide, 0.9166, 6.86, 11.5, 0.5, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        _para(_tf(band), c["conclusion"], 13, theme["primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
    else:
        pass


# ---------------------------------------------------------------- 8 雷达图
def radar_page(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    data = CategoryChartData()
    data.categories = c["dimensions"]
    for name, values in c["series"]:
        data.add_series(name, values)
    gframe = slide.shapes.add_chart(XL_CHART_TYPE.RADAR_MARKERS, In(1.6), In(1.7), In(6.4), In(5.0), data)
    chart = gframe.chart
    chart.has_legend = True
    chart.legend.position = XL_LEGEND_POSITION.BOTTOM
    chart.legend.include_in_layout = False
    chart.legend.font.size = Pt(12)
    for s, color in zip(chart.series, (theme["primary"], theme["muted"])):
        s.format.line.color.rgb = color
        s.format.line.width = Pt(2.5)
    note = c.get("note_lines") or []
    tb = _box(slide, 8.5, 2.0, 4.0, 4.2)
    tf = _tf(tb)
    for i, line in enumerate(note):
        _para(tf, line, 14, theme["text"], first=(i == 0))
    _fit(c["page_no"], "雷达页侧注", "\n".join(note), 4.0, 4.2, 14)


# ---------------------------------------------------------------- 9 时间线
def timeline(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    nodes = c["nodes"]  # [(时间, 事件)]
    n = len(nodes)
    y_mid = 4.0
    _rect(slide, 1.0, y_mid - 0.03, 11.3, 0.06, theme["accent"])
    seg = 11.3 / n
    for i, (time, event) in enumerate(nodes):
        cx = 1.0 + seg * (i + 0.5)
        dot = _rect(slide, cx - 0.14, y_mid - 0.14, 0.28, 0.28, theme["primary"], shape=MSO_SHAPE.OVAL)
        above = (i % 2 == 0)
        ty = y_mid - 1.75 if above else y_mid + 0.45
        tb = _box(slide, cx - seg / 2 + 0.08, ty, seg - 0.16, 1.5)
        tf = _tf(tb)
        _para(tf, time, 16, theme["primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        _para(tf, event, 12, theme["text"], align=PP_ALIGN.CENTER)
        _fit(c["page_no"], "时间线节点%d" % (i + 1), event, seg - 0.16, 1.0, 12)


# ---------------------------------------------------------------- 10 架构图
def architecture(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    layers = c["layers"]  # [(层名, [构件...])]
    n = len(layers)
    top, bottom = 1.7, 6.6
    h = (bottom - top - (n - 1) * 0.18) / n
    for i, (name, parts) in enumerate(layers):
        y = top + i * (h + 0.18)
        band = _rect(slide, 1.2, y, 2.5, h, theme["primary"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        _para(_tf(band), name, 16, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        m = len(parts)
        gap = 0.15
        w = (9.0 - (m - 1) * gap) / m
        for j, part in enumerate(parts):
            x = 4.0 + j * (w + gap)
            box = _rect(slide, x, y, w, h, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
            tf = _tf(box)
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            _para(tf, part, 13, theme["text"], align=PP_ALIGN.CENTER, first=True)
            _fit(c["page_no"], "架构构件", part, w, h, 13)


# ---------------------------------------------------------------- 11 流程链路
def flow_chain(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    steps = c["steps"]  # [(步骤名, 说明)]
    n = len(steps)
    w, h, gap = 1.95, 1.0, 0.28
    total_w = n * w + (n - 1) * gap
    x0 = (13.333 - total_w) / 2
    for i, (name, desc) in enumerate(steps):
        x = x0 + i * (w + gap)
        shape = MSO_SHAPE.PENTAGON if i == 0 else MSO_SHAPE.CHEVRON
        box = _rect(slide, x, 2.4, w, h, theme["accent"] if i % 2 == 0 else theme["primary"], shape=shape)
        tf = _tf(box)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        _para(tf, name, 14, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        tb = _box(slide, x - 0.1, 3.7, w + 0.2, 1.6)
        _para(_tf(tb), desc, 12, theme["text"], align=PP_ALIGN.CENTER, first=True)
        _fit(c["page_no"], "流程说明%d" % (i + 1), desc, w + 0.2, 1.6, 12)
    if c.get("conclusion"):
        band = _rect(slide, 0.9166, 6.35, 11.5, 0.62, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        _para(_tf(band), c["conclusion"], 14, theme["primary"], bold=True, align=PP_ALIGN.CENTER, first=True)


# ---------------------------------------------------------------- 12 四象限
def quadrant(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    quads = c["quadrants"]  # [(标题, [条目...], 是否强调)]
    pos = [(0.9166, 1.7), (6.75, 1.7), (0.9166, 4.25), (6.75, 4.25)]
    for i, (title, items, hot) in enumerate(quads):
        x, y = pos[i]
        box = _rect(slide, x, y, 5.65, 2.4, theme["light"] if hot else theme["bg"],
                    shape=MSO_SHAPE.ROUNDED_RECTANGLE, line_color=theme["accent"] if hot else theme["muted"])
        head = _rect(slide, x, y, 5.65, 0.6, theme["accent"] if hot else theme["muted"],
                     shape=MSO_SHAPE.ROUND_SAME_SIDE_CORNER_RECTANGLE)
        _para(_tf(head), title, 15, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        tb = _box(slide, x + 0.3, y + 0.75, 5.05, 1.5)
        tf = _tf(tb)
        for j, it in enumerate(items):
            _para(tf, "· " + it, 13, theme["text"], first=(j == 0))
        _fit(c["page_no"], "象限%d" % (i + 1), "\n".join(items), 5.05, 1.5, 13)


# ---------------------------------------------------------------- 13 团队卡片
def team_cards(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    members = c["members"]  # [(姓名, 角色, 一句话贡献)]
    n = max(1, len(members))
    gap = 0.3
    w = (13.333 - 2 * 0.9166 - (n - 1) * gap) / n
    w = min(w, 3.4)  # 少数成员时限制卡宽并居中，避免单卡空旷
    total_w = n * w + (n - 1) * gap
    x0 = (13.333 - total_w) / 2
    card_h = 3.9
    top = 1.9 + max(0.0, (4.5 - card_h) / 2)
    for i, (name, role, contrib) in enumerate(members):
        x = x0 + i * (w + gap)
        _rect(slide, x, top, w, card_h, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        avatar = _rect(slide, x + w / 2 - 0.55, top + 0.35, 1.1, 1.1, theme["primary"], shape=MSO_SHAPE.OVAL)
        _para(_tf(avatar), name[:1] if name else "?", 28, theme["on_primary"], bold=True,
              align=PP_ALIGN.CENTER, first=True)
        tb = _box(slide, x + 0.15, top + 1.65, w - 0.3, 2.1)
        tf = _tf(tb)
        _para(tf, name, 18, theme["text"], bold=True, align=PP_ALIGN.CENTER, first=True)
        _para(tf, role, 13, theme["accent"], bold=True, align=PP_ALIGN.CENTER)
        _para(tf, contrib, 12, theme["muted"], align=PP_ALIGN.CENTER)
        _fit(c["page_no"], "成员%s" % name, contrib, w - 0.3, 1.1, 12)


# ---------------------------------------------------------------- 14 里程碑+数据组合
def milestone_data(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    miles = c["milestones"]  # [(时间, 事件)] 竖排左侧
    for i, (time, event) in enumerate(miles):
        y = 1.8 + i * 1.15
        dot = _rect(slide, 1.1, y + 0.08, 0.24, 0.24, theme["accent"], shape=MSO_SHAPE.OVAL)
        tb = _box(slide, 1.55, y - 0.05, 6.2, 1.05)
        tf = _tf(tb)
        _para(tf, "%s  %s" % (time, event), 14, theme["text"], first=True)
        _fit(c["page_no"], "里程碑%d" % (i + 1), event, 6.2, 0.8, 14)
    kpis = c["kpis"]  # [(数字, 标签)] 右侧纵排
    for i, (num, label) in enumerate(kpis):
        y = 1.8 + i * 1.55
        card = _rect(slide, 8.4, y, 4.0, 1.35, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        tf = _tf(card)
        _para(tf, str(num), 26, theme["primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        _para(tf, str(label), 12, theme["muted"], align=PP_ALIGN.CENTER)


# ---------------------------------------------------------------- 15 全屏金句
def quote_fullscreen(slide, theme, c):
    _rect(slide, 0, 0, 13.333, 7.5, theme["primary"])
    tb = _box(slide, 1.2, 2.6, 10.93, 2.2)
    _para(_tf(tb), c["quote"], 36, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
    _fit(c["page_no"], "金句", c["quote"], 10.93, 2.2, 36)
    if c.get("attribution"):
        tb = _box(slide, 1.2, 5.1, 10.93, 0.6)
        _para(_tf(tb), c["attribution"], 16, theme["on_primary"], align=PP_ALIGN.CENTER, first=True)


# ---------------------------------------------------------------- 16 政策列表
def policy_list(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    policies = c["policies"]  # [(名称+年份, 红利条款)]
    for i, (name, benefit) in enumerate(policies):
        y = 1.7 + i * 1.15
        row = _rect(slide, 0.9166, y, 11.5, 1.0, theme["light"] if i % 2 == 0 else theme["bg"],
                    shape=MSO_SHAPE.ROUNDED_RECTANGLE, line_color=theme["muted"])
        tb = _box(slide, 1.2, y + 0.08, 3.6, 0.84)
        _para(_tf(tb), name, 14, theme["primary"], bold=True, first=True)
        tb = _box(slide, 5.0, y + 0.08, 7.2, 0.84)
        _para(_tf(tb), benefit, 13, theme["text"], first=True)
        _fit(c["page_no"], "政策%d" % (i + 1), benefit, 7.2, 0.84, 13)


# ---------------------------------------------------------------- 17 痛点→功能映射
def pain_solution(slide, theme, c):
    page_chrome(slide, theme, c["title"], c["page_no"], c["total"], c["project_name"])
    pairs = c["pairs"]  # [(痛点, 功能, 量化效果)]
    for i, (pain, feat, effect) in enumerate(pairs):
        y = 1.7 + i * 1.25
        left = _rect(slide, 0.9166, y, 4.3, 1.05, theme["light"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        tf = _tf(left)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        _para(tf, pain, 13, theme["text"], align=PP_ALIGN.CENTER, first=True)
        arrow = _rect(slide, 5.45, y + 0.28, 0.9, 0.5, theme["accent"], shape=MSO_SHAPE.RIGHT_ARROW)
        mid = _rect(slide, 6.6, y, 3.2, 1.05, theme["primary"], shape=MSO_SHAPE.ROUNDED_RECTANGLE)
        tf = _tf(mid)
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        _para(tf, feat, 14, theme["on_primary"], bold=True, align=PP_ALIGN.CENTER, first=True)
        right = _box(slide, 10.1, y + 0.15, 2.5, 0.85)
        _para(_tf(right), effect, 14, theme["accent"], bold=True, align=PP_ALIGN.CENTER, first=True)


LAYOUTS = {
    "cover": cover, "closing": closing, "agenda": agenda,
    "three_columns": three_columns, "chart_bar": chart_bar, "chart_line": chart_line,
    "chart_pie": chart_pie, "comparison_matrix": comparison_matrix, "radar_page": radar_page,
    "timeline": timeline, "architecture": architecture, "flow_chain": flow_chain,
    "quadrant": quadrant, "team_cards": team_cards, "milestone_data": milestone_data,
    "quote_fullscreen": quote_fullscreen, "policy_list": policy_list, "pain_solution": pain_solution,
}
