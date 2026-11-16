# 星云项目台与本地/金山双源

用户已授权直接实施并自行决定细节，明早查看；不逐项询问、不控制用户窗口、不修改 METIS、不另起 DSH。运行版仍为 D:/METIS超级合并/ares，原验收、原生助手与 MCP 隔离保持。

| 单元 | 文件/动作 | 验证与完成标准 |
| --- | --- | --- |
| N1 原生云网页载体 | 新 client/cloud-browser.js（编入旧入口）、client/client.js 服务适配、app 持久渲染层、host/cloud-view.js owner 路由 | 复用已核对 DSH dshDesktop.browser 协议1的 acquire/release/onOpenRequested 租约。根 DOM 不再整体销毁云页；切源/放大保活。仅绑定项目的官方云链接，账号分组依原权威 Workspace 或项目 Session，guest 不注入 Node/DSH API，不修改浏览器安全策略。协议/生命周期、URL/目录/owner 门禁及真实金山网页加载验证；登录要求按真实状态说明 |
| N2 项目进度轨与节点弹窗 | forge-view、app、project UI、process-model、样式与build | 删左侧动作直播；纵向星点进度轨展示真实步骤、负责人、截止/阻塞，已验收数量独立。中间星云点步骤/参与者打开丰富详情弹窗，动作/文件/分工正确绑定，原节点执行/人工验收保留；实际配置/文件读回、节点和轨道选择、弹窗/关闭/焦点、无动画推进验收 |
| N3 双源作品与版式 | app/cloud view/local viewer、样式 | 本地/金山真实页两个保活视图，可放大和双栏对照；未关联文档给绑定入口，不伪造成功。重新协调主区/常驻聊天/底部导航，次要功能收拢但可达 | 原编辑保存/冲突/版本与金山原协作链路保持；常驻原生输入，390/1280/1920布局和命中验证 |
| N4 验证审计交付 | 对应测试、README、恢复状态、源SHA与截图 | 每单元立即验证，失败修复复测；源码只在运行版。云写测试只用授权的专用验收文档，独立读取验真，不改用户现有作品分享权限 | 不以模拟网页或协议夹具冒充真实金山直播/线上DSH。保留实际结果/未验证边界、源差异、构建/语法/保护机制证据 |

真实研究：已只读安装包 Browser 源码。Desktop 使用主进程批准的租约，bridge.acquire(workspaceKey) 返回 lease/partition，webview name/partition/about:blank#lease 启动；页面不注入 Electron/Node，onOpenRequested 由宿主处理。Browser workspace 以现有 Workspace 的 canonical CWD 分组，无成员时按真实 Session 隔离。原 sidebarRight.openTab 在全局面板替代 Conversation 时无 mounted Session，不适合直接拿来当 ARES 内部预览；因此复用同一已暴露载体租约，而不打开或劫持用户侧栏 tab。

关键风险：webview 从 DOM 移除会丢 guest，所以增加持久 shell/guest 层，而非在 root.innerHTML 每轮重建；云网页加载事件不等于云端已保存，保存/协作状态由金山真实页显示。CLI 与网页 Cookie 登录各自独立，不读取 Token 或系统浏览器 Cookie注入。Web iframe 路径不保证站点允许；桌面原生载体优先，不能放开安全策略绕过。原共享/验收/云稿采用不自动互相覆盖。

证据根：本聊天 work/ares-nebula-dual-20261108。修改前435文件基线与client/host/index/build备份已保存；原生浏览器/布局参考源码仅在私有work研究，不拷入产品。
