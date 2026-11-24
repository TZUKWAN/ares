import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {competitionCatalog} from '../host/catalog.js';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {captureDraft,artifactHistory} from '../host/project-workbench.js';
import {researchEntry} from '../host/project-research.js';
import {readProjectObject} from '../host/project-objects.js';
import {prepareDefense,proposeDefense,adoptDefense,saveDefenseAnswers,defenseFollowup,resolveDefenseFollowup} from '../host/study-defense.js';
import {projectPlan,saveProjectPlan} from '../host/project-plan.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-defense-'));process.env.ARES_HOME=join(base,'home');
function setup(name){
  const root=join(base,name);mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(c=>c.id===5);
  const p=initializeProject({root,name,competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'}),step=p.workflow.steps[0],output=step.outputs.find(o=>o.kind==='file'&&o.format==='md'),path=join(root,p.outputDir,output.path);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'# 软件验收报告\n试验采用40份软件生成的协议样例，不能作为实际研究结论。\n');
  captureDraft({root,expectedRevision:0,stepId:step.id,artifactId:output.id});
  return {root,step,output,path,id:artifactHistory(root,output.id).versions[0].id};
}
test('defense questions and feedback cite fixed actual bytes, preserve the answer and create an independent project followup',async()=>{
  const {root,step,path,id}=setup('practice');
  const initial=await prepareDefense({root,expectedRevision:1,artifactVersionIds:[id]});
  writeFileSync(path,'# 工作稿已另行修改\n不替换历史演练材料。');
  const source=researchEntry(root,initial.item.id).data.sources[0];
  assert.match(readProjectObject(root,source.textObject.sha256).toString(),/40份/);
  const actor={kind:'agent',id:'explicit-protocol-agent'},evidence=[{sourceId:'s1',quote:'试验采用40份软件生成的协议样例',location:'第一段'}];
  const proposal=proposeDefense({root,expectedRevision:2,design:{sourceId:initial.item.id,sourceVersion:initial.version.id,questions:[{id:'q1',stepId:step.id,question:'这40份样例的适用范围是什么？',evidence}]}},actor);
  assert.equal(proposal.item.status,'proposal');
  assert.throws(()=>adoptDefense({root,expectedRevision:3,id:proposal.item.id}),/核对/);
  const adopted=adoptDefense({root,expectedRevision:3,id:proposal.item.id,confirm:true});
  const answered=saveDefenseAnswers({root,expectedRevision:4,id:adopted.item.id,answers:{q1:'这些是软件协议样例，不代表真实调查。'}});
  const feedback=proposeDefense({root,expectedRevision:5,design:{sourceId:adopted.item.id,sourceVersion:answered.version.id,feedback:[{questionId:'q1',observation:'回答说明了样本边界。',suggestion:'在报告对应步骤补充样例用途说明。',evidence}]}},actor);
  const reviewed=adoptDefense({root,expectedRevision:6,id:feedback.item.id,confirm:true});
  const data=researchEntry(root,reviewed.item.id).data;assert.equal(data.answers.q1,'这些是软件协议样例，不代表真实调查。');assert.equal(data.practiceOnly,true);
  const request={root,expectedRevision:7,id:reviewed.item.id,findingId:'f_q1',confirm:true},task=defenseFollowup(request);
  assert.equal(task.followup.stepId,step.id);assert.equal(task.followup.status,'open');assert.equal(projectPlan(root).followups.length,1);
  saveProjectPlan({root,expectedRevision:8,steps:[]});assert.equal(projectPlan(root).followups.length,1);
  resolveDefenseFollowup({root,expectedRevision:9,followupId:task.followup.id,confirm:true});
  assert.equal(projectPlan(root).followups[0].status,'done');assert.equal(readProject(root).progress.done,0);
  assert.equal(readFileSync(path,'utf8'),'# 工作稿已另行修改\n不替换历史演练材料。');
});
test('foreign versions, invented evidence and feedback without a recorded answer cannot become accepted practice',async()=>{
  const {root,step,id}=setup('guards');const other=setup('other');
  await assert.rejects(prepareDefense({root,expectedRevision:1,artifactVersionIds:[other.id]}),/当前项目/);
  const ready=await prepareDefense({root,expectedRevision:1,artifactVersionIds:[id]});
  const body={root,expectedRevision:2,design:{sourceId:ready.item.id,sourceVersion:ready.version.id,questions:[{id:'q1',stepId:step.id,question:'样本？',evidence:[{sourceId:'s1',quote:'不存在的依据'}]}]}};
  assert.throws(()=>proposeDefense(body,{kind:'agent',id:'protocol'}),/逐字原文/);
  assert.throws(()=>proposeDefense({...body,design:{...body.design,questions:undefined,feedback:[{questionId:'q1',observation:'虚构回答',suggestion:'补充',evidence:[]}]}},{kind:'agent',id:'protocol'}),/实际回答/);
  assert.throws(()=>saveDefenseAnswers({root,expectedRevision:2,id:ready.item.id,answers:{invented:'回答'}}),/当前演练问题/);
  assert.throws(()=>proposeDefense(body,{kind:'user',id:'owner'}),/助手身份/);
});
