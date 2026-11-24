# DSH 运行版真实验收 · 2026-11-24

本轮在既有运行版 DSH、原 ARES 编辑会话完成实际操作。在线模型工具链通过；Auto 审批实际验收失败。没有使用协议夹具替代在线结果，也不能宣称所有真实环境已通过。

## 实际结果

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| DSH 在线模型 | 通过 | `deepseek-official/deepseek-flash` 在真实 SessionController 回合执行四工具；真实 request/header、助手调用、步骤和返回事件相互对应 |
| ARES 当前上下文 | 通过 | `ares_config_read` 返回当前服务实例和既有草稿；未创建替代会话或选择竞赛工作区 |
| 原生文件与计算 | 通过 | write/read 实际标记字节一致，pwsh 实际计算 7+11+17=35，受管任务 exit code 0，回合 completed |
| Auto 审批 | **失败** | 该回合保持原生 `auto`，四工具均成功，但在线审批流请求为 **0**；独立读取的已加载审批函数含 `dsh-purge` 直接放行补丁 |
| ARES 清理后服务 | 通过 | 实际所有者认证接口 200、无认证 401，原 Agent idle，工具目录 220 / standard 212，无注册或展示缺项 |
| 恢复与隔离 | 通过 | 恢复该会话原模型及权限，全局默认未变；profile 和 ARES bundle 逐字节恢复，15 个自有临时模块与唯一入口清理，清理后再次读回 |

机器可读的脱敏结果、原生日志序号、当前五份宿主源码指纹、标记字节指纹、终端任务状态和清理回执见 [验收证据](evidence/dsh-live-20261124.json)。本地完整原生报告 ID 为 `a99aa807-b22c-440b-992c-10b806d2d7bc`；用户路径、凭据、完整会话历史和配置草稿未上传。

220 表示当前实际可见工具数量，不代表逐一执行 220 个外部服务。本轮只调用上述四工具，没有调用 METIS 工具或改变 MCP 连接/准入。

## 已修复的 ARES 问题

1. 原生工具检查兼容当前 DSH 的 `selectExecutor().describe(definitions)`，同时保留旧 `wireSchemas/modeFor` 支持；未知、卸载、缺项或重复描述拒绝通过。
2. 当前 DSH 在 system-prompt waterfall 结束后才附加 provider-owned 工具，ARES 改读真实执行器及该步 `toolSet`。完整 standard 注册对齐继续检查；该步展示与宿主实际准入比较，避免把非计划阶段隐藏的 `exit_plan_mode` 误报为缺失。必需能力缺失和展示缺失反例仍失败。
3. 冷恢复兼容 SessionController 直接返回真实 Agent 与旧 `{agent}` 结果；原身份、注册表、目录和 preset 检查保留。
4. Auto 体检只读观察该会话、该真实用户请求的原生 `llm/stream`，审批必须对应实际待执行调用并完成允许决定。没有审批、异会话、不完整响应、模型错误或拒绝结果不能通过；观察器不请求模型或替换决定。

运行中 ARES 曾因旧 ES 模块缓存缺少新导出而处置。仅清理其自身模块缓存并重载 ARES 后端，未重启 DSH 或操作用户窗口。界面、动画、业务模块、项目验收实现和 MCP 隔离实现未改动。

## 尚未完成的宿主阻断

已加载的 DSH 官方 Auto gate 被第三方补丁提前 `return next()`，原生审批根本没有执行。该事实同时由真实回合的零审批请求、已加载函数文本和函数 SHA256 证实。工具成功不能证明审批通过；新的 ARES 检查已如实输出失败。

要完成 Auto 正向验收，需要恢复宿主原生审批实现，并复核其中同属第三方补丁的 ask 放行路径，再验证真实允许和拒绝。该变更涉及整个 DSH 的安全行为，超出本次只修 ARES 的修改范围。本轮没有删除宿主补丁、修改全局权限/宿主配置，或用自建审批模型替代原生审批。因此总体真实验收仍有这一明确阻断，PR 保持 Draft、不合并。

## 本轮验证范围

- 精准回归：`node --test tests/native-tool-presentation.test.mjs tests/native-auto-evidence.test.mjs tests/editor.test.mjs tests/native-conversation-health.test.mjs tests/native-health.test.mjs tests/native-session.test.mjs`，36/36。
- 请求/恢复/项目与 MCP 隔离：`node --test tests/health-request.test.mjs tests/health-hot-reload.test.mjs tests/native-outcomes.test.mjs tests/native-two-workspace.test.mjs tests/project-session.test.mjs tests/portable-mcp.test.mjs`，25/25。
- `node scripts/build_forge.mjs --check`、`node scripts/build_portable_ui.mjs --check`，均通过，现有 UI/动画构建字节不变。

单元和协议回归与上面的真实 DSH 回合分别记录；未以其冒充 Auto 通过。本轮未重新生成/安装 Codex、ZCode 包，也没有重新核验赛事原文。
