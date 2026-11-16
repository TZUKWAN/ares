# 显式财务参数

没有通用营收、增长率、利润和融资默认值，不用其他收支凑目标利润。
在 facts.financials 或旧 financials 提供：
- years、revenue_start_wan、growth_rates（n-1项比例）。
- gross_margin_ratio、opex_ratio、tax_rate、depreciation_rate、receivable_ratio、inventory_ratio、payable_ratio、interest_rate。
- capex_ratios、funding_by_year（各n项）；零融资也需明确提供零值。
- opening_balance 的 cash、receivables、inventory、fixed_assets、payables、debt、equity，期初必须平衡。
- assumption_sources 逐项说明来源或明确场景假设。

金额为万元、比例为小数。模型保持债务本金不变，新增资本支出下年折旧，不自动确认补贴、借款、亏损结转或递延税。
脚本实际计算三表并报告负现金缺口；预测不代表真实业绩。复杂口径需另建适合项目的测算。
