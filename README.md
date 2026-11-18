# ARES

面向高校竞赛的流程与作品工作台，支持 DSH，以及使用原生助手的 Codex / ZCode 适配包。

## 开始使用

1. 在 **流程编排** 选择比赛、赛道和适用届次，调整步骤、依赖与交付文件，保存流程。比赛和赛道可自行增加、编辑、隐藏及恢复。
2. 在 **项目推进** 创建项目并采用已保存流程。共享流程后续修改不会静默改变该项目。
3. 点阶段查看详情、分工与实际作品。右侧 DSH 助手常驻；发送时固定当前步骤与作品上下文。工具、审批和 MCP 权限由宿主管理。
4. 实际检查作品并由负责人复核，才能验收。文件、输入、前置结果或复核记录变化后，原验收失效。
5. 金山工作稿可上传、共同编辑、读取差异再采用；原稿字节和历史版本保留。开启链接编辑只作用于选中的工作稿，目录和归档不会一并公开。
6. 在项目设置里运行 **检查与验收**，查看具体缺口、实际文件 SHA256 和规则状态，下载统一报告。无必需规则条目、非负责人复核、未知执行或云端结果均不能通过。

能力库、子插件、问卷模拟预测试和项目期限管理保留。模拟结果始终用于预测试，不能成为正式调查证据。

## 研究工具

在已建项目的页头打开「研究工具」，可以编辑和定稿问卷、整理访谈与编码、登记数据集，并将版本绑定到项目步骤。右侧原生助手可为当前项目起草研究建议。

[使用与部署](docs/RESEARCH_TOOLS.md) · [参考源码与许可](docs/RESEARCH_SOURCES.md)

## 安装与版本

DSH 使用现有插件安装方式，入口为 `index.js`。本仓库不替换宿主、不安装其他 MCP，也不存储模型或金山 Token。

Codex / ZCode 的安装、重定位与宿主支持范围见 [本地插件说明](platforms/packaging/README.md)。适配包与 DSH 共用业务代码；宿主原生助手和可视 MCP Apps 支持分别验收。

主产品清单为 **2.3.0**，便携适配器与 MCP 协议发布线为 **2.4.0**；二者不是相同的发布编号。工作分支的准确内容以提交 SHA、构建收据及包文件清单为准，详见 [版本与第三方许可](docs/VERSIONS_AND_LICENSES.md)。

## 开发与验证

Node.js >=20；CI 使用 Node 24、Python 3.13，覆盖 Windows / Linux。Office、PDF、媒体等实际格式检查还需要 Python 依赖与 FFmpeg。

```powershell
npm ci
npm ci --prefix platforms/shared
npm ci --prefix platforms/ui-tools
python -m pip install -r tests/requirements.txt
npm run test:browser:install
npm test
npm run test:quality
npm run test:workbench
npm run test:all
python scripts/validate_rubrics.py
node scripts/build_forge.mjs --check
node scripts/build_portable_ui.mjs --check
```

`npm test` 是核心快速检查；完整回归用 `npm run test:all`。原生宿主与金山真实账号验收单独记录，不以协议夹具代替。

修改客户端源稿后运行两个构建器（不加 `--check`），不要手改生成文件。当前 FORGE 为 **20 模块、3 字体、4 份原始媒体**。便携页面把媒体作为独立、有界资源加载，保留原参考动画。

```powershell
node scripts/package_plugins.mjs --out C:/ARES-packages
python scripts/final_gate.py --help
```

输出目录须在源码外；打包拒绝目标及祖先链接、已有硬链接和未知目录覆盖。最终门禁生成可核对的统一报告，内部检查通过不代表赛事主办方认可。

## 本轮审查

[系统整改与验收记录](docs/SYSTEM_AUDIT_20261118.md) 区分已运行测试、真实环境、失败及待实际环境验收。132 份赛事档案都包含来源与适用范围状态；尚未取得当届官方原文的内容保持未核验，不生成正式评分结论。

本轮在独立分支修复，PR 不自动合并。用户的真实项目、作品、会话和全局安全配置不作为测试夹具。

## 授权与历史

ARES 原创代码按 [MIT](LICENSE)；参考动画、媒体、字体和 SDK 各自的许可保持有效，详见 [第三方声明](THIRD_PARTY_NOTICES.md)。组合包不能被描述为无条件商用的 MIT 软件。

旧发布说明和旧测试数量保留在 [历史 README](docs/history/README_BEFORE_SYSTEM_AUDIT_20261118.md)。历史记录不代表当前分支的在线验收结果。
