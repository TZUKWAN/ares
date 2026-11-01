---
name: ares-ppt
description: Ares 竞赛插件 PPTX 程序化生成技能（python-pptx，无模板）。路演/答辩/展示 PPT 生成与重渲染时引用。触发词：PPT、路演、答辩幻灯片、演示文稿。
whenToUse: 需要生成或重渲染 PPTX（路演、答辩、展示）时。
---

# ares-ppt PPTX 程序化生成

PPT 全部由程序代码生成（python-pptx），不使用任何内置模板；版式由内容驱动自动推导，支持改 project.json 后一键重渲染。

## 一、触发条件与输入

被 ares 总控或生产线技能在产出 PPT 时引用。输入：`project.json`（必需，单一事实源）、可选页大纲 pages.json（按赛事 rubric 裁剪页序页数时提供）。

## 二、执行步骤（三层架构）

1. 内容层：从 project.json 提取每页内容（本技能 SKILL 与 build_ppt.py 的 default_outline 承担；生产线可另产出 pages.json）。
2. 版式层：`scripts/layouts.py` 版式引擎，包含文字、表格、市场漏斗、原生图表、真实图片和 `prototype_demo` 三步产品演示版式。图片页必须提供 `image_path`，Demo 页必须提供至少 3 张原型截图；素材缺失直接失败。
3. 渲染层：`scripts/build_ppt.py` 输出 16:9 PPTX，图表为原生 PPT 图表，图片/原型截图作为媒体嵌入；保存前自动规范 OpenXML 图表轴 ID。

运行：

```
python skills/ares-ppt/scripts/build_ppt.py --profile project.json --out 输出/项目名/03-路演PPT.pptx --strict
# 可选：--outline pages.json；--asset-dir 素材根目录；--prototype-dir 原型目录（自动加入 Demo 页）；
#       --theme tech_blue|eco_green|vitality_orange|auto
# 原型截图：python skills/ares-ppt/scripts/capture_prototype.py 输出/项目名/04-项目原型
# 独立渲染：python skills/ares-ppt/scripts/render_ppt.py 输出/项目名/03-路演PPT.pptx 审计/ppt_png
```

## 三、设计系统

主题色 3 套（科技蓝/生态绿/活力橙，按项目行业自动选，可在命令行覆盖）；统一微软雅黑；字号阶梯 32/24/18/14（封面主标题 44）；左右留白一致；卡片圆角统一；每页正文信息密度上限 120 字。渲染结束输出逐页溢出检查，有溢出风险退出码 1，必须修复内容后重渲。

## 四、内容规则

1. 默认大纲为附录三精简版 21 页：封面、摘要、市场、痛点、产品总述、架构、指标对比、链路、成果、壁垒、竞品、商业模式、营销、团队、财务、金句/规划、社会价值、结束。
2. 每页标题必须是一句话煽动性总结（优先排比/对仗），每页论点必须有量化数据支撑（PPT 文案纪律见 ares-writing-style 第六节）。
3. 完整版 37 页结构（含政策页、创始人页、导师页、3 页社会价值等）与裁剪规则：按赛事路演时长裁剪——5 分钟版取 15-18 页、8 分钟版取 21-24 页；rubric 中权重最高的维度对应页面前移且不得裁剪；载明裁剪结果的 pages.json 随交付归档。
4. 数字全部取自 project.json；改档案任一数字后重跑渲染命令即全套同步，禁止手改 PPT。

## 五、质量自检清单

- [ ] 16:9；字体统一微软雅黑；主题色全套一致
- [ ] 逐页溢出检查 0 警告（退出码 0）；版式守卫 0 条混量纲提示（`--strict` 默认执行）
- [ ] 图表为原生图表且数据与 project.json 一致
- [ ] 产品页/痛点页/试点页按内容插入真实图片；若有原型，PPT 含三步 Demo 截图与演示动线
- [ ] 用 render_ppt.py 经 PowerPoint 独立打开并导出全部页面，页数一致且逐页视觉检查
- [ ] 每页标题一句话总结；正文 ≤120 字/页；论点带数据
- [ ] 页码页脚齐全；封面与结束页 slogan 首尾呼应
- [ ] 修改档案营收数字重渲染后，财务页与摘要页同步变化（变更同步验收项）

## 六、协作接口

- 内容数字来自 project.json；文本风格遵循 ares-writing-style 第六节；讲稿（生产线技能产出）与本 PPT 逐页对应，标注切换时机。
- ares-judge 质检 PPT 时复用本技能溢出检查与一致性扫描。
