/** Real owned JSON files, catalogue/workflow functions and project versions. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {competitionDirectory,changeCompetitionDirectory,directoryPath} from '../host/competition-directory.js';
import {competitionCatalog,readConfiguration,configPath} from '../host/catalog.js?v=2.3.0-loadfix1';
import {readCompetitionWorkflow,saveCompetitionWorkflow,competitionWorkflowSummaries} from '../host/competition-workflows.js?v=2.3.0-loadfix1';
import {linkRoot,initializeProject,readProject} from '../host/projects.js?v=2.3.0-loadfix1';
const sha=b=>createHash('sha256').update(b).digest('hex');
function setup(){const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-directory-'));process.env.ARES_HOME=join(base,'home');return base;}
function change(action,data={}){return changeCompetitionDirectory({action,expectedRevision:competitionDirectory().revision,...data});}

test('users manage builtin and custom competitions/tracks with persistent names, stable identities and revision conflicts',()=>{
 const base=setup(),seed=competitionCatalog();assert.equal(seed.length,132);const builtin=seed[0],track=builtin.tracks[0];
 const created=change('competition-add',{name:'自有软件验证比赛',pipeline:'L4'}),id=created.competitionId,key=created.track;assert.ok(id>=1000000);
 assert.equal(competitionCatalog().find(c=>c.id===id).tracks[0].name,'默认赛道');
 change('competition-rename',{competitionId:id,name:'改名后的软件验证比赛'});change('track-rename',{competitionId:id,track:key,name:'调研组'});
 const extra=change('track-add',{competitionId:id,name:'建模组',pipeline:'L2'});assert.equal(competitionCatalog().find(c=>c.id===id).tracks.find(t=>t.track===extra.track).pipeline,'L2');
 change('track-remove',{competitionId:id,track:key});assert.equal(competitionCatalog().find(c=>c.id===id).tracks.some(t=>t.track===key),false);
 change('track-restore',{competitionId:id,track:key});assert.equal(competitionCatalog().find(c=>c.id===id).tracks.find(t=>t.track===key).name,'调研组');
 change('competition-remove',{competitionId:id});assert.equal(competitionCatalog().some(c=>c.id===id),false);change('competition-restore',{competitionId:id});assert.equal(competitionCatalog().find(c=>c.id===id).name,'改名后的软件验证比赛');
 change('competition-rename',{competitionId:builtin.id,name:'内置比赛显示名称'});change('track-rename',{competitionId:builtin.id,track:track.track,name:'内置赛道显示名称'});
 assert.equal(competitionCatalog()[0].tracks[0].track,track.track);assert.equal(competitionCatalog()[0].tracks[0].name,'内置赛道显示名称');
 change('competition-remove',{competitionId:builtin.id});change('competition-restore',{competitionId:builtin.id});
 const bytes=readFileSync(directoryPath());assert.throws(()=>changeCompetitionDirectory({action:'competition-add',name:'旧修订写入',expectedRevision:0}),e=>e.status===409);assert.deepEqual(readFileSync(directoryPath()),bytes);
 for(const request of [{action:'competition-add',name:'',expectedRevision:competitionDirectory().revision},{action:'track-add',competitionId:id,name:'调研组',expectedRevision:competitionDirectory().revision},{action:'track-remove',competitionId:id,track:track.track,expectedRevision:competitionDirectory().revision},{action:'competition-add',name:'无效方向',pipeline:'invalid',expectedRevision:competitionDirectory().revision},{action:'competition-add',name:'试图带权限字段',principal:'owner',expectedRevision:competitionDirectory().revision}])assert.throws(()=>changeCompetitionDirectory(request));
 assert.deepEqual(readFileSync(directoryPath()),bytes);const stored=JSON.parse(bytes);assert.equal(stored.revision,competitionDirectory().revision);assert.equal(stored.edits.find(c=>c.id===id).tracks.find(t=>t.key===key).name,'调研组');
 writeFileSync(join(base,'directory-receipt.json'),JSON.stringify({mode:'Actual catalogue operations and owned persisted JSON, not competition results',id,key,extraTrack:extra.track,revision:stored.revision,sha256:sha(bytes)},null,2));console.log('COMPETITION_DIRECTORY_EVIDENCE',base);
});

test('rename, removal and restoration preserve saved workflow identity and fixed project bytes',()=>{
 const base=setup(),c=competitionCatalog().find(c=>c.id===5),scope={competitionId:c.id,track:c.tracks[0].track,edition:'2026',group:''};
 const opened=readCompetitionWorkflow(scope),saved=saveCompetitionWorkflow({...scope,workflow:opened.workflow,configuration:opened.configuration,expectedRevision:opened.expectedRevision,expectedWorkflowHash:opened.workflowHash,expectedSkillHashes:opened.skillHashes});
 const root=join(base,'project');mkdirSync(root);linkRoot(root);const p=initializeProject({root,name:'目录保护软件检查',...scope,flowMode:'library',workflowId:saved.workflow.id,expectedWorkflowHash:saved.workflowHash,expectedConfigurationRevision:saved.expectedRevision});
 const configBefore=readFileSync(configPath()),projectBefore=readFileSync(join(root,'.ares/project.json')),definitionBefore=readFileSync(join(root,'.ares/definition.json'));
 change('competition-rename',{competitionId:c.id,name:'改名的建模比赛'});change('track-rename',{competitionId:c.id,track:scope.track,name:'改名的建模赛道'});
 assert.equal(readCompetitionWorkflow(scope).workflowHash,saved.workflowHash);assert.equal(competitionCatalog().find(row=>row.id===c.id).tracks.find(t=>t.track===scope.track).name,'改名的建模赛道');
 change('track-remove',{competitionId:c.id,track:scope.track});assert.doesNotThrow(readConfiguration);assert.equal(competitionWorkflowSummaries().some(w=>w.id===saved.workflow.id),false);assert.throws(()=>readCompetitionWorkflow(scope));
 change('track-restore',{competitionId:c.id,track:scope.track});assert.equal(readCompetitionWorkflow(scope).workflowHash,saved.workflowHash);
 change('competition-remove',{competitionId:c.id});assert.doesNotThrow(readConfiguration);assert.equal(competitionWorkflowSummaries().some(w=>w.id===saved.workflow.id),false);assert.equal(readProject(root).definitionId,p.definitionId);
 change('competition-restore',{competitionId:c.id});assert.equal(readCompetitionWorkflow(scope).workflow.id,saved.workflow.id);assert.equal(competitionWorkflowSummaries().find(w=>w.id===saved.workflow.id).workflowHash,saved.workflowHash);
 assert.deepEqual(readFileSync(configPath()),configBefore);assert.deepEqual(readFileSync(join(root,'.ares/project.json')),projectBefore);assert.deepEqual(readFileSync(join(root,'.ares/definition.json')),definitionBefore);
 writeFileSync(join(base,'workflow-retention-receipt.json'),JSON.stringify({workflowId:saved.workflow.id,workflowHash:saved.workflowHash,projectId:p.id,definitionId:p.definitionId,configSha256:sha(configBefore),projectSha256:sha(projectBefore),fixedDefinitionSha256:sha(definitionBefore),filesUnchanged:true},null,2));console.log('COMPETITION_DIRECTORY_RETENTION',base);
});

test('an empty visible directory and a competition without tracks remain valid and recoverable',()=>{
 const base=setup(),builtinBytes=['competitions.json','tracks.json'].map(n=>readFileSync(new URL('../data/'+n,import.meta.url)));
 const created=change('competition-add',{name:'空赛道恢复软件验证',pipeline:'L3'});change('track-remove',{competitionId:created.competitionId,track:created.track});assert.deepEqual(competitionCatalog().find(c=>c.id===created.competitionId).tracks,[]);assert.doesNotThrow(readConfiguration);
 for(const c of competitionCatalog())change('competition-remove',{competitionId:c.id});assert.deepEqual(competitionCatalog(),[]);assert.doesNotThrow(readConfiguration);
 change('competition-restore',{competitionId:created.competitionId});change('track-restore',{competitionId:created.competitionId,track:created.track});const reopened=readCompetitionWorkflow({competitionId:created.competitionId,track:created.track});assert.equal(reopened.workflow.pipeline,'L3');assert.equal(reopened.basis.requirementsVerified,false);
 for(const [i,n]of ['competitions.json','tracks.json'].entries())assert.deepEqual(readFileSync(new URL('../data/'+n,import.meta.url)),builtinBytes[i]);
 console.log('COMPETITION_DIRECTORY_EMPTY',base);
});
