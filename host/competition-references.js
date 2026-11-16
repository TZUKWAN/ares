import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AresError,readJson,clone,hash} from './storage.js';
const file=fileURLToPath(new URL('../data/competition-references.json',import.meta.url));
export function competitionReferences(competitionId){const data=readJson(file);return data.profiles.filter(item=>competitionId===undefined||item.competitionId===Number(competitionId)).map(item=>({...item,checkedAt:data.checkedAt,digest:hash(item)}));}
export function referenceWorkflow(workflow,id,competition){
 const profile=competitionReferences().find(item=>item.id===id);if(!profile||profile.competitionId!==Number(competition.id)||profile.track&&profile.track!==competition.track||!profile.workflows.includes(workflow.baseWorkflowId||workflow.id))throw new AresError('所选规则参考与赛事、赛道或作品类型不同');
 const next=clone(workflow);next.baseWorkflowId=workflow.baseWorkflowId||workflow.id;next.competitionReference=profile;next.id=(next.baseWorkflowId+'-'+profile.id).slice(0,66)+'-'+hash({base:next.baseWorkflowId,reference:profile.id}).slice(0,12);next.title=workflow.title+' · '+profile.title;
 for(const step of next.steps){const note=profile.phases[step.id];if(note)step.prompts.execute+='\n赛事参考：'+note;}
 next.prompts={...next.prompts,system:(next.prompts?.system||'')+'\n本项目采用规则参考：'+profile.title+'。仅为参考，需另核对项目实际届次、题目和赛区；来源未核验项不能当已满足。'};return next;
}
