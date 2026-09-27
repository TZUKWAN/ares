# /ares-prototype 只出多页 HTML 原型系统

## 用途

基于已有 project.json 只产出 04-项目原型/ 多页 HTML 交互系统与 原型导览.md。转发到 skills/ares-prototype。

## 需要用户补充的信息

- project.json 路径（默认当前工作目录）。
- 可选：页面数量档位（默认 8-12 页）、品牌主色（默认科技蓝）、是否需要移动端演示模式（默认自适应）。

## 参数说明

- 输入：project.json 的 solution.features 与 pain_points（功能-痛点追溯依据）。
- 行为：页面地图规划 → 设计系统 assets → 逐页生成 → scan_prototype.py 扫描（0 死链 0 死按钮才通过）→ 原型导览.md。
- 输出：`输出/项目名/04-项目原型/`（index.html + 功能页 + assets + 原型导览.md）。

## 触发示例

- 「/ares-prototype 给这个项目出可演示原型，10 页左右」
- 「/ares-prototype 原型主色换成生态绿，加一个数据大屏页」
