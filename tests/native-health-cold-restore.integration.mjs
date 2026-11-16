/** Actual installed DSH Session/JSONL/Query components; no DSH host or model.
 * Set ARES_DSH_NODE_MODULES to a source-verified copy of the installed modules.
 * Native tool execution below is an explicit adapter over owned files/pwsh.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {runNativeHealth} from '../host/native-health.js';
assert.ok(process.env.ARES_DSH_NODE_MODULES,'Supply the current installed DSH reader modules; an array fixture cannot verify cold restoration');
const modules=resolve(process.env.ARES_DSH_NODE_MODULES),installed=name=>import(pathToFileURL(join(modules,...name.split('/'),'lib/index.js')).href);
const {Context}=await installed('@deepseek-ai/cordis');
const {SessionStore}=await installed('@deepseek-ai/dsh-session');
const jsonl=await installed('@deepseek-ai/dsh-session-persistence-jsonl');
const {SessionQueryEngine}=await installed('@deepseek-ai/dsh-session-query');
const execute=promisify(execFile),base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-health-cold-'));
const receipt={mode:'Actual installed DSH cold read components, real files and pwsh behind an explicit tool adapter; no host instance, model request or desktop UI.',cases:[]};
console.log('ARES_HEALTH_COLD_EVIDENCE',base);
async function harness(root){const ctx=new Context(),errors=[];ctx.logger.exporter({export:r=>{if(r.type==='error')errors.push(r.args.map(String).join(' '));}});await ctx.plugin(SessionStore).await();await ctx.plugin(jsonl,{root,compression:'zstd'}).await();await ctx.plugin(SessionQueryEngine).await();return {ctx,errors,async close(){await ctx.fiber.dispose();}};}
async function observed(h,id){const lease=await h.ctx.sessionQuery.observeSession(id,{projection:'none'});try{return {header:lease.header,events:lease.events};}finally{lease[Symbol.dispose]();}}

test('the installed DSH cold reader refuses the legacy required health event that a live Session accepted',async()=>{
 const root=join(base,'legacy-log'),cwd=join(base,'legacy-project'),id='session-'+randomUUID();mkdirSync(cwd);let h=await harness(root);
 const session=h.ctx.sessions.create(id,{meta:{cwd,agentPreset:'ares.editor'}}),handle=await h.ctx.sessionPersistence.create(session.header);
 session.append('ares/health-call',{id:'legacy-proof',callId:'ares-health:legacy-proof:0',name:'ares_config_read',phase:'started'});
 await h.ctx.sessionPersistence.flush();await handle.close();assert.deepEqual(h.errors,[]);await h.close();h=await harness(root);
 let failure;try{await assert.rejects(observed(h,id),error=>{failure={name:error.name,code:error.code,message:error.message};return /ares\/health-call.*unknown.*not marked ignorable/.test(error.message);});assert.deepEqual(h.errors,[]);}finally{await h.close();}
 receipt.cases.push({name:'original-writer-refusal',id,failure});writeFileSync(join(base,'cold-restore-receipt.json'),JSON.stringify(receipt,null,2));
});

test('a real native health probe leaves the durable conversation restorable after close and a fresh reader',async()=>{
 const root=join(base,'fixed-log'),cwd=join(base,'fixed-project'),id='session-'+randomUUID();mkdirSync(cwd);process.env.ARES_HOME=join(base,'probe-home');let h=await harness(root);
 const session=h.ctx.sessions.create(id,{meta:{cwd,agentPreset:'ares.editor'}}),handle=await h.ctx.sessionPersistence.create(session.header);
 session.append('session/title',{title:'真实持久化健康检查回归',messageSeqs:[],source:{kind:'user'}});const before=session.snapshotEvents();
 const agent={id,status:'idle',session},listeners=new Set(),jobs=new Map();
 const registry={events:{subscribe(_filter,fn){listeners.add(fn);return()=>listeners.delete(fn);}},get:key=>jobs.get(key),wait:async key=>{const job=jobs.get(key);await job.done;return job;}};
 const tools={schemas:()=>['ares_config_read','write','read','pwsh'].map(name=>({name})),wireSchemas:()=>({schemas:[]}),async execute(call){let value;const args=call.arguments;
  if(call.name==='ares_config_read')value={target:'ARES配置编辑',workspaceSelectionRequired:false,serviceInstanceId:'cold-restore-explicit-adapter'};
  else if(call.name==='write'){mkdirSync(dirname(args.file_path),{recursive:true});writeFileSync(args.file_path,args.content);value={written:true};}
  else if(call.name==='read')value=readFileSync(args.file_path,'utf8');
  else {assert.equal(call.name,'pwsh');let finish;const job={id:'owned-cold-pwsh',owner:id,label:args.command,status:'running',done:new Promise(done=>finish=done)};jobs.set(job.id,job);for(const fn of listeners)fn({type:'registered',job});try{const result=await execute('pwsh',['-NoLogo','-NoProfile','-NonInteractive','-Command',args.command],{windowsHide:true,encoding:'utf8',timeout:15000});job.status='completed';value={kind:'foreground',exitCode:0,stdout:result.stdout,stderr:result.stderr};}finally{if(job.status!=='completed')job.status='failed';finish();}}
  return {isError:false,value,content:[]};
 }};
 const probeContext={get:key=>{if(['llm','models'].includes(key))assert.fail('No model may be requested');return key==='tools'?tools:key==='jobs'?registry:key==='agents'?{get:key=>key===id?agent:null}:undefined;}};
 const report=await runNativeHealth(probeContext,agent,{ready:true,presentation:'native'},{expectedServiceId:'cold-restore-explicit-adapter'});
 assert.equal(report.complete,true,JSON.stringify(report));assert.equal(report.calls.length,4);assert.equal(report.modelRequestsInitiated,0);assert.deepEqual(session.snapshotEvents(),before);
 await h.ctx.sessionPersistence.flush();await handle.close();assert.deepEqual(h.errors,[]);await h.close();h=await harness(root);
 try{const reopened=await observed(h,id);assert.equal(reopened.header.id,id);assert.equal(reopened.header.cwd,cwd);assert.deepEqual(reopened.events,before);assert.deepEqual(h.errors,[]);receipt.cases.push({name:'fixed-probe-close-and-reopen',id,eventCount:reopened.events.length,reportPath:report.reportPath,calls:report.calls,checks:report.checks,modelRequestsInitiated:0,errors:h.errors});}finally{await h.close();}
 writeFileSync(join(base,'cold-restore-receipt.json'),JSON.stringify(receipt,null,2));
});
