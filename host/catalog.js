import {readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, lstatSync} from 'node:fs';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AresError, clone, hash, home, readJson, atomicJson, locked, now} from './storage.js';
import {loadPackage} from './skill-packages.js';
import {normalizeWorkflow} from './workflow-model.js';
import {directoryCatalog} from './competition-directory.js';

export const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ID=/^[a-z][a-z0-9-]{0,79}$/;
export function text(value,label,max=12000){if(typeof value!=='string'||!value.trim()||value.length>max)throw new AresError(label+'不能为空且不能超过'+max+'字');return value;}
export function builtInSkills(){return readdirSync(join(ROOT,'skills'),{withFileTypes:true}).filter(e=>e.isDirectory()&&existsSync(join(ROOT,'skills',e.name,'SKILL.md'))).map(e=>{const content=readFileSync(join(ROOT,'skills',e.name,'SKILL.md'),'utf8');return {id:e.name,title:(/^# (.+)$/m.exec(content)||[])[1]||e.name,description:(/^description:\s*(.+)$/m.exec(content)||[])[1]||'',source:'builtin',verification:'not-run-in-this-project',content,root:join(ROOT,'skills',e.name)};});}
export function skillCatalog(configuration,{content=true,ids=null,tolerant=false}={}){const values=new Map(builtInSkills().filter(s=>!ids||ids.has(s.id)).map(s=>[s.id,s]));for(const s of configuration.skills||[]){if(ids&&!ids.has(s.id))continue;if(s.packageId){try{const pack=loadPackage(s.packageId,{body:content});values.set(s.id,{...s,source:'imported',origin:pack.origin,root:pack.root,bodyPath:pack.metadata.bodyPath,characters:pack.metadata.characters,files:pack.files,...(content?{content:pack.content}:{}),verification:'source-files-not-run-in-this-project',licenseStatus:pack.files.some(item=>/^(LICENSE|COPYING)(\.|$)/i.test(item.path))?'included':'not-in-package'});}catch(error){if(!tolerant||content)throw error;values.set(s.id,{...s,source:'imported',verification:'unavailable',error:error.message,root:null});}}else values.set(s.id,{...s,source:s.source==='builtin'?'user-override':s.source||'user',verification:'not-run-in-this-project',root:values.get(s.id)?.root||null});}return [...values.values()];}
export const defaults=()=>({schema_version:2,revision:0,updatedAt:null,workflows:readJson(join(ROOT,'data','workflows.json')).workflows.map(normalizeWorkflow),skills:[],workflowArchives:{},skillArchives:{}});
export const configPath=()=>join(home(),'ares-workflows.json');
/** Reusable workflow ownership is a real catalogue competition/track, never a
 * project ID or an arbitrary free-text category. Used by both UI and AI saves. */
export function validateCompetitionTemplate(raw,configuration,pipeline,{includeRemoved=false}={}){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).some(key=>!['competitionId','track','edition','group'].includes(key)))throw new AresError('比赛流程归属无效，不能携带项目或其他比赛字段',403);
 if(!Number.isSafeInteger(raw.competitionId)||typeof raw.track!=='string'||!raw.track.trim()||raw.track.length>300)throw new AresError('请选择比赛及对应赛道');
 for(const [key,maximum]of [['edition',80],['group',100]])if(raw[key]!==undefined&&(typeof raw[key]!=='string'||raw[key].length>maximum))throw new AresError('比赛流程届次或组别无效');
 const scope={competitionId:raw.competitionId,track:raw.track.trim(),edition:(raw.edition||'').trim(),group:(raw.group||'').trim()},competition=competitionCatalog(configuration,{includeRemoved}).find(row=>row.id===scope.competitionId),track=competition?.tracks.find(row=>row.track===scope.track);
 if(!competition||!track)throw new AresError('请选择目录中的比赛及该比赛的真实赛道');
 if(pipeline!==undefined&&pipeline!==track.pipeline)throw new AresError('流程领域与比赛赛道不一致',403);
 return scope;
}
export function validateConfiguration(raw){
 const c=clone(raw);if(c.schema_version!==2||!Number.isInteger(c.revision)||c.revision<0||!Array.isArray(c.workflows)||c.workflows.length>512||!Array.isArray(c.skills)||c.skills.length>5000||Buffer.byteLength(JSON.stringify(c))>8*1024*1024)throw new AresError('ARES 配置结构无效或超过8MiB');
 c.workflows=c.workflows.map(normalizeWorkflow);c.workflowArchives??={};c.skillArchives??={};
 const skillIds=new Set(builtInSkills().map(s=>s.id)),customIds=new Set();
 for(const s of c.skills){if(!ID.test(s.id)||customIds.has(s.id))throw new AresError('技能 ID 无效或重复');customIds.add(s.id);text(s.title,'技能名',120);if(s.packageId){loadPackage(s.packageId);delete s.content;}else text(s.content,'技能正文',100000);s.description=String(s.description||'');delete s.root;skillIds.add(s.id);}
 const ids=new Set();for(const w of c.workflows){if(!ID.test(w.id)||ids.has(w.id))throw new AresError('流程 ID 无效或重复');ids.add(w.id);text(w.title,'流程名',120);text(w.description,'流程说明',3000);if(!['L1','L2','L3','L4','L5','L6','E1','E2','E3'].includes(w.pipeline))throw new AresError('未知生产线');if(!Array.isArray(w.steps)||w.steps.length<1||w.steps.length>40)throw new AresError('每个流程需要 1–40 步');
  if(w.competitionTemplate){const scope=validateCompetitionTemplate(w.competitionTemplate,c,w.pipeline,{includeRemoved:true});if(w.competitionScope&&hash(w.competitionScope)!==hash(scope))throw new AresError('比赛流程草稿归属冲突，不能保存项目专用流程到其他比赛',403);w.competitionTemplate=scope;w.competitionScope=clone(scope);}
  for(const value of [w.parameters,w.prompts])if(!value||typeof value!=='object'||Array.isArray(value))throw new AresError('流程参数和提示词必须为JSON对象');for(const key of ['system','execute','review'])if(typeof w.prompts[key]!=='string'||w.prompts[key].length>16000)throw new AresError('流程级提示词需要16000字以内文本');
  const seen=new Set(),outputs=new Set();for(const s of w.steps){if(!ID.test(s.id)||seen.has(s.id))throw new AresError('步骤 ID 无效或重复');text(s.title,'步骤名',120);text(s.objective,'步骤目标',8000);if(!Array.isArray(s.dependsOn)||s.dependsOn.some(id=>!seen.has(id)))throw new AresError('前置依赖必须存在并位于当前步骤之前：'+s.title);if(!Array.isArray(s.skills)||s.skills.length<1||s.skills.length>16||s.skills.some(id=>!skillIds.has(id)))throw new AresError('步骤需要绑定真实技能：'+s.title);if(!['agent','human'].includes(s.execution))throw new AresError('执行方式必须为 agent 或 human');if(!Array.isArray(s.inputs)||s.inputs.some(x=>typeof x!=='string'||!x||x.length>150))throw new AresError('输入字段无效');for(const key of ['role','execute','review'])text(s.prompts?.[key],key+' 提示词',16000);if(!Array.isArray(s.outputs)||!s.outputs.length)throw new AresError('步骤必须声明产物');
   for(const o of s.outputs){if(!ID.test(o.id)||outputs.has(o.id))throw new AresError('产物 ID 无效或重复');outputs.add(o.id);text(o.title,'产物名',120);if(o.format!==undefined&&o.format!==null&&o.format!==''&&(typeof o.format!=='string'||!/^[a-z0-9_-]{1,40}$/i.test(o.format)))throw new AresError('产物格式标记无效');if(!['file','directory','section'].includes(o.kind)||!['required','optional','conditional'].includes(o.requirement))throw new AresError('产物类型或必需性无效');if(o.kind==='section'){if(!outputs.has(o.parentId)||o.parentId===o.id)throw new AresError('文内章节需要前面已声明的父文档');text(o.heading,'章节标题',150);}else{const p=text(o.path,'产物路径',300);if(p.startsWith('/')||p.startsWith('\\')||/^[A-Za-z]:/.test(p)||p.split(/[\\/]/).includes('..'))throw new AresError('产物路径必须在输出目录内');}if(o.requirement==='conditional'&&(!o.condition||typeof o.condition.field!=='string'||o.condition.equals===undefined))throw new AresError('条件产物须声明 condition.field/equals');}
   seen.add(s.id);
  }
 }
 return c;
}
export function readConfiguration(){return validateConfiguration(readJson(configPath(),defaults()));}
export function readStoredConfiguration(){const value=readJson(configPath(),defaults());if(value.schema_version!==2||!Number.isInteger(value.revision)||value.revision<0||!Array.isArray(value.workflows)||!Array.isArray(value.skills))throw new AresError('配置记录结构损坏，未换成默认配置',409);return value;}
export function configurationForEditor(){const configuration=readStoredConfiguration();try{return {configuration:validateConfiguration(configuration),configurationError:null};}catch(error){return {configuration,configurationError:error.message};}}
export function saveConfiguration(raw,expectedRevision){return locked(configPath(),()=>{const previous=readStoredConfiguration();if(expectedRevision!==previous.revision||raw.revision!==expectedRevision)throw new AresError('配置已被其他窗口更新，请保留草稿并重新读取',409);const next=validateConfiguration(raw);next.revision=expectedRevision+1;next.updatedAt=now();atomicJson(configPath(),next);return next;});}
export function suggestWorkflow(entry){const t=[entry.competition_name,entry.track,entry.notes].filter(Boolean).join(' ');const p=entry.pipeline;if(p==='L3')return /软件|计算机|应用开发|程序|信息安全|网络技术|服务外包|大数据|人工智能|数字媒体/.test(t)?'software':'hardware';if(p==='L4')return /市场调查|调研|统计/.test(t)?'survey':'case-analysis';if(p==='L5')return /视频|影像|动画|影视|短片/.test(t)?'video':'design';return {L1:'venture',L2:'modeling',L6:'coding',E1:'humanities',E2:'lab',E3:'simulation'}[p]||null;}
export function competitionCatalog(configuration=readConfiguration(),{includeRemoved=false}={}){
 return directoryCatalog({includeRemoved}).map(c=>({...c,tracks:c.tracks.map(t=>({...t,suggestedWorkflow:suggestWorkflow({...t,track:t.name||t.track}),configurationAvailable:configuration.workflows.some(w=>w.id===suggestWorkflow({...t,track:t.name||t.track})),support:'template-configured',ruleStatus:'needs-current-edition-verification'})),support:c.source==='user'?'user-defined':'catalogued',ruleStatus:'needs-current-edition-verification'}));
}
function resources(root){const result=[];if(!root)return result;function walk(dir){for(const e of readdirSync(dir,{withFileTypes:true})){if(e.name==='__pycache__'||e.name==='样例输出'||e.name.startsWith('.'))continue;const path=join(dir,e.name);if(e.isSymbolicLink())throw new AresError('技能资源含链接，不能固定版本');if(e.isDirectory())walk(path);else if(e.isFile()){const data=readFileSync(path);if(data.length>8*1024*1024||result.length>=256)throw new AresError('技能资源超过单包大小限制');result.push({path:relative(root,path).replaceAll('\\','/'),sha256:hash(data),data});}}}walk(root);return result;}
export function skillResourceFiles(skill){return skill.packageId?loadPackage(skill.packageId).files:resources(skill.root).map(({path,sha256,data})=>path==='SKILL.md'&&typeof skill.content==='string'?{path,sha256:hash(skill.content),bytes:Buffer.byteLength(skill.content),editableCopy:true}:{path,sha256,bytes:data.length});}
export function freezeWorkflow(workflow,configuration=readConfiguration()){
 const selected=new Set(workflow.steps.flatMap(s=>s.skills)),skills=skillCatalog(configuration,{content:false,ids:selected}).map(s=>{const pack=s.packageId?loadPackage(s.packageId,{body:true,verify:true}):null;const files=resources(s.root).filter(f=>f.path!=='SKILL.md');return {id:s.id,title:s.title,description:s.description,content:pack?pack.content:s.content,source:s.source,...(s.packageId?{packageId:s.packageId,origin:pack.origin}:{}),resources:files};});
 const payload={schema_version:2,workflow:clone(workflow),skills:skills.map(({resources,...s})=>({...s,resources:resources.map(({data,...f})=>f)}))};const id=hash(payload),base=join(home(),'ares-versions',id);
 if(!existsSync(join(base,'definition.json'))){mkdirSync(base,{recursive:true});for(const s of skills){for(const file of s.resources){const dest=join(base,'resources',s.id,file.path);mkdirSync(dirname(dest),{recursive:true});writeFileSync(dest,file.data);}mkdirSync(join(base,'resources',s.id),{recursive:true});writeFileSync(join(base,'resources',s.id,'SKILL.md'),s.content);}atomicJson(join(base,'definition.json'),{id,createdAt:now(),...payload});}
 return loadVersion(id);
}
export function loadVersion(id){if(!/^[a-f0-9]{64}$/.test(id))throw new AresError('版本 ID 无效');const record=readJson(join(home(),'ares-versions',id,'definition.json'));const {id:stored,createdAt,...payload}=record;if(stored!==id||hash(payload)!==id)throw new AresError('流程版本损坏，拒绝替换为最新版',409);return record;}
export function versionList(){const root=join(home(),'ares-versions');return existsSync(root)?readdirSync(root).filter(id=>/^[a-f0-9]{64}$/.test(id)).map(id=>{try{const v=loadVersion(id);return {id,title:v.workflow.title,workflowId:v.workflow.id,createdAt:v.createdAt,status:'available'};}catch(e){return {id,status:'damaged',error:e.message};}}).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))):[];}
export function previewStep(workflow,step,record){return `你正在 ARES 的“${workflow.title}”流程中，只处理当前步骤“${step.title}”（${step.id}）。
流程总控：${workflow.prompts?.system||workflow.controller||''}
流程执行：${workflow.prompts?.execute||''}
流程复核：${workflow.prompts?.review||''}
目标：${step.objective}
角色：${step.prompts.role}
执行：${step.prompts.execute}
检查：${step.prompts.review}
输入字段：${step.inputs.join('、')}
绑定技能：${step.skills.join('、')}
执行方式：${step.execution}
产物契约：${JSON.stringify(step.outputs)}
参数：${JSON.stringify({...workflow.parameters,...step.parameters})}
先调用 ares_project status 读取真实任务；用 ares_library 按需读取本步技能。当前技能先load/read，再按实际需要prepare/call/run；环境准备不是作品验收。没有当前任务或必需输入时先恢复/建档。不要一次加载整库，不要虚构状态和结果。完成需要check实际产物和review内容复核记录；人工作业由用户在工作台登记。${record?'工具包实际目录：'+ROOT+'；固定流程版本：'+record.id:''}`;}
