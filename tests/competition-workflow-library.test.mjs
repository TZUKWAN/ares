/** Owned files and production functions; no online model/cloud/user project. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readCompetitionWorkflow,saveCompetitionWorkflow,competitionWorkflowSummaries} from '../host/competition-workflows.js';
import {defaults,configPath,readConfiguration,saveConfiguration,validateConfiguration,loadVersion,competitionCatalog} from '../host/catalog.js';
import {initializeProject,linkRoot,readProject,previewUpgrade,upgradeProject} from '../host/projects.js';
import {readProjectFlow,previewProjectFlow,applyProjectFlow} from '../host/project-flow.js';
import {hash} from '../host/storage.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-competition-library-'));
const scope={competitionId:1,track:'高教主赛道',edition:'2026',group:''};
function environment(name){process.env.ARES_HOME=join(base,name);return readCompetitionWorkflow(scope);}
function save(context,workflow=context.workflow,configuration=context.configuration){return saveCompetitionWorkflow({...scope,workflow,configuration,expectedRevision:context.expectedRevision,expectedWorkflowHash:context.workflowHash});}
function project(name,body={}){const root=join(process.env.ARES_HOME,name);mkdirSync(root,{recursive:true});linkRoot(root);return initializeProject({root,name:'流程库软件验证 '+name,...scope,flowMode:'library',...body});}

test('competition and track can be compiled and saved before any project, without read-side files',()=>{
 const opened=environment('library');assert.equal(opened.saved,false);assert.equal(existsSync(configPath()),false);assert.equal(opened.workflow.competitionTemplate.track,scope.track);assert.equal(opened.workflow.steps.length,8);
 const workflow=structuredClone(opened.workflow);workflow.steps[0].title='先核对真实竞赛材料';const saved=save(opened,workflow);
 assert.equal(saved.saved,true);assert.equal(saved.expectedRevision,1);assert.equal(saved.workflow.steps[0].title,workflow.steps[0].title);assert.equal(loadVersion(saved.definitionId).workflow.steps[0].title,workflow.steps[0].title);assert.ok(existsSync(configPath()));
 const reread=readCompetitionWorkflow(scope);assert.equal(reread.workflowHash,saved.workflowHash);assert.equal(reread.saved,true);assert.equal(competitionWorkflowSummaries().length,1);assert.equal(competitionWorkflowSummaries()[0].competitionName,'中国国际大学生创新大赛');
 const foreign=readCompetitionWorkflow({competitionId:2,track:'哲学社会科学类社会调查报告',edition:'2026'});assert.equal(foreign.saved,false);assert.notEqual(foreign.workflow.id,saved.workflow.id);assert.ok(foreign.workflow.steps.some(step=>step.id==='fieldwork'));
 assert.throws(()=>readCompetitionWorkflow({...scope,track:'不属于本赛的赛道'}));
});

test('scope association and concurrent library revisions reject overwrites through both scoped and full configuration saves',()=>{
 const opened=environment('guards'),first=save(opened),before=readFileSync(configPath());
 assert.throws(()=>save(opened),{status:409});
 assert.throws(()=>readCompetitionWorkflow({...scope,edition:'2027',workflowId:first.workflow.id}),{status:403});
 assert.throws(()=>saveCompetitionWorkflow({...scope,edition:'2027',workflow:first.workflow,expectedRevision:1}),{status:403});
 assert.throws(()=>saveCompetitionWorkflow({...scope,workflow:{...first.workflow,id:'venture'},expectedRevision:1}),{status:403});
 const wrong=structuredClone(first.configuration);wrong.workflows.find(row=>row.id===first.workflow.id).competitionTemplate.track='其他比赛赛道';assert.throws(()=>saveConfiguration(wrong,1));
 const projectOwned=structuredClone(first.configuration);projectOwned.workflows.find(row=>row.id===first.workflow.id).competitionScope.projectId='foreign-project';assert.throws(()=>saveConfiguration(projectOwned,1),{status:403});
 const pipeline=structuredClone(first.configuration);pipeline.workflows.find(row=>row.id===first.workflow.id).pipeline='L4';assert.throws(()=>saveConfiguration(pipeline,1),{status:403});
 assert.throws(()=>saveCompetitionWorkflow({...scope,workflow:first.workflow,expectedRevision:1,expectedWorkflowHash:'a'.repeat(64)}),{status:409});
 assert.deepEqual(readFileSync(configPath()),before);
});

test('one saved competition flow creates independent projects and later library edits preserve their fixed source and progress',()=>{
 const first=save(environment('projects')),a=project('a',{workflowId:first.workflow.id}),b=project('b',{workflowId:first.workflow.id});
 const aBefore=readFileSync(join(a.root,'.ares/project.json')),bBefore=readFileSync(join(b.root,'.ares/project.json'));assert.equal(a.definitionId,b.definitionId);assert.equal(a.workflow.competitionTemplateSource.workflowHash,first.workflowHash);
 const edited=structuredClone(first.workflow);edited.steps[0].objective+='\n仅为新建项目增加的软件验证要求。';const second=save(first,edited),c=project('c',{workflowId:second.workflow.id});
 assert.deepEqual(readFileSync(join(a.root,'.ares/project.json')),aBefore);assert.deepEqual(readFileSync(join(b.root,'.ares/project.json')),bBefore);assert.equal(readProject(a.root).definitionId,a.definitionId);assert.notEqual(c.definitionId,a.definitionId);assert.equal(c.workflow.steps[0].objective,edited.steps[0].objective);assert.equal(c.progress.done,0);assert.equal(c.workflow.competitionTemplateSource.workflowHash,second.workflowHash);
 assert.throws(()=>project('wrong-year',{workflowId:second.workflow.id,edition:'2027'}),{status:403});
 assert.throws(()=>project('stale-source',{workflowId:second.workflow.id,expectedWorkflowHash:first.workflowHash}),{status:409});
 assert.equal(readProject(a.root).progress.done,0);assert.equal(loadVersion(first.definitionId).workflow.steps[0].objective,first.workflow.steps[0].objective);
 const automatic=project('automatic',{flowMode:'competition'});assert.equal(automatic.workflow.steps[0].objective,edited.steps[0].objective);
});

test('a project created from the saved library can still preview and apply its own flow without changing the shared template',()=>{
 const saved=save(environment('project-customize')),a=project('a',{workflowId:saved.workflow.id}),b=project('b',{workflowId:saved.workflow.id}),before=readFileSync(configPath()),other=readFileSync(join(b.root,'.ares/project.json'));
 const opened=readProjectFlow({root:a.root}),workflow=structuredClone(opened.workflow);workflow.steps[0].objective+='\n此处仅调整当前参赛项目。';workflow.competitionTemplateSource.workflowHash='forged-source';
 const request={root:a.root,projectId:a.id,expectedRevision:a.revision,expectedDefinitionId:a.definitionId,workflow},preview=previewProjectFlow(request).preview;
 const result=applyProjectFlow({...request,fromId:preview.fromId,toId:preview.toId});
 assert.equal(result.applied,true);assert.equal(result.project.workflow.steps[0].objective,workflow.steps[0].objective);assert.equal(result.project.workflow.competitionScope.projectId,a.id);
 assert.deepEqual(readFileSync(configPath()),before);assert.deepEqual(readFileSync(join(b.root,'.ares/project.json')),other);assert.equal(readProject(a.root).progress.done,0);assert.deepEqual(result.project.workflow.competitionTemplate,saved.workflow.competitionTemplate);assert.deepEqual(result.project.workflow.competitionTemplateSource,a.workflow.competitionTemplateSource);
 const next=readProjectFlow({root:a.root}),bad=structuredClone(next.workflow);bad.competitionTemplate.track='其他赛道';assert.throws(()=>previewProjectFlow({root:a.root,projectId:a.id,expectedRevision:next.expectedRevision,expectedDefinitionId:next.expectedDefinitionId,workflow:bad}),{status:403});
});

test('legacy workflow-ID upgrade entry also rejects a saved flow from another competition in the same pipeline',()=>{
 const saved=save(environment('upgrade-scope')),a=project('a',{workflowId:saved.workflow.id}),otherScope={competitionId:3,track:'默认赛道',edition:'2026',group:''},other=readCompetitionWorkflow(otherScope),foreign=saveCompetitionWorkflow({...otherScope,workflow:other.workflow,expectedRevision:other.expectedRevision});
 const before=readFileSync(join(a.root,'.ares/project.json'));assert.equal(foreign.workflow.pipeline,a.workflow.pipeline);
 assert.throws(()=>previewUpgrade({root:a.root,workflowId:foreign.workflow.id}),{status:403});assert.throws(()=>upgradeProject({root:a.root,workflowId:foreign.workflow.id,expectedRevision:a.revision,fromId:a.definitionId,toId:foreign.definitionId}),{status:403});
 assert.deepEqual(readFileSync(join(a.root,'.ares/project.json')),before);
});

test('selected-flow save merges only actually referenced custom skills and freezes their real bytes',()=>{
 const opened=environment('skills'),workflow=structuredClone(opened.workflow),configuration=structuredClone(opened.configuration);
 configuration.skills.push({id:'owned-library-skill',title:'真实软件验证能力',description:'本地正文，不宣称在线执行',content:'# 真实验证技能\n\n读取项目资料，明确来源和缺口。'});
 configuration.skills.push({id:'unrelated-draft-skill',title:'未引用草稿',content:'# 不应在本次保存中写入'});
 configuration.workflows[0].title='未选中流程的未保存修改';workflow.steps[0].skills=['owned-library-skill'];
 const saved=save(opened,workflow,configuration),stored=readConfiguration();
 assert.ok(stored.skills.some(row=>row.id==='owned-library-skill'));assert.equal(stored.skills.some(row=>row.id==='unrelated-draft-skill'),false);assert.equal(stored.workflows[0].title,opened.configuration.workflows[0].title);
 assert.equal(loadVersion(saved.definitionId).skills.find(row=>row.id==='owned-library-skill').content,configuration.skills[0].content);
 const next=readCompetitionWorkflow(scope),bad=structuredClone(next.configuration);bad.revision--;assert.throws(()=>save(next,next.workflow,bad),{status:409});
 const missing=structuredClone(next.workflow);missing.steps[0].skills=['does-not-exist'];assert.throws(()=>save(next,missing),/真实技能/);
});

test('rebasing a global revision cannot silently overwrite externally edited referenced skill content',()=>{
 const opened=environment('skill-conflict'),workflow=structuredClone(opened.workflow),configuration=structuredClone(opened.configuration);
 workflow.steps[0].skills=['referenced-skill'];configuration.skills.push({id:'referenced-skill',title:'需核对版本的实际技能',content:'# 初始实际正文'});
 const first=saveCompetitionWorkflow({...scope,workflow,configuration,expectedRevision:opened.expectedRevision,expectedSkillHashes:opened.skillHashes});
 assert.equal(first.skillHashes['referenced-skill'],hash(first.configuration.skills.find(row=>row.id==='referenced-skill')));
 const local=structuredClone(first.configuration);local.skills.find(row=>row.id==='referenced-skill').content='# 本地尚未保存的修改';
 const external=readConfiguration();external.skills.find(row=>row.id==='referenced-skill').content='# 其他编辑已保存的修改';const changed=saveConfiguration(external,external.revision),before=readFileSync(configPath());local.revision=changed.revision;
 assert.throws(()=>saveCompetitionWorkflow({...scope,workflow:first.workflow,configuration:local,expectedRevision:changed.revision,expectedWorkflowHash:first.workflowHash,expectedSkillHashes:first.skillHashes}),{status:409});assert.deepEqual(readFileSync(configPath()),before);
 const fresh=readCompetitionWorkflow(scope);assert.notEqual(fresh.skillHashes['referenced-skill'],first.skillHashes['referenced-skill']);
 const reviewed=structuredClone(fresh.configuration);reviewed.skills.find(row=>row.id==='referenced-skill').content='# 已核对双方修改后保存的实际正文';
 const saved=saveCompetitionWorkflow({...scope,workflow:fresh.workflow,configuration:reviewed,expectedRevision:fresh.expectedRevision,expectedWorkflowHash:fresh.workflowHash,expectedSkillHashes:fresh.skillHashes});
 assert.equal(loadVersion(saved.definitionId).skills.find(row=>row.id==='referenced-skill').content,'# 已核对双方修改后保存的实际正文');
});

test('explicit library creation rejects missing or foreign saved flows while legacy generic initialization remains available',()=>{
 const context=environment('legacy'),root=join(process.env.ARES_HOME,'legacy');mkdirSync(root,{recursive:true});linkRoot(root);
 const p=initializeProject({root,name:'原通用流程软件验证',...scope,workflowId:'venture'});assert.equal(p.kind,'v2');assert.equal(p.workflow.id,'venture');assert.equal(p.progress.done,0);
 assert.throws(()=>project('not-saved',{workflowId:context.workflow.id}),{status:403});
 assert.throws(()=>project('no-selection'),/已保存/);
 const survey=competitionCatalog().find(row=>row.id===5);const unknown=readCompetitionWorkflow({competitionId:5,track:survey.tracks[0].track});assert.equal(unknown.saved,false);assert.equal(unknown.basis.method,'requirements-first-draft');assert.equal(unknown.basis.requirementsVerified,false);
});

test('scoped route can retain the original native publisher and its last-moment idle guard',async()=>{
 const context=environment('native-publish'),events=[];
 const result=await saveCompetitionWorkflow({...scope,workflow:context.workflow,expectedRevision:0},{
  beforeCommit(){events.push('idle');},
  async commitConfiguration(configuration,revision,{beforeCommit}){events.push('publish');await Promise.resolve();beforeCommit();events.push('disk');return {configuration:saveConfiguration(configuration,revision),warning:'测试目录通知回执',capabilities:{native:{available:false}}};}
 });
 assert.deepEqual(events,['publish','idle','disk']);assert.equal(result.saved,true);assert.equal(result.expectedRevision,1);assert.equal(result.warning,'测试目录通知回执');
 const opened=readCompetitionWorkflow(scope),bytes=readFileSync(configPath());
 await assert.rejects(()=>saveCompetitionWorkflow({...scope,workflow:opened.workflow,expectedRevision:1},{beforeCommit(){throw Object.assign(new Error('实际空闲门禁拒绝'),{status:409});},async commitConfiguration(configuration,revision,{beforeCommit}){await Promise.resolve();beforeCommit();return {configuration:saveConfiguration(configuration,revision)};}}),{status:409});
 assert.deepEqual(readFileSync(configPath()),bytes);
});

test('configuration can hold saved track workflows beyond the old category-only count without relaxing byte or node limits',()=>{
 const context=environment('capacity'),configuration=structuredClone(context.configuration);
 for(let i=0;i<120;i++)configuration.workflows.push({...structuredClone(context.workflow),id:'owned-catalog-'+i});
 assert.equal(validateConfiguration(configuration).workflows.length,132);
 const tooMany=structuredClone(configuration);tooMany.workflows=Array.from({length:513},(_,i)=>({...structuredClone(context.workflow),id:'bounded-'+i}));assert.throws(()=>validateConfiguration(tooMany),/配置结构/);
 console.log('COMPETITION_LIBRARY_EVIDENCE',base);
});
