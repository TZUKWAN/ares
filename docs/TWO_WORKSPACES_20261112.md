# ARES 两工作区改造 · 2026-11-12

目标：按刘总确认的 METIS 职责划分，将主入口变为「流程编排｜项目推进」，编排保留 ARES 比赛→赛道分类；AI 明确跟随当前编排草稿或项目/步骤/作品，金山协同融入项目作品区。直接修改运行版，不改METIS、不操作用户窗口、不另起DSH，原验收/审批/版本与MCP隔离保留。

## 最小可验证单元与责任

|单元|文件/责任|动作|验证/完成标准|
|---|---|---|---|
|W1 可复用赛事流程|competition_workflows 子智能体：host/competition-workflows.js、projects.js、catalog.js窄改与对应新测试|复用现有configuration保存赛事/赛道/届次流程，项目从已保存流程独立冻结|无项目可读存；错scope/旧revision拒绝；旧项目/其他模板与验收不变|
|W2 两区主界面|主模型：app.js、routes.js、build_forge.mjs；workspace_design：workspace-layout.css/新UI测试|两主入口，赛事/赛道目录进入编排、已有流程画布编辑；项目星图/作品/金山与管理动作归入推进|真实保存→重读→新建项目采用该流程；跨两比赛草稿不串；390/800/1280/1920无横溢，原生助手常驻|
|W3 助手目标上下文|assistant_context：project-session.js、新host上下文、runtime-workbench；主模型接app/client/native输入|编排同步选中流程与未保存草稿；项目同步步骤/作品并绑定原生消息，排队不串对象|错session/root/version拒绝，延迟响应不覆盖新项目；原生消息绑定实际工具可读；不冒充在线模型执行|
|W4 对应回归与审计|各子智能体精准单元+主模型整合|原项目流程预览应用、原生Portal、金山载体保活、旧资源入口及保护机制回归|所有本轮对应检查通过；失败修复复测；主模型审阅子结果/diff/真实截图；交付源码审计与操作说明|

技术路线：复用现有全局配置/冻结与项目定义，不另建一套流程存储。编排资料以competitionTemplate元数据绑定赛事/赛道，项目仍独立固定版本；不自动把模板改动强推已执行项目。新前端能力经原workshop-scene.js/CSS自包含入口交付，避免运行宿主旧静态路由引发模块加载失败。后端升级未加载时明确提示需重载，不伪造已生效。

风险：草稿/AI建议竞争、编排与项目助手切换、旧项目与模板隔离、DSH原生发送ABI、并行改动冲突。责任文件不重叠，主模型集中接线；每单元完成即验证；未验证/未在线事项明确记录。金山本轮只验证既有UI与协议，不新增云写入或分享。

交付：运行版实现、赛事流程与项目新建/推进说明、真实界面截图/验证日志/源SHA审计、可恢复状态。基线460文件完整备份在本聊天 work/ares-two-workspaces-20261112/before。

## 已实现的使用路径

1. 进入「流程编排」，选择比赛和赛道。届次、组别按需展开；不需要先创建项目。赛事目录的 132 项保留，目录分类不会把所有比赛强塞进同一个行业模板。
2. 点击步骤，修改目标、交付物、技能和执行说明；支持添加、排序、依赖与流程设置。流程助手跟随当前选中步骤，发送前同步未保存草稿。AI 建议需查看后明确带入草稿，不自动替换已保存流程。
3. 点击「保存流程」，保存为这个比赛与赛道的可复用流程。遇到同流程或引用技能的并发修改，保留本地草稿并提示处理；不会直接覆盖远端。
4. 点击「用于新项目」，填写项目名称、目录与目标，项目采用刚保存的准确流程版本。编排另一场比赛，或修改该比赛的库流程，不会直接改变已有项目。
5. 切到「项目推进」，继续本项目星图、步骤、作品、人员安排、执行检查、验收和版本。右侧项目助手常驻，发送时绑定当前项目、步骤及作品；原生附件、引用、队列和工具调用仍由 DSH 管理。
6. 本地与金山共编在项目作品区切换、放大、对照。离开项目区只隐藏金山视口，返回后继续同一个网页；云稿采用仍经过原差异审阅和工作版本机制。

