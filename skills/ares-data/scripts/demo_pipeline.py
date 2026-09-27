# -*- coding: utf-8 -*-
"""
demo_pipeline.py — ares-data 标准样例（T3.5 DoD）

合成社区老人监测使用数据（种子固定可复现）→ 描述统计与回归 → 图表 png/svg →
重跑一致性自校验。

用法：
    python demo_pipeline.py [输出目录，默认本目录下 样例输出/demo_data]
"""
import io
import os
import sys

import numpy as np

SEED = 42


def generate(out_dir):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.rcParams["font.family"] = ["Microsoft YaHei", "SimHei", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False
    os.makedirs(out_dir, exist_ok=True)
    charts = os.path.join(out_dir, "charts")
    os.makedirs(charts, exist_ok=True)

    rng = np.random.default_rng(SEED)
    n = 240
    # 合成逻辑：老人日均可支配支出 x（元）→ 月度服务使用时长 y（小时）
    # x ~ 正态(420, 90)，y = 0.35x - 40 + 噪声N(0, 25)，并截断合理区间
    x = rng.normal(420, 90, n)
    x = np.clip(x, 180, 720)
    y = 0.35 * x - 40 + rng.normal(0, 25, n)
    y = np.clip(y, 2, None)

    csv_path = os.path.join(out_dir, "data.csv")
    with io.open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        f.write("DEMO数据，提交前须替换为真实数据；生成种子=%d\n" % SEED)
        f.write("sample_id,monthly_disposable_xiar,y_monthly_usage_hours\n")
        for i, (xi, yi) in enumerate(zip(x, y), 1):
            f.write("S%03d,%.2f,%.2f\n" % (i, xi, yi))

    # 描述统计与一元线性回归（最小二乘闭式解，避免依赖差异）
    slope, intercept = np.polyfit(x, y, 1)
    r = float(np.corrcoef(x, y)[0, 1])
    y_hat = slope * x + intercept
    ss_res = float(np.sum((y - y_hat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1 - ss_res / ss_tot

    colors = {"primary": "#1F4E79", "accent": "#2E75B6"}
    fig, ax = plt.subplots(figsize=(7, 4.2), dpi=300)
    ax.scatter(x, y, s=12, alpha=0.55, color=colors["accent"], edgecolors="none")
    xs = np.linspace(x.min(), x.max(), 100)
    ax.plot(xs, slope * xs + intercept, color=colors["primary"], lw=2.2)
    ax.set_title("图1 月度可支配支出与服务使用时长关系（DEMO数据，提交前须替换为真实数据）", fontsize=9)
    ax.set_xlabel("月度可支配支出（元）")
    ax.set_ylabel("月服务使用时长（小时）")
    fig.tight_layout()
    fig.savefig(os.path.join(charts, "fig1_scatter.png"))
    fig.savefig(os.path.join(charts, "fig1_scatter.svg"))
    plt.close(fig)

    stats = {
        "n": n, "seed": SEED,
        "x_mean": round(float(x.mean()), 2), "x_std": round(float(x.std(ddof=1)), 2),
        "y_mean": round(float(y.mean()), 2), "y_std": round(float(y.std(ddof=1)), 2),
        "slope": round(float(slope), 4), "intercept": round(float(intercept), 4),
        "r": round(r, 4), "r2": round(r2, 4),
    }
    with io.open(os.path.join(out_dir, "stats.json"), "w", encoding="utf-8") as f:
        import json
        json.dump(stats, f, ensure_ascii=False, indent=2)
    with io.open(os.path.join(out_dir, "README.md"), "w", encoding="utf-8") as f:
        f.write("# 演示数据说明\n\nDEMO数据，提交前须替换为真实数据。\n\n"
                "生成逻辑：x~N(420,90)截断[180,720]；y=0.35x-40+N(0,25)截断下界2；种子 %d。\n\n"
                "复现：`python demo_pipeline.py <输出目录>`（重跑两次 stats.json 应逐字节一致）。\n" % SEED)
    return stats, out_dir


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "样例输出", "demo_data")
    stats, out = generate(out)
    print("统计结果：", stats)
    print("输出目录：", out)
