# ARES 统一工作现场

运行源码 `D:/METIS超级合并/ares`，前端与新观察接口缓存标记 `2.3.0-work3`。按本轮确认的方案完成三处联动、一条底栏和常驻聊天，并根据后续反馈重新打磨字体、留白、作品区和原生聊天挂载。

## 本轮行为

- 中间星河保留实际步骤、登记成员及已核对的原生 Agent。点击步骤或参与者，左侧执行详情和右侧作品同时定位。左侧不再重复人员和流程清单；技能绑定放进步骤设置。
- 左侧显示选中工作相关的实际工具动作、运行/返回/失败状态和可核对的项目内文件路径。按文件路径关联的动作注明来源；未确认所属步骤的调用单列为项目会话动作，不冒充该步骤已经执行。不从未返回的工具调用猜测审批通过；审批细节仍在原生对话。
- 右侧复用原作品服务，展示真实本地工作稿。文件内容稳定保存后自动刷新，文本展示实际前后行变化；二进制/版式变化只报告指纹更新，明确需要查看真实页面。没有文件时显示缺失状态，初次读取不伪装为新增成果。观察到文件变化不自动认定修改者。
- 点击「放大作品」进入原保护编辑器，同一项目聊天保持可见。文本编辑、保存为工作版本、未保存草稿和并发冲突保护保留；PDF/Office 页面继续走原渲染服务，不拿图片或文字占位冒充文件。直播仅为只读预览，放大编辑时停止它的文件轮询，关闭后恢复。
- 原下方事件流、技能分布、原生 JSON 和进度四个大框取消常驻。导航、进度/作品/金山及当前步骤操作合并到底栏，次要入口收进「更多」。原始记录放进诊断，成员记录、版本、规则、扩展和项目进度继续可达。底栏限制在工作区内，不盖住聊天输入。
- 聊天默认常驻，项目/配置仍用原生 DSH 会话及槽位，不另写消息执行器。实际客户端代码与 React Portal 的集成检查覆盖同一输入节点、草稿、唯一会话 lease，以及切步骤、放大作品和窄屏后的保持。

视觉沿用黑底、冰蓝细线与原字体，提升执行文字的可读性；Markdown 预览采用统一深色阅读样式，PDF/Office 原页面仍忠实展示。窄屏通过「执行 / 流程 / 作品」切换工作区域，聊天在下方常驻。动画保留吸积、公转和有来源的活动反馈，不恢复旧机械变形。

## 实现与边界

`host/project-live.js` 是新增只读观察模块，通过原 owner、同源及方法守卫提供 POST `/ares/api/v2/project/live`。核对项目、固定定义、原生会话 ID/目录/preset，再读取真实会话事件及其所属 Agent 家族；不创建会话、不发送提示、不执行工具、不改任务/作品/验收。参数正文、命令内容、外部目录和敏感文件路径不下发为展示资料。原 `node-execution.get` 已具备执行中 calls；本轮补齐动作路径、Agent 和步骤/作品关联，没有替换执行器。

可见项目现场约每 1.2 秒读取过程快照，作品沿用原 1.6 秒指纹检查；这是近实时观察，不是逐字符云编辑流。金山仍承担团队共同编辑，沿用原读取云稿、比较、采用和分享链路。本轮没有新增金山远端逐字直播、匿名编辑身份识别或内嵌完整 Office 编辑器，也没有改变分享权限。

主要修改为 `client/app.js`、`artifact-viewer.js`、`forge-view.js`、`forge-data.js`、`forge-scene-controller.js`、`process-model.js`、`project-workbench.js`；新增 `work-model.js`、`work-surface.css` 和上述观察模块。`index.js` 只改路由缓存标记，`host/routes.js` 只增观察导入与 owner 路由。新前端模块仍编入旧 `workshop-scene.js` / CSS 入口，无需增加宿主静态资源路径。

## 验证与修复

证据根 `C:/Users/lauze/Documents/Codex/2026-11-02/c/work/ares-work-surface-20261108`。94 个不同对应检查的最新结果全部通过；最后一组 13/13，通过的原业务组为 17/17。按测试名称去重，以每项最后一次实际运行结果为准，不重复累加重跑项。原失败与定位修复、逐项名称、命令日志和源码审计随交付保存。

本轮实际修复：启动前空项目状态导致的初始化失败、旧 container 规则覆盖窄屏布局、菜单/底栏溢出风险、文档打开后工作上下文不一致、只读预览与大编辑器的交互隔离，以及异步刷新后旧测试误选已移动入口。原生聊天不能只用一个侧栏占位证明正常，本轮增加了实际 `client/client.js`、真实 React DOM `createPortal` 和显式会话/Provider/Composer 协议夹具的集成验证，确认输入框、草稿和 lease 保持。界面截图中的软件验证名称、协议标识明确保留。

对应检查覆盖真实文件写入/读取与文本变化、pending→工具结果、目录/身份/preset/节点范围、owner/来源/方法门禁、1/9/40 步实际绘制、公转/悬停、源文案转义、底栏、常驻输入、放大编辑/保存/冲突、PDF/HTML/兼容 Canvas、原版本/规则/子插件/预测试/计划和原生会话协议。失败先定位修复再复测，原始失败日志保留。

主要运行命令：

```powershell
node scripts/build_forge.mjs
node scripts/build_forge.mjs --check
node --test --test-concurrency=2 tests/project-live.test.mjs tests/work-model.test.mjs tests/work-surface-client.test.mjs tests/native-portal-client.test.mjs tests/client-module-loading.test.mjs
node --test tests/client-workbench.test.mjs
node --test --test-concurrency=2 tests/workshop-client.test.mjs tests/galaxy-client.test.mjs tests/process-orbits.test.mjs tests/process-progress-client.test.mjs tests/sci-fi-client.test.mjs
```

测试使用既有可信 Playwright 路径；原生样式契约依据本机已安装 DSH 输入组件源码。Portal 集成的测试依赖是官方 [React 19.2.0](https://registry.npmjs.org/react/19.2.0) 与匹配 React DOM，仅安装在本聊天私有测试目录，使用 `--ignore-scripts`，版本与完整性记录在锁文件；不进入 ARES 生产依赖或源码归档。该检查的会话/hooks/composer 为明确协议夹具，不冒充当前 DSH 窗口或新的在线模型执行。

本轮没有操作/重载用户窗口、另起 DSH、修改 METIS、发送消息或新增在线模型/金山/MCP 调用。用户当前窗口是否已加载最新版没有代为观察，新后端需现有一键重载加载；旧后端观察不可用时保留原运行记录与本地预览。原验收、执行和 MCP 保护通过源码字节比对复核；软件 GL 检查不代表所有硬件帧率保证。
