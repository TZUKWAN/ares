# ARES 自适应画布、自写界面精修与跨平台插件交付

运行源码：`D:/METIS超级合并/ares`。桌面安装入口的 Junction 指向该目录，本轮直接修改此运行版。没有改 METIS、创建另一套 DSH、操作用户窗口、安装插件到个人宿主或改全局 MCP 配置。

## 实际改动

- 流程画布按实际容器宽度重新计算列数、卡片尺寸及依赖线路；自动适配和手动缩放分开，窗口或助手宽度改变后不再沿用固定 802px 平面。长流程可滚动、节点标题可读；同屏原生拖动与键盘排序保留依赖约束。缩放只更新画布，不重建原生助手。
- 自写控件统一字号、留白、层级、按钮尺寸、焦点、按压、等待、弹窗及作品预览。修复 800/390 宽度下预览头尾挤占正文的问题。动效沿用原有交互层并补齐控件状态，支持减少动态效果。
- `neural-creator-dashboard` 的参考核心、原始媒体和原场景动画没有改写；复核 SHA 与本轮修改前一致。保留两个工作区、比赛/赛道分类和 DSH 右侧常驻原生助手。
- 新增同源便携适配：九项 ARES 业务工具、`ares_workbench` 可视入口、官方 SDK stdio、Codex/ZCode 清单、技能与本地市场。复用真实流程、项目、作品、检查和固定版本函数，不自建模型循环或任意命令代理。
- 便携界面使用同一参考动画与自适应画布；实际工作稿通过 MCP 读取和保存，点明确按钮才向宿主原生对话提交上下文。编排步骤和项目步骤分别保存，切换不会混用上下文。
- 目录权限来自宿主 roots 或显式启动配置，JSON 不能扩大目录。默认便携数据目录独立于 `.dsh`；明确选用相同 home 才共享数据。无法核验 DSH 会话空闲的项目仍拒绝便携写入。
- 便携负责人动作通过受信本机宿主的标准单次确认表单：确认绑定参数、项目修订与实际文件哈希，确认后重新核对目录和证据。取消、过期、重放、文件变化和目录撤销拒绝执行。没有表单能力时保持 `needs-owner`，CLI 不提供自行审批选项。云分享/权限没有提升。
- 原 DSH 后端仅 `host/artifact-viewer.js` 增加可选 actor 并向两处透传，默认仍是原 user/owner；避免便携 Agent 编辑被错误归因负责人。原文件冲突、验收和版本门禁保留。

## 主要文件

|用途|文件|
|---|---|
|响应画布|`client/workflow-canvas.js`、`client/workflow-canvas.css`、`client/app.js` 的画布接线|
|自写界面细节|`client/ui-refinements.css`|
|原入口自包含构建|`scripts/build_forge.mjs`、生成 `client/workshop-scene.js` / `client/workshop.css`，缓存 `2.3.0-polish1`|
|便携真实业务与确认|`platforms/shared/core.mjs`、`server.mjs`、`approval.mjs`、`scripts/ares-mcp.mjs` / `ares-local.mjs`|
|MCP Apps 页面|`platforms/ui-server.mjs`、`platforms/ui/client.mjs` / `portable.css`、`scripts/build_portable_ui.mjs`|
|平台包与安装说明|`platforms/packaging/`、`platforms/skills/ares/SKILL.md`、`scripts/package_plugins.mjs`|

## 对应验证

本轮按不同测试去重的最新结果为 **28 项通过**；不是一次整组 28/28。联合便携回归曾有一项旧 CSP 精确断言失败，按已收紧为空域名白名单的新契约修正后定向复测通过，其余不无谓重跑。

