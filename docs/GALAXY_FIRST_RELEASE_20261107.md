# ARES 星河入口与仅吸积动画

本次落实两个明确要求：打开ARES立即进入整屏星河，功能从场景内操作；动画仅保留吸积。运行源码仍为 `D:/METIS超级合并/ares`，桌面安装目录Junction指向该目录。前端入口更新为 `2.3.0-galaxy1`，插件声明版本保持2.3.0。

## 当前界面

- 启动、读取项目以及没有项目时都先显示星河。没有外侧导航栏、顶栏、项目标题区、分页工作台框架；无项目时明确显示空态，没有虚构项目ID、任务、技能、调用或验收记录。
- 项目、赛事、编排、能力、查找、新建、流程与版本、资料、金山、作品与助手入口进入场景HUD。功能作为星河上的单一操作层展开，底层画布保持存在；返回星河立即收起操作层。
- 功能层无额外应用窗口外框；编排节点、依赖与属性浮在星河上。打开操作层时弱化背景HUD，吸积背景仍可播放。作品保留自身纸张/图像内容，原生助手继续使用DSH组件。
- 切换项目、打开功能、查看版本、编辑作品或切换助手不会重新创建星河Canvas；实际WebGL上下文丢失时才按既有机制换成真实Canvas兼容渲染。

## 动画范围

动画状态集合现在只有 `ingest`。已移除坍缩、成形、拆件、锻造、合拢、交付、回收七段动画，以及阶段跳转、模型选择/巡展、预演/实际动画切换入口。逐字回执动画也已取消，场景中的其他CSS自动动画和过渡关闭。

吸积粒子、光子环、空间轨道、星尘与吸积光包继续运动；可暂停/播放，尊重OS减少动态效果，隐藏时停止绘制。摄像机拖动、缩放、复位与视角切换属于用户手动操作，保留。连续吸积没有“播放完毕即完成任务”的含义。

实际竞赛流程节点、作品版本、检查、人工验收、MCP隔离及金山协作均保留。运行中的调用、任务状态、工作版本和验收数来自真实记录，与动画时钟分开计算；不会因播放吸积生成版本或通过验收。

## 修改范围

- `client/app.js`：以持久galaxyDock替代外部页面外壳；HUD导航、单一操作层、原生会话停靠、作品操作、助手宽度和焦点管理。
- `client/galaxy.css`：整屏星河、场景内透明仪器层、窄屏及仅吸积的视觉约束。
- `client/project-workbench.js`：在场景内提供真实项目、节点、流程/版本、资料、文件、计划、子插件与协作入口。
- `client/artifact-viewer.js`：作品与背景分离，不创建第二个场景；保留草稿、保存、冲突、实时预览与历史。
- `client/forge-data.js`、`forge-view.js`、`forge-timeline.js`、`forge-scene-controller.js`：真实空态、单吸积状态、删除其他动画控制、场景回调与持久生命周期。
- `client/client.js`：规范缓存版本；`workshop-scene.js`和`workshop.css`为自包含生成入口。
- `scripts/build_forge.mjs`：将galaxy.css编译进已有资源入口，没有要求运行中的DSH新增静态路由。
- 对应测试更新为场景导航，并新增 `galaxy-field.test.mjs`、`galaxy-client.test.mjs`。旧17项业务、8项作品台的业务断言保留；已明确删除的阶段/模型界面断言改为仅吸积、控件与生命周期检查。

## 实际验证

最终命令在运行源码目录执行，使用本机已有Playwright和自有软件QA目录：

```powershell
$env:ARES_TEST_ROOT='C:\Users\lauze\Documents\Codex\2026-11-02\c\work\ares-tests'
$env:ARES_PLAYWRIGHT_PACKAGE='C:\Users\lauze\AppData\Roaming\Python\Python314\site-packages\playwright\driver\package'
node --test --test-concurrency=2 tests/galaxy-field.test.mjs tests/galaxy-client.test.mjs tests/client-workbench.test.mjs tests/workshop-client.test.mjs tests/sci-fi-client.test.mjs tests/forge-faithful-client.test.mjs tests/forge-faithful.test.mjs tests/forge-scene.test.mjs tests/client-module-loading.test.mjs tests/editor-client.test.mjs tests/project-session.test.mjs tests/native-session.test.mjs
```

最终66/66通过，失败、取消、跳过均为0，约131.9秒。日志为本聊天 `work/ares-galaxy-first-20261107/FINAL-corresponding-after.log`。

验证覆盖：

- 初始星河覆盖插件视口、无外侧页面框架；空态真实、从空态实际创建项目；跨功能Canvas身份不变；390/800/1280/1900布局和可点击入口。
- 实际WebGL分别在空态、真实项目下各绘制600帧，持续只有ingest，累计GL错误0，项目文件字节与验收数不变；纯时间状态覆盖240秒，其他阶段入口被拒绝。
- 实际相机像素变化、拖动/缩放/复位、暂停、键盘输入保护；真实上下文丢失、无WebGL、隐藏与减少动态效果。
- 真实文件自动更新、未保存草稿跨功能保留、实际保存/工作版本、固定历史与恢复/对比、编辑冲突、PDF分页缩放/半写保护、HTML隔离。
- 实际流程拖放/键盘排序/复制/保存读回、typed接口schema/无效字段拒绝、项目授权与绑定、预测试、规则、计划与既有云稿/批注收据链路。
- 原生会话适配、cwd/preset/工具元数据门禁与冷恢复，以及明确的原生槽位协议夹具DOM/草稿/宽度验证。

本轮实际修复：操作层与事实输入框同名导致无障碍定位冲突；更多菜单未收起挡住后续操作。修复后17项业务组全部通过。首次合并回归在三个并行软件GL负载下出现3处加载/点击等待超时（63/66）；业务与加载测试改用产品真实的减少动态效果分支，动画仍单独真实绘制，并行降低至2，最终全组通过。没有放宽测试超时、伪造工具结果或关闭业务断言。所有失败及修复复测日志保留。

## 交付与边界

已运行DSH的旧资源路由条件仍验证通过：全部资源经既有入口，字体本地内嵌，没有新增模块404依赖。现有host后端、index/package/plugin/patch通过SHA256对照确认未改，MCP隔离与验收机制保留。完整指纹、源码及截图在交付目录；主模型已复核进入星河、功能浮层、作品与窄屏实际截图。

截图和临时项目均为明确的软件QA资料，不是竞赛成果。本轮原生会话、金山部分包含明确协议夹具；没有新调用在线模型、金山API或给队员发送消息，不将其称为新的在线工具验收。没有修改METIS、启动另一套DSH或控制/重载用户窗口，因此没有声称用户当前缓存窗口已加载。软件GL验证不保证每种硬件性能；无WebGL时使用明确标识的静态兼容点云。

此前 `SCI_FI_UI_RELEASE_20261107.md` 的普通外壳、`FORGE_FAITHFUL_RELEASE_20261107.md` 的多阶段动画仅为历史记录；本说明覆盖当前入口与动画范围。
