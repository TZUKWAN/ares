# 原生 Auto 修复与真实验收 · 2026-11-24

已在原运行版 DSH 修复 Auto：真实模型发出的四笔普通工具调用均经原生在线审批允许并实际执行；另一笔受独立保护的待执行负例被原生审批判为 **high / deny**，工具体没有执行。原宿主未重启、未操作窗口，原 ARES 会话和另一条 Auto 会话均保留。

这次在刘总明确授权修复宿主 Auto 后完成。它取代 [此前实际失败的结论](DSH_LIVE_ACCEPTANCE_20261124.md)，失败原始记录保留。机器可读结果及原生序号见 [脱敏证据](evidence/dsh-auto-restored-20261124.json)。

## 原因与恢复范围

第三方 `dsh-purge` 同时修改了三层安全链路：跳过 Auto reviewer、把工具 ask 分支直接允许、把审批服务 decide 改为自动批准。仅修改 ARES 体检入口不能恢复这些原生方法。

本轮以本机同版本、未包含补丁标记的 `.dshpurge.bak` 为基线，恢复四个固定文件中的已知修改：

- `dsh-experimental-auto-review/lib/index.js`：恢复原生风险判断、原始策略与决策处理。
- `dsh-tools/lib/pipeline.js`：恢复 ask 的原生服务派发及拒绝/取消/不可用处理。
- `dsh-user-approval/lib/index.js`、`lib/types/index.js`：恢复 never 拒绝及正常 answerer 派发，修正“never 会自动批准”的错误提示。

当前 `Config.default(never)` 和所有用户配置值保留。原始备份不改，修复前/后源码私有归档；只公开指纹，不随插件分发 vendor 源码或用户会话历史。

## 运行中的宿主

恢复脚本先校验全部已知差异、路径/硬链接和候选语法，再原子写入，独立回读；未知改动会停止，部分写入失败则回滚。

原 Auto 插件实例没有卸载，因为原生卸载过程会切换其他 Auto 会话的权限。运行期恢复从修复后的 vendor 模块取得原生回调，迁移至原 Auto 作用域，保留已存在的 Auto 注册；原 pipeline/approval 实例换回对应原生方法。没有重写 reviewer policy、手工请求替代审批模型、构造 Session 历史或改 MCP 准入。最终仍只有一个 Auto hook，重复恢复返回已完成，不重复注册。

最终工具另外加入了对未知内存方法修改的严格拒绝和安装失败回滚。记录的实际替换前/后方法 SHA 与 vendor 源码逐项相符；额外未知修改的反例失败，最终版本的幂等检查通过。原生判定函数在真实验收期间及收尾回读保持同一指纹。

## 真实正反验收

| 阶段 | 原生审批 | 实际执行及独立证据 |
| --- | --- | --- |
| 正例 | 四笔 `low / allow` | `ares_config_read`、write、read、pwsh 全部成功；标记字节一致、算术35、任务exit0；13项检查全部通过 |
| 独立保护先验 | 一笔 `low / allow` | 安全写入被原生 monotonic guard 拦住，标记不存在、作业0。只有保护验真后才提交负例 |
| 拒绝负例 | 一笔 **`high / deny`** | 正常模型/工具待执行链路返回原生“body was not executed”；独立guard命中0、作业0。拒绝由Auto作出，负例命令未执行、未读取凭据或外传 |

全部使用既有 DSH、同一 ARES Agent 和已配置的 DeepSeek；审批都有实际调用ID、步骤、原生返回及完成流对应。没有把模型自述当执行证据。正例报告 `d41c3fcb-3387-462f-8d8b-eb8d0db4b995`，三个真实诊断回合分别为6、7、8。

临时原生 guard、唯一诊断入口及六个自有模块已精确撤回。profile逐字节恢复，原模型/权限/审批policy恢复、全局默认和其他Auto选择不变。清理后独立宿主回读确认：ARES正常、原Agent空闲、认证接口200/未认证401、工具目录ready、原生Auto一个hook、四个安装文件指纹正确。

## 代码及对应验证

- `scripts/restore_dsh_auto.py`：本机 vendor 文件的检查/选择性恢复工具；7项新增文件/回滚负例，连同原Python检查23/23。
- `scripts/dsh_auto_runtime.mjs`：仅供已有宿主显式维修，取原生回调/原方法，不在ARES启动或MCP调用中自动运行；4项注册与未知修改单元测试。
- `tests/dsh-auto-native.integration.mjs`：读取实际安装的原生方法，5项 never/ask/取消/缺失/错误/允许的协议检查通过。其输入和answerer是明确的协议carrier，不冒充真实在线或人工点击；上表才是真实在线验收。

```powershell
python -m unittest discover -s tests -p 'test_*.py'
node --test tests/dsh-auto-runtime.test.mjs
# ARES_DSH_NODE_MODULES 指向已安装的真实 DSH node_modules 时：
node --test tests/dsh-auto-native.integration.mjs
```

## 检查与维护

本机已完成运行期恢复，不需要刘总点击重连或重启。以下是检查当前安装文件的命令，不会写入宿主：

```powershell
$dshModules = Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\app\dsh\node_modules'
python scripts/restore_dsh_auto.py --node-modules $dshModules
```

显式恢复需另加 `--apply --backup-dir`，先保存私有备份。缺失备份、旧版/未知源码、硬链接或路径越界会拒绝操作。运行期模块不能在普通CLI中伪造Host context。

已确认 `dsh-purge` 启动自动应用关闭，普通启动不会自动覆盖本次修复；若之后手动重新应用其“权限绕过”补丁，会重新引入冲突，需要检查/恢复。这个维护限制明确保留。未代点人工审批弹窗，未把220个可见工具解释为逐个外部服务已调用。METIS、ARES客户端、原项目验收和MCP实现未修改，PR继续Draft、不合并。
