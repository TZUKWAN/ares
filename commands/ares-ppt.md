# /ares-ppt 只出路演 PPT

## 用途

基于已有 project.json 只生成或重渲染 03-路演PPT.pptx，不影响其他文件。转发到 skills/ares-ppt（build_ppt.py 渲染）。

## 需要用户补充的信息

- project.json 路径（默认当前工作目录）。
- 可选：页数模式（默认 21 页；5 分钟路演 15-18 页、8 分钟 21-24 页）、主题（tech_blue/eco_green/vitality_orange，默认按行业自动选）、自定义大纲 pages.json、素材目录和原型目录。

## 参数说明

- 输入：project.json（必需）；--outline pages.json（可选）；--theme、--asset-dir、--prototype-dir（可选）。
- 行为：内容层从档案取数 → 版式引擎选版式 → 渲染输出 16:9 → 严格模式下逐页溢出、缺数据、混量纲检查。严格模式默认开启；市场分层/漏斗可用对数刻度保留跨度，指标混排须改对比矩阵或拆同量纲页。
- 输出：`输出/项目名/03-路演PPT.pptx`。
- 不改动计划书/财务表/原型等任何其他文件（单项模式隔离性）。

## 触发示例

- 「/ares-ppt 按档案重出 PPT，8 分钟版」
- 「/ares-ppt 主题换成生态绿，砍到 16 页」
