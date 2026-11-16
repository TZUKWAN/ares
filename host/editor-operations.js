import {AresError,clone,hash} from './storage.js';
import {validateConfiguration,skillCatalog,defaults} from './catalog.js?v=2.3.0-directory1';
import {createWorkflowDraft} from './workflow-model.js';
import {editPackage,readLocalPackage,packageReference,storePackage} from './skill-packages.js';
export const editorOperations={
 update_workflow:'type/update_workflow；workflowId、title/description/pipeline/prompts={system,execute,review}/parameters。流程级提示词局部合并，参数使用完整JSON对象。',
 create_workflow:'type/create_workflow；id、title、description，可选copyFromId（当前流程）、templateId（真实基础模板）或完整workflow；均不提供时创建可继续编排的基础流程，pipeline可指定领域。',
 remove_workflow:'type/remove_workflow；workflowId。归档当前配置中的流程，允许删空，历史项目及固定版本保留。',
 restore_workflow:'type/restore_workflow；workflowId，从真实归档恢复原流程及可恢复的技能引用。',
 reorder_workflows:'type/reorder_workflows；workflowIds提供全部当前流程ID的完整排列。只调整新建入口次序，不改旧项目。',
 update_step:'type/update_step；stepId、changes。可改title/objective/prompts/parameters/inputs/outputs/dependsOn/execution。prompts和parameters局部合并。',
 add_step:'type/add_step；afterId、完整step（id/title/objective/skills/inputs/outputs/dependsOn/execution/prompts/parameters）。需要保持依赖顺序。',
 remove_step:'type/remove_step；stepId，并通过其他编辑修正依赖。',
 reorder:'type/reorder；stepIds是完整步骤ID排列；保持依赖在前。',
 bind_skill:'type/bind_skill 或 unbind_skill；stepId、skillId（真实技能ID）。',
 create_skill:'type/create_skill；skill={id,title,description,content}。创建文本技能，不执行脚本、不声称已安装依赖。',
 update_skill:'type/update_skill；skillId、expectedContentHash（read返回bodyHash）、patch={title/description/content}或replacements=[{find,replace}]，每个find须唯一，保留未读正文。',
 remove_skill:'type/remove_skill；skillId。仅删除本地自定义能力，须先解绑；不删除插件内置文件。',
 index_source:'type/index_source；source={kind:local,path:用户提供的目录}或{kind:github,repository:owner/repo,ref:可选}、expectedLibraryRevision。只索引元数据，不执行来源代码。来源须来自真实用户消息或此前保存的来源。',
 install_skill:'type/install_skill；source={kind:local,path:单个技能目录}或{kind:github,repository,ref,subdirectory}；可选id；替换现有项需replace=true和expectedContentHash。文件只暂存为固定包，正式采用仍需保存配置；不安装运行依赖。',
 update_skill_resource:'type/update_skill_resource；skillId、path、expectedContentHash（资源读取返回的bodyHash，新文件为null）、content或remove=true。创建新的资源包，不覆盖内置文件或已固定版本。',
 restore_skill:'type/restore_skill；skillId，恢复真实归档的自定义技能。',
};
export function applyEdits(configuration,workflowId,edits){
 const c=clone(configuration);if(!Array.isArray(edits)||edits.length>40)throw new AresError('提案操作数量无效');
 for(const e of edits){const w=c.workflows.find(w=>w.id===(e.workflowId||workflowId)),s=w?.steps.find(s=>s.id===e.stepId);
  if(e.type==='create_workflow'){c.workflows.push(createWorkflowDraft(c,e,defaults().workflows));}
  else if(e.type==='remove_workflow'){if(!w)throw new AresError('流程不存在');c.workflowArchives={...c.workflowArchives,[w.id]:clone(w)};c.workflows=c.workflows.filter(x=>x.id!==w.id);}
  else if(e.type==='restore_workflow'){const archived=c.workflowArchives?.[e.workflowId||workflowId];if(!archived||w)throw new AresError('没有可恢复的真实流程归档，或ID已存在');const skills=new Set(skillCatalog(c,{content:false}).map(item=>item.id));for(const id of new Set(archived.steps.flatMap(item=>item.skills))){if(!skills.has(id)&&c.skillArchives?.[id]){c.skills.push(clone(c.skillArchives[id]));skills.add(id);}if(!skills.has(id))throw new AresError('归档引用的技能不可恢复：'+id);}c.workflows.push(clone(archived));delete c.workflowArchives[archived.id];}
  else if(e.type==='reorder_workflows'){if(!Array.isArray(e.workflowIds)||e.workflowIds.length!==c.workflows.length||new Set(e.workflowIds).size!==c.workflows.length||e.workflowIds.some(id=>!c.workflows.some(item=>item.id===id)))throw new AresError('排序须包含全部当前流程且不重复');c.workflows=e.workflowIds.map(id=>c.workflows.find(item=>item.id===id));}
  else if(e.type==='create_skill'){if(!e.skill||skillCatalog(c,{content:false}).some(s=>s.id===e.skill.id))throw new AresError('技能已存在或参数无效');c.skills.push({...clone(e.skill),source:'user'});}
  else if(e.type==='update_skill'){const original=skillCatalog(c,{ids:new Set([e.skillId])}).find(s=>s.id===e.skillId);if(!original||hash(original.content)!==e.expectedContentHash)throw new AresError('技能正文已变化，请先重新读取');let content=e.patch?.content??original.content;if(e.replacements){if(e.patch?.content!==undefined||!Array.isArray(e.replacements)||e.replacements.length>20)throw new AresError('不能同时覆盖正文和替换片段');for(const r of e.replacements){if(typeof r.find!=='string'||!r.find||typeof r.replace!=='string'||content.split(r.find).length!==2)throw new AresError('替换片段必须真实且唯一');content=content.replace(r.find,r.replace);}}const value=original.packageId?{...packageReference(editPackage(original.packageId,{content}),original.id),title:e.patch?.title||original.title,description:e.patch?.description??original.description}:{id:original.id,title:e.patch?.title||original.title,description:e.patch?.description??original.description,content,source:'user'};const i=c.skills.findIndex(s=>s.id===e.skillId);if(i<0)c.skills.push(value);else c.skills[i]=value;}
  else if(e.type==='replace_skill_package'){const original=skillCatalog(c,{ids:new Set([e.skill.id])}).find(s=>s.id===e.skill.id);if(!original||hash(original.content)!==e.expectedContentHash)throw new AresError('替换前须读取当前技能正文',409);const i=c.skills.findIndex(s=>s.id===e.skill.id);if(i<0)c.skills.push(e.skill);else c.skills[i]=clone(e.skill);}
  else if(e.type==='update_skill_resource'){const original=skillCatalog(c,{ids:new Set([e.skillId])}).find(s=>s.id===e.skillId);if(!original)throw new AresError('技能不存在');let pack=original.packageId;if(!pack){const imported=original.root?readLocalPackage(original.root):storePackage(new Map([['SKILL.md',Buffer.from(original.content)]]),{kind:'custom-skill',name:original.id});pack=hash(imported.content)===hash(original.content)?imported.id:editPackage(imported.id,{content:original.content}).id;}const next=editPackage(pack,{resources:[e]}),value={...packageReference(next,original.id),title:original.title,description:original.description},i=c.skills.findIndex(s=>s.id===e.skillId);if(i<0)c.skills.push(value);else c.skills[i]=value;}
  else if(e.type==='remove_skill'){const removed=c.skills.find(s=>s.id===e.skillId);if(!removed)throw new AresError('只能移除自定义技能或覆盖副本');if(c.workflows.some(w=>w.steps.some(s=>s.skills.includes(e.skillId)))&&!skillCatalog({...c,skills:c.skills.filter(s=>s.id!==e.skillId)},{content:false}).some(s=>s.id===e.skillId))throw new AresError('技能仍被步骤绑定');c.skillArchives={...c.skillArchives,[e.skillId]:clone(removed)};c.skills=c.skills.filter(s=>s.id!==e.skillId);}
  else if(e.type==='restore_skill'){const archived=c.skillArchives?.[e.skillId];if(!archived||c.skills.some(s=>s.id===e.skillId))throw new AresError('没有可恢复的真实归档技能');c.skills.push(clone(archived));delete c.skillArchives[e.skillId];}
  else if(!w)throw new AresError('未知流程');
  else if(e.type==='update_workflow'){for(const k of ['title','description','pipeline','parameters'])if(e[k]!==undefined)w[k]=e[k];if(e.prompts){if(typeof e.prompts!=='object'||Array.isArray(e.prompts))throw new AresError('流程级提示词须为JSON对象');w.prompts={...w.prompts,...e.prompts};}}
  else if(e.type==='update_step'){if(!s)throw new AresError('提案引用未知步骤');for(const [k,v]of Object.entries(e.changes||{})){if(!['title','objective','prompts','parameters','inputs','outputs','dependsOn','execution'].includes(k))throw new AresError('不允许修改步骤字段：'+k);s[k]=['prompts','parameters'].includes(k)?{...s[k],...v}:v;}}
  else if(e.type==='bind_skill'||e.type==='unbind_skill'){if(!s)throw new AresError('未知步骤');s.skills=e.type==='bind_skill'?[...new Set([...s.skills,e.skillId])]:s.skills.filter(id=>id!==e.skillId);}
  else if(e.type==='add_step'){const at=w.steps.findIndex(s=>s.id===e.afterId);if(at<0)throw new AresError('插入位置不存在');w.steps.splice(at+1,0,e.step);}
  else if(e.type==='remove_step'){if(!s)throw new AresError('删除步骤不存在');w.steps=w.steps.filter(x=>x.id!==e.stepId);}
  else if(e.type==='reorder'){if(!Array.isArray(e.stepIds)||e.stepIds.length!==w.steps.length||new Set(e.stepIds).size!==w.steps.length||e.stepIds.some(id=>!w.steps.some(s=>s.id===id)))throw new AresError('排序必须包含全部步骤且不重复');w.steps=e.stepIds.map(id=>w.steps.find(s=>s.id===id));}
  else throw new AresError('不支持的提案动作：'+e.type);
 }
 return validateConfiguration(c);
}
