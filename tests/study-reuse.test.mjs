import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {captureDraft,artifactHistory} from '../host/project-workbench.js';
import {reuseTargets,previewReuse,applyReuse,resumeReuse} from '../host/study-reuse.js';
import {saveResearchVersion,researchEntry} from '../host/project-research.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-reuse-'));process.env.ARES_HOME=join(base,'home');
function setup(name){
  const root=join(base,name);mkdirSync(root);linkRoot(root);const comp=competitionCatalog().find(c=>c.id===5);
  const p=initializeProject({root,name,competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'}),step=p.workflow.steps[0],output=step.outputs.find(o=>o.kind==='file'&&o.format==='md'),path=join(root,p.outputDir,output.path);
  mkdirSync(dirname(path),{recursive:true});writeFileSync(path,'# 固定软件验收稿\n此材料仅用于验证跨赛项目复制和版本边界。');
  captureDraft({root,expectedRevision:0,stepId:step.id,artifactId:output.id});
  const targetComp=competitionCatalog().find(c=>c.id===1),scope={competitionId:targetComp.id,track:targetComp.tracks[0].track,edition:'SOFTWARE-QA',group:'测试组'};
  const targets=reuseTargets({root,...scope}),target=targets.targets.find(o=>o.kind==='file'&&o.format==='md');assert.ok(target);
  return {root,path,target,scope,id:artifactHistory(root,output.id).versions[0].id};
}
test('a new competition project copies immutable actual bytes and never inherits acceptance, rules, credentials or source mutations',()=>{
  const {root,path,target,scope,id}=setup('source');const originalProject=readFileSync(join(root,'.ares/project.json')),fixed=readFileSync(path);
  writeFileSync(path,'# 原项目正在编辑，不能替换固定版本');
  const body={root,...scope,targetRoot:join(base,'new-competition'),name:'软件改编目标',mapping:[{sourceVersionId:id,targetArtifactId:target.id}]},preview=previewReuse(body);
  assert.equal(existsSync(body.targetRoot),false);assert.equal(preview.acceptanceInherited,false);assert.ok(preview.gaps.length);
  assert.throws(()=>applyReuse({...body,token:preview.token}),/确认/);
  const result=applyReuse({...body,token:preview.token,confirm:true}),p=readProject(body.targetRoot);
  assert.equal(p.competition.id,scope.competitionId);assert.equal(p.competition.edition,scope.edition);assert.equal(p.competition.group,scope.group);
  assert.equal(p.progress.done,0);assert.equal(p.competition.ruleStatus,'needs-current-edition-verification');assert.equal(p.competition.ruleBaseline,undefined);
  assert.ok(Object.values(p.tasks).every(task=>task.status==='pending'&&!task.acceptedVersionIds?.length));
  assert.deepEqual(readFileSync(join(p.root,p.outputDir,target.path)),fixed);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),originalProject);
  assert.equal(readFileSync(path,'utf8'),'# 原项目正在编辑，不能替换固定版本');
  const reused=researchEntry(p.root,result.item.id);assert.equal(reused.data.status,'completed');assert.equal(reused.data.plan.sourceProjectId,readProject(root).id);
  assert.equal(resumeReuse({root:p.root,id:result.item.id,confirm:true}).resumed,true);
});
test('foreign versions, incompatible mappings, nonempty targets and a changed preview cannot overwrite any project',()=>{
  const {root,target,scope,id}=setup('guard-source'),other=setup('foreign'),targetRoot=join(base,'guard-target');
  const body={root,...scope,targetRoot,name:'改编检查',mapping:[{sourceVersionId:id,targetArtifactId:target.id}]};
  assert.throws(()=>previewReuse({...body,targetRoot:root}),/原项目/);
  assert.throws(()=>previewReuse({...body,mapping:[{sourceVersionId:other.id,targetArtifactId:target.id}]}),/不属于原项目/);
  assert.throws(()=>previewReuse({...body,mapping:[{sourceVersionId:id,targetArtifactId:'unknown'}]}),/不存在/);
  const preview=previewReuse(body);
  assert.throws(()=>applyReuse({...body,name:'已改变名称',token:preview.token,confirm:true}),/重新预览/);assert.equal(existsSync(targetRoot),false);
  mkdirSync(targetRoot);writeFileSync(join(targetRoot,'keep.txt'),'user data');
  assert.throws(()=>applyReuse({...body,token:preview.token,confirm:true}),/为空/);assert.equal(readFileSync(join(targetRoot,'keep.txt'),'utf8'),'user data');
});


test('an interrupted copy stays recoverable and refuses to replace a changed target file',()=>{
  const {root,path,target,scope,id}=setup('resume-source'),body={root,...scope,targetRoot:join(base,'resume-target'),name:'可恢复改编',mapping:[{sourceVersionId:id,targetArtifactId:target.id}]};
  const preview=previewReuse(body),created=applyReuse({...body,token:preview.token,confirm:true}),p=created.project;
  const entry=researchEntry(p.root,created.item.id),targetFile=join(p.root,p.outputDir,target.path),expected=readFileSync(targetFile);
  // Explicit interruption-state fixture: production resume must re-check the actual bytes.
  saveResearchVersion({root:p.root,expectedRevision:p.revision,id:entry.item.id,baseVersion:entry.version.id},{kind:'reuse',title:entry.item.title,status:'copying',provenance:'source-project',data:{...entry.data,status:'copying'}});
  writeFileSync(targetFile,'# 用户在新项目修改的工作稿');
  assert.throws(()=>resumeReuse({root:p.root,id:entry.item.id,confirm:true}),/未覆盖/);
  assert.equal(readFileSync(targetFile,'utf8'),'# 用户在新项目修改的工作稿');assert.equal(researchEntry(p.root,entry.item.id).item.status,'needs-attention');
  writeFileSync(targetFile,expected);
  assert.equal(resumeReuse({root:p.root,id:entry.item.id,confirm:true}).item.status,'completed');assert.equal(readProject(p.root).progress.done,0);
});
