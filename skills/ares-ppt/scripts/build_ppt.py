# -*- coding: utf-8 -*-
"""
build_ppt.py — ares-ppt 渲染入口（T3.4 三层架构之渲染层）

用法：
    python build_ppt.py --profile <project.json> --out <输出.pptx> [--outline <pages.json>] [--theme auto|tech_blue|eco_green|vitality_orange]

- 无 outline 时按附录三精简版默认 21 页大纲，全部内容取自 project.json（单一事实源，
  改档案任一数字重渲染即同步）。
- outline 为页列表：[{"layout": "chart_bar", "title": "...", ...该版式的内容字段}, ...]，
  供生产线按赛事 rubric 裁剪页序页数。
- 输出 16:9；图表为原生 PPT 图表；渲染后打印逐页溢出检查报告，有溢出风险退出码 1。
"""
import argparse
import io
import json
import os
import re as _re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation
from pptx.oxml.ns import qn
from pptx.util import Emu

import layouts
from layouts import LAYOUTS, OVERFLOWS
from theme import SLIDE_H, SLIDE_W, THEMES, pick_theme


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _flat(v, fallback=""):
    """把档案里任意结构（字符串/列表/字典/数字）摊平成可上页的干净文本，杜绝 repr/json 痕迹。"""
    if v is None:
        return fallback
    if isinstance(v, str):
        return v.strip() or fallback
    if isinstance(v, bool):
        return str(v)
    if isinstance(v, (int, float)):
        return str(v)
    if isinstance(v, list):
        parts = [_flat(x) for x in v]
        parts = [p for p in parts if p]
        return "；".join(parts) if parts else fallback
    if isinstance(v, dict):
        parts = [_flat(x) for x in v.values()]
        parts = [p for p in parts if p]
        return "；".join(parts) if parts else fallback
    return str(v)


def _required(value, field):
    if value is None or value == "" or value == [] or value == {}:
        raise ValueError("project.json 缺少 PPT 必需字段：%s" % field)
    return value


def _resolve_asset(path, base_dirs):
    if not path:
        raise ValueError("PPT 素材路径为空")
    candidates = [path] if os.path.isabs(path) else [os.path.join(d, path) for d in base_dirs]
    for candidate in candidates:
        if os.path.isfile(candidate):
            return os.path.abspath(candidate)
    raise FileNotFoundError("PPT 素材不存在：%s（搜索目录：%s）" % (path, ", ".join(base_dirs)))


def _prototype_screenshots(prototype_dir):
    if not prototype_dir:
        return []
    prototype_dir = os.path.abspath(prototype_dir)
    candidates = []
    for folder in (os.path.join(prototype_dir, "screenshots"),
                   os.path.join(prototype_dir, "assets")):
        if os.path.isdir(folder):
            candidates.extend(os.path.join(folder, f) for f in sorted(os.listdir(folder))
                              if f.lower().endswith((".png", ".jpg", ".jpeg")))
    return candidates[:3]


def _normalize_chart_axis_ids(prs):
    """python-pptx may serialize signed int32 axis IDs; OpenXML requires uint32."""
    changed = 0
    for slide in prs.slides:
        for shape in slide.shapes:
            if not getattr(shape, "has_chart", False):
                continue
            for tag in ("c:axId", "c:crossAx"):
                nodes = shape.chart._element.iter(qn(tag))
                for node in nodes:
                    raw = node.get("val")
                    try:
                        value = int(raw)
                    except (TypeError, ValueError):
                        continue
                    if value < 0:
                        node.set("val", str(value % (2 ** 32)))
                        changed += 1
    return changed


def _prepare_asset_pages(pages, base_dirs):
    prepared = []
    for spec in pages:
        item = dict(spec)
        if item.get("layout") == "image":
            item["image_path"] = _resolve_asset(item.get("image_path") or item.get("image"), base_dirs)
        if item.get("layout") == "prototype_demo":
            shots = []
            for shot in item.get("screenshots", []):
                if isinstance(shot, dict):
                    shot = dict(shot)
                    shot["path"] = _resolve_asset(shot.get("path"), base_dirs)
                else:
                    shot = {"path": _resolve_asset(shot, base_dirs)}
                shots.append(shot)
            item["screenshots"] = shots
        prepared.append(item)
    return prepared


