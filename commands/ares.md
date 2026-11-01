# /Ares 竞赛交付总入口

## 用途

从一段自然语言需求开始，按赛事匹配 → 评分标准 → Project Profile → 证据台账 → 生产计划 → Word/PPT/Demo → 评审与复测的顺序执行。`/Ares` 是 `/ares-start` 的稳定别名；用户也可以在没有命令支持的平台直接说“用 Ares 帮我准备……”。

## 低上下文模型执行协议

每次只执行一个阶段，阶段结束后把结果写入工作目录的 `ares-run.json`，再进入下一阶段。不要把所有赛事档案、rubric 和产出物全文塞入上下文。

0. `doctor`：先运行 `scripts/doctor.py --out ares-runtime.json`，记录必需/可选能力；缺失的可选能力必须进入交付风险，不得假装完成。
1. `match`：运行 `scripts/match_competition.py --request "用户原话"`，输出最多 3 个候选和选择理由。
2. `profile`：创建/更新 `project.json`；已有旧档案先运行 `scripts/migrate_profile.py --profile project.json --out 迁移报告.json`，再运行 `validate_profile.py` 与 `validate_evidence.py`；正式申报前追加 `validate_evidence.py --strict`。
3. `plan`：运行 `scripts/build_scorecard.py`，生成评分点覆盖矩阵、交付物清单和缺口。
4. `research`：对用户提供的 Word/PPT/PDF/XLSX/文本资料先运行 `scripts/ingest_material.py` 生成可追溯 Markdown 和 SHA256，再逐条补充 claim、来源原文/证据文件和真实性状态；正式模式不允许用 placeholder 冒充 real。
5. `produce`：按生产线生成 Word、Excel、PPT、原型/Demo、代码和讲稿；每个产物写回 manifest。
6. `review`：运行一致性、写作、原型、Word、PPT 和独立渲染门禁；失败只修当前阶段并复测。
7. `deliver`：运行 `scripts/final_gate.py` 统一执行档案、严格证据、评分覆盖、一致性和视觉门禁；若有缺口，先运行 `scripts/build_evidence_request.py` 生成补交清单。只有所有关键评分点覆盖、证据可追溯、占位项已处理、渲染通过后，才生成正式交付清单。

状态操作：

```text
python ares/scripts/run_state.py init --project-dir <项目目录> --request "<用户需求>"
python ares/scripts/run_state.py status --project-dir <项目目录>
python ares/scripts/run_state.py advance --project-dir <项目目录> --stage <阶段> --status done --evidence <路径>
```

需要验收入口稳定性时，使用 `scripts/smoke_low_context.py` 串行检查状态、赛事匹配、环境能力和已有档案门禁；该 smoke 不生成虚假模型结果。

模型每轮只需读取 `ares-run.json` 的 `current_stage`、`next_action`、`blocking_items` 和最近一条证据，就能继续工作。出现工具失败时，保留失败记录并从当前阶段重试，不重做已经通过的阶段。

状态机拒绝越级推进，也拒绝没有 evidence 的 `done` 状态；这两个错误必须先补当前阶段证据再重试。

## 触发示例

- `/Ares 我要参加中国国际大学生创新大赛，项目是毫米波雷达跌倒监测，帮我从建档做到 PPT、原型和答辩。`
- `/Ares 我准备数学建模国赛 A 题，先给我匹配赛事和建立可复现的建模生产计划。`
- `/Ares 我想参加市场调查与分析大赛，已有问卷和数据，先做证据审计。`
