# ARES 自适应画布、界面精修与跨平台插件

## 目标与边界

刘总要求修复流程画布无法自适应，仔细打磨我们新增部分的排版和动画；neural-creator-dashboard复用的动画/交互/媒体保留。将同一竞赛流程和项目核心打包为Codex插件，并兼容ZCode。运行版直接改，不改METIS、不操作用户窗口、不另起DSH；原验收、审批、固定版本和MCP隔离保留。

## 可验证任务

|单元|目标和涉及文件|执行路线|验证与完成标准|
|---|---|---|---|
|U1 画布|app.js仅画布区段、workflow-canvas.js/css|以实际容器宽高布局、ResizeObserver、自动/手动缩放、避障依赖线，保留排序/键盘/选中|先复现固定802px裁切；真实1/8/40步、长标题、助手宽度、窗口resize、节点选择/排序可用，无卡片覆盖/连线穿卡|
|U2 自写UI|ui-refinements.css及必要原自写主题|调整工具条/表单/详情/弹窗/预览/助手空态的层级、尺寸、间距；hover/focus/press/loading和轻量转场|真实功能页与延迟请求，文字/输入可读、焦点可见、按钮不位移，窄屏无横溢出；主模型看最终截图|
|P1 共享核心|platforms/shared、ares-mcp.mjs、新增测试|复用实际业务函数，标准MCP stdio，官方SDK锁定并自包含传输；可信宿主roots或显式根目录；独立home|官方协议client initialize/list/call，真实流程保存/项目/文件/版本，越界和未授权验收拒绝，无模拟能力|
|P2 平台包|Codex/ZCode清单、技能、市场和打包脚本|以官方和当前安装版真实规范打包；DSH继续原生入口；各宿主使用其原生AI与工具|清单/路径/依赖/技能实际可解析，解压包启动stdio并读写真实测试项目；不自动改全局MCP/安装设置|
|P3 可视界面|按实际宿主支持选择MCP Apps资源和共享UI桥|Codex工具/技能为必需可用路径；ZCode支持MCP Apps页面，桥只调用ARES允许工具、提交宿主上下文|资源和桥按真实协议验证；不把页面协议夹具冒充已在用户宿主安装/激活，不自建模型循环|
|I1 整合交付|build_forge、缓存、README、状态及报告|统一生成资源、保留旧宿主静态入口兼容；源代码/许可/资产SHA审计|对应测试通过、失败修复、原动画/媒体及保护源码核对、真实截图/日志/包/安装说明存在|

## 技术决策

- 共享竞赛/项目/版本数据与业务函数，DSH保持右侧原生助手常驻；Codex/ZCode用各自原生助手及执行工具，插件提供真实工作上下文和工具，不冒充DSH控制器。
- OpenAI官方将工具/技能定义为ChatGPT和Codex共用能力，自定义MCP Apps页面的明确UI说明面向ChatGPT/兼容宿主；不能据此宣称Codex的嵌入界面与DSH等价。ZCode当前官方文档明确支持本地桌面MCP Apps侧栏。
- stdio信任宿主提供的roots或操作者显式配置；模型参数不能扩大允许目录。默认跨平台home不写.dsh；共享DSH数据须明确选同一home并遵守原固定版本。
- Agent工具与UI负责人操作区分。没有可信负责人上下文时保留待验收/待授权，不能通过JSON自称owner，不能放宽模拟数据、权限与公开分享要求。
- 独立子包管理pinned官方SDK及锁文件；DSH根不增加MCP运行依赖。保留代码/媒体许可；只做本地私有打包，不公开发布。

## 风险与交付

风险包括动态容器的Observer循环/缩放重排冲突、宿主旧缓存、插件路径重定位、SDK主版本、原生执行差异、用户数据/审批边界。通过受限改动、真实浏览器与协议测试、包解压重定位测试、源码和保护SHA审计处理。未实测的宿主安装或在线模型/云端写入须明确列出。

交付为运行版源码、Codex/ZCode本地可安装包/市场、使用说明、对应验证日志、截图与源审计。489文件修改前完整备份在本聊天work/ares-portable-polish-20261113/before。具体完成状态持续写入.claude/CLAUDE_STATE.md。

## 主要真实资料

- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/plugins/build/chatgpt-ui
- https://developers.openai.com/plugins/deploy/desktop-only
- https://zcode.z.ai/cn/docs/plugin
- https://github.com/zai-org/ZCode/blob/main/UI_PLUGIN.md
- 当前安装Codex CLI 0.154.0及ZCode应用源码/插件规范；DSH运行版源码及前轮加载修复记录。
