# ARES 2.3.0 · 作品工坊

2026-11-06 开始实施，2026-11-07 完成本轮验证。运行源码：`D:/METIS超级合并/ares`；桌面安装目录的 Junction 指向该源码。

## 使用

项目默认进入“制作现场”。左侧选择真实流程工位和作品，中间直接看文件，右侧使用同一项目的 DSH 原生助手。“流程管理、资料与规则、项目事实、扩展能力、版本与队员”保留已有操作，按需进入。

- **工坊场景**：仅参考 [Agent Display FACTORY 的工位与交接思路](https://github.com/cyberdaddyleo/agent-display)，几何、视觉和代码独立编写。只呈现真实流程、节点运行、已保存作品和验收数量；没有接入十套主题、上游资产或模拟器。动画只随实际节点运行出现，隐藏、离屏和减少动态效果时暂停。
- **实时作品台**：本地文件保存稳定后自动刷新。Office 通过 DSH 自带的 `officeToPdf` 转为真实页面，PDF 分页看图，保留页码和缩放。还支持 Markdown、UTF-8 文本/代码、PNG/JPEG/GIF/WebP、受限静态 HTML、作品目录和固定作品版本。正在写入的 Office 包无法解析时保留上次有效预览，随后自动重试。
- **文本编辑**：保存时同时检查项目修订和原文件 SHA256，保留旧字节并形成工作版本。外部编辑冲突不会覆盖；旧编辑草稿保留，可在查看新稿后点击“基于最新稿编辑”，把需要的内容手动合并。内容未变时不生成新修订、不使验收失效；UTF-8 BOM 保留，非 UTF-8 不强行改写。
- **原生助手**：右侧连接与节点执行复用同一个真实项目 Session，固定 cwd 和原生 preset，不再要求选择工作区。选中的作品、指纹、历史版本、页码、表页、文本或归一化页面区域只填入原生草稿，由用户决定发送。模型、流式、工具目录与审批仍由 DSH 提供，未增加自建聊天循环。
- **金山共编**：所有多人编辑在金山完成，没有团队网页、协作服务器或另一套账号系统。每项目选择一次目录，可关联已有云文档，或将当前本地 Markdown/文本/Office 上传为新的金山工作稿。开启链接共同编辑、复制链接、金山历史与批注集中在同一张文档卡片。上传默认不改变分享；明确点击“开启链接共同编辑”后才调用既有分享机制并独立读回。
- **云稿回流**：“读取最新云稿 → 查看实际差异 → 采用云稿”。不会自动把队员的云端改稿覆盖到本地。未知上传结果保留原操作与文件 ID，按原记录核对，禁止重复上传碰运气。已知模拟来源经过金山转换后仍保持 synthetic 标签，采用回来依然被正式验收门禁拦截。

## 验证证据

证据根：`C:/Users/lauze/Documents/Codex/2026-11-02/c/work/ares-workshop-20261106`。

1. **最终精准回归 112/112**：`FINAL-targeted.log`，失败、取消、跳过均为 0。命令覆盖新预览/原生会话/金山上传与恢复/模拟来源，以及受影响的 API、原有验收、流程配置和全部 17 项已有工作台 DOM 操作。这是一次最终结果；早期各组包含重叠，不累加，也没有把软件夹具说成在线实测。
2. **真实 DSH Host**：`C-D-live-host.json` 与 `C-D-host-final-audit.json`。既有进程 PID 78424，项目助手与节点执行 Session 相同；实际目录返回 92 个工具。原生回合实际调用 `ares_project / ares_library / pwsh / write / read`，调用均成功，实际文件标记读回。结果 `awaiting-review`、节点 `pending`、`accepted=false`。只对自有软件 QA 会话临时选择 DeepSeek，未调用 Kimi，未改全局默认模型。
3. **真实 Office 转换**：同一 Host 的 DOCX/PPTX/XLSX 均转为 PDF，独立 PyMuPDF 渲染首张 PNG，保存页数、PNG 签名、大小和 SHA256。三张实际页图已逐张查看；Excel 公式 5+7 在实际转换页中为 12。测试素材明确为软件 QA，不能充当竞赛成果。
4. **真实金山**：`E-live-kdocs.json`。通过生产上传函数新建私有软件验收稿（链接不随源码公开），独立核对文件信息与分享状态，读取内容标记；在保留本地另一次编辑的情况下生成候选、展示差异、显式采用为新工作版本，旧字节可由不可变对象读回，节点 `stale` 且未验收。原有已授权的公开可编辑 QA 文档只读核对仍为 open/anyone；未新增公开分享。
5. **界面验证**：`tests/workshop-client.test.mjs` 使用自有 headless Chromium 和真实生产路由/文件，覆盖实时更新、并发编辑与继续合并、PDF 页码缩放/半写入、静态 HTML 隔离、390/800/1280/1600 宽度和金山入口。云写入 DOM 部分明确是协议夹具；实际云验证单独列于上一项。截图在测试日志指向的 `ares-tests/ares-workshop-ui-*`，不是用户桌面截图；其中原生助手占位属于无 DSH 的软件界面测试，不能当作用户窗口已加载的证明。
6. **临时联调清理**：3 个本轮自有 Host 模块和精确的 profile 片段已移除，保留其他所有 profile 字节；自有 QA 根已取消用户工作台关联。没有启动另一个 DSH、子 Agent、接管窗口、修改 METIS 或新增公网监听。

对应命令：

```text
node --test tests/api.test.mjs tests/core.test.mjs tests/native-session.test.mjs tests/project-session.test.mjs tests/node-execution.test.mjs tests/editor-client.test.mjs tests/editor.test.mjs tests/cloud-working-draft.test.mjs tests/cloud-candidate.test.mjs tests/client-workbench.test.mjs tests/workshop-client.test.mjs tests/artifact-viewer.test.mjs
node work/ares-workshop-20261106/live-kdocs.mjs
python work/ares-workshop-20261106/activate_host.py
python work/ares-workshop-20261106/cleanup_host.py
```

后面三条为本次明确软件 QA 的证据脚本，不是日常启动命令，不应重复创建验收文档。Node/Python 命令使用了已有本机依赖；Playwright 测试使用 `ARES_PLAYWRIGHT_PACKAGE` 指向既有可信安装，不执行上游 Agent Display 代码或安装其依赖。

## 修复与边界

- 真实联调发现当前 DSH 已移除旧 `sessionController.inspect`。新增 `native-session.js`，从实际注册 Agent 的真实 Session header/事件读取身份，兼容旧实际 inspect 接口；不补造 header、事件、审批上下文，不降级身份校验。同步修正项目与配置编辑助手。Office 转换取消信号也按当前实际 API 改为第二参数。首次失败报告保留，修复后完成真实 Host 和对应回归。
- 常规预览文件最多 32MiB，转换 PDF 最多 64MiB/600页；文本编辑 1MiB，金山快捷上传 16MiB。大文件仍可通过原编辑器/金山处理。没有转换服务时 Office 明确显示正文或表格内容视图，不伪造版式。字体缺失会提示，不承诺所有字体完全一致。
- HTML 仅静态预览，不执行脚本和外部资源；动态网页、视频及本地开发服务器没有在本轮冒充实现。
- 本地预览实时追踪已保存文件；队员正在金山键入的内容在金山查看，ARES 经读取云稿和显式采用同步到本地。没有跨电脑实时合并 `.ares/project.json`。
- 云稿采用仍是服务端转换文本生成工作稿；Word 原版式/图片，以及 XLSX/PPTX 原件往返保真编辑不作承诺。可在金山直接编辑 Office 原工作稿，本地原件与固定版本保留。
- 保留旧人工确认、哈希复核、正式规则与模拟数据门禁、受授权的 MCP 隔离。实际验证了具体工具调用和合法工具目录，没有宣称所有外部 MCP/模型都逐项执行或绝对零风险。
- 尚未代用户重载或检查当前缓存窗口；运行源码与资源版本已更新，用户可自行使用现有“一键重载”查看。未处理与本任务无关的旧工作区改动，未创建新 worktree 或另一个 DSH。

主要生产变更：`host/artifact-viewer.js / native-session.js / cloud-working-draft.js`，`scripts/render_artifact.py`，`client/artifact-viewer.js / workshop-scene.js / project-session.js / workshop.css`；接入 `routes / node-execution / native / editor-workspace / project-collaboration / cloud-candidates` 和 `client / app / project-workbench`。版本、缓存键、使用文档及对应测试同步更新。准确文件清单与指纹以交付 manifest 为准。
