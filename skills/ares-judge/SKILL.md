---
name: ares-judge
description: Ares 竞赛插件模拟评审与质检技能。交付前质检、模拟评委打分、一致性扫描、"修复全部高优先级扣分点"指令执行时引用。触发词：评审、质检、模拟评委、打分、检查一致性。
---

# ares-judge 模拟评审与质检

两道质检串联执行，全部通过方可交付。

## 一、触发条件

被 ares 总控在交付阶段调用；用户单独要求"评审/质检/打分"时直接调用；生产线技能完成单项产出后的自检复检。

## 二、执行步骤一：证据与一致性扫描（机器，必须全部通过）

先运行档案证据门禁：

```
python <插件目录>/scripts/validate_profile.py <project.json>
python <插件目录>/scripts/validate_evidence.py <project.json>
python <插件目录>/scripts/build_scorecard.py --profile <project.json> --output-dir <输出目录>
python <插件目录>/scripts/audit_visuals.py --docx <Word路径> --pptx <PPT路径> --pipeline <L1-L6/E1-E3> --prototype-dir <原型目录> --strict
python <插件目录>/scripts/build_evidence_request.py --profile <project.json> --scorecard <输出目录>/评分覆盖矩阵.json> --out <输出目录>/证据补交清单.json
python <插件目录>/scripts/final_gate.py --profile <project.json> --output-dir <输出目录> --docx <Word路径> --pptx <PPT路径> --prototype-dir <原型目录> --pipeline <L1-L6/E1-E3>
```

来源/结论台账失败时不得进入正式交付；正式提交前追加 `validate_evidence.py --strict` 与 `build_scorecard.py --strict`。

评分覆盖矩阵存在未绑定 claim、关键 claim 没有可用来源或默认交付物缺失时，正式交付门禁失败；要求第三方检测、查新、合同订单、真实营收或一手调研的评分点还必须有 real/强来源证据。不得用评委主观判断替代缺口记录。视觉审计发现 Word 无真实图片/表格、PPT 缺少必要图片或 Demo 标识时，也必须先修复。

```
python <插件目录>/scripts/consistency_check.py <输出目录> --profile <project.json>
```

扫描 docx/pptx/xlsx/md/html/txt 中团队人数、专利数、试点数、获奖数、性能指标、起始营收、市场规模等关键数字与 project.json 的一致性。退出码 1 时逐条修复（产出物改错则改产出物；档案缺登记则回填档案）后重扫，直至零矛盾。同步执行 ares-writing-style 机扫（文本类交付物 0 违禁）、原型静态扫描与可用时的 `skills/ares-prototype/scripts/smoke_prototype.py` 运行时冒烟、ares-ppt 默认 strict 溢出/混量纲检查，并用 `skills/ares-ppt/scripts/render_ppt.py` 经 PowerPoint 独立打开导出全部页面。

## 三、执行步骤二：模拟评审（按赛事 rubric 打分）

1. 读取 `data/rubrics/{赛事id三位}.json` 的 judging_dimensions（维度+权重+打分点）。
2. 以评委视角逐维度审读全部产出物，按百分制打分，每个扣分点必须给出三要素：
   - 证据位置（哪个文件哪一节/哪一页）
   - 违反的打分点（引用 rubric 原文）
   - 修改建议（可执行）
3. 加权总分 = Σ(维度得分×权重)；输出《10-评审报告.md》，结构如下：

```
# 模拟评审报告
赛事/赛道/评审依据（rubric 文件与 confidence）
## 评分总表
| 维度 | 权重 | 得分 | 加权 | 状态 |
## 扣分点清单
| 编号 | 维度 | 扣分描述 | 证据位置 | 优先级(P0-P2) | 修改建议 |
## 高优先级修复指令（P0 全部、P1 择要）
## 修复后复检结论
```

4. 无 rubric 的赛事：按 tracks.json 生产线默认维度（创新性/完整性/规范性/数据支撑/呈现）打分并在报告注明。

## 四、修复循环

用户指令"修复全部高优先级扣分点"时：取全部 P0 与 P1 扣分点 → 定位证据位置修改对应产出物（遵守各生产线技能与写作纪律）→ 重跑两道质检 → 报告更新"修复后复检结论"。循环至 P0 清零；P2 记录留档不强改。

## 五、输出

《10-评审报告.md》置于输出目录；一致性扫描原始输出随交付归档；交付清单附两道质检结论。

## 六、质量自检清单

- [ ] 档案证据校验、严格证据门禁、评分覆盖矩阵、一致性扫描、写作纪律机扫和视觉覆盖审计均退出码 0；PPT strict 检查与 PowerPoint 独立渲染均通过；原型运行时冒烟已通过或记录环境限制
- [ ] 每个维度都有得分与权重，总分可复算
- [ ] 每个扣分点三要素齐全（证据位置/违反打分点/修改建议）
- [ ] 修复循环后有复检结论，P0 清零
- [ ] 评审立场客观：优点也须点名，不因挑错而否定全篇

## 七、协作接口

- 输入：输出目录 + project.json + 对应 rubric。
- 修复执行需要回调生产线技能（写作修改遵 ares-writing-style，PPT 修改走重渲染，原型修改后重跑 scan_prototype.py）。
- 评分口径严禁虚构：rubric 权重为推断时，报告注明 confidence 与推断依据。
