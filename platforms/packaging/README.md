# ARES · Codex / ZCode 本地插件

与DSH运行版共用竞赛目录、流程、项目、作品和版本业务核心。Codex/ZCode使用各自原生助手与工具，插件不另接模型API、不自动安装其他MCP，也不默认写入DSH的数据目录。

## 安装

需要Node.js 20或以上；本轮实测环境为Windows、Node.js v25.6.0。Office/PDF等检查仍按原ARES文档需要对应Python工具。服务器与页面SDK已随包自包含，无须为了运行再执行npm install。

Codex：解压`ARES-Codex-2.4.0.zip`，保持`ares`目录完整。把该目录作为本地市场添加，再安装：

```powershell
codex plugin marketplace add "解压后的ares绝对路径"
codex plugin add ares@ares-local-codex
```

ZCode：解压对应ZIP，在“设置→插件→创建→添加插件市场”中选择解压的`ares`目录或其中`.zcode-plugin/marketplace.json`，安装ARES。本地桌面工作区可打开ARES侧栏面板。

新会话中使用ARES技能或直接说明竞赛目标。Codex以技能和真实工具为稳定入口；自定义MCP Apps页面依宿主支持，不能把协议验证理解为Codex已具备DSH的嵌入会话界面。插件不替换宿主的原生聊天窗口。

## 开始使用

- 编排：选择实际比赛/赛道，读取流程、编辑步骤、保存流程。当前项目不会被共享流程的修改自动升级。
- 推进：读取项目和固定步骤，使用宿主原生文件/代码/文档工具工作；ARES读取、检查和记录实际文件版本。
- 可视工作台：MCP Apps兼容宿主调用`ares_workbench`；页面使用同一原版动画/新自适应画布，点击明确操作才把上下文交给宿主原生助手。
- 目录授权：ZCode包按当前工作区显式提供根目录；其他客户端使用标准`roots/list`，或在MCP启动参数中配置`--root <项目绝对目录>`。只有精确规范根目录可访问，子目录需要单独声明。
- 没有roots的Codex客户端仍可由已获当前项目命令权限的原生助手使用`ares-local.mjs`。先读`ares_capabilities`，显式传入其`home`和已授权当前项目目录；不拿此入口绕过已有目录拒绝。

```powershell
node scripts/ares-local.mjs --host codex --root "已授权项目绝对路径" --home "能力诊断返回的home" --tool ares_project --input "实际JSON输入文件"
```

## 存储与验收

默认数据目录为`~/.ares/codex`或`~/.ares/zcode`。要有意共享现有DSH配置/固定版本，显式配置同一个`--home`或MCP的`ARES_HOME`；不自动复制或替换任何原项目。DSH绑定的项目如便携进程无法核验其会话空闲，保留写入拦截。

模型不能通过JSON把自己设成负责人。结构检查、内容复核和负责人验收分别保留；受支持的本机操作由宿主标准确认表单批准一次，确认绑定当次参数和实际文件哈希，确认期间变更、取消或过期都会拒绝。缺少受信表单能力时保持待验收，原生命令入口也不能自行批准。该机制信任本机宿主的确认响应，不提供账号身份认证。公开分享、权限更改与云发布不会被插件自动授权。金山状态必须以实际工具结果为准，本轮没有代用户做线上模型或金山写入测试。

## 自包含来源

`PACKAGE_FILES.json`记录包内真实文件SHA。`PORTABLE_NOTICES.md`与`assets/neural-reference/`保留动画素材许可；`platforms/shared/vendor/`、`platforms/ui/licenses/`保留官方SDK和依赖许可。原神经动画媒体保持原字节，经固定分片资源传入页面，页面不连接外部资源域名。

本包用于本地私有安装；没有公开发布。参考媒体含非商用许可及记录的旧版MIT例外，不能把整个组合包描述为无条件商用MIT。
