/** Product metadata for the actual routes; project roles are enforced by the existing host admission. */
export const researchTools=Object.freeze([
  {id:'survey.design',workspace:'survey',title:'问卷设计',inputs:['研究需求','变量与维度','题目与条件'],result:'可填写的问卷定义',access:'项目负责人保存及定稿；助手提交建议'},
  {id:'survey.pretest',workspace:'survey',title:'问卷预测试',inputs:['已保存问卷版本','样本数','随机种子'],result:'带来源的模拟数据与诊断',access:'负责人在当前项目授予现有扩展权限',background:true},
  {id:'survey.responses',workspace:'survey',title:'实际答卷整理',inputs:['定稿版本','采集来源','CSV 或 JSON'],result:'实际答卷与缺失、分布统计',access:'负责人确认实际采集来源'},
  {id:'interview.design',workspace:'interview',title:'访谈提纲',inputs:['研究问题','访谈对象','方法与时长'],result:'可编辑提纲版本',access:'项目负责人保存；助手提交建议'},
  {id:'interview.records',workspace:'interview',title:'访谈原始与校订稿',inputs:['笔记、逐字稿或本机音视频','匿名编号'],result:'保留来源的记录版本',access:'项目负责人登记；本机音视频需单次确认'},
  {id:'interview.transcribe',workspace:'interview',title:'离线转写',inputs:['原始媒体版本','本机模型与设备'],result:'独立转写稿和词级时标',access:'负责人授予本机处理许可',background:true},
  {id:'interview.codes',workspace:'interview',title:'访谈主题分析',inputs:['编码本','已保存发言及证据范围'],result:'编码证据、主题频次与矩阵',access:'助手建议由研究人员采用'},
  {id:'dataset.resources',workspace:'datasets',title:'数据资源',inputs:['提供方和搜索关键词','版本、许可、所选文件'],result:'原始文件、来源与校验记录',access:'负责人逐次授权联网，下载前核对许可',background:true},
  {id:'study.requirements',workspace:'study',title:'比赛要求整理',inputs:['规则原文','比赛届次、赛道与组别','条款与作品映射'],result:'可追溯原文的项目要求',access:'助手提议，负责人逐项核对；不自动认证官方规则'},
  {id:'study.evidence',workspace:'study',title:'事实与作品引用',inputs:['证据片段','事实版本','作品中的实际原句'],result:'引用位置、变化差异和新工作版本',access:'负责人确认引用及差异；过期引用沿用原验收门禁'},
  {id:'study.experiments',workspace:'study',title:'可复现模型实验',inputs:['固定数据','模型参数或已审阅Python/R脚本'],result:'实际计算回执和方案比较',access:'固定算法需本机运行确认，定制脚本走原宿主工具审批',background:true},
  {id:'study.collection',workspace:'study',title:'金山问卷回收',inputs:['已定稿问卷','金山数据表链接与字段映射'],result:'原始答卷、质量检查、复核决定及采用来源',access:'负责人逐次授权读取、逐份复核后确认实际来源',background:true},
  {id:'study.defense',workspace:'study',title:'作品答辩演练',inputs:['固定作品','规则与事实','实际填写的回答'],result:'有逐字依据的演练问题、反馈和项目待办',access:'助手提交建议，负责人采用；演练不代替正式验收'},
  {id:'study.reuse',workspace:'study',title:'跨比赛改编',inputs:['原项目固定作品','目标比赛、赛道与空目录'],result:'带材料来源的独立新项目和交付缺口',access:'负责人预览并确认新建，不继承原项目验收'}
]);
