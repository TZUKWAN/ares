---
name: ares-prototype
description: Ares 竞赛插件多页 HTML 原型系统生成技能。创业/工科类作品原型（可交互多页 Web 系统）产出时引用。触发词：原型、演示系统、可交互、网页系统、前端作品。
---

# ares-prototype 多页 HTML 原型系统

创业类与软件类作品原型统一为多页 HTML 前端系统：单工程多页面，纯 HTML/CSS/JS，零构建，双击 index.html 离线可演示。不是单页静态海报。

## 一、触发条件与输入

被 ares 总控、ares-entrepreneurship（04-项目原型）、ares-engineering（软件类作品）引用。输入：project.json 的 solution.features（功能清单，必须全部覆盖）与 pain_points（功能可追溯依据）。

## 二、架构规范（强制）

1. 输出为一个文件夹：`index.html`（首页/产品门面，首屏 3 秒讲清产品是什么）+ 若干功能页（通常 6-12 页，总数 ≥8）+ `assets/`（共享 css/js/图片）。
2. 纯 HTML/CSS/JS，零构建；默认不引外部 CDN（离线可用），必须引用时提供本地化兜底。
3. 统一设计系统（配色、圆角、阴影、字体、组件样式）写入 `assets/app.css`，规范见 `references/design-system.md`。
4. 顶部/侧边导航全站互通；所有按钮要么跳转、要么有交互反馈（弹窗/抽屉/toast/数据联动），禁止死按钮。
5. 内置模拟数据（`assets/data.js` 内置 JSON，DEMO 标注），实现 列表→详情→表单→结果页 的完整数据流转；图表用内联 SVG 或本地 JS 绘制。
6. 页面必须覆盖计划书产品功能章节的每一个功能点，功能与痛点一一对应可追溯（页脚注明对应痛点编号）。
7. 同时交付 `原型导览.md`：页面地图、演示动线（路演时按什么顺序点）、各页与计划书章节对应关系。

## 三、面向演示的专项要求

1. 首屏 3 秒内讲清产品是什么（一句话价值主张 + 核心视觉）。
2. 存在一个核心演示闭环（评委最常看的 3 步操作），路径 ≤3 次点击，在导览文档中标注。
3. 移动端/桌面端自适应（媒体断点 ≤768px）。

## 四、执行步骤

1. 从 project.json 提取功能点与痛点，规划页面地图（每功能至少一页）。
2. 按 design-system.md 搭 assets（css/js/data）。
3. 逐页生成 HTML，导航互通，接模拟数据流转。
4. 运行死链扫描：`python skills/ares-prototype/scripts/scan_prototype.py <原型目录>`，全部 a/button 有归宿才通过。扫描口径：按钮绑定认可 onclick 属性与 JS 脚本（内联 `<script>` 与外部 .js 均计）中对按钮 id/class 的 click 监听；页面可达性同时计入 `<a href>` 与 JS 跳转（location.href/window.open 等）。
5. 写 原型导览.md 并与实际页面核对。

## 五、输出

`输出/项目名/04-项目原型/`（完整站点 + 原型导览.md）；`05-源代码/` 放同一份源码 + README（技术栈说明与部署/演示说明）。

## 六、质量自检清单

- [ ] ≥8 页互通；双击 index.html 离线可运行
- [ ] scan_prototype.py 扫描 0 死链 0 死按钮
- [ ] 计划书每个功能点都有对应页面，页脚可追溯痛点编号
- [ ] 列表→详情→表单→结果数据流转完整；模拟数据带 DEMO 标注
- [ ] 首屏 3 秒讲清产品；核心演示闭环 ≤3 次点击
- [ ] 移动端断点可用
- [ ] 原型导览.md 与实际页面一一对应

## 七、协作接口

- 功能与痛点来自 project.json；页面内容与计划书产品章节（ares-entrepreneurship/ares-engineering 产出）互相引用编号。
- ares-judge 质检时复用 scan_prototype.py 并核对导览文档一致性。
