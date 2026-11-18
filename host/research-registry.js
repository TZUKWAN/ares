/** Product metadata for the actual routes; project roles are enforced by the existing host admission. */
export const researchTools=Object.freeze([
  {id:'survey.design',workspace:'survey',title:'问卷设计',inputs:['研究需求','变量与维度','题目与条件'],result:'可填写的问卷定义',access:'项目负责人保存及定稿；助手提交建议'},
  {id:'survey.pretest',workspace:'survey',title:'问卷预测试',inputs:['已保存问卷版本','样本数','随机种子'],result:'带来源的模拟数据与诊断',access:'负责人在当前项目授予现有扩展权限',background:true},
  {id:'survey.responses',workspace:'survey',title:'实际答卷整理',inputs:['定稿版本','采集来源','CSV 或 JSON'],result:'实际答卷与缺失、分布统计',access:'负责人确认实际采集来源'},
  {id:'interview.design',workspace:'interview',title:'访谈提纲',inputs:['研究问题','访谈对象','方法与时长'],result:'可编辑提纲版本',access:'项目负责人保存；助手提交建议'},
  {id:'interview.records',workspace:'interview',title:'访谈原始与校订稿',inputs:['笔记、逐字稿或本机音视频','匿名编号'],result:'保留来源的记录版本',access:'项目负责人登记；本机音视频需单次确认'},
  {id:'interview.transcribe',workspace:'interview',title:'离线转写',inputs:['原始媒体版本','本机模型与设备'],result:'独立转写稿和词级时标',access:'负责人授予本机处理许可',background:true},
  {id:'interview.codes',workspace:'interview',title:'访谈主题分析',inputs:['编码本','已保存发言及证据范围'],result:'编码证据、主题频次与矩阵',access:'助手建议由研究人员采用'},
  {id:'dataset.resources',workspace:'datasets',title:'数据资源',inputs:['提供方和搜索关键词','版本、许可、所选文件'],result:'原始文件、来源与校验记录',access:'负责人逐次授权联网，下载前核对许可',background:true}
]);
