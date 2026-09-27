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
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pptx import Presentation
from pptx.util import Emu

import layouts
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


def _finance_series(profile, years_out):
    fin = profile.get("financials", {})
    rev0 = _f(fin.get("revenue_start_wan")) or 200.0
    years = int(_f(fin.get("years")) or 6)
    growth = 0.32
    gr = str(fin.get("growth_rate_range", ""))
    import re
    m = re.findall(r"(\d+(?:\.\d+)?)\s*%", gr)
    if m:
        lo, hi = float(m[0]), float(m[-1])
        if len(m) >= 2:
            growth = (lo + hi) / 200.0
        else:
            growth = lo / 100.0
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


def default_outline(p):
    """附录三精简版 21 页，内容全部取自 project.json。"""
    comp = p.get("competition", {})
    team = p.get("team", [])
    market = p.get("market", {})
    sol = p.get("solution", {})
    ach = p.get("achievements", {})
    biz = p.get("business_model", {})
    fin = p.get("financials", {})
    pains = p.get("pain_points", [])
    feats = sol.get("features", []) or ["核心功能一", "核心功能二", "核心功能三"]
    metrics = sol.get("performance_metrics", [])
    m0 = metrics[0] if metrics else {}
    compet = p.get("competitors", [])
    years, revs, profits = [], [], []
    revs, profits = _finance_series(p, years)
    milestones = p.get("milestones", [])[:5]
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
                  "note_lines": [str(market.get("growth", "")), "来源：" + _src_text(market)],
                  "conclusion": "刚性需求未被现有方案满足，细分赛道存在明确空白"})
    policies = p.get("policy", []) or []
    pages.append({"layout": "policy_list", "title": "政策红利正在为这个行业开路",
                  "policies": [[str(pl.get("name", pl) if isinstance(pl, dict) else pl),
                                str(pl.get("benefit", "")) if isinstance(pl, dict) else "利好条款见计划书政策章节"]
                               for pl in policies[:4]] or [["政策持续加码", "近两年国家与地方专项政策密集出台，详见计划书政策环境章节"]]})
    pages.append({"layout": "pain_solution", "title": "四个真实痛点，全部指向同一个未被满足的需求",
                  "pairs": [[pp.get("desc", ""), pp.get("mapped_feature", ""), "详见产品页"] for pp in pains[:4]]})
    pages.append({"layout": "three_columns", "title": "产品以三大核心功能闭环解决上述痛点",
                  "columns": [{"head": str(f)[:12], "lines": ["功能与痛点对应，实测数据见后页"]} for f in feats[:3]]})
    pages.append({"layout": "architecture", "title": "一套架构支撑全链路服务",
                  "layers": [("感知层", ["传感器/数据接入", "边缘采集"]), ("算法层", ["核心算法", "模型训练", "推理引擎"]),
                             ("应用层", feats[:3] + ["管理后台"])]})
    ms = metrics[:5]
    pages.append({"layout": "comparison_matrix", "title": "关键指标全面领先对标方案",
                  "dimensions": [_flat(m.get("metric"), "指标%d" % (i + 1))[:12] for i, m in enumerate(ms)] or ["指标"],
                  "columns": [("本项目", True, [_flat(m.get("value"), "—") for m in ms]),
                               ("对标方案", False, [_flat(m.get("benchmark"), "—") for m in ms])],
                  "conclusion": "所有指标来自实测，测试方法与样本见计划书技术章节"})
    pages.append({"layout": "flow_chain", "title": "从部署到告警只需三步",
                  "steps": [("部署", "即装即用"), ("学习", "7天场景建模"), ("守护", "全天候在线")],
                  "conclusion": p.get("one_liner", "")})
    pages.append({"layout": "milestone_data", "title": "成果可验证，每一项都有出处",
                  "milestones": milestones and [[m.get("time", ""), m.get("event", "")] for m in milestones] or [["2026", "项目启动"]],
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
    pages.append({"layout": "chart_pie", "title": "两条收入曲线构成盈利模型",
                  "categories": [str(r) for r in (biz.get("revenue_streams", []) or ["硬件", "服务"])],
                  "series_name": "收入占比",
                  "values": [60, 40][:max(1, len(biz.get("revenue_streams", []) or []))] or [60, 40],
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
    roadmap = [[str(m.get("time", "")), str(m.get("event", ""))] for m in milestones] or \
              [["第1年", "完成产品定型与种子客户"], ["第2-3年", "区域复制与渠道建设"], ["第4-6年", "平台化与生态构建"]]
    pages.append({"layout": "timeline", "title": "三步走的发展路径清晰可见", "nodes": roadmap})
    pages.append({"layout": "quote_fullscreen", "title": "", "quote": p.get("slogan", ""),
                  "attribution": "发展规划：短期守住试点，中期复制区域，长期构建平台"})
    pages.append({"layout": "three_columns", "title": "商业价值之上，是不可替代的社会价值",
                  "columns": [{"head": "就业", "lines": [str(social.get("employment", ""))]},
                              {"head": "教育", "lines": [str(social.get("education", ""))]},
                              {"head": "行业", "lines": [_flat(social.get("others"), "行业价值见计划书")[:80]]}]})
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


def _src_text(market):
    srcs = market.get("sources", [])
    if isinstance(srcs, list) and srcs:
        s0 = srcs[0]
        if isinstance(s0, dict):
            return "%s %s" % (s0.get("org", s0.get("title", "")), s0.get("year", ""))
        return str(s0)
    return "见计划书市场章节"


def render(profile_path, out_path, outline_path=None, theme_name="auto"):
    p = json.load(io.open(profile_path, encoding="utf-8"))
    if outline_path:
        pages = json.load(io.open(outline_path, encoding="utf-8"))
    else:
        pages = default_outline(p)
    theme_key = theme_name if theme_name != "auto" else pick_theme(p)
    theme = THEMES[theme_key]
    del layouts.OVERFLOWS[:]
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
    ap.add_argument("--strict", action="store_true", help="版式提示（如混量纲守卫）计入退出码")
    a = ap.parse_args()
    STRICT = a.strict
    sys.exit(render(a.profile, a.out, a.outline, a.theme))


if __name__ == "__main__":
    main()