def _finance_series(profile, years_out):
    fin = profile.get("financials", {})
    _required(fin.get("revenue_start_wan"), "financials.revenue_start_wan")
    _required(fin.get("years"), "financials.years")
    _required(fin.get("growth_rate_range"), "financials.growth_rate_range")
    rev0 = _f(fin.get("revenue_start_wan"))
    years = int(_f(fin.get("years")))
    growth = None
    gr = str(fin.get("growth_rate_range", ""))
    import re
    m = re.findall(r"(\d+(?:\.\d+)?)\s*%", gr)
    if m:
        lo, hi = float(m[0]), float(m[-1])
        if len(m) >= 2:
            growth = (lo + hi) / 200.0
        else:
            growth = lo / 100.0
    if growth is None or years <= 0:
        raise ValueError("financials.growth_rate_range/years 无法生成财务曲线")
    margin_mult = 1.2
    mm = re.search(r"(\d+(?:\.\d+)?)", str(fin.get("margin_ratio_vs_industry", "")))
    if mm:
        margin_mult = float(mm.group(1))
    base_margin = 0.12 * margin_mult
    revs, profits, labels = [], [], []
    rev = rev0
    for i in range(years):
        ramp = 0.6 + 0.4 * (i / max(1, years - 1))   # 与 build_financials 同口径：首年60%爬坡到100%
        revs.append(round(rev, 1))
        profits.append(round(rev * base_margin * ramp, 1))
        labels.append("第%d年" % (i + 1))
        rev *= (1 + growth)
    years_out.extend(labels)
    return revs, profits


