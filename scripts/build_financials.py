# -*- coding: utf-8 -*-
"""
build_financials.py — Ares 财务三表参数化生成（利润表/现金流量表/资产负债表，默认6年）

用法：
    python build_financials.py --profile <project.json> --out <02-财务三表.xlsx>
        [--revenue-start 200] [--growth-lo 25] [--growth-hi 40]
        [--industry-margin 12] [--margin-mult 1.2]
        [--funding 400] [--equity-stake 15]

参数默认值取自 project.json 的 financials 字段，命令行覆盖：
    revenue_start_wan 185-255 区间（默认200）；growth_rate_range "25%-40%" 逐年上浮；
    margin_ratio_vs_industry 行业均值×1.13-1.4（行业均值默认12%，倍数默认1.2）；
    融资默认 400 万元出让 10%-25%（默认15%）。

勾稽关系由构造恒等式保证：利润表净利 → 现金流 → 资产负债表借贷平衡，
生成后逐年末复算 |资产-负债-权益| 并写入《勾稽校验》页；任一年超 0.05 万元退出码 1。
所有数值单位：万元。
"""
import argparse
import io
import json
import os
import re
import sys

DEMO_NOTE = "DEMO数据，提交前须替换为真实经营数据"


def parse_args():
    ap = argparse.ArgumentParser()
    ap.add_argument("--profile", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--revenue-start", type=float)
    ap.add_argument("--growth-lo", type=float)
    ap.add_argument("--growth-hi", type=float)
    ap.add_argument("--industry-margin", type=float)
    ap.add_argument("--margin-mult", type=float)
    ap.add_argument("--funding", type=float)
    ap.add_argument("--equity-stake", type=float)
    ap.add_argument("--years", type=int)
    a = ap.parse_args()

    fin = {}
    try:
        prof = json.load(io.open(a.profile, encoding="utf-8"))
        fin = prof.get("financials", {}) or {}
    except (ValueError, OSError):
        pass
    a.revenue_start = a.revenue_start if a.revenue_start is not None else float(fin.get("revenue_start_wan") or 200)
    gr = str(fin.get("growth_rate_range") or "25%-40%")
    nums = [float(x) for x in re.findall(r"(\d+(?:\.\d+)?)", gr)]
    a.growth_lo = a.growth_lo if a.growth_lo is not None else (nums[0] if nums else 25.0)
    a.growth_hi = a.growth_hi if a.growth_hi is not None else (nums[-1] if len(nums) > 1 else (nums[0] if nums else 40.0))
    mm = re.search(r"(\d+(?:\.\d+)?)", str(fin.get("margin_ratio_vs_industry") or "1.2"))
    a.margin_mult = a.margin_mult if a.margin_mult is not None else float(mm.group(1))
    a.industry_margin = a.industry_margin if a.industry_margin is not None else 12.0
    # 融资方案同样从档案读取（funding_wan/equity_stake_pct，兼容别名），命令行可覆盖
    a.funding = a.funding if a.funding is not None else float(
        fin.get("funding_wan") or fin.get("funding") or 400.0)
    a.equity_stake = a.equity_stake if a.equity_stake is not None else float(
        fin.get("equity_stake_pct") or fin.get("equity_stake") or 15.0)
    a.years = a.years if a.years is not None else int(fin.get("years") or 6)
    return a


def build(args):
    n = args.years
    gross_margin = 0.45
    opex_ratio = 0.38           # 三费合计占收入比（研发+销售+管理）
    da_ratio = 0.05             # 折旧摊销占上年固定资产净值
    ar_ratio, inv_ratio, ap_ratio = 0.15, 0.08, 0.12
    capex_ratio = [0.15, 0.10, 0.08, 0.06, 0.05, 0.05]
    tax = 0.25
    margin_ramp_start = 0.6     # 首年净利润率达目标值的60%，逐年爬坡至100%

    target_margin = args.industry_margin / 100.0 * args.margin_mult
    revs, growths = [], []
    rev = args.revenue_start
    for i in range(n):
        revs.append(rev)
        g = (args.growth_lo + (args.growth_hi - args.growth_lo) * (i / max(1, n - 1))) / 100.0
        growths.append(g)
        rev *= (1 + g)

    is_rows, cf_rows, bs_rows = [], [], []
    cash_prev, fixed_prev, equity_prev, retain_prev, ar_prev, inv_prev, ap_prev = 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0
    balance_errors = []
    for i in range(n):
        revenue = revs[i]
        ramp = margin_ramp_start + (1 - margin_ramp_start) * (i / max(1, n - 1))
        cogs = revenue * (1 - gross_margin)
        opex = revenue * opex_ratio
        ebit = revenue - cogs - opex
        target_ni = revenue * target_margin * ramp
        # 其他收支（政府补助等，透明列出）把净利拉到 目标净利率×爬坡系数 的水平
        other = target_ni - ebit * (1 - tax)
        other = max(other, -ebit * 0.5) if ebit > 0 else other
        ni = ebit * (1 - tax) + other

        capex = revenue * capex_ratio[min(i, len(capex_ratio) - 1)]
        da = fixed_prev * da_ratio if i > 0 else revenue * 0.02
        ar = revenue * ar_ratio
        inv = cogs * inv_ratio
        ap = (cogs + opex) * ap_ratio
        d_wc = (ar - ar_prev) + (inv - inv_prev) - (ap - ap_prev)
        funding = args.funding if i == 0 else 0.0
        ocf = ni + da - d_wc
        icf = -capex
        fcf = funding
        cash_end = cash_prev + ocf + icf + fcf
        fixed_net = fixed_prev + capex - da
        retain = retain_prev + ni
        equity = equity_prev + ni + funding
        assets = cash_end + ar + inv + fixed_net
        liab_eq = ap + equity
        diff = assets - liab_eq
        if abs(diff) > 0.05:
            balance_errors.append((i + 1, diff))

        is_rows.append(["第%d年" % (i + 1), round(revenue, 2), round(cogs, 2), round(revenue * gross_margin, 2),
                        round(opex, 2), round(ebit, 2), round(other, 2), round(ni, 2),
                        round(ni / revenue * 100, 2)])
        cf_rows.append(["第%d年" % (i + 1), round(ni, 2), round(da, 2), round(-d_wc, 2), round(ocf, 2),
                        round(icf, 2), round(fcf, 2), round(cash_prev, 2), round(cash_end, 2)])
        bs_rows.append(["第%d年" % (i + 1), round(cash_end, 2), round(ar, 2), round(inv, 2), round(fixed_net, 2),
                        round(assets, 2), round(ap, 2), round(equity, 2), round(retain, 2),
                        round(assets - liab_eq, 4)])
        cash_prev, fixed_prev, equity_prev = cash_end, fixed_net, equity
        retain_prev, ar_prev, inv_prev, ap_prev = retain, ar, inv, ap

    params = [["起始年营收（万元）", args.revenue_start],
              ["年增长率区间", "%.1f%% - %.1f%%（逐年上浮）" % (args.growth_lo, args.growth_hi)],
              ["行业平均净利率", "%.1f%%" % args.industry_margin],
              ["利润率倍数（行业均值×）", args.margin_mult],
              ["目标净利率", "%.2f%%" % (target_margin * 100)],
              ["融资金额（万元）", args.funding],
              ["出让股权（%）", args.equity_stake],
              ["投前估值（万元）", round(args.funding / (args.equity_stake / 100.0) - args.funding, 1)],
              ["预测年数", n],
              ["口径说明", DEMO_NOTE + "；成本结构：毛利率45%、三费38%、调节项为政府补助等收支"]]
    return params, is_rows, cf_rows, bs_rows, balance_errors


HEADERS = {
    "利润表": ["期间", "营业收入", "营业成本", "毛利润", "三费合计", "营业利润", "其他收支(净)", "净利润", "净利率%"],
    "现金流量表": ["期间", "净利润", "折旧摊销", "营运资本变动", "经营现金流", "投资现金流", "筹资现金流", "期初现金", "期末现金"],
    "资产负债表": ["期间", "货币资金", "应收账款", "存货", "固定资产净值", "资产总计", "应付账款", "所有者权益", "其中留存收益", "平衡差"],
    "勾稽校验": ["检查项", "结果", "说明"],
}


def write_xlsx(out_path, params, is_rows, cf_rows, bs_rows, balance_errors):
    import openpyxl
    from openpyxl.styles import Font, PatternFill
    wb = openpyxl.Workbook()
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="1F4E79")
    note_font = Font(italic=True, color="C0392B")

    ws = wb.active
    ws.title = "参数与融资"
    for row in params:
        ws.append(row)
    ws.append([])
    ws.append([DEMO_NOTE])
    ws.cell(row=ws.max_row, column=1).font = note_font

    checks = [
        ["利润表→现金流量表", "PASS" if not balance_errors else "FAIL", "净利润+折旧-营运资本变动=经营现金流，逐年推导"],
        ["现金流量表→资产负债表", "PASS" if not balance_errors else "FAIL", "期末现金=资产负债表货币资金；留存收益=累计净利润"],
        ["借贷平衡", "PASS" if not balance_errors else "FAIL",
         "各年末 |资产-(负债+权益)| ≤ 0.05 万元，最大偏差 %s" % (max((abs(d) for _y, d in balance_errors), default=0.0))],
    ]
    for title, rows in (("利润表", is_rows), ("现金流量表", cf_rows), ("资产负债表", bs_rows)):
        ws = wb.create_sheet(title)
        ws.append([DEMO_NOTE])
        ws.cell(row=1, column=1).font = note_font
        ws.append(HEADERS[title])
        for c in ws[2]:
            c.font = head_font
            c.fill = head_fill
        for r in rows:
            ws.append(r)
    ws = wb.create_sheet("勾稽校验")
    ws.append(HEADERS["勾稽校验"])
    for c in ws[1]:
        c.font = head_font
        c.fill = head_fill
    for r in checks:
        ws.append(r)
    os.makedirs(os.path.dirname(os.path.abspath(out_path)) or ".", exist_ok=True)
    wb.save(out_path)
    return checks


def main():
    args = parse_args()
    params, is_rows, cf_rows, bs_rows, balance_errors = build(args)
    checks = write_xlsx(args.out, params, is_rows, cf_rows, bs_rows, balance_errors)
    print("已生成 %s（%d 年预测，单位万元）" % (args.out, args.years))
    for p in params:
        print("  %s: %s" % (p[0], p[1]))
    print("各年净利润：", [r[7] for r in is_rows])
    ok = not balance_errors
    for c in checks:
        print("  [%s] %s — %s" % (c[1], c[0], c[2]))
    if ok:
        print("勾稽校验全部通过。")
        return 0
    print("勾稽校验失败：", balance_errors)
    return 1


if __name__ == "__main__":
    sys.exit(main())
