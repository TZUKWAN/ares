# 规则档案与项目原文

`data/rubrics/001.json` 至 `132.json` 保存历次整理的参考资料，不是当前届次的官方规则数据库。2026-11-18 的完整清点覆盖 11,160 个文本字段和 613 条候选来源。旧档案中 101 份包含推断，67 份含二手来源线索，19 份同时带有旧 high 标签与推断文字。这些计数已由本地原始文件复核。

本轮没有把候选 URL、历史访问日期或“官方原文”的旧字段名当作核验证据。所有尚未逐条定位的内容明确为 `unverified`；备赛建议明确为 `advice`。旧置信度保存在 `provenance.legacyConfidence`，原始规则文字保留。当前 132 份均有未核验内容，不能作为整份已确认的当届官方标准。

## 字段依据

每个字段以 JSON Pointer 和内容 SHA256 固定版本。`provenance` 包含：

- `scope`：赛事、届次、赛道及组别。空值表示未知，不能解释为所有届次通用。
- `sourceChecks`：候选来源 URL 的哈希、页面定位类型和核验状态。首页、搜索页和存档入口本身不证明具体条款。
- `fields`：字段哈希、来源类别、核验状态和明确的来源 ID。空 `sourceIds` 表示尚未找到逐条依据，不会把所有候选来源自动绑定为支持证据。
- 已核验条款必须有原文快照、SHA256、实际摘录、条款位置、核验日期和核验人；快照必须在 `data/rule-sources/`，不能穿越目录或链接。

类别为官方规则原文、官方补充、依据材料的解释、建议、未核验五种。来源 authority=A/B/C 是旧资料的自述，不是核验结果。官方数值权重还必须对应具体范围；未核验、跨范围或内容变化时不参与官方计分。现有评分矩阵仍是证据覆盖检查，不输出官方分数。

## 项目检查

实际项目应登记本次原文，逐项由负责人核对。`verifyProject` 返回 `ruleEvidence`，显示档案的真实来源状态；它不会把登记原文等同于官方认可。原文 SHA 变化，或项目届次、赛道、组别变化，会使对应规则确认失效。历史档案的不确定性不能靠更改状态字段消除。

具体届次的规则需要独立核查，例如[教育部 2026 创新大赛通知](https://www.moe.gov.cn/srcsite/A08/s5672/202607/t20260731_1445670.html)、[数学建模 2026 参赛规则](https://www.mcm.edu.cn/html_cn/node/9d8e511fe7a1447b35f53a82c908e2e0.html)和[数学建模 2026 论文格式规范](https://www.mcm.edu.cn/html_cn/node/4cd596519c9eb9fbd866398f6df0caa3.html)。这些原文入口已在线查看；不能因此认定旧档案里的不同届次、组别及推断权重也已核验。

## 检查命令

```sh
python scripts/validate_rubrics.py
python scripts/audit_rubric_sources.py --report rubric-source-report.json
node --test tests/rubric-evidence.test.mjs tests/rule-checklist.test.mjs
npm run test:quality
```

`audit_rubric_sources.py --initialize-unverified` 仅为缺少元数据的历史条目建立未核验清单，已有元数据不会被重置。校验通过表示结构、状态和证据一致性通过；不表示 132 项赛事的当前规则均已取得官方认证。