已有项目时默认进入项目推进，没有项目时默认进入编排。两侧原生助手、输入 DOM 和各自输入草稿在切区时保留。高级操作留在对应流程或项目详情，主导航只有两个入口。

## 实现文件

- `host/competition-workflows.js`：复用原 configuration 保存比赛/赛道/届次/组别流程；校验版本、范围、技能哈希，保存前冻结实际技能资源。
- `host/catalog.js`、`projects.js`、`project-flow.js`、`routes.js`：赛事归属校验、从库创建独立项目版本、项目自身流程兼容、受原门禁保护的新接口。
- `client/app.js`、`workspace-layout.css`：两区导航、比赛目录与节点编辑、按范围保留草稿、冲突处理与现有作品区接线。
- `client/client.js`、`editor-session.js`、`project-session.js`、`native-input-context.js`：保留原生聊天；在真实发送前获取当前编排/作品上下文，并绑定原生消息 ID。
- `host/project-chat-context.js`、`runtime.js`、`runtime-workbench.js`：校验真实会话、固定版本、项目目录和声明作品；排队消息按其自身绑定读取目标，不借用后来选择的步骤。
- `scripts/build_forge.mjs` 与生成资源：16 模块/3 字体继续经原自包含静态入口加载，缓存统一 `2.3.0-workspaces1`。

## 验证与修复

主模型整合运行以下对应检查，最终 **61/61 通过**，失败/取消/跳过均为 0，耗时 57.654 秒。不同运行的重复检查没有累加。使用真实源码、实际项目文件和生产路由；原生会话服务/输入服务与云浏览器租约边界使用明确标注的协议夹具。

```powershell
node --test --test-concurrency=1 tests/competition-workflow-library.test.mjs tests/competition-project-flow.test.mjs tests/project-chat-context.test.mjs tests/project-session.test.mjs tests/native-input-context.test.mjs tests/editor-client.test.mjs tests/editor-background.test.mjs tests/two-workspace-client.test.mjs tests/two-workspace-cloud.test.mjs tests/native-portal-client.test.mjs tests/native-two-workspace.test.mjs tests/client-module-loading.test.mjs tests/admission.test.mjs
node scripts/build_forge.mjs --check
```

实际验证覆盖：无项目编排→保存→重读→准确版本建项；旧项目与库流程隔离；跨比赛/赛道拒绝；并发流程与技能冲突；原生发送前未保存草稿同步与消息对象绑定；延迟响应不串项目；真实 React Portal 两区输入保留；1920/1280/800/390 尺寸的实际画布宽高、无横向溢出；同一云网页与租约在切区、放大、对照时保活；旧静态资源和 owner 门禁。

本轮修复过的具体问题：1280 宽度下旧网格列把画布挤窄；流程库创建的项目无法编辑自身流程；旧升级入口可误取另一个比赛的同领域流程；重读时覆盖人工草稿；只改技能未计入未保存状态；延迟赛事请求改动项目选中步骤；原生排队/异步展开期间上下文可能变化。对应测试均已通过，原失败和复测记录留在本聊天 work 目录。

## 证据与边界

开始实施：2026-11-12；最后整合与审计：2026-11-13。实际源码为 `D:/METIS超级合并/ares`，桌面 ARES 的 junction 指向该目录。

本聊天 `work/ares-two-workspaces-20261112` 留存 460 文件修改前备份、最终测试日志、逐文件 SHA 清单与源码审计；交付目录为 `outputs/ARES-流程编排与项目推进-20261112`，含说明、日志、源码审计与真实界面截图。截图中的测试项目与原生/云协议夹具均有明确标识，不是竞赛成果。

没有修改 METIS，没有操作或重载用户窗口，没有另起 DSH，没有新增在线模型请求、金山写入或分享授权。用户当前已打开的旧窗口需要一键重载后才能加载本轮前后端；未代观察该窗口的在线结果。本轮也没有为目录中每场比赛核验当届规则：没有专属方案的比赛仍显示诚实的起始草稿，由团队结合真实规则完善。

状态：本轮两工作区实现与对应回归已完成；原验收、审批、MCP 隔离和固定项目版本机制保留。构建、语法、源码保护 SHA 和 diff 审计结果以交付的 `source-audit.json` 为准。
