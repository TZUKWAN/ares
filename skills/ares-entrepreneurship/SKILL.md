---
name: ares-entrepreneurship
description: Ares 竞赛插件 L1 创业竞赛生产线。中国国际大学生创新大赛、挑战杯创业计划、电商三创、iCAN、创青春、服务外包、学创杯等创业类赛事全套材料生产。触发词：创业类赛事、商业计划书、路演、BP。
---

# ares-entrepreneurship L1 创业竞赛线

## 一、触发条件与输入

总控路由判定赛事 pipeline 为 L1 时调用。输入：project.json、赛事 rubrics/NNN.json、tracks.json 该赛事条目。

## 二、执行步骤

1. 调研先行：市场/政策/竞品检索结论回填 project.json（market/policy/competitors 字段），来源与年份入档。
2. 商业计划书：按 `references/bp-outline.md` 章节引擎逐节生成（节节有内容要求、写作纪律引用、数据字段映射、字数区间），排版走 ares-docx。
3. 财务三表：运行 `python <插件目录>/scripts/build_financials.py --profile project.json --out 输出/项目名/02-财务三表.xlsx`，参数从档案读取，勾稽校验须 PASS。
4. 原型：按 ares-prototype 产出多页 HTML 系统，功能页与计划书 3.x 节、痛点 Pn 一一对应。
5. PPT：按 ares-ppt 生成（默认 21 页，按 rubric 权重与路演时长裁剪）。
6. 讲稿：与 PPT 逐页对应，8 分钟版约 2000 字、5 分钟版约 1300 字，口语化但不失专业度，每页标注切换时机【切换到第N页】。
7. QA 预案：按 rubric 高权重维度倒推提问，覆盖技术可行性、数据真实性、竞品、财务、团队五类，≥30 问，每问配应答要点。
8. 评审与收尾：ares-judge 两道质检 → 修复高优先级扣分点 → 交付清单 + 数据真实性清单。

## 三、默认产出物清单（11 项，目录结构见 tracks.json）

01-商业计划书.docx ｜ 02-财务三表.xlsx ｜ 03-路演PPT.pptx ｜ 04-项目原型/ ｜ 05-源代码/ ｜ 06-演示数据/ ｜ 07-路演讲稿-8分钟.docx ｜ 07-路演讲稿-5分钟.docx ｜ 08-答辩QA预案.docx ｜ 09-一分钟VCR脚本.docx（可选）｜ 10-评审报告.md ｜ 11-数据真实性清单.md

## 四、输入输出契约

- 输入：project.json（数字唯一来源）、rubric 权重。
- 输出：上列 11 项到 `输出/项目名/`；每项完成后向总控回传路径清单。
- 数据回填：调研结论与新数字先写 project.json 再进文档。

## 五、质量自检清单

- [ ] 计划书章节与 references/bp-outline.md 完全一致
- [ ] 三表勾稽校验 PASS；PPT 数字与计划书一致（一致性扫描零矛盾）
- [ ] 原型功能页与计划书功能点一一对应（页脚可追溯）
- [ ] 讲稿与 PPT 页数对应、切换时机标注完整、字数达标
- [ ] QA 预案 ≥30 问且五类覆盖
- [ ] 全部文本通过写作纪律机扫
- [ ] DEMO 数据全部标注；数据真实性清单三类齐全

## 六、协作接口

调用：ares-writing-style（强制）、ares-docx、ares-ppt、ares-prototype、ares-data、ares-judge、scripts/build_financials.py。被 /ares-start、/ares-bp、/ares-ppt、/ares-prototype、/ares-review、/ares-sync 调用。

## 七、财务参数规则（摘要，全文见 references/financial-params.md）

起始年营收默认 185-255 万元；年增长率默认 25%-40% 逐年合理上浮；利润率取行业均值×1.13-1.4；融资默认 400 万元出让 10%-25%；全部可按用户真实数据调整，调整后同步重渲染受影响产出物。