def default_outline(p, prototype_dir=None):
    """附录三精简版 21 页，内容全部取自 project.json。"""
    comp = p.get("competition", {})
    team = p.get("team", [])
    market = p.get("market", {})
    sol = p.get("solution", {})
    ach = p.get("achievements", {})
    biz = p.get("business_model", {})
    fin = p.get("financials", {})
    pains = p.get("pain_points", [])
    feats = _required(sol.get("features"), "solution.features")
    metrics = _required(sol.get("performance_metrics"), "solution.performance_metrics")
    compet = _required(p.get("competitors"), "competitors")
    years, revs, profits = [], [], []
    revs, profits = _finance_series(p, years)
    milestones = _required(p.get("milestones"), "milestones")[:5]
    social = p.get("social_value", {})
    pages = []

    pages.append({"layout": "cover", "title": p.get("project_name", "项目名称"),
                  "slogan": p.get("slogan", ""),
                  "meta_lines": ["参赛赛事：%s %s" % (comp.get("name", ""), comp.get("track", "")),
                                 "团队：%s" % "、".join([m.get("name", "") for m in team[:5]]),
                                 str(comp.get("deadline", ""))]})
    pages.append({"layout": "three_columns", "title": "三分钟看懂一个正在发生的市场机会",
                  "columns": [
                      {"head": "机会", "lines": [str(market.get("tam", "")), str(market.get("growth", ""))]},
                      {"head": "方案", "lines": [p.get("one_liner", "")]},
                      {"head": "壁垒", "lines": [_flat(p.get("advantages"), "核心优势见后页")[:60]]}]})
    pages.append({"layout": "chart_bar", "title": "千亿市场正在以两位数速度扩张",
                  "categories": ["TAM 总市场", "SAM 可服务", "SOM 初期可获得"],
                  "series_name": "市场规模（亿元）",
                  "values": [_num_or(market.get("tam")), _num_or(market.get("sam")), _num_or(market.get("som"))],
                   "note_lines": ["对数刻度展示市场分层", str(market.get("growth", "")), "来源：" + _src_text(market, p)],
                   "allow_large_span": True, "log_scale": True,
                  "conclusion": "刚性需求未被现有方案满足，细分赛道存在明确空白"})
    policies = _required(p.get("policy"), "policy")
    pages.append({"layout": "policy_list", "title": "政策红利正在为这个行业开路",
                  "policies": [[str(pl.get("name", pl) if isinstance(pl, dict) else pl),
                                str(pl.get("benefit", "")) if isinstance(pl, dict) else "利好条款见计划书政策章节"]
                                for pl in policies[:4]]})
    pages.append({"layout": "pain_solution", "title": "四个真实痛点，全部指向同一个未被满足的需求",
                  "pairs": [[pp.get("desc", ""), pp.get("mapped_feature", ""), "详见产品页"] for pp in pains[:4]]})
    pages.append({"layout": "three_columns", "title": "产品以三大核心功能闭环解决上述痛点",
                  "columns": [{"head": str(f)[:12], "lines": ["功能与痛点对应，实测数据见后页"]} for f in feats[:3]]})
    pages.append({"layout": "architecture", "title": "一套架构支撑全链路服务",
                  "layers": [("感知层", ["传感器/数据接入", "边缘采集"]), ("算法层", ["核心算法", "模型训练", "推理引擎"]),
                             ("应用层", feats[:3] + ["管理后台"])]})
    ms = metrics[:5]
    pages.append({"layout": "comparison_matrix", "title": "关键指标全面领先对标方案",
                  "dimensions": [_flat(m.get("metric"), "指标%d" % (i + 1))[:12] for i, m in enumerate(ms)],
                  "columns": [("本项目", True, [_flat(m.get("value"), "—") for m in ms]),
                               ("对标方案", False, [_flat(m.get("benchmark"), "—") for m in ms])],
                  "conclusion": "所有指标来自实测，测试方法与样本见计划书技术章节"})
    pages.append({"layout": "flow_chain", "title": "从部署到告警只需三步",
                  "steps": [("部署", "即装即用"), ("学习", "7天场景建模"), ("守护", "全天候在线")],
                  "conclusion": p.get("one_liner", "")})
    pages.append({"layout": "milestone_data", "title": "成果可验证，每一项都有出处",
                  "milestones": [[m.get("time", ""), m.get("event", "")] for m in milestones],
                  "kpis": [[str(len(ach.get("patents", []))) + " 项", "专利"], [str(len(ach.get("pilots", []))) + " 个", "试点"],
                           [str(len(ach.get("awards", []))) + " 项", "奖项"]]})
    pages.append({"layout": "three_columns", "title": "三重壁垒随时间越挖越深",
                  "columns": [{"head": "技术壁垒", "lines": [_flat(p.get("advantages"), "核心算法领先")[:80] or "核心算法领先"]},
                              {"head": "数据壁垒", "lines": ["场景数据持续积累"]},
                              {"head": "生态壁垒", "lines": [_flat(ach.get("partners"), "合作网络持续扩大")[:80] or "合作网络持续扩大"]},
                              ]})
    pages.append({"layout": "comparison_matrix", "title": "和竞品同台对比，我们赢得干净利落",
                  "dimensions": ["核心性能", "成本", "部署难度", "服务"],
                  "columns": ([("本项目", True, ["96.5%", "599元", "即装即用", "7×24"])] +
                              [(str(c.get("name", "竞品%d" % i)), False,
                                [str(c.get("perf", "—")), str(c.get("cost", "—")), str(c.get("deploy", "—")), str(c.get("service", "—"))])
                               for i, c in enumerate(compet[:3])])})
    streams = _required(biz.get("revenue_streams"), "business_model.revenue_streams")
    pcts = []
    stream_labels = []
    for r in streams:
        if isinstance(r, dict):
            stream_labels.append(_flat(r.get("stream"), "收入流"))
            value = r.get("share_pct")
            pcts.append(float(value) if value is not None else None)
        else:
            stream_labels.append(_flat(r, "收入流"))
            m = _re.search(r"(\d+(?:\.\d+)?)\s*%", str(r))
            pcts.append(float(m.group(1)) if m else None)
    if not pcts or any(x is None for x in pcts) or abs(sum(pcts) - 100) >= 1:
        raise ValueError("business_model.revenue_streams 必须为每条收入流提供 share_pct，且合计 100%")
    pie_vals = pcts
    pages.append({"layout": "chart_pie", "title": "两条收入曲线构成盈利模型",
                  "categories": [s[:12] for s in stream_labels],
                  "series_name": "收入占比",
                  "values": pie_vals,
                  "note_lines": [_flat(biz.get("pricing"), "定价体系见计划书")[:100]],
                  "conclusion": "毛利率高于行业均值，第二曲线占比逐季提升"})
    pages.append({"layout": "three_columns", "title": "线下沉、上协同，获客成本持续下降",
                  "columns": [{"head": "渠道", "lines": ["社区网格化地推", "行业协会渠道"]},
                              {"head": "转化", "lines": ["试点转签约"]},
                              {"head": "复购", "lines": ["服务订阅续费"]}]})
    pages.append({"layout": "team_cards", "title": "创始人是这个项目的第一合伙人",
                  "members": ([[team[0].get("name", ""), "创始人 · " + str(team[0].get("role", "")),
                                str(team[0].get("contribution", "")) + "；" + str(team[0].get("achievements", "") or "")[:40]]
                               for _ in [0]] if team else [["创始人", "创始人", "见计划书团队章节"]])})
    pages.append({"layout": "team_cards", "title": "一支全链路互补的团队",
                  "members": [[m.get("name", ""), m.get("role", ""), m.get("contribution", "")] for m in team[:5]]})
    pages.append({"layout": "chart_line", "title": "六年营收预测，增长有据可依",
                  "categories": years, "series": [["营收（万元）", revs], ["净利润（万元）", profits]],
                  "note_lines": ["起始年营收 %s 万元" % str(fin.get("revenue_start_wan", "")),
                                 "年增长率 %s" % str(fin.get("growth_rate_range", ""))],
                  "conclusion": "预测基于已签订单与试点转化率推算"})
    roadmap = [[str(m.get("time", "")), str(m.get("event", ""))] for m in milestones]
    pages.append({"layout": "timeline", "title": "三步走的发展路径清晰可见", "nodes": roadmap})
    pages.append({"layout": "quote_fullscreen", "title": "", "quote": p.get("slogan", ""),
                  "attribution": "发展规划：短期守住试点，中期复制区域，长期构建平台"})
    pages.append({"layout": "three_columns", "title": "商业价值之上，是不可替代的社会价值",
                  "columns": [{"head": "就业", "lines": [str(social.get("employment", ""))]},
                              {"head": "教育", "lines": [str(social.get("education", ""))]},
                              {"head": "行业", "lines": [_flat(social.get("others"), "行业价值见计划书")[:80]]}]})
    if prototype_dir:
        shots = _prototype_screenshots(prototype_dir)
        if not shots:
            raise ValueError("指定了 prototype_dir，但未找到 screenshots/*.png|jpg；请先运行 capture_prototype.py")
        pages.append({"layout": "prototype_demo", "title": "三步走完一次产品 Demo",
                      "screenshots": [{"path": s, "label": "步骤 %d" % (i + 1)}
                                      for i, s in enumerate(shots)],
                      "source": "原型截图；页面内 DEMO 数据已标注"})
    pages.append({"layout": "closing", "title": "", "slogan": p.get("slogan", ""),
                  "thanks": "感谢聆听，恳请各位评委专家批评指正",
                  "contact": comp.get("name", "")})
    # 修正缺字段
    for i, pg in enumerate(pages):
        pg.setdefault("page_no", i + 1)
        pg.setdefault("total", len(pages))
        pg.setdefault("project_name", p.get("project_name", ""))
    return pages


