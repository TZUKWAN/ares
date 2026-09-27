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

## 阶段F 第1轮（T6.1 创业赛全流程）— 通过（2026-09-28）

- 测试用户智能体在隔离沙箱 ares-e2e/round1 完成 T6.1：11 项交付物齐全（可选VCR按规则跳过）、validate/build_financials/build_ppt/scan_prototype/consistency_check/check_style 六项质检退出码全 0、模拟评审 85→修复P1→87 分（≥85 达标）、一致性零矛盾、数据真实性清单三类齐全。编排方独立复验（机扫+一致性+档案校验）与测试自报一致。
- 视觉验收（PowerPoint 渲染 21 页 + presentations:visual-judge）：首轮 14/21 过，暴露三栏卡片空置、单人卡空旷、混量纲柱状图三类版式硬伤 → 引擎修复（三栏高度自适应、少人数卡宽限制、混量纲守卫提示、默认指标页改对比矩阵）→ 重渲染复检 20/21 过；余 1 页为测试代理自选内容（守卫已提示，默认大纲不再产生该问题）。
- 测试用户回报 13 条插件缺陷，全部修复并提交：consistency_check 试点类误报（年份/型号数排除、显式单位精确匹配、零值跳过）、scan_prototype 内联脚本口径、build_ppt 默认大纲 repr 上页/利润率口径/溢出累积、写作纪律词表文档对齐、validate_profile track 校验、count_words.py 字数审计工具、rubric 额外提交物增补规则。

## 阶段F 第2轮（T6.2 建模赛 2024 国赛A题）— 运行中

（待续）

## 阶段B 收口（T2 全量）— PASS（2026-09-28）

- 132/132 份 rubric 通过 validate_rubrics.py；confidence 分布 high 47 / medium 83 / low 2；每项来源 ≥2 且含 A/B 权威源；标★ 12 项 past_winning_patterns 全部齐备。
- competitions.json 调研回填：official_url 99 项、deliverables_required 132 项、typical_timeline 113 项；台达杯停办、机械创新创意"起重机"更名"物流技术"等关键发现写入档案 notes。
- 官方权重获取情况（部分）：1/2/4/9/12/14/15/21/23/31/33/34/36/39/47/48/50/56/57/58/65/66/71/73/74/77/79/82/83/86/88/92/99/100/106/110/114/115/119 等数十项拿到官方分值/计分口径；未公开者一律标【推断】并在 notes 写明依据，无虚构权重。

## 阶段F 第3轮（T6.3 单项模式）— 通过（2026-09-28）

- /ares-ppt 单项重渲染：sha1 快照证明除 03-路演PPT.pptx 与 pages.json 外 42 个文件字节未动，project.json 一致；混量纲页按守卫改对比矩阵；重渲后退出码 0、0 条守卫提示、一致性零矛盾。
- 反馈 3 条已修复：build_ppt --strict 标志（守卫提示计入退出码）、守卫措辞区分漏斗/混量纲、comparison_matrix 支持 note_lines。

## 阶段F 第2/4/5轮 — 运行中

（待续）

## 阶段F 第4轮（T6.4 变更同步）— 通过（2026-09-28）

- 用户手改档案（营收 200→230、融资 400→500、股权 15%→18%）后执行 /ares-sync：9 个文件正确传播（三表重算勾稽 PASS、PPT 财务页重渲、BP 八章与表 8-1、两版讲稿、QA/真实性清单最小订正），35 个文件字节原样；正则残留检索旧数字 0 命中；一致性扫描 0。
- 反馈 4 条已修复：build_financials 融资参数真正从档案读取（funding_wan/equity_stake_pct，高危）；consistency_check 纳入 docx 表格文本（实测抓到表格内矛盾数字）；ares-sync 映射补 08/11/pages.json 并明确"引用即同步"原则；生成日志落盘位置定义为 输出/生成日志.md。

## 阶段F 第2轮（T6.2 建模赛 2024 国赛A题）— 通过（2026-09-28）

- L2 线 6 项交付齐备：论文（摘要独立成页、8图9表、数字与代码输出同源）、8 模块求解代码（run_all 一键复现，395s 重跑 10 个数据文件哈希一致）、官方模板实验数据、8 幅 300dpi 图表、灵敏度分析（3参数±10/20%）、数据真实性清单。
- 官方原题从 mcm.edu.cn 下载核实，纠正用户转述两处偏差（直径9m非半径、把手中心）并写入假设节；结果量级与公开优秀解法互证。
- 模拟评审 2 轮：首轮 2 个 P0（缺候选模型对比、数据不符）修复后复检 92.8 分，P0 清零。
- 反馈已修复：add_formula 公式编号参数生效、ares-modeling 补质检适配口径与官方题面渠道、consistency_check 文档补 docx 表格说明。

## 阶段F 第5轮（跨平台 AGENTS.md 触发 + 全插件扫描）— 通过（2026-09-28）

- 仅 3 行 AGENTS.md 指引即完成 建档（validate_profile 0）+ L4 线调研问卷产出（check_style 0 一次过）；全程自然语言触发，未用 Commands/Agents/Hooks。
- 全插件客观扫描：verify.py all 四阶段 170 项断言全 PASS；round1/3/4 共 30 份文本交付物机扫 30/30 零违禁；rubric 132/132 PASS。
- 反馈 6 条已修复：check_style --strict 短行豁免（封面主副标题破折号）、validate_profile 非商业线必填放宽（L2/L5/L6/E1/E2 商业字段降级为警告）、tracks.json id21 补本科/研究生组、AGENTS.md 片段补根路径与单项模式提示、L4 问卷机扫豁免说明、建模线口径文档化。

## 全量复测（2026-09-28）— 全绿

- verify.py all（A/C/D/E 170+ 断言）PASS；rubric 132/132 PASS。
- PPT 视觉验收终轮 21/21 全过（visual-judge 判定 deliverable_ready=true）：第3页占位列自动隐藏、第13页饼图百分比标签+侧注居中均已确认修复。
- 五轮真实使用测试累计 36 条反馈全部闭环。

## 平台冒烟记录（T7.1 DoD：≥2 平台）

- 平台一（类 ZCode/Claude Code，Commands+Skills 全量）：第1/3/4轮 加载→触发（/ares-start、/ares-ppt、/ares-sync）→产出 全部成功。
- 平台二（Codex 式，仅 AGENTS.md 指引）：第5轮 加载→自然语言触发→产出 成功。
