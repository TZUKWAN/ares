import {randomUUID} from 'node:crypto';
import {AresError,clone} from './storage.js';
import {defaults,validateConfiguration,skillCatalog} from './catalog.js?v=2.3.0-directory1';
import {createWorkflowDraft} from './workflow-model.js';

const lines=value=>String(value||'').split(/\r?\n/).map(row=>row.trim()).filter(Boolean);
const fileName=value=>{const text=value.trim();if(!text||text.length>140||/[<>:"/\\|?*\x00-\x1f]/.test(text)||text==='.'||text==='..')throw new AresError('交付文件名不应包含路径或特殊字符');return /\.[a-z0-9]{1,10}$/i.test(text)?text:text+'.md';};
const knownFormats=new Set(['md','txt','csv','json','docx','xlsx','pptx','pdf','py','ipynb','html','mp4','png','jpg','zip']);
const skillHints=[[/问卷|调查|调研/,'ares-survey'],[/模型|建模|计算|算法/,'ares-modeling'],[/报告|论文|写作/,'ares-docx'],[/代码|软件|系统|开发/,'ares-prototype'],[/演示|路演|答辩/,'ares-pitch'],[/资料|数据|清洗/,'ares-data']];

/** A transparent guided compiler, not a simulated AI response. All stages are
 * taken from user-supplied lines or an actual installed template. */
export function buildGuidedWorkflow(body){
 const configuration=clone(body.configuration||defaults());if(typeof body.title!=='string'||!body.title.trim()||body.title.length>120||typeof body.goal!=='string'||!body.goal.trim()||body.goal.length>5000)throw new AresError('请填写流程名称与实际目标');
 const templates=defaults().workflows,rows=lines(body.stages),recommended=[[/问卷|调查|调研/,'survey'],[/建模|数学|模型/,'modeling'],[/软件|系统|应用|开发/,'software'],[/创业|商业|路演/,'venture'],[/视频|短片/,'video'],[/设计|海报/,'design']].find(([pattern])=>pattern.test(body.goal))?.[1],template=templates.find(row=>row.id===(body.templateId||(!rows.length?recommended||templates.find(row=>row.pipeline===body.pipeline)?.id||'venture':null)));if(body.templateId&&!template)throw new AresError('流程模板不存在');if(rows.length>30)throw new AresError('引导构建最多30个阶段');
 const workflow=createWorkflowDraft(configuration,{id:'guided-'+randomUUID().slice(0,12),title:body.title.trim(),description:body.goal.trim(),pipeline:body.pipeline||template?.pipeline||'L1',...(template?{templateId:template.id}:{})},templates);
 const skills=skillCatalog(configuration,{content:false}),ids=new Set(skills.map(row=>row.id));
 if(rows.length){workflow.steps=rows.map((line,index)=>{const [name,...pieces]=line.split('|').map(value=>value.trim());if(!name||name.length>120)throw new AresError('阶段名称须为120字以内');const requested=pieces.join('|').trim(),names=requested?requested.split(/[;；]/).map(fileName):[fileName(name+'记录')];if(names.length>8)throw new AresError('每阶段最多8个交付文件');
  const base=template?.steps.find(step=>name.includes(step.title)||step.title.includes(name)),selected=base?.skills.filter(id=>ids.has(id))||skillHints.filter(([pattern,id])=>pattern.test(name)&&ids.has(id)).map(([,id])=>id);if(!selected.length)selected.push('ares-intake');
  return {id:'stage-'+(index+1),title:name,objective:'围绕“'+body.goal.trim()+'”完成'+name+'。读取前置真实材料，生成本阶段交付物并如实记录未知项。',skills:[...new Set(selected)],inputs:['competition','facts','facts.materials'],outputs:names.map((name,n)=>{const format=name.split('.').at(-1).toLowerCase();if(!knownFormats.has(format))throw new AresError('请为交付物选择支持的实际格式：'+name);return {id:'stage-'+(index+1)+'-output-'+(n+1),title:name.replace(/\.[^.]+$/,''),kind:'file',format,path:'阶段'+(index+1)+'/'+name,requirement:'required'};}),dependsOn:index?['stage-'+index]:[],execution:/实地|实访|真实访谈|人工采集|问卷发放|实验操作|现场采样/.test(name)?'human':'agent',prompts:{role:'本项目“'+name+'”阶段的执行助手。',execute:'先读取实际输入和当前技能，再生成本阶段文件。目标：'+body.goal.trim()+'。不虚构数据、来源、工具或人工操作。',review:'检查实际交付物、来源、关键结论及前置依赖，记录阻断问题；验收与人工节点保留负责人确认。'},parameters:{}};});}
 else if(!template)throw new AresError('请选择实际模板，或每行填写一个需要的阶段');
 workflow.prompts={...workflow.prompts,system:workflow.prompts.system+'\n本次明确目标：'+body.goal.trim()+'\n已有材料说明：'+String(body.materials||'尚未提供，执行前须核对').slice(0,5000)+'\n规则与限制：'+String(body.constraints||'当届规则待核验').slice(0,5000)};
 const final=lines(body.deliverables);if(final.length){const last=workflow.steps.at(-1);last.outputs=final.map((value,index)=>{const name=fileName(value),format=name.split('.').at(-1).toLowerCase();if(!knownFormats.has(format))throw new AresError('最终交付格式不支持：'+name);return {id:last.id+'-delivery-'+(index+1),title:name.replace(/\.[^.]+$/,''),kind:'file',format,path:'最终交付/'+name,requirement:'required'};});}
 const verified=validateConfiguration({...configuration,workflows:[...configuration.workflows,workflow]}),result=verified.workflows.find(row=>row.id===workflow.id);
 return {workflow:result,method:rows.length?'compiled-user-stages':'adapted-installed-template',saved:false,summary:{stages:result.steps.length,outputs:result.steps.reduce((n,row)=>n+row.outputs.length,0),skills:[...new Set(result.steps.flatMap(row=>row.skills))].map(id=>({id,title:skills.find(row=>row.id===id)?.title||id})),humanStages:result.steps.filter(row=>row.execution==='human').map(row=>row.title)},notes:['这是按所填阶段或实际模板编排的可审阅草稿；材料说明不会被登记为已核验事实。','放入草稿后仍可调整、改成人工节点；保存后用于新项目，旧项目不自动升级。']};
}
