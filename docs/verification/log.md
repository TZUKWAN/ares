# Ares 插件验收记录

> 执行方式：每任务完成即自查 DoD，每阶段收口跑 `docs/verification/verify.py`，阶段F 做多轮真实使用测试。本日志按时间顺序追加。

## 阶段A 基础设施（T1.1–T1.4）— PASS（2026-09-28）

- T1.1 目录骨架：21 个规范目录全部建立；README 含 8 条自然语言触发示例（DoD ≥6）。✔
- T1.2 competitions.json：132 条；id 连续；等级分布 A1:3 / A2:42 / A3:38 / B1:13 / B2:36 与附录四一致；每条含 id/name/level/category/pipeline；随机抽 10 条核对无误；JSON 可解析。✔
- T1.3 tracks.json：160 条（DoD ≥150）；132 项全覆盖；9 条子赛道赛事逐项展开（国创赛4赛道、挑战杯学术3类、外研社4赛项、机器人大赛2赛项、高校计算机5赛项、机械创新创意A2五项+A3四项、商业精英5赛项、巴哈2组、方程式3组、美赛MCM/ICM）；每条含默认产出物与交付目录；脚本可查询。✔
- T1.4 profile-schema.json + validate_profile.py：空档案输出 16 项缺失清单退出码 1；完整档案校验通过退出码 0；交叉核对 competition.id 与主库一致性。✔
- 收口验证：`python docs/verification/verify.py A` → 全部 PASS。

## 阶段B 评审标准库（T2.0–T2.132）

- T2.0 rubric Schema 与调研方法规范：schema 固化于各 rubric 文件；`scripts/validate_rubrics.py` 作为逐份校验器（存在性/字段/sources≥2/★赛事 past_winning_patterns/confidence/日期）。✔
- T2.1–T2.132：以 16 个批次子代理并行联网调研，产出 data/rubrics/001–132.json。进行中。

## 阶段C 核心通用技能（T3.1–T3.7）— PASS（2026-09-28）

- T3.1 ares-writing-style：附录一全部条款固化；自检清单 10 项；3 组违规→修正对照；配套 `check_style.py` 机扫（违禁词/违禁句式/泛泛表述/标点密度，QA 类文档 --allow-questions）。违规样张拦截、合规样张通过。✔
- T3.2 ares 总控：七步流程固化（赛事匹配→画像→一次性采集→建档→生产计划→编排→质检交付），单项模式与 /ares-sync 逻辑，完整示例对话两则。✔
- T3.3 ares-docx：统一版式规范表 + `make_docx.py` 样张（封面/自动目录域/三级标题/宋体小四1.5倍/首行缩进/图表编号/公式段/GB-T 7714/页眉页脚页码域）。✔
- T3.4 ares-ppt：三层架构；`theme.py`（3 主题×行业自动选）+ `layouts.py`（18 种版式函数≥14，含溢出检测）+ `build_ppt.py`（默认 21 页大纲全量取自 project.json，16:9，原生图表，微软雅黑统一）；改营收数字重渲染后图表同步变化实测通过。✔
- T3.5 ares-data：合成数据种子固定，`demo_pipeline.py` 重跑两次 stats.json 逐字节一致；png+svg 双输出。✔
- T3.6 ares-prototype：架构规范 + `design-system.md` 设计系统 + `scan_prototype.py`（死链/死按钮/不可达页检测，相对路径解析）；合规站点通过、违规站点全拦。✔
- T3.7 ares-judge：两道质检流程 + 修复循环 + 评审报告结构；`consistency_check.py`（9 项关键数字、单位归属防交叉误报）——干净文档零误报，人为埋入 3 处数字矛盾全部发现。✔
- 财务三表 `build_financials.py`：参数化（起始营收/增长率区间/利润率倍数/融资方案），三表由构造恒等式勾稽，逐年末平衡差 0.0，勾稽校验页写入 xlsx。✔
- 收口验证：`python docs/verification/verify.py C` → 全部 PASS。

（待续）

## 阶段B 中期记录（2026-09-28）

- 批次 1-6（全★）、7-15、16-24、34-42 已完成并逐份 PASS（validate_rubrics.py），官方权重拿到：1/2/4/6/9/12/14/15/21/23(部分)/34/36/39 等；未公开权重一律标【推断】并写明依据。
- 中期抽验 005/021/034：官方原文引用充分，★赛事 past_winning_patterns 齐备。

## 阶段D 六线三模块（T4.1–T4.9）— PASS（2026-09-28）

- 九条生产线 SKILL.md 全部按六要素结构（触发/执行步骤/输入/输出/自检清单/协作接口）固化，全部引用 ares-writing-style。
- T4.1 创业线：references/bp-outline.md 固化附录二十章章节引擎（每节内容要求/纪律引用/数据字段映射/字数区间）；references/financial-params.md 固化财务参数规则。
- 收口验证：verify.py D → 全部 PASS。

## 阶段E 外围组件（T5.1–T5.3）— PASS（2026-09-28）

- T5.1 六个 Commands：用途/需补充信息/参数说明/触发示例四件套。
- T5.2 五个 Agents：角色/可用工具/输入输出契约/交接格式，职责无重叠。
- T5.3 Hook on-project-init：自动三步 + 手动等价指令 + 幂等性。
- 收口验证：verify.py E → 全部 PASS。

## 阶段G 打包（初版）

- T7.1 plugin.json：16 skills + 6 commands + 5 agents + 1 hooks + data + scripts，v1.0.0。
- T7.2 docs/跨平台安装说明.md：ZCode/Claude Code/Codex/其他 Harness 四类安装法 + 验证指令。
- T7.3 发布包：待阶段F全绿后执行。

## 阶段F 端到端真实使用测试（启动）

- 方式：每轮派独立"测试用户"子代理，在隔离沙箱 ares-e2e/roundN/ 以真实用户指令驱动插件，插件目录只读。
- 第1轮 T6.1 创业赛全流程：运行中。
