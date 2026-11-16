# 中央现场 · FORGE 视界熔炉

本轮仅按用户最新要求替换中央现场。运行源码仍在 `D:/METIS超级合并/ares`，桌面安装 Junction 同源。原“工位沙盘”已由独立编写的黑洞、吸积盘、彩色双总线和作品线框投影取代；整体导航、原生助手、作品编辑/预览、金山协作及后端验收和 MCP 隔离未重做。

参考：[Agent Display 官方 FORGE 说明](https://github.com/cyberdaddyleo/agent-display#06--forge-视界熔炉)。只参考视觉与交互思路，不复制其代码、资源、虚拟 Agent 名单或模拟工单；没有接入其他九个主题。

## 实现与使用

- 中央采用原生 WebGL 着色器渲染黑洞和三维吸积盘，叠加原创 SVG 作品投影与输入/派发线束。场景保持暗色，打开作品后仍使用原文档预览面板。
- 环绕、正视、俯视、拖动、聚焦后滚轮缩放、双击复位和暂停只控制视觉，不发起模型调用、不推进任务。
- 左侧输入数量、右侧节点名称/状态、底部验收/版本/执行数量来自实际项目与运行记录。没有假负载、假 token 或自动循环的示例工作；未知版本列表显示“—”，不伪报零。
- 点击右侧真实节点会选中原流程节点；选中的目标产物以线框表达，不冒充文件内容。实际作品仍从左侧打开。
- 仅真实节点运行时出现总线传输效果。背景吸积盘是装饰性场景动态；隐藏/离屏暂停，减少动态效果时静止。场景释放时取消 RAF、移除监听并释放 WebGL 资源。
- WebGL 不可用或上下文丢失时切换实际 Canvas 2D 兼容静态视图，节点选择和作品预览继续可用。窄屏收起左输入栏，节点变为可横向滚动的底部条。
- 前端资源缓存链更新为 `2.3.0-forge`；后端版本和执行机制保持 2.3.0。未代用户重载当前窗口。

## 修改文件

`client/workshop-scene.js`、`client/workshop.css` 是本轮核心；`client/artifact-viewer.js` 接生命周期与视角偏好，`client/app.js` 传递当前选择；`client/client.js` 和 `client/project-workbench.js` 仅同步必要缓存引用。对应验证在 `tests/forge-scene.test.mjs` 和 `tests/workshop-client.test.mjs`。

## 精准验证

证据根：`C:/Users/lauze/Documents/Codex/2026-11-02/c/work/ares-forge-20261107`。

```text
node --test tests/forge-scene.test.mjs tests/workshop-client.test.mjs
node --test --test-name-pattern="FORGE renders" tests/workshop-client.test.mjs
```

第一组 **12/12**，失败/取消/跳过 0。覆盖真实 WebGL 编译绘制、相机像素变化、暂停帧一致、拖动/复位、减少动态效果、离屏暂停、上下文实际丢失后的降级、禁止 WebGL 时的实际 2D 绘制，以及现有作品预览/编辑与金山入口回归。软件协议夹具没有冒充云 API 或模型执行。

第二组 **1/1**，专门补拍中央 FORGE 在 390/800/1280/1600 宽度的画面并检查溢出；与第一组重叠，不合计为 13 个独立测试。本轮没有重复上一轮 112 项、真实 Host 模型或金山云写入。

截图来自自有 headless Chromium 的生产界面与软件测试项目，不是用户桌面；主模型已查看宽屏、390 宽度和兼容视图。真实 WebGL 分支有明确断言，未用兼容绘图冒充 GPU 成功。当前用户窗口是否已采用新缓存仍未观察。
