/** Owned software-verification projects. Automatic fixtures never claim a real user's confirmation. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createPortableAres} from '../platforms/shared/core.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {setTimeout as pause} from 'node:timers/promises';
import {Client} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import {StdioClientTransport} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';

const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-host-confirmation-'));
console.log('Host confirmation evidence: '+base);
const scope={competitionId:1,track:'高教主赛道',edition:'2026',group:''};
const source=dirname(dirname(fileURLToPath(import.meta.url)));
async function fixture(name) {
  const directory=join(base,name),root=join(directory,'owned project'),home=join(directory,'owned home');mkdirSync(root,{recursive:true});
  const core=createPortableAres({home,host:'codex',roots:[root]});await core.ready;
  const project=await core.dispatch('ares_project',{action:'init',root,name:'本地确认通道软件验收 '+name,...scope});
  const step=project.workflow.steps[0],output=step.outputs.find(row=>row.kind==='file'&&row.format==='md');assert.ok(output);
  const path=join(root,project.outputDir,output.path);mkdirSync(dirname(path),{recursive:true});
  writeFileSync(path,'# 本地宿主确认通道软件检查\n\n这是测试进程真实创建的文件，用于校验审批通道的文件绑定。\n\n后续自动确认仅是协议或受信适配层的软件fixture，不表示实际用户点击或竞赛内容已经人工审核。\n');
  const args={action:'complete',root,expectedRevision:project.revision,stepId:step.id,review:{summary:'自动软件fixture：仅核对真实本地文件与单次确认机制，不代表实际用户审批。',findings:[]}};
  return {directory,root,home,core,project,step,output,path,args};
}

test('core approval evidence binds actual bytes and exact args before the original acceptance function',async()=>{
  const f=await fixture('core-unit');
  try {
    const pending=await f.core.prepareOwnerApproval('ares_project',f.args);
    assert.ok(pending.artifactHashes[f.output.id]);assert.ok(pending.summary.includes(f.root));
    await assert.rejects(f.core.dispatch('ares_project',f.args),{code:'needs-owner'});
    await assert.rejects(f.core.dispatchConfirmed('ares_project',{...f.args,review:{...f.args.review,summary:'不同的复核说明'}},{id:'trusted-adapter-unit-fixture',fingerprint:pending.fingerprint}),{code:'confirmation-stale'});
    writeFileSync(f.path,readFileSync(f.path,'utf8')+'\n确认等待期间真实发生的文件修改。\n');
    await assert.rejects(f.core.dispatchConfirmed('ares_project',f.args,{id:'trusted-adapter-unit-fixture',fingerprint:pending.fingerprint}),{code:'confirmation-stale'});
    const untouched=await f.core.dispatch('ares_project',{action:'status',root:f.root});assert.equal(untouched.revision,f.project.revision);assert.equal(untouched.progress.done,0);
    const fresh=await f.core.prepareOwnerApproval('ares_project',f.args);
    const accepted=await f.core.dispatchConfirmed('ares_project',f.args,{id:'trusted-adapter-unit-fixture',fingerprint:fresh.fingerprint});
    assert.equal(accepted.tasks[f.step.id].status,'done');assert.equal(accepted.progress.done,1);
    assert.deepEqual(accepted.tasks[f.step.id].artifactHashes,fresh.artifactHashes);
    const report=JSON.parse(readFileSync(join(f.root,accepted.tasks[f.step.id].reviewPath),'utf8'));
    assert.deepEqual(report.artifactHashes,fresh.artifactHashes);assert.equal(report.portableConfirmation.fingerprint,fresh.fingerprint);
    writeFileSync(join(f.directory,'core-confirmation-receipt.json'),JSON.stringify({fixture:'Automatic trusted-adapter software test; no actual user confirmation claimed.',oldFingerprint:pending.fingerprint,newFingerprint:fresh.fingerprint,artifactHashes:report.artifactHashes,reviewPath:accepted.tasks[f.step.id].reviewPath,progress:accepted.progress},null,2));
  } finally {f.core.dispose();}
});

function valueOf(response) {
  if(response.structuredContent!==undefined)return response.structuredContent;
  const text=response.content?.find(row=>row.type==='text')?.text;try{return JSON.parse(text);}catch{return {message:text};}
}
async function protocolFixture(f,{modern=false,manual=false,answer,timeout}={}) {
  let roots=[f.root],forms=0,rootRequests=0;
  const requests=[];
  const client=new Client({name:'ares-automatic-confirmation-protocol-fixture',version:'1.0.0'}, {
    capabilities:{roots:{listChanged:true},elicitation:modern?{form:{}}:{}},
    ...(modern?{versionNegotiation:{mode:{pin:'2026-07-28'}}}:{}),
    ...(manual?{inputRequired:{autoFulfill:false}}:{}),
  });
  client.setRequestHandler('roots/list',async()=>{rootRequests++;return {roots:roots.map(root=>({uri:pathToFileURL(root).href}))};});
  client.setRequestHandler('elicitation/create',async(request)=>{
    forms++;const params=request.params;requests.push(params);
    assert.equal(params.mode,'form');assert.ok(params.message.includes(f.root));
    assert.equal(params.requestedSchema.properties.confirm.type,'boolean');assert.equal(params.requestedSchema.properties.confirm.default,false);
    return answer?answer({setRoots:values=>{roots=values;},params,client}):{action:'accept',content:{confirm:true}};
  });
  const env={...process.env};delete env.ARES_HOME;delete env.DSH_HOME;delete env.ARES_ALLOWED_ROOTS;
  let commandArgs=[join(source,'scripts/ares-mcp.mjs'),'--host','codex','--home',f.home,'--no-ui'];
  if(timeout!==undefined) {
    const script=join(f.directory,'actual-sdk-server-fixture.mjs');
    writeFileSync(script,'import {startPortableStdio} from '+JSON.stringify(pathToFileURL(join(source,'scripts/ares-mcp.mjs')).href)+';\nstartPortableStdio('+JSON.stringify({host:'codex',home:f.home,roots:[],ui:false,confirmationTimeoutMs:timeout})+');\n');
    commandArgs=[script];
  }
  const transport=new StdioClientTransport({command:process.execPath,args:commandArgs,env,cwd:source,stderr:'pipe'});
  let stderr='';transport.stderr?.on('data',value=>{stderr+=value;});await client.connect(transport);
  return {client,requests,get forms(){return forms;},get rootRequests(){return rootRequests;},get stderr(){return stderr;},
    async call(name,args,options) {return client.callTool({name,arguments:args},options);},
    async close(){await client.close();},
  };
}

for(const modern of [false,true])test((modern?'2026':'legacy')+' actual protocol fixture accepts once through the existing review gate and declines without re-prompting',async()=>{
  const f=await fixture(modern?'modern-accept':'legacy-accept');f.core.dispose();
  const s=await protocolFixture(f,{modern});
  try {
    const response=await s.call('ares_project',f.args),accepted=valueOf(response);assert.notEqual(response.isError,true,JSON.stringify(accepted));
    assert.equal(s.forms,1);assert.equal(accepted.progress.done,1);assert.equal(accepted.tasks[f.step.id].review.reviewer,'user');assert.ok(accepted.hostConfirmation.id);assert.equal(accepted.hostConfirmation.identityAuthentication,false);
    assert.ok(s.requests[0].message.includes(accepted.tasks[f.step.id].artifactHashes[f.output.id]));
    const again=await s.call('ares_project',f.args);assert.equal(again.isError,true);assert.equal(s.forms,1);
    const capability=valueOf(await s.call('ares_capabilities',{}));assert.equal(capability.hostConfirmation.protocolAvailable,true);assert.equal(capability.hostConfirmation.identityAuthentication,false);
    writeFileSync(join(f.directory,'protocol-confirmation-receipt.json'),JSON.stringify({fixture:'Automatic official SDK protocol accept fixture; NOT evidence of a real user clicking a host dialog.',modern,forms:s.forms,rootRequests:s.rootRequests,confirmation:accepted.hostConfirmation,reviewPath:accepted.tasks[f.step.id].reviewPath,progress:accepted.progress},null,2));
    assert.equal(s.stderr,'');
  } finally {await s.close();}
  const declined=await fixture(modern?'modern-decline':'legacy-decline');declined.core.dispose();
  const no=await protocolFixture(declined,{modern,answer:()=>({action:'decline'})});
  try {
    const response=await no.call('ares_project',declined.args),value=valueOf(response);assert.equal(response.isError,true);assert.equal(value.code,'confirmation-declined');assert.equal(no.forms,1);
    const stored=JSON.parse(readFileSync(join(declined.root,'.ares/project.json'),'utf8'));assert.equal(stored.revision,0);assert.equal(stored.tasks[declined.step.id].status,'pending');
    writeFileSync(join(declined.directory,'protocol-decline-receipt.json'),JSON.stringify({fixture:'Automatic official SDK protocol decline fixture; no real host user interaction claimed.',modern,result:value,forms:no.forms,revision:stored.revision},null,2));assert.equal(no.stderr,'');
  } finally {await no.close();}
});

for(const modern of [false,true])test((modern?'2026':'legacy')+' protocol fixture refuses changed files and revoked roots after the form',async()=>{
  const f=await fixture(modern?'modern-file-change':'legacy-file-change');f.core.dispose();
  const s=await protocolFixture(f,{modern,answer:()=>{writeFileSync(f.path,readFileSync(f.path,'utf8')+'\n等待确认期间实际编辑的版本。\n');return {action:'accept',content:{confirm:true}};}});
  try {
    const response=await s.call('ares_project',f.args),value=valueOf(response);assert.equal(response.isError,true);assert.equal(value.code,'confirmation-stale');assert.equal(s.forms,1);
    assert.equal(JSON.parse(readFileSync(join(f.root,'.ares/project.json'),'utf8')).revision,0);assert.equal(s.stderr,'');
    writeFileSync(join(f.directory,'changed-file-receipt.json'),JSON.stringify({fixture:'Automatic protocol fixture mutates a real file while the form is pending.',modern,result:value,forms:s.forms},null,2));
  } finally {await s.close();}
  const revoked=await fixture(modern?'modern-root-revocation':'legacy-root-revocation');revoked.core.dispose();
  const no=await protocolFixture(revoked,{modern,answer:({setRoots})=>{setRoots([]);return {action:'accept',content:{confirm:true}};}});
  try {
    const response=await no.call('ares_project',revoked.args),value=valueOf(response);assert.equal(response.isError,true);assert.equal(value.code,'scope-denied');assert.equal(no.forms,1);
    assert.equal(JSON.parse(readFileSync(join(revoked.root,'.ares/project.json'),'utf8')).revision,0);assert.equal(no.stderr,'');
    writeFileSync(join(revoked.directory,'revoked-root-receipt.json'),JSON.stringify({fixture:'Automatic protocol fixture revokes its actual roots/list result while the form is pending.',modern,result:value,forms:no.forms,rootRequests:no.rootRequests},null,2));
  } finally {await no.close();}
});

test('modern protocol nonce replay, mismatched arguments and expired confirmation are terminal failures',async()=>{
  const f=await fixture('modern-replay');f.core.dispose();const s=await protocolFixture(f,{modern:true,manual:true});
  try {
    const initial=await s.call('ares_project',f.args,{allowInputRequired:true});assert.equal(initial.resultType,'input_required');
    const roots={roots:[{uri:pathToFileURL(f.root).href}]};
    const confirmation=await s.client.callTool({name:'ares_project',arguments:f.args,requestState:initial.requestState,inputResponses:{aresRoots:roots}},{allowInputRequired:true});assert.equal(confirmation.resultType,'input_required');assert.ok(confirmation.inputRequests.aresOwner);
    const wrong=await s.client.callTool({name:'ares_project',arguments:{...f.args,review:{...f.args.review,summary:'Changed after prompt'}},requestState:confirmation.requestState,inputResponses:{aresOwner:{action:'accept',content:{confirm:true}}}},{allowInputRequired:true});assert.equal(wrong.isError,true);assert.equal(valueOf(wrong).code,'confirmation-mismatch');
    const replay=await s.client.callTool({name:'ares_project',arguments:f.args,requestState:confirmation.requestState,inputResponses:{aresOwner:{action:'accept',content:{confirm:true}}}},{allowInputRequired:true});assert.equal(replay.isError,true);assert.equal(valueOf(replay).code,'invalid-confirmation');
    assert.equal(JSON.parse(readFileSync(join(f.root,'.ares/project.json'),'utf8')).revision,0);
    const next=await s.call('ares_project',f.args,{allowInputRequired:true});
    const prompt=await s.client.callTool({name:'ares_project',arguments:f.args,requestState:next.requestState,inputResponses:{aresRoots:roots}},{allowInputRequired:true});
    const finalRoots=await s.client.callTool({name:'ares_project',arguments:f.args,requestState:prompt.requestState,inputResponses:{aresOwner:{action:'accept',content:{confirm:true}}}},{allowInputRequired:true});assert.equal(finalRoots.resultType,'input_required');assert.ok(finalRoots.inputRequests.aresRoots);
    const accepted=await s.client.callTool({name:'ares_project',arguments:f.args,requestState:finalRoots.requestState,inputResponses:{aresRoots:roots}},{allowInputRequired:true});assert.notEqual(accepted.isError,true);assert.equal(valueOf(accepted).progress.done,1);
    const successReplay=await s.client.callTool({name:'ares_project',arguments:f.args,requestState:finalRoots.requestState,inputResponses:{aresRoots:roots}},{allowInputRequired:true});assert.equal(successReplay.isError,true);assert.equal(valueOf(successReplay).code,'invalid-confirmation');
    writeFileSync(join(f.directory,'nonce-replay-receipt.json'),JSON.stringify({fixture:'Manual official SDK protocol retry fixture; no real host approval claimed.',wrong:valueOf(wrong),replay:valueOf(replay),successReplay:valueOf(successReplay),accepted:valueOf(accepted).hostConfirmation},null,2));assert.equal(s.stderr,'');
  } finally {await s.close();}
  const expired=await fixture('modern-expiry');expired.core.dispose();const slow=await protocolFixture(expired,{modern:true,timeout:30,answer:async()=>{await pause(60);return {action:'accept',content:{confirm:true}};}});
  try {
    const response=await slow.call('ares_project',expired.args),value=valueOf(response);assert.equal(response.isError,true);assert.equal(value.code,'confirmation-expired');assert.equal(slow.forms,1);assert.equal(JSON.parse(readFileSync(join(expired.root,'.ares/project.json'),'utf8')).revision,0);
    writeFileSync(join(expired.directory,'confirmation-expiry-receipt.json'),JSON.stringify({fixture:'Actual delayed protocol fixture; production timeout is unchanged.',result:value,forms:slow.forms},null,2));assert.equal(slow.stderr,'');
  } finally {await slow.close();}
});

test('strict form responses cancel or reject without granting owner in either protocol era',async()=>{
  for(const modern of [false,true]) {
    const f=await fixture(modern?'modern-invalid-forms':'legacy-invalid-forms');f.core.dispose();
    const answers=[{action:'cancel'},{action:'accept',content:{confirm:false}},{action:'accept',content:{}},{action:'accept',content:{confirm:true,principal:'owner'}}];
    let index=0;const s=await protocolFixture(f,{modern,answer:()=>answers[index++]});
    try {
      const results=[];
      for(const code of ['confirmation-cancelled','confirmation-declined','confirmation-declined','invalid-confirmation']) {
        const response=await s.call('ares_project',f.args),value=valueOf(response);assert.equal(response.isError,true);assert.equal(value.code,code);results.push(value);
      }
      assert.equal(s.forms,4);assert.equal(JSON.parse(readFileSync(join(f.root,'.ares/project.json'),'utf8')).revision,0);assert.equal(s.stderr,'');
      writeFileSync(join(f.directory,'invalid-forms-receipt.json'),JSON.stringify({fixture:'Automatic official SDK rejection fixtures, not a real user.',modern,results},null,2));
    } finally {await s.close();}
  }
});

test('modern protocol local owner actions retain actual team, plan, rules, workflow, formal version and restore semantics',async()=>{
  const f=await fixture('local-actions');f.core.dispose();const s=await protocolFixture(f,{modern:true});
  try {
    async function confirmed(name,args) {const response=await s.call(name,args),value=valueOf(response);assert.notEqual(response.isError,true,JSON.stringify(value));assert.ok(value.hostConfirmation.id);return value;}
    let p=await confirmed('ares_team',{action:'member',root:f.root,expectedRevision:0,id:'protocol-member',name:'自动协议测试队员',role:'member'});
    assert.ok(p.workbench.team.some(row=>row.id==='protocol-member'));
    p=await confirmed('ares_team',{action:'assign',root:f.root,expectedRevision:p.revision,stepId:f.step.id,memberId:'protocol-member'});assert.equal(p.tasks[f.step.id].assigneeId,'protocol-member');
    p=await confirmed('ares_plan',{action:'save',root:f.root,expectedRevision:p.revision,deadline:'2026-12-31T15:59:59.000Z',steps:[{stepId:f.step.id,assigneeId:'protocol-member',dueAt:'2026-12-01T09:00:00.000Z',estimateHours:2}]});assert.equal(p.workbench.plan.steps[f.step.id].estimateHours,2);
    const snapshotPath=p.outputDir+'/'+f.output.path,quote='这是测试进程真实创建的文件，用于校验审批通道的文件绑定。';
    p=await confirmed('ares_project',{action:'rules',root:f.root,expectedRevision:p.revision,edition:'2026',sourceUrl:'https://ares-software-fixture.invalid/rules',snapshotPath,quote});assert.equal(p.competition.ruleStatus,'reviewed');assert.equal(p.competition.ruleBaseline.snapshotPath,snapshotPath);
    p=await confirmed('ares_project',{...f.args,expectedRevision:p.revision});assert.equal(p.progress.done,1);
    const editor=valueOf(await s.call('ares_workflow',{action:'project-read',root:f.root})),workflow=structuredClone(editor.workflow);workflow.steps[1].objective+='\n自动协议软件fixture，仅修改后续步骤。';
    const identity={root:f.root,projectId:p.id,expectedDefinitionId:p.definitionId,expectedRevision:p.revision},preview=valueOf(await s.call('ares_workflow',{action:'project-preview',...identity,workflow}));
    const applied=await confirmed('ares_workflow',{action:'project-apply',...identity,fromId:preview.preview.fromId,toId:preview.preview.toId});p=applied.project;assert.equal(applied.applied,true);assert.equal(p.progress.done,1);
    const frozen=await confirmed('ares_version',{action:'freeze',root:f.root,expectedRevision:p.revision,kind:'stage',stepIds:[f.step.id],title:'自动协议fixture实际阶段版本'});p=frozen.project;assert.equal(frozen.release.payload.kind,'stage');assert.ok(frozen.release.payload.files.length);
    const restored=await confirmed('ares_version',{action:'restore',root:f.root,expectedRevision:p.revision,releaseId:frozen.release.id});p=restored.project;assert.equal(p.progress.done,0);assert.ok(restored.draftPath);assert.equal(readFileSync(join(f.root,p.outputDir,f.output.path),'utf8'),readFileSync(f.path,'utf8'));
    p=await confirmed('ares_team',{action:'remove',root:f.root,expectedRevision:p.revision,id:'protocol-member'});assert.equal(p.workbench.team.some(row=>row.id==='protocol-member'),false);
    assert.equal(s.forms,9);assert.equal(s.stderr,'');
    writeFileSync(join(f.directory,'local-owner-actions-receipt.json'),JSON.stringify({fixture:'Automatic official SDK confirmation fixtures for actual owned local files only. Reserved .invalid rules URL is deliberately not an online rule source. No actual host user clicks or cloud access claimed.',forms:s.forms,releaseId:frozen.release.id,restoredDraft:restored.draftPath,progress:p.progress,revision:p.revision},null,2));
  } finally {await s.close();}
});
