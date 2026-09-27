# Ares 原型设计系统规范（references/design-system.md）

原型全部页面共用本规范，样式集中在 `assets/app.css`。

## 设计令牌

| 令牌 | 值 | 说明 |
|---|---|---|
| --color-primary | #1F4E79 | 主色（可按行业替换为 #1E5E3A / #C2531A） |
| --color-accent | #2E75B6 | 强调色 |
| --color-bg | #F5F7FA | 页面底色 |
| --color-card | #FFFFFF | 卡片底色 |
| --color-text | #262626 | 正文 |
| --color-muted | #595959 | 次要文字 |
| --color-success / --color-warn / --color-danger | #2E8B57 / #E87D2B / #C0392B | 状态色 |
| --radius | 12px | 卡片圆角（按钮 8px） |
| --shadow | 0 2px 8px rgba(31,78,121,.10) | 卡片阴影 |
| --font | "Microsoft YaHei", "PingFang SC", sans-serif | 全站字体 |
| 断点 | 768px | 移动端自适应分界 |

## 布局

- 顶部导航 64px：左侧产品名+logo 区（首字圆形标），中间导航项，右侧用户区；当前页高亮（accent 底 10% 透明）。
- 内容区最大宽 1200px 居中；卡片栅格 auto-fill minmax(280px, 1fr)。
- 移动端：导航折叠为汉堡按钮（必须可展开），栅格单列。

## 组件清单（app.css 提供的类）

`.btn`（主/次/危险三种 `.btn-primary/.btn-ghost/.btn-danger`，所有按钮必须有 cursor:pointer 与 hover 态）、`.card`、`.tag`、`.table`（三线风格）、`.form-item`（label+input 校验提示 `.error`）、`.modal`（遮罩+关闭按钮）、`.drawer`、`.toast`（2.5s 自动消失）、`.kpi`（数字+标签）、`.breadcrumb`、`.empty`（空状态）、`.pagination`。

## 数据流转约定

1. `assets/data.js` 顶部注释：`/* DEMO数据，提交前须替换为真实数据 */`；数据以 `window.ARES_DATA = {...}` 暴露，分实体组织（列表、详情、配置）。
2. 列表页点击行进详情（`detail.html?id=xxx`），详情页操作按钮触发表单页，表单提交写入 `localStorage` 并跳结果页，结果页可返回列表看到新增记录——四级链路全站至少一条完整跑通。
3. 图表用内联 SVG 或原生 canvas 绘制（封装在 `assets/charts.js`），不引外部库。

## 页面骨架

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>页面名 · 产品名</title>
  <link rel="stylesheet" href="assets/app.css">
</head>
<body>
  <header class="nav">...</header>
  <main class="container">
    <!-- 内容；页脚标注：对应计划书 3.x 节 · 解决痛点 Pn -->
  </main>
  <footer class="footer">...</footer>
  <script src="assets/data.js"></script>
  <script src="assets/app.js"></script>
</body>
</html>
```

## 可追溯性

每个功能页页脚以 `<!-- 映射：计划书3.2节 → 痛点P1 -->` 注释标注来源章节与痛点编号，与原型导览.md 的页面地图一一对应，供 ares-judge 核对。