|验证|结果和实际边界|
|---|---|
|DSH 画布/界面/入口/原生助手槽位/原门禁|9/9；真实浏览器 1/8/40 步，容器变化、排序、长标题、焦点/等待、800/390 作品正文；原生助手为实际 React Portal 接协议服务 fixture，没有调用线上模型|
|DSH 既有文本保存/编码|2/2；默认 owner 调用、真实文件 SHA、非 UTF8/BOM 行为保留|
|便携 MCP/单次确认/CLI|15 个不同检查的最终结果通过：联合先 14 通过、1 项旧 CSP 断言失败；该项修正后 1/1。含 8 个确认用例、6 个 MCP 用例及 1 个 CLI 用例；实际 stdio、原检查器、文件、修订冲突、目录撤销、固定版本与拒绝审批路径|
|便携界面端到端|1/1；官方 AppBridge/SDK、真实 MCP 文件和流程保存读回、实际 409 保留草稿、原媒体 Blob 播放、1280/390、两区上下文隔离。宿主消息接收端为捕获 fixture，没有发到真实模型|
|最终 ZIP 解压重定位|1/1，分别运行两个实际清单的命令；中文与空格目录、无 node_modules/安装依赖，独立 Python zipfile CRC、所有文件 SHA、解压包自己的产物检查器和 UI 资源均通过|

另外，当前本机 Codex CLI 0.154.0 对外层市场与解压包自带市场均实际识别 ARES 2.4.0 为 available；ZCode CLI 0.17.1 对插件及两种市场均校验零诊断。仅按次覆盖配置进行读取，未安装/启用。ZCode 3.17.2 源码只读核查表明当前页面 4,807,228 字节低于 16MiB HTML 入口及 8MiB 资源读取限制，其默认 CSP 支持所用本地 data 字体和 blob 媒体；这不是实际宿主激活测试。

主要复现命令：

```powershell
node --test --test-concurrency=1 tests/workflow-canvas.test.mjs tests/workflow-canvas-client.test.mjs tests/ui-refinements-client.test.mjs tests/neural-native-workspaces.test.mjs tests/client-module-loading.test.mjs tests/admission.test.mjs
node --test --test-name-pattern='text save|non-UTF8' tests/artifact-viewer.test.mjs
node --test --test-concurrency=1 tests/portable-owner-approval.test.mjs tests/portable-mcp.test.mjs tests/portable-local.test.mjs
node --test --test-name-pattern='required UI resources' tests/portable-mcp.test.mjs
node --test tests/portable-ui-client.test.mjs
node --test tests/portable-package.test.mjs
node scripts/build_forge.mjs --check
node scripts/build_portable_ui.mjs --check
node scripts/package_plugins.mjs --out '本次交付目录绝对路径'
```

每个检查的原始证据位于本聊天 `work/ares-portable-polish-20261113`，关键结果复制到输出目录 `evidence/`。`final-source-audit.json` 核对所有修改、原始保护文件、语法、构建输入、许可与包内源文件，`packages.json` 记录最终 ZIP SHA。

## 使用与边界

- DSH 仍用原工作台和右侧助手；用户当前已打开窗口需自行点击现有一键重载加载新版，本轮没有代点。
- Codex 插件以技能和工具为稳定入口；官方自定义 MCP Apps UI 文档面向 ChatGPT/兼容宿主，不能声称 Codex 已具备与 DSH 一样的内嵌工作台。ZCode 包提供官方 MCP Apps 侧栏清单，但未在用户窗口安装/激活。
- 两个包都已完成本地真实文件和协议验证；没有进行真实宿主模型执行、真人确认弹窗、金山云端写入或共编登录验收。负责人确认信任本机宿主响应，不是账号身份认证；外部进程不受本机队列锁定，仍依原文件/版本门禁处理并发。
- 跨屏原生 dragTo 曾在测试浏览器产生零事件，未当作通过；同屏可信拖动、键盘排序及自动布局已验证。不引入另一套拖动引擎扩大本轮范围。
- 原媒体许可与官方 SDK 依赖许可已附包；本次为本地私有打包，未公开发布。

## 已修复的实测问题与主模型复核

固定画布裁切/依赖线穿卡、预览正文被挤没、便携页误删参考 DOM/缺 CSS 作用域、作品聚焦字段及步骤上下文混用、窄屏标签点击框重叠、并发流程修订草稿丢失风险、便携 Agent 编辑归因错误及 SDK 确认表单严格模式不兼容均已按实际失败修复并对应复测。失败证据保留，未使用假结果替代。

主模型已逐项复核上述实现、原门禁差异、确认状态机、真实回执与最终 DSH/便携截图。交付边界内没有已知未通过项；用户宿主安装激活和上述线上路径仍未验证，不作已完成声明。
