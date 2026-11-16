# ARES 步骤星核、成员黑洞与项目进度

运行版：`D:/METIS超级合并/ares`，前端与新增进度接口标记 `2.3.0-process1`。本轮只处理步骤可视化、成员活动和进度管理；原有整屏星河、DSH 原生助手、作品预览、金山协作、版本与验收继续使用。

## 实际使用

1. 星核代表实际流程步骤。每一步单独显示编号、名称、推进状态和负责人，中央缓慢公转；悬停或键盘聚焦时暂停公转，便于阅读和点击。点击后直接进入该步骤，执行、查看作品、检查验收和记录工作均保留。1–40 步不会再合并成十个分区；密集流程收起非选中名称，悬停或聚焦展开。
2. 成形黑洞代表项目登记成员。虚线表示实际分工，细线和箭头表示前置关系。点击成员查看负责的步骤及可追溯活动。新活动以光点、节点反馈和姓名/步骤/说明呈现；历史回放单独标明，刷新不重复当成新活动播放。
3. 左上「进度」或右下进度数字打开项目进度。可添加队员、分配步骤、保存项目/节点截止时间与预计小时，筛选负责人、查看工作稿、登记推进、待检查、待前置、异常及已验收。工作登记可以关联该步骤真实保存的工作版本。返回星河后保持同一 Canvas。

验收百分比只依据真实 `done` 状态。保存工作稿、登记开始/提交、播放动画或回放不会登记验收、执行工具或修改作品。依据失效的步骤显示「待复核」，跳过显示「已跳过」，均不冒充验收完成。常规等待前置单独显示，不算异常阻塞。

## 活动来源

成员姓名来自项目名单。当前接口能可靠区分已有系统事件和「负责人登记」：工作说明由已认证的本机负责人提交，事件实际 actor 仍为 owner。不能将登记说成队员本人已认证操作，不能从负责人分工推断该成员已经做过工作。

金山仍是唯一团队共同编辑渠道。本轮没有新增团队网页、改变分享权限或发送通知。金山匿名编辑及最近访问者不能可靠提供逐人逐步编辑身份，因此没有伪造在线状态、编辑轨迹或成员动作；无法归属的系统记录明确显示未归属成员。本轮没有新增真实模型、金山或外部 MCP 调用。

工作记录为原有不可变事件存储中的 `work.recorded`，带内容哈希、提交编号、来源和实际操作者。新增 owner 保护的 POST `/ares/api/v2/project/progress` 与 `/ares/api/v2/project/progress/work`。登记支持幂等读回、修订冲突检查、成员/步骤/版本边界及限定字段，不接受改变任务状态或已验收类型。损坏历史单列错误，不补造活动。已有验收、执行、工具、MCP 和原生会话核心实现不变。

## 渲染与兼容

参考 [DISPLAY 的 FORGE](https://github.com/cyberdaddyleo/agent-display)，固定研究提交 `ff44824a741d9b2a767b82f39d3dd34c75c87e3f`。仓库没有独立黑洞 PNG，视觉依据是上游实际渲染的 collapse 帧；原图里的业务指标是模拟内容，只作美术研究，未进入 ARES 业务状态。保留来源署名和字体许可，产品中黑洞与星核以代码绘制。

保留吸积，加上本次明确要求的慢速公转与有来源的活动反馈；不恢复七段整机变形动画。共用 WebGL 场景，步骤点云总量按数量分配，宽屏不超过 50000、窄屏不超过 30000；无 WebGL 时明确显示低密度兼容点云，不冒称 GPU 成功。暂停、系统减少动态效果、页面隐藏与资源销毁继续生效。软件 GL 检查不等于保证所有硬件的帧率。

十个源模块和三种字体继续构建到旧的 `workshop-scene.js` / CSS 入口，不要求宿主新增静态资源路由。未重载的旧宿主缺少新后端接口时，步骤和已有进度仍可打开，工作登记明确禁用并提示重载。当前用户窗口未代重载、未操作；使用已有一键重载后才会加载新增后端路由。

## 实际验证与修复

证据根：`C:/Users/lauze/Documents/Codex/2026-11-02/c/work/ares-process-orbits-20261107`。

- 对应组首次运行 79 项，78 通过、1 失败。原因是镜头测试原固定拖动坐标被新增节点按钮覆盖；测试现在先验证命中实际空白画布，再操作真实拖拽、滚轮、双击和快捷键。精准复测 2/2 通过。
- 审计补查发现新读模型把原有 stale/skipped 显示成待开始，新增断言真实复现后修复。最终受影响组 26/26 通过，无失败/取消/跳过；与前组其余 54 项合并为 80 个不同的对应检查，最终均通过，不重复累加重跑项。原始失败日志保留。
- 新界面测试通过实际生产处理器保存/读回成员、分工、截止、预计小时、关联版本与工作登记，核对作品字节、全部任务及验收不变；验证活动去重、历史标识、390px 布局、旧后端降级及从编排返回后的进度轮询。
- 实际绘制验证 1/9/40 步全节点、真实 GL 错误为 0、受控点数、公转和悬停暂停；旧文件/版本恢复、冲突保护、PDF/HTML 预览、流程构建、子插件、原生槽位及加载入口继续通过。涉及金山/原生协议夹具的测试明确是软件协议验证，不冒充新的在线验收。

运行命令：

```powershell
node scripts/build_forge.mjs
node scripts/build_forge.mjs --check
node --test --test-concurrency=2 tests/galaxy-field.test.mjs tests/galaxy-client.test.mjs tests/client-workbench.test.mjs tests/workshop-client.test.mjs tests/sci-fi-client.test.mjs tests/forge-faithful-client.test.mjs tests/forge-faithful.test.mjs tests/forge-scene.test.mjs tests/client-module-loading.test.mjs tests/editor-client.test.mjs tests/project-session.test.mjs tests/native-session.test.mjs tests/process-orbits.test.mjs tests/project-progress.test.mjs tests/process-progress-client.test.mjs
node --test --test-concurrency=2 tests/process-orbits.test.mjs tests/project-progress.test.mjs tests/process-progress-client.test.mjs tests/forge-faithful-client.test.mjs tests/forge-faithful.test.mjs tests/forge-scene.test.mjs tests/client-module-loading.test.mjs
```

完整日志、实际测试名称合并结果、源文件审计、运行截图和源码清单随交付保存。审计以本轮 411 文件基线比对，保留已有未提交改动；主模型复核图形、实际日志及守卫差异，不修改 METIS，不另起 DSH，不控制或重载用户窗口。
