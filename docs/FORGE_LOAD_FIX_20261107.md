# 已运行DSH宿主的FORGE模块加载修复

用户实际错误：`Failed to fetch dynamically imported module: dsh-app://app/ares/api/v2/app.js?v=2.3.0-forge-faithful`。

## 原因与复现

现有宿主保留了启动时注册的旧路由表。旧入口会按请求读取最新文件，但修改磁盘上的路由声明不会向已运行的宿主自动注册新路由。新 `app.js` 的依赖树进入 FORGE 七模块后，请求这些新路径返回404，浏览器因此将整个动态导入判为失败。旧样式入口同样不会自动增加新CSS拼接，新增字体路径也不可用。

在现有DSH监听器作无凭据只读检查：`app.js`、`workshop-scene.js`、`bootstrap`返回原有owner认证的401；新增 `forge-geometry.js`、`forge-renderer.js`、`forge-display.woff2`返回404。这没有绕过认证，也没有检查用户窗口。

新增 `tests/client-module-loading.test.mjs`，以实际生产处理器和明确的软件旧静态路由条件验证：所有新增FORGE模块/字体路径都不可用，样式处理器只读取原有两个文件。修复前实际复现相同动态导入错误，见本聊天 `work/ares-module-load-fix-20261107/before.log`。上一轮42项使用新建完整路由表，确实漏掉了此热更新兼容性条件。

## 实现

- `client/workshop-scene.js` 现在是七个原始模块的自包含ES模块，通过已注册的同名入口提供；不再在浏览器请求新增JS路径。
- `client/workshop.css` 包含完整主题及三个本地字体的数据URL。旧样式处理器即可取得全部样式和字体，不需要新增字体路由。
- 可维护源文件继续分开保留：`client/forge-*.js`、`forge-theme.css`、`workshop-base.css`及原字体资产。新增无第三方依赖的 `scripts/build_forge.mjs`；只链接白名单中的命名导入/声明，校验依赖、导出、循环和字体SHA256，不支持的语法直接报错。
- `node scripts/build_forge.mjs` 更新两个交付入口；`node scripts/build_forge.mjs --check` 验证源文件与生成文件逐字一致。包内增加 `npm run build:forge`，没有增加依赖。
- 客户端入口与内部导入统一改为 `2.3.0-forge-loader1`，避免复用此前失败的模块缓存。场景诊断测试使用同一规范URL，避免自包含模块以不同URL分别实例化。
- `host/routes.js` 的样式处理器恢复仅拼接既有 `style.css` 和已自包含的 `workshop.css`，避免新宿主重复覆盖内嵌字体声明。原owner认证、执行、验收、工具、MCP隔离和原生会话逻辑不变。

## 验证与边界

修复后的旧路由回归通过：完整工作台启动，23800点实际WebGL绘制，累计GL错误0，三字体实际加载，未请求任何新增FORGE静态路径，无页面错误。截图已由主模型查看；所有项目都明确标为软件QA而非赛事成果。

对应命令：

```powershell
node scripts/build_forge.mjs --check
node --check client/workshop-scene.js
node --test tests/client-module-loading.test.mjs
node --test tests/workshop-client.test.mjs tests/editor-client.test.mjs
node --test tests/forge-faithful-client.test.mjs
```

测试环境沿用本机已安装Playwright，`ARES_TEST_ROOT` 指向本聊天自有QA目录。旧路由启动测试是明确的协议环境回归，不冒充用户当前桌面的认证加载。没有重启DSH、重载用户窗口、修改METIS或调用模型/金山；当前窗口加载结果尚未直接观察。内嵌字体使样式文件约2.88MB，这是无需运行宿主增加路由的兼容开销。

本轮三组结果分别为1/1、18/18、6/6，合计25项对应测试通过，失败、取消、跳过均为0。第二组覆盖8项作品台及10项原生助手客户端回归；第三组覆盖打包后十个阶段画面/六模型、镜头、面板与文件切换、原生状态协议、降级和连续完整周期。`--check`重复构建及入口语法检查通过。旧路由测试证据为 `work/ares-tests/ares-module-loading-qtaa42/loading-evidence.json`；日志分别为本修复工作目录内 `after.log`、`regression.log`、`bundle-scene-regression.log`。

完整结果与源码变更指纹见本聊天 `work/ares-module-load-fix-20261107`；最初的主题设计说明仍见 `FORGE_FAITHFUL_RELEASE_20261107.md`，本修复覆盖其旧分模块运行加载方式。
