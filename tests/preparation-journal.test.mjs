import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,readdirSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareSkillEnvironment} from '../host/skill-execution.js';

// An owned adapter writes real plan files, but never launches a DSH host or
// claims that the fixture job descriptors are real jobs/environment success.
test('preparation journals before dispatch, preserves unknown attempts, and adopts only its exact original command',async()=>{
 const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-prepare-journal-')),root=join(base,'project'),source=join(base,'source');mkdirSync(root);mkdirSync(source);const skill={id:'journal-fixture',content:'# Explicit software protocol fixture\n',resources:[]};writeFileSync(join(source,'SKILL.md'),skill.content);
 const exec={agent:{id:'journal-contract-agent',session:{header:{cwd:root},append:()=>{}}},callId:'explicit-fixture-call',token:{}};let command,launches=0,jobReads=0,list=[];
 const tracking=()=>{const folder=join(root,'.ares/skill-environments/requests'),file=readdirSync(folder).find(name=>/^[a-f0-9]{64}\.json$/.test(name));return JSON.parse(readFileSync(join(folder,file)));};
 const ctx={tools:{schemas:()=>['write','pwsh','job_list','job_output'].map(name=>({name})),execute:async call=>{
  if(call.name==='write'){mkdirSync(dirname(call.arguments.file_path),{recursive:true});writeFileSync(call.arguments.file_path,call.arguments.content);return {isError:false,value:{written:true},content:[]};}
  if(call.name==='pwsh'){launches++;command=call.arguments.command;assert.equal(tracking().status,'preparing');throw new Error('Explicit lost-reply contract fixture');}
  if(call.name==='job_list')return {isError:false,value:list,content:[]};
  jobReads++;return {isError:false,value:{job:{id:'fixture-original-job',kind:'pwsh',status:'running'},text:''},content:[]};
 }}};
 await assert.rejects(prepareSkillEnvironment(ctx,exec,skill,source,'explicit-definition',{runtime:'none'}),error=>error.executionOutcome==='unknown');assert.equal(tracking().status,'preparing');
 const unknown=await prepareSkillEnvironment(ctx,exec,skill,source,'explicit-definition',{runtime:'none'});assert.equal(unknown.status,'unknown-job');assert.equal(unknown.readyForNativeRun,false);assert.equal(launches,1);
 list=[{id:'fixture-unrelated-job',kind:'pwsh',label:command+' unrelated'},{id:'fixture-original-job',kind:'pwsh',label:command}];
 const pending=await prepareSkillEnvironment(ctx,exec,skill,source,'explicit-definition',{runtime:'none'});assert.equal(pending.status,'preparing');assert.equal(pending.jobId,'fixture-original-job');assert.equal(pending.readyForNativeRun,false);assert.equal(launches,1);assert.equal(jobReads,1);
});
