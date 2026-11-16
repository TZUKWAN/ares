# ARES 2.0.3：DSH 原生工具能力修正

目标是让 ARES 助手使用 DSH 原生工具完成资料读取、开发和验证，且不要求用户选择工作区。

## 真实原因与修复

旧编辑预设只声明 persona、工具展示和两个配置工具，没有加载标准文件/终端/技能等组合。`editor-runtime` 又调用 `tools.restrict({allow:[]})`。当前 DSH 将预设工具注册在 live Agent 的祖先作用域，限制同时过滤全局及祖先工具，所以两个 ARES 工具也可能被隐藏。旧注册夹具仅检查工具曾经注册，不能证明 live Agent 或模型能看到它们。

已读取本机安装包中的 `dsh-web-app/presets/standard.patch.yml`、`dsh-tools`、`dsh-scope`、`dsh-system-prompt`、`dsh-agent-preset-registry` 和 METIS 当前实现，以实际源码为依据。

- `host/base-plugins.json` 完整同步当前安装的 DSH 标准声明，共 22 个顶层条目，含平台条件及分组。保留标准预设原本禁用的插件管理入口，遵守宿主选择。
- `native-toolbox.js` 为编辑与比赛预设共用原生组合；`editor-definition.js` 声明专用 persona 和工具契约。移除 ARES 空白名单，也移除“不能使用终端”的提示。
- 文件、终端、搜索、联网、技能、定时与高级工具按 DSH 实际服务挂载；宿主全局工具和已连接 MCP 正常继承。工具存在不代表执行结果一定成功，也不代表应自发启动高级任务。
- 原生工具执行、权限、沙箱、流式状态和停止继续由 DSH 管理，无自写模型调用循环。
- 实际会话状态包含 `toolSurface`。每次核验借用真实标准预设作用域，并检查 Agent 可见 schemas；发送前还对比最终 `system-prompt/assemble` 目录，原生工具或实际授权工具的缺项会报出，不让助手以空工具目录继续声称能够工作。已读取本机 MCP 连接器的工作区隔离实现：项目专用连接会对其他会话设置全局工具 deny。因此比对原生预设贡献与本会话实际允许的全局工具，既不绕过隔离，也不将合法 deny 误报成整个助手挂载失败。
- 空闲编辑会话重连时，使用 DSH `recompose` 切到当前编辑预设修订；保留会话、消息和提案。运行中 Agent 不被改绑，比赛的固定工作流不被改绑。
- 原生目录故障与配置草稿错误分开显示。同 revision 的工具故障与恢复仍会同步；客户端拒绝缺少检查协议的旧后端，提示“一键重载”。
- `ares_config_read kind=context` 返回真实 `toolkitRoot` 和内部 `sessionCwd`。源码读写使用绝对源码路径，配置读改仍通过 ARES 提案、revision 和保存机制，保留人工草稿。

## 精准验证

`node --test tests/editor.test.mjs tests/editor-client.test.mjs tests/api.test.mjs`：30 项通过，包括协议、真实隔离 HTTP API、配置冲突、旧后端识别及工具状态同步。原生服务夹具与在线模型调用明确区分。

`node --test tests/dsh-native-tools.integration.mjs`：使用从本机实际安装包只读提取的 DSH 依赖，运行真实 Cordis、预设注册器、作用域、工具执行管线、文件/搜索/PowerShell/技能等原生插件。真实 Session 使用一个不含模型循环的测试 Agent carrier；inspect 适配器从该 Session 读取真实元数据和事件。所有持久数据写入隔离目录，技能发现只扫描隔离目录，不读取或监视用户技能库。

8 项原生集成检查覆盖：

1. 完整插件声明与安装包标准预设逐项一致。
2. 标准预设的全部可见工具被 ARES 保留，最终 wire schemas 也齐全。
3. 真实空白名单复现继承工具消失，组装守卫拒绝，移除限制后恢复。
4. 下游仅删去最终 wire 中的工具，同样被守卫捕获。
5. 实际执行 `write`、`read`、`grep`、`pwsh`、`skill`；全局扩展执行真实本地文件读取。
6. `ares_config_read` / `ares_config_edit` 通过真实工具管线执行；只产生提案，未自动保存，过期 revision 被拒绝。
7. 保留旧预设作用域并重新注册后，空闲会话重连恢复工具，Session、消息和提案不丢失；运行中不改绑。
8. 使用与宿主 MCP 隔离相同的真实工具 deny 机制：受限的全局扩展保持隐藏，其他原生工具和配置助手继续可用；解除限制后正常恢复。

运行集成检查需指向可信安装包的隔离副本：`ARES_DSH_NODE_MODULES` 指向其 node_modules，`ARES_DSH_STANDARD_PRESET` 指向原始 standard.patch.yml，`ARES_TEST_ROOT` 指向验证目录，可用 `ARES_TOOL_REPORT` 输出完整结果。不下载或执行额外第三方安装脚本。

## 结果边界

验证没有调用真实模型、用户外部 MCP 服务或付费搜索，没有启动子 Agent、workflow 或定时任务，也没有操作用户桌面或重载运行中的 DSH。全局扩展检查是明确的本地继承验证，不冒充真实外部 MCP 服务成功。

工具数量随宿主服务、模型设置和连接状态变化，不用固定数字作为生产环境成功标准。未连接、宿主禁用或缺凭据的能力按 DSH 原生行为报告，ARES 不绕过权限。后续 DSH 标准新增工具时，实际目录对比会报告缺项，需要同步标准声明并重载插件，不能用旧快照声称始终相同。

本地源码已通过 profile Junction 生效到安装路径；运行中宿主采用新版仍需“一键重载”。单纯新建对话不更新已加载的插件代码。
