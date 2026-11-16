import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createRoutes} from '../host/routes.js';
import {presetDefinition,createNativeCatalog} from '../host/native.js';
import {apply as installRuntime} from '../host/runtime.js';
import {readConfiguration,freezeWorkflow,loadVersion} from '../host/catalog.js';
import {applyEdits} from '../host/assistant.js';
import {nativePlugins} from '../host/native-toolbox.js';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-api-tests-'));process.env.ARES_HOME=join(base,'isolated-home');
// Explicit admission fixture verifies the ARES boundary, not DSH credential cryptography.
const admission={get:key=>key==='connection'?{admit:req=>req.headers.authorization==='Bearer ares-test-owner'?{peer:{principal:{kind:'owner'}}}:req.headers.authorization==='Bearer ares-test-guest'?{peer:{principal:{kind:'guest'}}}:{rejection:401}}:undefined};
const api=createRoutes(admission),server=createServer((req,res)=>{const route=api.routes.find(r=>r.path===new URL(req.url,'http://localhost').pathname);if(route)route.handler(req,res);else{res.writeHead(404);res.end();}});let url;
before(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));url='http://127.0.0.1:'+server.address().port;});
after(async()=>{api.dispose();await new Promise(r=>server.close(r));});
async function request(path,data,headers={}){headers={authorization:'Bearer ares-test-owner',...headers};const response=await fetch(url+'/ares/api/v2/'+path,data===undefined?{headers}:{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});return {status:response.status,body:await response.json()};}
let boot,root,p;
test('real HTTP boot contains catalogue/configuration and honestly unavailable host capabilities',async()=>{const r=await request('bootstrap');assert.equal(r.status,200);boot=r.body;assert.equal(boot.competitions.length,132);assert.equal(boot.configuration.workflows.length,12);assert.equal(boot.capabilities.native.available,false);assert.equal(boot.capabilities.assistant.available,false);});
test('all sensitive reads and writes require an authenticated DSH owner',async()=>{assert.equal((await request('bootstrap',undefined,{authorization:''})).status,401);assert.equal((await request('projects',undefined,{authorization:'Bearer ares-test-guest'})).status,403);const before=readConfiguration();assert.equal((await request('configuration',{configuration:before,expectedRevision:before.revision},{authorization:''})).status,401);assert.equal(readConfiguration().revision,before.revision);for(const path of ['assistant/health','project/workbench','project/release','project/extensions/build','project/extensions/run','project/collaboration/connect','project/collaboration/publish','project/collaboration/grant','project/assistant/connect','project/viewer/status','project/viewer/open','project/viewer/page','project/viewer/image','project/viewer/save','project/collaboration/upload-working','project/collaboration/reconcile-working']){assert.equal((await request(path,{}, {authorization:''})).status,401,path);assert.equal((await request(path,{}, {authorization:'Bearer ares-test-guest'})).status,403,path);}});
test('wrong HTTP methods and cross-site writes are rejected',async()=>{assert.equal((await request('configuration')).status,405);assert.equal((await request('configuration',{configuration:boot.configuration,expectedRevision:0},{origin:'https://unrelated.invalid'})).status,403);});
test('configuration HTTP save rejects stale writers and retains real stored revision',async()=>{const r=await request('configuration',{configuration:boot.configuration,expectedRevision:0});assert.equal(r.status,200);assert.equal(r.body.configuration.revision,1);assert.equal((await request('configuration',{configuration:boot.configuration,expectedRevision:0})).status,409);});
test('custom chat is retired and unavailable native editor/session fails explicitly',async()=>{assert.equal((await request('assistant/models')).status,410);assert.equal((await request('assistant/session',{})).status,503);assert.equal((await request('project/session',{root:base})).status,503);});
test('native declaration matches installed desktop vocabulary and retains all native tools without auto-starting them',()=>{
 const c=readConfiguration(),v=freezeWorkflow(c.workflows.find(w=>w.id==='modeling'),c),d=presetDefinition(v);
 assert.equal(d.id,'ares-v2-'+v.id);assert.ok(d.name.startsWith('ARES'));assert.ok(Array.isArray(d.plugins));assert.ok(d.plugins.some(p=>p.name==='ares/runtime'));assert.ok(d.plugins.some(p=>p.id==='delegation'));assert.ok(d.plugins.some(p=>p.id==='tool-goal'));assert.match(d.plugins.find(p=>p.id==='persona').config.prefix,/禁止自发启动/);
});
test('retiring the ARES roster filter preserves a later METIS-style wrapper',async()=>{const rows=new Map([['metis-test-fixture',{id:'metis-test-fixture'}]]),cleanups=[];const registry={definitions:new Map(),async register(d){rows.set(d.id,{id:d.id});return()=>rows.delete(d.id);},async resolve(id){return {id};},async remoteExportList(){return {presets:[...rows.values()]};}};registry.definitions.set('standard',{config:{plugins:nativePlugins('')},context:{agentPresets:registry}});const native=createNativeCatalog({inject(_deps,fn){fn({agentPresets:registry,effect(fn){cleanups.push(fn());}});},emit(){}});await native.publish();const aresRoster=registry.remoteExportList;const later=async function(){const result=await aresRoster.call(this);return {...result,metisFixture:true};};registry.remoteExportList=later;await native.dispose();cleanups.forEach(fn=>fn?.());assert.equal(registry.remoteExportList,later);assert.equal((await registry.remoteExportList()).metisFixture,true);});
test('scoped runtime registers real tool contracts and refuses unrelated skill reads',async()=>{
 // Adapter boundary test only. This does not claim the desktop host was launched.
 const c=readConfiguration(),v=freezeWorkflow(c.workflows[0],c),registered=new Map(),cleanup=[];
 installRuntime({tools:{register(t){registered.set(t.name,t);return()=>registered.delete(t.name);}},skills:{},effect(fn){const off=fn();if(typeof off==='function')cleanup.push(off);}},{definitionId:v.id});
 assert.ok(registered.has('ares_project'));const tool=registered.get('ares_library'),exec={agent:{id:'TEST-FIXTURE-AGENT'}};
 await assert.rejects(()=>tool.execute({action:'read',stepId:'context',skillId:'ares-intake'},exec),/open/);
 await tool.execute({action:'open',stepId:'context'},exec);const data=JSON.parse(await tool.execute({action:'read',stepId:'context',skillId:'ares-intake'},exec));assert.ok(data.content.includes('资料盘点'));
 await assert.rejects(()=>tool.execute({action:'read',stepId:'context',skillId:'ares-finance'},exec),/未绑定/);
 const prepared=JSON.parse(await tool.execute({action:'prepare',stepId:'context',skillId:'ares-intake'},exec));assert.ok(readFileSync(join(prepared.skillRoot,'SKILL.md'),'utf8').includes('资料盘点'));
 const projectTool=registered.get('ares_project'),fresh=join(base,'fresh-session');mkdirSync(fresh);const freshExec={agent:{id:'TEST-FRESH-SESSION',session:{header:{cwd:fresh}}}};
 const catalogue=JSON.parse(await projectTool.execute({action:'catalog',query:'蓝桥杯'},freshExec));assert.equal(catalogue.records.length,1);assert.equal(catalogue.records[0].id,51);
 assert.equal(JSON.parse(await projectTool.execute({action:'status'},freshExec)).kind,'unlinked');const competition=boot.competitions.find(c=>c.id===1);
 const initialized=JSON.parse(await projectTool.execute({action:'init',name:'原生入口软件测试夹具',competitionId:1,track:competition.tracks[0].track,edition:'TEST'},freshExec));assert.equal(initialized.kind,'v2');assert.equal(initialized.progress.done,0);
 const modernTools=new Map();installRuntime({tools:{register(tool){modernTools.set(tool.name,tool);return()=>modernTools.delete(tool.name);}},skills:{},effect(fn){fn();}},{definitionId:v.id,execution:'native-on-demand-v1'});const modern=modernTools.get('ares_project');await assert.rejects(()=>modern.execute({action:'facts',facts:{goal:'explicit revision test fixture'}},freshExec),/expectedRevision/);const updated=JSON.parse(await modern.execute({action:'facts',expectedRevision:initialized.revision,facts:{goal:'explicit revision test fixture'}},freshExec));assert.equal(updated.facts.goal,'explicit revision test fixture');assert.equal(updated.revision,initialized.revision+1);
 await request('roots',{path:fresh,remove:true});cleanup.reverse().forEach(fn=>fn());
});
test('assistant edits are validated configuration changes and cannot invent skills',()=>{
 const c=readConfiguration(),updated=applyEdits(c,'modeling',[{type:'update_step',stepId:'problem',changes:{objective:'TEST FIXTURE updated objective'}}]);assert.equal(updated.workflows.find(w=>w.id==='modeling').steps.find(s=>s.id==='problem').objective,'TEST FIXTURE updated objective');
 assert.throws(()=>applyEdits(c,'modeling',[{type:'bind_skill',stepId:'problem',skillId:'nonexistent-skill'}]));assert.throws(()=>applyEdits(c,'modeling',[{type:'run_shell',command:'anything'}]));
});
test('project/material/rules endpoints operate on actual isolated files',async()=>{
 root=join(base,'软件API测试夹具');mkdirSync(root);await request('roots',{path:root});const comp=boot.competitions.find(c=>c.id===5);
 const r=await request('project/init',{root,name:'软件API测试夹具',competitionId:5,track:comp.tracks[0].track,edition:'TEST-EDITION',workflowId:'modeling'});assert.equal(r.status,200);p=r.body.project;
 writeFileSync(join(root,'test-rule.txt'),'TEST FIXTURE RULE: this is a software test, never actual competition evidence.');
 const m=await request('project/material',{root,path:'test-rule.txt',title:'软件测试夹具规则'});assert.equal(m.status,200);assert.equal(m.body.project.facts.materials.length,1);
 assert.equal((await request('project/rules',{root,edition:'TEST-EDITION',snapshotPath:'test-rule.txt',sourceUrl:'https://example.invalid/test-fixture',quote:'this quote does not exist'})).status,400);
 const rule=await request('project/rules',{root,edition:'TEST-EDITION',snapshotPath:'test-rule.txt',sourceUrl:'https://example.invalid/test-fixture',quote:'TEST FIXTURE RULE',scope:'TEST ONLY'});assert.equal(rule.status,200);assert.equal(rule.body.project.competition.ruleStatus,'reviewed');
 writeFileSync(join(root,'test-rule.txt'),'TEST FIXTURE rule modified');const current=await request('projects');assert.equal(current.body.projects[0].competition.ruleStatus,'stale');
 assert.equal((await request('project/material',{root,path:'../outside.txt',title:'traversal'})).status,400);
 writeFileSync(join(root,'.credentials.yaml'),'explicit-software-fixture: never-a-real-secret');const factsBefore=readFileSync(join(root,'.ares/project.json'),'utf8');assert.equal((await request('project/material',{root,path:'.credentials.yaml'})).status,400);assert.equal((await request('project/rules',{root,edition:'TEST',snapshotPath:'.credentials.yaml',sourceUrl:'https://example.invalid',quote:'explicit-software-fixture'})).status,400);assert.equal(readFileSync(join(root,'.ares/project.json'),'utf8'),factsBefore);
});
test('project upgrade is explicit, detects stale previews and preserves original snapshot',async()=>{
 const original=readFileSync(join(root,'.ares','definition.json'),'utf8'),old=p.definitionId,c=readConfiguration();c.workflows.find(w=>w.id==='modeling').steps.find(s=>s.id==='models').objective+=' TEST FIXTURE changed';
 await request('configuration',{configuration:c,expectedRevision:c.revision});const preview=await request('project/upgrade-preview',{root,workflowId:'modeling'});assert.equal(preview.status,200);assert.ok(preview.body.preview.changes.changed.some(s=>s.id==='models'));
 const invalid=await request('project/upgrade',{...preview.body.preview,toId:'0'.repeat(64)});assert.equal(invalid.status,409);
 const upgraded=await request('project/upgrade',preview.body.preview);assert.equal(upgraded.status,200);assert.notEqual(upgraded.body.project.definitionId,old);assert.equal(readFileSync(join(root,'.ares','definition.json'),'utf8'),original);assert.equal(upgraded.body.project.facts.materials.length,1);
});
