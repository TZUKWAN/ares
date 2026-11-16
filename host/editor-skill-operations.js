import {AresError,clone} from './storage.js';
import {skillCatalog} from './catalog.js?v=2.3.0-directory1';
import {readLocalPackage,readGithubPackage,packageReference} from './skill-packages.js';
import {addLibrarySource,knownSourceAllows,sourceAuthorized,materializeLibrarySkill} from './skill-library.js';

export async function prepareSkillEdits(configuration,workflowId,edits,{authorization='',readReceipts={},signal}={}){
 if(!Array.isArray(edits)||edits.length>40)throw new AresError('提案最多40项操作');
 const current=clone(configuration),prepared=[],libraryChanges=[];
 for(const edit of edits){signal?.throwIfAborted();
  if(edit.type==='index_source'){
   const result=await addLibrarySource(edit.source,edit.expectedLibraryRevision,{signal,authorization});libraryChanges.push({revision:result.revision,sources:result.sources.map(({id,total,commit})=>({id,total,commit}))});continue;
  }
  if(edit.type==='install_skill'){
   if(!edit.source||!['local','github'].includes(edit.source.kind))throw new AresError('安装技能需要真实local或github来源');
   if(!sourceAuthorized(edit.source,authorization)&&!knownSourceAllows(edit.source))throw new AresError('安装来源必须由刘总真实用户消息或已登记来源授权',403);
   const pack=edit.source.kind==='local'?readLocalPackage(edit.source.path):edit.source.kind==='github'?await readGithubPackage(edit.source,{signal}):null;if(!pack)throw new AresError('不支持的技能来源');
   const skill=packageReference(pack,edit.id),existing=skillCatalog(current,{content:false}).some(item=>item.id===skill.id);
   if(existing&&!edit.replace)throw new AresError('技能已存在，需要明确replace和当前正文哈希');
   prepared.push(existing?{type:'replace_skill_package',skill,expectedContentHash:edit.expectedContentHash}:{type:'create_skill',skill});
   if(!existing)current.skills.push(skill);else current.skills=current.skills.filter(item=>item.id!==skill.id).concat(skill);continue;
  }
  if(edit.type==='bind_skill'){
   let skill=skillCatalog(current,{content:false,ids:new Set([edit.skillId])}).find(item=>item.id===edit.skillId);
   if(!skill&&String(edit.skillId).startsWith('library-')){
    const loaded=await materializeLibrarySkill(edit.skillId,{signal});if(readReceipts[edit.skillId]!==loaded.readToken)throw new AresError('先读取此来源版本的技能正文，再绑定到步骤',409);skill=loaded.skill;current.skills.push(skill);prepared.push({type:'create_skill',skill});
   }
   const workflow=current.workflows.find(item=>item.id===(edit.workflowId||workflowId)),already=workflow?.steps.find(item=>item.id===edit.stepId)?.skills.includes(edit.skillId);
   if(skill?.packageId&&!already&&readReceipts[skill.id]!==skill.packageId)throw new AresError('导入技能须先读取当前包正文后再绑定',409);
  }
  prepared.push(edit);
 }
 if(prepared.length>40)throw new AresError('技能物化后操作过多，请缩小单次修改');return {edits:prepared,libraryChanges};
}
