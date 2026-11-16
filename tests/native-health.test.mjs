import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runNativeHealth} from '../host/native-health.js';
const execute=promisify(execFile);
// Owned real filesystem and pwsh processes behind a protocol adapter. This
// verifies the probe code, NOT authentication/presentation in a live DSH host.
for(const presentation of ['native','ptc'])test('the '+presentation+' probe validates actual bytes and calculations without invoking model services',async()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-health-probe-'));process.env.ARES_HOME=join(base,'home');const cwd=join(base,'editor');mkdirSync(cwd);const events=[],agent={id:'explicit-probe-agent',status:'idle',session:{header:{id:'explicit-probe-agent',cwd},append:()=>assert.fail('Health diagnostics must not append custom events to the native conversation')}},listeners=new Set(),jobs=new Map();let waiterRegistered=false;
 const registry={events:{subscribe(_filter,fn){listeners.add(fn);return()=>listeners.delete(fn);}},get:id=>jobs.get(id),wait:async id=>{waiterRegistered=true;const job=jobs.get(id);await job.done;return job;}};
 const tools={schemas:()=>['ares_config_read','write','read','pwsh'].map(name=>({name})),wireSchemas:()=>({mode:presentation,schemas:presentation==='ptc'?[{name:'run_code'}]:[]}),async execute(call){const args=call.arguments;let value;if(call.name==='run_code'){
   const sdk=Object.fromEntries(['ares_config_read','write','read','pwsh'].map(name=>[name,async argumentsValue=>(await tools.execute({name,arguments:argumentsValue})).value]));
   const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;value={result:await new AsyncFunction('tools',args.code)(sdk)};
  }else if(call.name==='ares_config_read')value=JSON.stringify({target:'ARES配置编辑',workspaceSelectionRequired:false,revision:1,serviceInstanceId:'explicit-owned-service-fixture'});else if(call.name==='write'){mkdirSync(dirname(args.file_path),{recursive:true});writeFileSync(args.file_path,args.content);value={written:true};}else if(call.name==='read')value=readFileSync(args.file_path,'utf8');else{
   let finish;const job={id:'owned-pwsh-adapter',owner:agent.id,label:args.command,status:'running',done:new Promise(resolve=>finish=resolve)};jobs.set(job.id,job);for(const fn of listeners)fn({type:'registered',job});const result=await execute('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',args.command],{windowsHide:true,encoding:'utf8',timeout:15000});job.status='completed';job.detail='exit code: 0';finish();value={kind:'foreground',exitCode:0,stdout:result.stdout,stderr:result.stderr};
  }return {isError:false,value,content:[]};}};
 const ctx={get:key=>{if(['llm','models'].includes(key))assert.fail('The probe must not ask for model services');return key==='tools'?tools:key==='jobs'?registry:key==='agents'?{get:id=>id===agent.id?agent:null}:undefined;}};
 const report=await runNativeHealth(ctx,agent,{ready:true,presentation},{expectedServiceId:'explicit-owned-service-fixture'});assert.equal(report.complete,true,JSON.stringify(report));assert.ok(report.checks.every(c=>c.status==='passed'));assert.equal(report.modelRequestsInitiated,0);assert.equal(waiterRegistered,true);assert.equal(listeners.size,0);assert.deepEqual(events,[]);assert.ok(report.calls.length>0);assert.equal(JSON.parse(readFileSync(join(process.env.ARES_HOME,'ares-health-reports',report.id+'.json'))).complete,true);
});
test('a stale editor-service binding stops before any filesystem or terminal probe',async()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-health-stale-'));process.env.ARES_HOME=join(base,'home');const cwd=join(base,'editor');mkdirSync(cwd);const agent={id:'stale-contract-agent',session:{header:{id:'stale-contract-agent',cwd},append:()=>{}}},calls=[];
 const tools={schemas:()=>['ares_config_read','write','read','pwsh'].map(name=>({name})),execute:async call=>{calls.push(call.name);assert.equal(call.name,'ares_config_read');return {isError:false,value:JSON.stringify({target:'ARES配置编辑',workspaceSelectionRequired:false,serviceInstanceId:'old-instance'}),content:[]};}};
 const registry={events:{subscribe:()=>()=>{}},wait:async()=>{},get:()=>{}};const ctx={get:key=>key==='tools'?tools:key==='jobs'?registry:key==='agents'?{get:()=>agent}:undefined};const report=await runNativeHealth(ctx,agent,{ready:true,presentation:'native'},{expectedServiceId:'current-instance'});assert.equal(report.complete,false);assert.match(report.error,/旧的配置服务/);assert.deepEqual(calls,['ares_config_read']);
});

test('background diagnostics preserve Auto approval and stop without creating a model request or a pending-call history',async()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-health-auto-'));process.env.ARES_HOME=join(base,'home');const cwd=join(base,'editor');mkdirSync(cwd);const events=[],agent={id:'auto-contract-agent',session:{header:{id:'auto-contract-agent',cwd},append:(...value)=>events.push(value)}};
 const tools={schemas:()=>[{name:'ares_config_read'}],wireSchemas:()=>({schemas:[{name:'ares_config_read'}]}),execute:async()=>assert.fail('Auto requires a genuine model-owned pending call; no background dispatch is authorized')};
 const permissions={current:()=> 'auto',set:()=>assert.fail('The healthcheck must not change the permission preset')},registry={events:{subscribe:()=>()=>{}},wait:async()=>{},get:()=>{}};
 const ctx={get:key=>{if(['llm','models'].includes(key))assert.fail('No approval-model invocation');return key==='tools'?tools:key==='jobs'?registry:key==='agents'?{get:()=>agent}:key==='permissionPresets'?permissions:undefined;}};
 const report=await runNativeHealth(ctx,agent,{ready:true,presentation:'native'},{expectedServiceId:'current-instance'});assert.equal(report.complete,false);assert.equal(report.status,'blocked');assert.equal(report.blockers[0].code,'auto-review-background-context');assert.match(report.error,/自动审批/);assert.deepEqual(report.calls,[]);assert.deepEqual(events,[]);assert.equal(report.modelRequestsInitiated,0);assert.equal(JSON.parse(readFileSync(report.reportPath,'utf8')).status,'blocked');
});
