# ARES 常驻聊天与星河统一风格

运行源码 `D:/METIS超级合并/ares`，前端入口与样式缓存标记 `2.3.0-chat2`。本轮解决聊天被临时操作层收走，以及聊天面板与星河风格不一致的问题。

聊天默认常驻。宽屏在星河右侧，窄屏在下方，二者不互相覆盖。打开步骤、进度、资料或作品不会关闭聊天；收起由用户主动操作，左上始终保留「聊天」按钮。可拖动边界或用键盘调整宽度。进入编排自动显示配置助手，回到项目显示项目助手，也可用「项目 / 配置」标签切换。无项目时直接显示 ARES 配置助手，不要求另选 DSH 工作区。

视觉采用星河同款黑底、低亮细边、冰蓝选中线和既有字体。取消深蓝大底与整块填色标签；上下文标签改为细线选中，空态改为简短标题与 2×2 编号操作。原生输入框使用黑底、1px 边框和 2px 圆角，工具、模型、附件及发送控件继续由 DSH 提供，只在 ARES 内调整外观。没有另写消息执行器或模拟工具结果，状态错误仍按原有真实来源显示。

使用原有 `nativeDock`、`projectDock` 和 DSH SessionProvider / conversation.content 槽位。界面更新、切换功能、收起再展开保留同一槽位 DOM 和草稿；项目切换仍经原生项目会话管理器绑定真实目录。配置工具上下文跟随选中流程/步骤更新。快捷操作依旧只填写原生输入草稿，不自动发送。人工验收、MCP 隔离、原生审批和业务 API 均不修改。

一并修复刷新时原生输入选区被 DOM Selection 二次重置、启动占位文字残留，以及聊天挤窄场景后保存按钮被操作层标题挡住的问题。保存按钮在流程操作层标题内固定显示；compact 场景导航按场景实际宽度定位。

## 源文件

- `client/app.js`：独立常驻区、项目/配置上下文、宽度/收放、槽位与光标保留、流程保存入口。
- `client/client.js`：原生空态及快捷操作排版、前端缓存标记；原会话、消息、输入和工具桥接保持。
- `client/galaxy-chat.css`、`scripts/build_forge.mjs`、生成的 `client/workshop.css`：统一主题，并通过原 CSS 入口加载，不新增宿主路由。
- `tests/resident-chat-client.test.mjs` 与 `tests/helpers/native-theme-surface.mjs`：常驻/草稿/布局及实际源码样式契约验证。三个原 UI 测试仅适配新的入口、可用体检按钮与拖拽前缩放。

## 实际验证

对应组首轮 60 项：52 通过、8 失败。已定位并处理：常驻区内禁用的配置体检按钮被测试误选、保存按钮被标题覆盖，以及拖拽测试源/目标不同时可见；后续几项为保存失败后的连带失败。精准业务/流程复测 19/19 通过。最终常驻、原生输入样式与旧入口组 10/10 通过，无失败/取消/跳过。合并所有对应测试名称后，61 个不同测试的最新结果全部通过，重跑项不重复累加。原始失败及修复日志全部保存。

新交互通过实际生产处理器/文件和自有 headless 界面验证；包含同一 Canvas、步骤操作、作品保存/版本、进度、输入草稿与选区、双原生槽位、390/800/1280/1900 布局和旧静态路由加载。原生输入样式依据是本机安装包内真实 `@deepseek-ai/dsh-client-ui-conversation/lib/client.js`（940214 字节，SHA256 `210640100a1431a31a307f31d8258801d0042bec60b4c4a18576b6775487d73e`），核对 `data-composer-card/input/placeholder/seat` 标记及主题变量。

样式检查执行实际 ARES NativeEditorBody 视图函数，并加载该安装版本真实 InputBar CSS；hook/会话状态和 composer DOM 是明确标注的结构夹具。实际量得聊天底 `rgb(5,7,10)`、输入底 `rgb(8,13,18)`、1px 边和 2px 圆角，标签无实底或边框；四个真实快捷回调只产生草稿提示。此检查不是新的在线 DSH/模型/云调用，截图也不是用户窗口或竞赛成果。

证据根 `C:/Users/lauze/Documents/Codex/2026-11-02/c/work/ares-chat-resident-20261107`。主要命令：

```powershell
node scripts/build_forge.mjs
node scripts/build_forge.mjs --check
# ARES_TEST_ROOT / ARES_PLAYWRIGHT_PACKAGE 沿用本地可信测试环境。
# ARES_NATIVE_CONVERSATION_SOURCE 指向从上述本机安装包只读取得的 lib/client.js。
node --test --test-concurrency=2 tests/resident-chat-client.test.mjs tests/galaxy-client.test.mjs tests/client-module-loading.test.mjs
node --test --test-concurrency=2 tests/client-workbench.test.mjs tests/sci-fi-client.test.mjs
```

源审计以修改前 420 文件清单比对；原 host、index、审批、验收、MCP、技能和命令文件保持原 SHA。没有修改 METIS、另起 DSH、控制或重载用户窗口。当前用户窗口是否已经加载最新版未代为观察；更新通过现有一键重载加载。没有新增在线模型/金山/MCP验收，也不声称保证所有硬件帧率。主模型复核实际截图、样式测量、测试日志及源码差异后交付。