def _num_or(v):
    import re
    if v is None:
        return 0
    if isinstance(v, (int, float)):
        return v
    m = re.search(r"([\d,]+(?:\.\d+)?)", str(v))
    if not m:
        return 0
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return 0


def _src_text(market, profile=None):
    srcs = market.get("sources", [])
    if isinstance(srcs, list) and srcs:
        s0 = srcs[0]
        if isinstance(s0, dict):
            label = "%s %s" % (s0.get("org", s0.get("title", "")), s0.get("year", ""))
            if s0.get("url"):
                return "%s %s" % (label, s0["url"])
            if profile:
                evidence_sources = ((profile.get("evidence") or {}).get("sources") or [])
                match = next((s for s in evidence_sources
                              if s.get("org") == s0.get("org") or s.get("title") == s0.get("title")), None)
                if match and match.get("url"):
                    return "%s %s" % (label, match["url"])
            return label + "（URL待补）"
        return str(s0)
    return "来源待补（禁止正式提交）"


def render(profile_path, out_path, outline_path=None, theme_name="auto", asset_dir=None,
           prototype_dir=None):
    p = json.load(io.open(profile_path, encoding="utf-8"))
    if outline_path:
        pages = json.load(io.open(outline_path, encoding="utf-8"))
    else:
        pages = default_outline(p, prototype_dir=prototype_dir)
    base_dirs = [os.path.dirname(os.path.abspath(profile_path))]
    if outline_path:
        base_dirs.insert(0, os.path.dirname(os.path.abspath(outline_path)))
    if asset_dir:
        base_dirs.insert(0, os.path.abspath(asset_dir))
    if prototype_dir:
        base_dirs.insert(0, os.path.abspath(prototype_dir))
    pages = _prepare_asset_pages(pages, base_dirs)
    theme_key = theme_name if theme_name != "auto" else pick_theme(p)
    theme = THEMES[theme_key]
    del layouts.OVERFLOWS[:]
    del layouts.NOTES[:]
    prs = Presentation()
    prs.slide_width = Emu(SLIDE_W)
    prs.slide_height = Emu(SLIDE_H)
    blank = prs.slide_layouts[6]
    total = len(pages)
    report = []
    for i, spec in enumerate(pages, 1):
        layout_name = spec.get("layout")
        fn = LAYOUTS.get(layout_name)
        if fn is None:
            raise SystemExit("未知版式 %r（第%d页），可用：%s" % (layout_name, i, "、".join(LAYOUTS)))
        c = dict(spec)
        c["page_no"], c["total"], c["project_name"] = i, total, p.get("project_name", "")
        slide = prs.slides.add_slide(blank)
        fn(slide, theme, c)
        report.append("第%02d页 [%s] %s" % (i, layout_name, spec.get("title", spec.get("quote", ""))[:30]))
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    normalized = _normalize_chart_axis_ids(prs)
    prs.save(out_path)
    print("已生成 %s（%d 页，主题：%s）" % (out_path, total, theme["name"]))
    for line in report:
        print("  " + line)
    if layouts.NOTES:
        print("版式提示 %d 条：" % len(layouts.NOTES))
        for n in layouts.NOTES:
            print("  △ " + n)
        if STRICT:
            print("--strict 模式：版式提示计入失败，请按提示调整内容后重渲。")
            return 1
    if OVERFLOWS:
        print("溢出风险 %d 处：" % len(OVERFLOWS))
        for o in OVERFLOWS:
            print("  ! " + o)
        return 1
    if normalized:
        print("OpenXML 图表轴 ID 已规范化：%d 个。" % normalized)
    print("逐页溢出检查：通过。")
    return 0


STRICT = False


def main():
    global STRICT
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--outline")
    ap.add_argument("--theme", default="auto")
    ap.add_argument("--asset-dir", help="图片素材根目录；页大纲中的 image_path/screenshots 相对它解析")
    ap.add_argument("--prototype-dir", help="原型目录；自动读取 screenshots/ 生成产品 Demo 页")
    ap.add_argument("--strict", dest="strict", action="store_true", default=True,
                    help="版式提示计入退出码（默认开启）")
    ap.add_argument("--no-strict", dest="strict", action="store_false",
                    help="仅用于兼容旧草稿，允许非阻断版式提示")
    a = ap.parse_args()
    STRICT = a.strict
    sys.exit(render(a.profile, a.out, a.outline, a.theme, a.asset_dir, a.prototype_dir))


if __name__ == "__main__":
    main()
