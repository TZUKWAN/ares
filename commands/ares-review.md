# /ares-review 模拟评审

## 用途

对当前输出目录执行 ares-judge 两道质检：一致性扫描 + 按赛事 rubric 模拟评审打分，产出 10-评审报告.md。支持"修复全部高优先级扣分点"后续指令。

## 需要用户补充的信息

- 输出目录与 project.json 路径（默认当前工作目录与 `输出/项目名/`）。
- 可选：修复指令（「修复全部高优先级扣分点」）、指定评审维度（默认按 rubrics 全维度）。

## 参数说明

- 输入：输出目录 + project.json + rubrics/NNN.json。
- 行为：先运行 `validate_profile.py` 与 `validate_evidence.py --check-url`（数据和来源门禁）→ consistency_check.py（零矛盾）→ check_style.py（文本 0 违禁）→ PPT 严格检查与 PowerPoint 独立渲染（PNG 页数完整）→ 逐维度打分（百分制+权重）→ 评审报告（评分总表/扣分点三要素/修复指令/复检结论）。
- 输出：`输出/项目名/10-评审报告.md`。

## 触发示例

- 「/ares-review 像国赛评委一样审一遍，按评分维度打分」
- 「/ares-review 修复全部高优先级扣分点后复检」
