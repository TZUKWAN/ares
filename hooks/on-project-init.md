# Hook：on-project-init（项目初始化后自动建档）

## 触发时机

用户在 /ares-start 流程第 4 步确认项目信息后（Project Profile 内容就绪、validate_profile.py 通过前后均可安全执行）。

## 动作（支持 hooks 的平台自动执行）

1. 创建输出目录树：`输出/{项目名}/` 与 tracks.json 该赛事条目定义的编号子目录（04-项目原型/ 05-源代码/ 06-演示数据/ 等目录类条目建目录，文件类条目不预建空文件）。
2. 写 project.json 骨架：schema 全字段就位（缺失值置空串/空列表），data_confidence 三类初始化为空列表。
3. 运行 `python <插件目录>/scripts/validate_profile.py project.json` 输出缺失项清单。

## 等价手动指令（不支持 hooks 的平台）

在对话中对 Ares 说：

「初始化项目档案：项目名 {名称}，赛事 {赛事名}。」

Ares 将执行与上述完全相同的三步：建目录树、写 project.json 骨架、跑校验并汇报缺失项。该手动方式为 skills/ares 总控流程第 4 步的内置行为，功能无差别。

## 幂等性

重复触发不覆盖已填写的 project.json 字段，只补齐缺失骨架与缺失目录。
