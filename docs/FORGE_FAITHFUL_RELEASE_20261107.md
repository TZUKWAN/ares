# FORGE 视界熔炉完整还原与 ARES 适配

本轮已修改运行版 `D:/METIS超级合并/ares`。桌面安装目录 `C:/Users/lauze/.dsh/profiles/desktop/node_modules/ares` 是指向该目录的 Junction。插件版本仍为 2.3.0，前端资源标记为 `2.3.0-forge-faithful`。未另起 DSH，也未控制、重载或检查用户正在使用的窗口。

## 研究与还原依据

研究对象为 [agent-display 固定提交 ff44824](https://github.com/cyberdaddyleo/agent-display/tree/ff44824a741d9b2a767b82f39d3dd34c75c87e3f) 的 FORGE 主题。实际读取原始实现，并在自有、禁止外部网络的 headless 浏览器中运行该主题，取得十个阶段画面和六种模型画面。原版模拟器和原始参考源码没有放进 ARES 生产目录；渲染与业务适配重新编写。

上一版只处理中央平面黑洞，缺失了原版三维丝带、机械点云和完整信息布局。本次已替换该实现。

| 设计部分 | 当前实现与复核结果 |
| --- | --- |
| 布局 | 三栏、四底栏、顶部五段流程、两列构件卡、当前工序和版本记录；1920×1080逻辑画板。1600×900对照测量中，主三栏和底栏坐标与尺寸一致，所测标题与子面板差异最大0.816669像素；这不是全画面逐像素一致性声明。 |
| 字体和色彩 | 本地 Syncopate、JetBrains Mono、Noto Sans SC 子集，保留许可证并重命名字体内部名称；深色背景、冰蓝点云、琥珀锻造。三个字体面在实际浏览器中均已加载。 |
| 星核 | 14条三维丝带×10列×170点，共23800粒子；中心薄光子环、遮挡、58条空间轨道、1100星尘和900背景星。窄屏初始密度13440粒子。 |
| 构型 | 人形机器人、推进器、产线、园区、行星减速器、机械臂六种完整点云，支持自动巡展或手选。机械构件与实际流程分区分别计算，节点数改变不会把机械运动扭坏。 |
| 八段动画 | 吸积6秒、坍缩2.2秒、成形3秒、拆解2.2秒、每件锻造1.75秒、合拢2.4秒、交付构型3.4秒、回收2.6秒；7分区周期34.05秒。形变采用原版的三次缓入缓出，光环采用单独的平滑淡出曲线。 |
| 总线与HUD | 每个能力44条输入、每分区18条输出、24条版本通道；两段曲线、渐变、刻度、光包吸收与停留再派发、尾迹、余烬、到达反馈；120刻度、三圆弧、四角标记、交付冲击波。 |
| 镜头与标签 | 环绕/正视/俯瞰，拖动惯性、滚轮、双击复位、V切换、Esc解除聚焦、6秒聚焦期限；动态投影标签与引线避让、随轨道移动的能力标签。输入框内不抢快捷键。 |
| 生命周期 | 更新真实项目快照时保留渲染器和原生助手DOM；隐藏时停止播放。尊重减少动态效果设置，WebGL丢失或不可用时明确降级为实际3600点的Canvas点云。 |

## ARES 交互与事实

- 左侧能力卡来自实际绑定技能；显示真实关联节点和验收数量。没有虚构Agent、CPU负载、上下文占用、token吞吐或工单。
- 右侧构件映射实际流程节点。长流程最多十个几何分区，仍保留全部节点；选中构件进入已有节点操作。执行、作品、检查和验收仍走原有逻辑与门禁。
- 事件流、版本、资料、原生调用和JSON快照来自已有数据。元数据未知时显示“—”；只有实际匹配项目根目录且存在会话ID才显示DSH会话标记。原版模拟执行代码改为真实JSON/原生回执的打字展示。
- 空闲时显示明确标识的“结构预演 · 动画不执行任务”。播放到锻造或交付不会写文件、启动模型、增加固定版本或通过验收。实际作业出现后自动跟随现场状态，已有人工验收规则保留。
- 全景、项目文件、项目助手可直接切换。助手继续使用已有DSH原生组件。三维构型是流程结构投影，实际作品仍由原实时作品台读取；金山链接共编方式保留。

## 修改文件

新增 `client/forge-geometry.js`、`forge-timeline.js`、`forge-renderer.js`、`forge-effects.js`、`forge-data.js`、`forge-view.js`、`forge-scene-controller.js`、`forge-theme.css` 和 `assets/forge-fonts/`。`workshop-scene.js` 改为新场景入口，删除 `workshop.css` 内旧平面场景样式。`artifact-viewer.js` 接入持续更新和可见性，`app.js` 传入实际技能与会话元数据，`client.js`/`project-workbench.js` 更新资源标记。

`host/routes.js` 仅新增受原owner门禁保护的静态模块、字体和样式拼接。与本聊天既有2.3.0源码快照逐文件SHA256比较，其他host文件及index/package/plugin/patch共64个核心文件一致；既有执行、验收、金山、工具和MCP隔离代码均未改变。本轮没有修改METIS。

## 实际验证

在运行版目录执行，使用本机已有Playwright，所有浏览器均为自有headless实例：

```powershell
$env:ARES_TEST_ROOT='C:\Users\lauze\Documents\Codex\2026-11-02\c\work\ares-tests'
$env:ARES_PLAYWRIGHT_PACKAGE='C:\Users\lauze\AppData\Roaming\Python\Python314\site-packages\playwright\driver\package'
node --test tests/forge-faithful.test.mjs tests/forge-scene.test.mjs tests/forge-faithful-client.test.mjs tests/workshop-client.test.mjs tests/client-workbench.test.mjs
```

最终结果42/42通过，失败、取消、跳过均为0，耗时约52.8秒。覆盖十个阶段画面、六模型、真实字体加载、持续完整周期、实际WebGL绘制、镜头像素变化、暂停、面板收放、节点选择、真实Markdown/PDF/HTML预览、保存冲突、既有流程/版本/云稿入口以及兼容降级。

连续周期实际绘制700帧，跨越八阶段再进入下一构型；阶段边界误差小于0.051秒，GL累计错误为0。播放前后项目文件字节、真实验收/工作版本/固定版本/调用数量均保持不变，没有业务写请求。截图时间与原作者50毫秒快进调试时钟对齐，不能把参考模拟工单的完成数量当成ARES验收数量。

本轮复现并修复：WebGL着色器精度不一致导致链接失败；渐变标题被继承阴影压暗；工序按钮裁切；未知根目录被误判原生绑定；隐藏区域零尺寸布局；JSON语法展示转义；坍缩与回收缓动曲线不符。测试中两处选择器歧义和受控RAF默认轮询等待也已修正并复测。历史失败日志保留，最终通过日志为 `work/ares-forge-faithful-20261107/final-calibrated.log`。

最终图像与时序证据位于本聊天 `work/ares-tests/ares-forge-faithful-4B0nXV`，参考研究与对照图位于 `work/ares-forge-faithful-20261107`。主模型已查看十个阶段、六模型、完整工作台、窄屏和降级图；已校准坍缩环厚度及回收散度。软件QA项目均明确标为非竞赛成果。

## 边界与来源

独立机械采样点、真实流程分组、业务文案和原版模拟数据有明确差异，不声称逐顶点或全画面逐像素一致。headless软件渲染验证不等于所有硬件性能保证；WebGL不可用时使用明确标识的低密度静态兼容视图。未替用户重载缓存窗口，因此没有声称用户当前窗口已经加载新UI。

此视觉回归中的云协作、原生回执部分使用明确的软件协议夹具；本轮没有新调用DSH模型、外部MCP或金山API，不能将这些UI结果当成新一轮在线工具验收。既有机制通过源码比较及对应本地回归确认保留。

视觉研究来源：[agent-display](https://github.com/cyberdaddyleo/agent-display)，原项目许可证 [PolyForm Noncommercial 1.0.0](https://github.com/cyberdaddyleo/agent-display/blob/ff44824a741d9b2a767b82f39d3dd34c75c87e3f/LICENSE)，保留作者署名 `Required Notice: Copyright (c) 2026 赛博老爸`。字体单独按Apache/OFL许可证处理，具体源地址与SHA256见 `assets/forge-fonts/SOURCES.json`。原始参考源码仅用于私人研究，不在运行版或源码交付包内。
