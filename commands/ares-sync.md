# /ares-sync 档案变更后全量同步重算

## 用途

project.json 变更后，找出受影响的产出物并重渲染，保证全部交付物与档案数字一致。对应 skills/ares 总控第八节同步逻辑。

## 需要用户补充的信息

- 改了什么（哪个字段/哪个数字），或直接告知"档案已改，全量同步"。
- project.json 路径（默认当前工作目录）。

## 参数说明

- 输入：变更后的 project.json；可选变更字段清单（未提供则按 diff 自动识别）。
- 受影响映射：financials.* → 02-财务三表.xlsx（重跑 build_financials.py）、03-路演PPT.pptx（重跑 build_ppt.py）、01-商业计划书第八章、07-讲稿数字段；market.*/pain_points/advantages → 计划书对应章节与 PPT 对应页；solution.features → 原型功能页与计划书三章；achievements.* → 计划书 4.7/3.9 与 PPT 成果页。
- 行为：逐项重渲染 → `validate_profile.py` 与 `validate_evidence.py --check-url` 复核档案和来源 → consistency_check.py 复扫 → PPT 严格检查与 PowerPoint 独立渲染 → 零矛盾收口，输出同步清单（改了哪些文件哪些数字）。
- 输出：同步清单.md（或对话内清单）+ 更新后的产出物。

## 触发示例

- 「/ares-sync 营收起始值从 200 改成 230」
- 「/ares-sync 团队多了一个人，专利又拿下一项，全部同步」
