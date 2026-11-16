# ARES 作品工坊实施方案 · 2026-11-06

目标：将运行版 ARES 改为围绕真实作品的竞赛制作工作台。只参考 Agent Display 中 FACTORY 的工位、装配与交接思路，独立编写代码和视觉，不复制上游实现、资源或模拟数据，不集成其他九种主题。

范围与边界：仅修改 D:/METIS超级合并/ares（安装目录 Junction 同源）。不改 METIS、不另起 DSH、不控制用户窗口。保留既有验收、人工节点、模拟数据门禁、版本对象及 MCP 隔离。用户已取消团队网页；多人协作只使用金山可编辑分享链接，不增加协作服务器或第二套账号系统。

## 可验证任务

| 单元 | 文件 | 动作 | 验证与完成标准 |
| --- | --- | --- | --- |
| A 真实作品预览 | host/artifact-viewer.js、scripts/render_artifact.py、host/routes.js | 仅解析已登记作品；Office 复用 DSH officeToPdf，PDF 转页图；文本、表格、图片独立安全渲染；按内容哈希读取，保存稳定后刷新 | 真实文件与页图/正文一致；路径、凭据、越界、并发变化被拒绝；失败保留上次有效预览，不能冒充验收通过 |
| B 制作工作台 | client/artifact-viewer.js、client/project-workbench.js、client/app.js、client/style.css | 左侧作品与流程、中间预览，保留历史/验收/扩展的真实操作；页面与缩放保留；文本草稿保存有并发指纹与旧字节留存 | 自有 headless 浏览器打开真实文档、修改后自动更新、冲突保护、响应布局与原有关键操作通过 |
| C 原生项目助手 | host/node-execution.js、host/routes.js、client/project-session.js、client/client.js | 复用同项目真实 DSH 会话；右侧原生对话；作品/版本/页码上下文只填草稿 | 实际 SessionController、cwd 与 preset 校验；无额外模型循环/假事件/工作区选择；审批和 MCP 边界不变 |
| D 单一工坊视觉 | client/workshop-scene.js、client/style.css | 独立 SVG 工位与作品台，由真实节点、运行、作品版本驱动；可点击、减少动态效果、隐藏暂停 | 不生成假队员、假进度、假工具调用或花费；状态与后端事实对应，视图切换不丢对话 |
| E 金山协作收口 | client/project-workbench.js、client/artifact-viewer.js、host/project-collaboration.js（必要时） | 清晰的“金山共编→读取云稿→查看差异→采用工作稿”链路，复用现有分享与候选机制 | 不创建团队网页、不嵌未经授权的第三方编辑器；金山改稿不会静默覆盖本地；保留旧版本与重新验收 |
| F 集成审计与交付 | tests/、docs/、.claude/CLAUDE_STATE.md | 精准对应测试、实际 Host 转换验证、静态检查、可复核截图与报告 | 每项测试有真实输出，软件夹具与 Host/云验证分开；未验证的当前用户窗口、Office 云原版式不得报完成 |

技术路线：采用项目注册根与产物契约解析，不给预览接口任意文件读取能力；Office 原件只读并使用宿主转换服务；固定版本与工作稿分离；预览监测不自动验收、不执行网页脚本、不启动本地作品服务器。助手继续由 DSH 处理模型、工具、流式与审批。多人同时编辑由金山处理，ARES 负责显式读回候选和版本采用。

风险：Office 转换依赖宿主服务及字体；正在写入的 Office 包可能短暂无效；大文档需要页数/大小限制；本地与云端是两个版本来源。通过稳定读取、内容指纹、上次有效预览、明确状态和显式采用处理。不承诺在本地界面同步金山未保存的键入，不承诺任意 Office 布局/字体完全一致。

交付物：运行版代码、精准测试与真实结果、原生 Host 转换证据、headless 界面截图、实现说明与未验证边界。禁止用截图占位、模拟器或只做按钮入口冒充完成。
