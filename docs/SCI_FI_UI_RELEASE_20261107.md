# ARES 全界面科幻工作台交付

已直接修改运行版 `D:/METIS超级合并/ares`。安装目录 `C:/Users/lauze/.dsh/profiles/desktop/node_modules/ares` 仍为指向运行源码的Junction。插件版本保持2.3.0，前端加载标记更新为 `2.3.0-system1`。没有修改METIS、启动另一套DSH、重载或控制用户窗口。

## 已实现

| 部分 | 实际行为 |
| --- | --- |
| 统一外壳 | 四个主页面、项目各子页、表格、表单、通知、错误、空状态、工具栏和操作面板统一深空背景、冰蓝线框、琥珀反馈及本地字体；品牌仅ARES。 |
| 全局快捷查找 | 搜索实际项目、赛事、流程、技能；点击结果进入对应项目、流程、赛事或技能正文。支持Ctrl/Cmd+K、上下键、Enter和Esc；输入框与原生会话不抢快捷键。 |
| 连续项目工作区 | 当前流程节点与固定作品版本置于同一时间轴。节点显示实际状态、工作稿及覆盖该节点的版本数；选择版本读取当时的真实流程、节点状态、文件与指纹，沿用实际对比/恢复入口。 |
| 节点与作品切换 | 从时间轴进入节点，保留既有执行/作品/检查/验收操作；离开作品编辑时暂存未保存草稿，回到该文件可继续编辑。视觉选择和预演不改变验收。 |
| 流程画布 | 使用真实dependsOn绘制SVG连线，点选节点在属性区编辑。支持拖动排序、Alt+上下键、增添/复制/删除、缩放复位和空白拖动画布；重排同步顺序依赖，自定义依赖倒置仍阻断。保存后已从实际配置读回检查。 |
| 统一能力库 | 技能与来源、当前项目子插件与预测试在同一入口。子插件卡显示实际清单的输入、输出、用途、版本和启用状态；启用、绑定、运行和历史沿用原项目权限链路。 |
| 常用接口字段 | 构建HTTP子插件时可填写名称、用途、地址及逐行字段，不必手写完整JSON。字段生成实际JSON Schema，支持string/number/integer/boolean、中文显示名和可选项；拒绝重复、不安全或无效字段。复杂约束继续使用高级清单。 |
| 上下文操作面板 | 项目、版本、能力、规则、协作及流程编辑对话采用统一侧面板。进入时定位可用控件，Tab限定在可见控件，Esc关闭后恢复原操作按钮；异步刷新保留对应控件焦点。 |
| 原生助手 | 继续使用DSH原生组件。项目助手支持拖动或键盘调宽，保持会话槽位DOM；流程编辑可切换属性和助手，仍支持展开。没有制作替代聊天后端。 |
| 作品阅读 | 深色工具栏包围实际作品；Markdown纸张和正文保持浅纸黑字，PDF、图像、HTML内容保持原有预览与隔离规则。编辑冲突、历史版本和云稿入口保留。 |
| 动画 | 页面及面板短过渡、选中依赖线、低亮星点微动和顶部光带。成功、工作稿、待验收等业务状态继续读取真实记录。手动“减少动态效果”同时控制CSS和真实WebGL时间，记住本机偏好；OS减少动态效果优先。 |
| 窄屏与加载 | 390/800/1440等宽度核对无页面横向溢出；长流程使用内部画布滚动，长节点文字截断不串入邻卡。全部新样式继续编译到旧workshop.css入口，场景仍自包含，不依赖宿主新增路由。 |

## 修改文件

- `client/ares-system.css`：全应用设计变量、组件、布局、窄屏与动画。
- `client/app.js`：统一外壳、真实搜索、流程画布、能力入口、动效偏好及面板焦点。
- `client/project-workbench.js`：项目节点/版本时间轴、能力卡、字段表单转实际schema及节点切换。
- `client/artifact-viewer.js`：带草稿保留的返回现场、动效控制。
- `client/forge-scene-controller.js`：手动/OS减少动态效果及助手宽度控制，保留原生命周期管理。
- `client/client.js`：更新前端版本标记；`workshop-scene.js`、`workshop.css`由构建脚本生成。
- `scripts/build_forge.mjs`：将系统样式纳入既有入口，保持七模块/三字体构建校验。
- `tests/sci-fi-client.test.mjs`：六项新完整UI验证；两处现有加载/场景测试只同步规范入口URL。

