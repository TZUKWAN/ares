# ARES 界面与交互动效精修 · 2026-11-12

目标：按刘总要求，逐处精修整个功能界面的细节与动画。直接修改运行版 D:/METIS超级合并/ares；不改 METIS，不操作用户窗口，不另起 DSH。保留常驻原生助手、已有流程/作品/云文档、审批/验收和 MCP 隔离。

## 最小验证单元

|单元|涉及文件|动作|验证与完成标准|
|---|---|---|---|
|P1 统一视觉基础|client/interface-polish.css，scripts/build_forge.mjs|统一颜色、字号、间距、控件、表单、标签、导航；精修作品和助手外壳|原资源构建正确；真实页面桌面/窄屏可读，无横向溢出，四导航与常驻助手可见|
|P2 交互动效|client/interface-motion.js，client/app.js，构建入口|有边界的波纹/聚光、面板和弹窗进场、列表层次切换、真实忙碌反馈；同页刷新不重复进场|真实指针和键盘触发，等待对应请求而非假进度；减少动态立即取消，卸载清理；聊天/预览 DOM 保持|
|P3 功能界面精修|同一视觉层；必要时调整现有模板语义|项目/赛事/本赛流程/能力、节点弹窗、协作/资料/版本、作品阅读编辑细节统一|逐页面实际截图复核；本赛流程真编辑/预览、作品真打开/编辑、助手常驻及旧门禁机制保持|
|P4 最终核验与交付|tests/interface-polish-client.test.mjs，文档与状态记录|只跑对应UI/加载/原生Portal回归，最终构建/语法/源范围审计|新检查无失败；保护后端文件SHA相等，主模型查看真实界面图；明确协议夹具与当前用户DSH未代操作的边界|

技术路线：利用原来的认证CSS和workshop-scene.js两个入口，不增加运行中宿主依赖的静态路由；原生CSS/Canvas/Web Animations，无新库。新增精修层作为最终设计规范，旧模块保留兼容；本轮不改球体比例或原本数据结构。

风险与控制：原有多轮选择器可能覆盖新规范，按真实计算样式/截图处理；不对画布定位节点施加transform，以免干扰旋转坐标；动画只描述界面变化，不造业务活动；所有输入保留焦点/草稿；本机浏览器验证不冒充在线模型或金山写入。

交付：运行版源码、实际界面截图/动效记录、命令结果与源审计、简明改动和边界说明。

状态：P1–P4 已完成本轮实现与对应验证。运行版客户端缓存为 `2.3.0-polish1`，后端 API 仍为 `2.3.0-competition1`。

## 实现与复核

新增 `client/interface-polish.css` 作为统一规范，覆盖控件、表单、底栏、功能面板、项目/赛事/流程/能力、进度、节点详情、作品与原生助手；新增 `client/interface-motion.js`，负责真实指针反馈、面板/弹窗/列表进场、选项展开、流程卡片移动、作品定位与请求等待反馈。动画复用浏览器原生能力，无新增运行依赖。

`client/app.js` 只接入UI生命周期、真实忙碌态与易读的动效开关；`client/galaxy.css` 移除旧的全局禁止动画规则。`scripts/build_forge.mjs` 将15模块与3字体继续编入既有资源，未增加运行中宿主依赖的新路由。其他业务前端与既有测试的修改仅为缓存参数。

视觉问题已修正：搜索图标与文字重叠、项目卡片双重边框与窄屏横排、窗口/按钮尺寸不一致、进度卡片方硬、作品编辑字号偏小。动画坐标换算考虑父画布缩放，最终实测110%缩放前与动画起点坐标完全相同：x=329，y=512.15625。

验证命令：

```powershell
node scripts/build_forge.mjs --check
node --test --test-concurrency=1 tests/interface-polish-client.test.mjs tests/competition-workbench-client.test.mjs tests/native-portal-client.test.mjs tests/client-module-loading.test.mjs
node --test --test-name-pattern='real pending' tests/interface-polish-client.test.mjs
git diff --check -- client scripts/build_forge.mjs tests README.md
```

运行环境使用已存在的Playwright与React测试依赖，自有浏览器，无新DSH进程。完整对应检查11/11，缩放坐标精修后对应一项再测1/1；后者属于同一项复测，不计为第12个独立检查。22个变更/新增JS/MJS语法检查及生成产物逐字核对通过。涵盖真实项目流程的保存/预览/应用、跨项目不变、四导航/项目搜索、实际作品打开/编辑草稿、多人分工、按钮/弹窗真实动画、OS与手动减少动态、真实请求等待、常驻React Portal及输入DOM/草稿保持、1920/1440/1280/800/390布局与旧资源路由加载。

测试中三类等待问题均保留失败及复测：固定30ms不能代表媒体change已送达，改为等真实事件；固定520ms不能代表动画已提交完成，改等Animation.finished；同步button.click后尚未完成异步点击分发，几何验证改等待实际重绘DOM。初次弹窗采图过早出现空遮罩，最终等动画完成重新采集，实际opacity=1且内容可见，没有把早期图作为交付。未留下已知未修复的本轮关键失败。

主模型已核对变更diff并实际查看项目、赛事、流程、能力、节点详情、进度、资料、事实、作品编辑、主界面和窄屏以及原生Portal截图。源审计456→460文件：23改、4新、无删除；266个受保护文件原SHA不变，其中68个后端/入口文件不变。业务/验收/审批/MCP机制保持。

交付在 `C:/Users/lauze/Documents/Codex/2026-11-02/c/outputs/ARES-界面与动效精修-20261112`，包含实际截图、6.116秒浏览器实录GIF/MP4、85帧/85不同帧核验、日志与源码SHA审计。

边界：验证使用实际ARES代码/处理器与自有本地文件；原生会话/输入服务含明确协议夹具，不能当作本轮在线模型或云端写入验收。未代操作或重载刘总当前DSH窗口，当前窗口的实际加载尚未观察。未更改METIS、后端权限或云端分享，也未恢复任何旧大任务。剩余用户侧动作仅为现有窗口重载加载新版。

浏览器API依据：[Element.animate](https://developer.mozilla.org/en-US/docs/Web/API/Element/animate)、[MediaQueryList change](https://developer.mozilla.org/en-US/docs/Web/API/MediaQueryList/change_event)。