## 对应验证

使用本机已有Playwright，自有headless浏览器运行生产处理器和自有项目文件，未操作用户窗口：

```powershell
$env:ARES_TEST_ROOT='C:\Users\lauze\Documents\Codex\2026-11-02\c\work\ares-tests'
$env:ARES_PLAYWRIGHT_PACKAGE='C:\Users\lauze\AppData\Roaming\Python\Python314\site-packages\playwright\driver\package'
node --test tests/sci-fi-client.test.mjs tests/client-module-loading.test.mjs tests/client-workbench.test.mjs tests/workshop-client.test.mjs tests/editor-client.test.mjs tests/forge-faithful-client.test.mjs tests/forge-faithful.test.mjs tests/forge-scene.test.mjs
```

对应回归58/58通过，失败、取消、跳过0，约88.8秒。覆盖既有流程构建、真实工作版本/版本恢复与对比、资料与规则、云稿采用、子插件、实际预览/编辑冲突/PDF/HTML隔离、原生助手协议、旧路由启动及六模型/八阶段/连续完整周期。

最终视觉复核发现并修正了节点小字串卡、页脚作用域选择器及窄屏品牌隐藏。最终运行源码再次执行：

```powershell
node --test tests/sci-fi-client.test.mjs tests/client-module-loading.test.mjs
```

7/7通过，失败、取消、跳过0，约59.4秒；包含最终页面巡检及所有新交互、旧路由启动。此前背景微动精修另有2/2针对性检查。这些测试组有重叠，不累加为一个总数。构建一致性 `node scripts/build_forge.mjs --check`、变更JS语法检查及 `git diff --check` 通过。

真实本地验证包括：拖放事件被实际触发，重排后的依赖及新增节点写入自有配置并读回；接口字段生成实际清单、启用并绑定固定版本，但未发送外部HTTP请求；模拟预测试实际运行20条样本，真实样本仍为0、正式节点仍pending；切换节点前后实际项目文件字节保持不变；手动降动效时实际场景时钟停止；原生槽位协议夹具草稿与DOM身份保持；Markdown实际纸张/正文颜色符合阅读设计。

已修复并保留复现记录的问题：旧studio容器样式将画布挤为176px，导致拖放不能启动；中文字段名称未写入schema的title；异步打开面板丢失返回焦点；长节点文案串卡及窄屏品牌隐藏。测试选择器曾误用旧编辑文案、盲切已打开面板及未填必填目标，均已按真实界面修正复测。历史失败日志保留于本聊天工作目录。

## 审计、证据和边界

基线与对应日志位于本聊天 `work/ares-full-ui-20261107`；最终UI截图和证据位于 `work/ares-tests/ares-system-ui-LbQEKu`，旧路由加载证据位于 `work/ares-tests/ares-module-loading-o3KE84`。主模型已查看项目现场、流程画布、赛事目录、技能/子插件、资料/事实、版本/引导/搜索面板、作品阅读及窄屏画面。

所有现有host后端以及index/package/plugin/patch通过源码指纹比较确认保留；没有放宽验收、MCP隔离、权限、未知结果核对或金山分享范围。详细变更指纹与最终源码快照在交付目录。

本轮原生会话与金山部分是明确的软件协议回归，不是新一轮真实DSH模型/金山API调用。截图中的“原生槽位协议夹具”仅用于验证DOM/草稿保留，不代表真实DSH会话。实际用户窗口未代为重载或观察，因此不声称它已经加载本轮界面。软件GL验证不等于所有硬件性能保证。复杂输入schema仍提供高级JSON，文稿内容保留自身视觉，插件主题不改写用户作品或DSH其他插件。
