/** Real installed DSH services, without a model loop, user profile, or desktop UI.
 * Requires ARES_DSH_NODE_MODULES and ARES_DSH_STANDARD_PRESET from the installed runtime.
 * The agent carrier and inspect adapter only bind an isolated real Session to its scope.
 */
import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {nativePlugins} from '../host/native-toolbox.js';
import {createNativeCatalog} from '../host/native.js';
import {createEditorWorkspace} from '../host/editor-workspace.js';
import {EDITOR_PRESET_ID} from '../host/editor-definition.js';
import {readConfiguration,builtInSkills,ROOT,competitionCatalog} from '../host/catalog.js';
import {readLocalPackage,packageReference} from '../host/skill-packages.js';
import {linkRoot,initializeProject} from '../host/projects.js';

assert.ok(process.env.ARES_DSH_NODE_MODULES,'Set ARES_DSH_NODE_MODULES to an isolated copy of the actual installed DSH node_modules');
assert.ok(process.env.ARES_DSH_STANDARD_PRESET,'Set ARES_DSH_STANDARD_PRESET to the actual installed standard.patch.yml');
const modules=resolve(process.env.ARES_DSH_NODE_MODULES);
const installed=async name=>import(pathToFileURL(join(modules,...name.split('/'),'lib/index.js')).href);
const extension=async(packageName,path)=>import(pathToFileURL(join(modules,...packageName.split('/'),'lib',path)).href);
const {Context}=await installed('@deepseek-ai/cordis');
const {createScope}=await installed('@deepseek-ai/dsh-scope');
const {interpolate}=await installed('@deepseek-ai/cordis-plugin-loader');
const {entryListSchema}=await installed('@deepseek-ai/cordis-plugin-include');
const yaml=(await import(pathToFileURL(join(modules,'js-yaml','index.js')).href)).default;
const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-real-dsh-'));
process.env.ARES_HOME=join(base,'ares-home');process.env.DSH_HOME=join(base,'dsh-home');
const root=new Context().extend({baseUrl:pathToFileURL(join(modules,'..','package.json')).href});
const logs=[],report={environment:'isolated real installed DSH services; no model or desktop actions',base,calls:[]};
root.logger.exporter({export:record=>{if(record.type==='error')logs.push(record.args.map(String).join(' '));}});
let native,editor,agent,agentScope,connection,standardRows,detachAgent,offStandard,callId=0;
const isolatedSkills=join(base,'skills');mkdirSync(isolatedSkills);
const isolateDiscovery=definition=>({...definition,plugins:definition.plugins.map(row=>row.id==='skill-filesystem'?{...row,config:{...row.config,includeDefaultRoots:false,customSkillDirs:[isolatedSkills],watch:false}}:row.id==='tool-jobs'?{...row,config:{...row.config,completionDelivery:'quiet'}}:row)});
const names=schemas=>schemas.map(row=>row.name).sort();
async function execute(name,args){
 const result=await root.tools.execute({name,arguments:args,callId:'ares-integration-'+(++callId),agent,signal:new AbortController().signal});
 report.calls.push({name,arguments:args,result});
 assert.equal(result.isError,false,JSON.stringify({name,result}));
 return result;
}
before(async()=>{
 const packages=[
  ['@deepseek-ai/cordis-plugin-loader',{baseUrl:root.baseUrl}],
  ['@deepseek-ai/dsh-session-projection'],['@deepseek-ai/dsh-session'],
  ['@deepseek-ai/dsh-system-prompt'],['@deepseek-ai/dsh-tools'],
  ['@deepseek-ai/dsh-agent'],['@deepseek-ai/dsh-skill'],['@deepseek-ai/dsh-commands'],
  ['@deepseek-ai/dsh-llm'],['@deepseek-ai/dsh-token-meter'],
  ['@deepseek-ai/dsh-working-directory',{defaultDirectory:base}],
  ['@deepseek-ai/dsh-sandbox-policy',{mode:'workspace-write',workspaceRoot:base}],
  ['@deepseek-ai/dsh-user-approval',{policy:'never'}],['@deepseek-ai/dsh-permission-presets',{presets:{'isolated-test':{sandbox:'workspace-write',approval:'never'}},defaultPreset:'isolated-test'}],
  ['@deepseek-ai/dsh-fs-sandbox',{cwd:base}],['@deepseek-ai/dsh-subprocess-local'],
  ['@deepseek-ai/dsh-sandbox-local'],['@deepseek-ai/dsh-pwsh-sandbox'],['@deepseek-ai/dsh-shell-env'],
  ['@deepseek-ai/dsh-jobs-local'],['@deepseek-ai/dsh-web'],['@deepseek-ai/dsh-goal'],
  ['@deepseek-ai/dsh-ptc-runtime-node'],
  ['@deepseek-ai/dsh-subagent'],['@deepseek-ai/dsh-subagent-spawn-in-process',{providerName:'spawn'}],
  ['@deepseek-ai/dsh-subagent-fork-in-process',{providerName:'fork'}],['@deepseek-ai/dsh-user-questions'],
  ['@deepseek-ai/dsh-agent-preset-registry',{default:'standard'}],
 ];
 for(const [name,config] of packages){const module=await installed(name);await root.plugin(module.default||module,config).await();}
 await root.plugin((await extension('@deepseek-ai/dsh-tool-subagent','model-selection-settings.js')).default,{allowedModels:[]}).await();
 root.loader.builtins.group=(await installed('@deepseek-ai/cordis-plugin-group')).default;
 // Only skill discovery locations differ from production: never scan/watch the user's library.
 const registry=root.agentPresets,register=registry.register;
 registry.register=function(definition){return register.call(this,isolateDiscovery(definition));};
 const shipped=yaml.load(readFileSync(process.env.ARES_DSH_STANDARD_PRESET,'utf8'),{schema:entryListSchema});
 standardRows=interpolate(root,shipped[0].insert[0].config.plugins);
 offStandard=await registry.register({id:'standard',plugins:structuredClone(standardRows)});
 assert.equal((await registry.resolve('standard')).broken,undefined);
 // A real global extension reads a real file. This tests inheritance, not a real external MCP connection.
 const extensionFile=join(base,'extension-source.txt');writeFileSync(extensionFile,'ARES actual global extension read\n');
 root.tools.register({name:'ares_test_extension_read',description:'Isolated integration extension: read its actual local source file',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'string'},render:(_args,text)=>[{type:'text',text}]},isConcurrencySafe:()=>true,execute:()=>readFileSync(extensionFile,'utf8')});
 for(const skill of builtInSkills().filter(item=>item.id==='ares'))root.skills.register({name:skill.id,description:skill.description,content:skill.content,invocation:{modelInvocable:true,userInvocable:true},provider:'ares',source:'plugin:ares',path:join(skill.root,'SKILL.md'),resourceBase:{kind:'directory',path:skill.root}});
 root.provide('sessionController',{async inspect(id){const session=root.sessions.get(id);assert.ok(session);return {meta:session.header,events:session.snapshotEvents()};}});
 const host=Object.assign(ctx=>{native=createNativeCatalog(ctx);editor=createEditorWorkspace(ctx,{forEditor:()=>native.forEditor(),inspectEditorTools:(...args)=>native.inspectEditorTools(...args),refreshEditor:value=>native.refreshEditor(value),commitConfiguration:(...args)=>native.commitConfiguration(...args)});ctx.provide('aresEditor',editor);},{inject:['agentPresets','tools']});
 await root.plugin(host).await();await native.publish();await native.forEditor();
 assert.equal((await registry.resolve(EDITOR_PRESET_ID)).broken,undefined);
 connection=await editor.open({configuration:readConfiguration(),workflowId:'venture',activeStepId:'context'});
 const id='session-'+randomUUID(),session=root.sessions.create(id,{meta:{cwd:connection.cwd,agentPreset:EDITOR_PRESET_ID}});
 agent={id,session,status:'idle',options:{}};agentScope=createScope(root,agent);agent.ctx=agentScope.ctx;
 await registry.mount(agent.ctx,EDITOR_PRESET_ID);
 detachAgent=root.agents.enter(agent,undefined);
 await editor.bind({bindingToken:connection.bindingToken,sessionId:id});
 assert.deepEqual(logs,[],'All real plugin rows must mount without errors');
});
after(async()=>{
 try{detachAgent?.();await agentScope?.dispose();editor?.dispose();await native?.dispose();await root.fiber.dispose();}
 finally{if(process.env.ARES_TOOL_REPORT)writeFileSync(process.env.ARES_TOOL_REPORT,JSON.stringify({...report,pluginErrors:logs},null,2));}
});

test('the entire toolbox matches the actual installed DSH standard declaration',()=>{
 const expected=structuredClone(standardRows);expected.find(row=>row.id==='persona').config.prefix='';
 assert.deepEqual(nativePlugins(''),expected);
 report.standardPluginRows=expected.length;
});
test('real DSH preset and descendant scope preserve all native and host-global tools in wire assembly',async()=>{
 const lease=await root.agentPresets.acquireScope('standard');
 try{
  const baseline=root.tools.schemas(lease.key),actual=root.tools.schemas(agent);
  const status=await native.inspectEditorTools(agent);
  assert.equal(status.ready,true,JSON.stringify(status));
  assert.ok(status.visibleTools.includes('ares_test_extension_read'));
  for(const tool of baseline)assert.ok(actual.some(row=>row.name===tool.name),tool.name);
  for(const name of ['ares_config_read','ares_config_edit'])assert.ok(actual.some(row=>row.name===name),name);
  const wire=await root.systemPrompt.assemble({agent,scope:agent});
  assert.deepEqual(names(wire.tools),names(actual));
  report.standardTools=names(baseline);report.aresTools=names(actual);report.wireTools=names(wire.tools);
 }finally{await lease[Symbol.asyncDispose]();}
});
test('missing inherited tools block the actual prompt assembly and state reports recovery at the same revision',async()=>{
 const previous=await editor.state(),remove=agent.ctx.get('tools').restrict({allow:[]});
 try{
  assert.equal(root.tools.get('ares_config_read',agent),undefined);
  assert.equal(root.tools.get('pwsh',agent),undefined);
  await assert.rejects(()=>root.systemPrompt.assemble({agent,scope:agent}),error=>error.code==='ares/editor-tools-unavailable'&&/ares_config_read/.test(error.message));
  const state=await editor.state(previous.revision);
  assert.equal(state.unchanged,true);assert.equal(state.toolSurface.ready,false);
  assert.ok(state.toolSurface.missing.includes('ares_config_read'));
  report.deniedToolCount=state.toolSurface.missing.length;
 }finally{remove();}
 assert.equal((await editor.state(previous.revision)).toolSurface.ready,true);
 await root.systemPrompt.assemble({agent,scope:agent});
});
test('the assembly guard also catches tools removed downstream from otherwise healthy wire schemas',async()=>{
 const remove=root.on('system-prompt/assemble',async(_assembly,context,next)=>{const result=await next();return context.agent===agent?{...result,tools:result.tools.filter(row=>row.name!=='read')}:result;});
 try{assert.ok(root.tools.get('read',agent));await assert.rejects(()=>root.systemPrompt.assemble({agent,scope:agent}),error=>error.code==='ares/editor-tools-unavailable'&&/read/.test(error.message));}
 finally{remove();}
 await root.systemPrompt.assemble({agent,scope:agent});
});
test('legitimate Host restrictions on global extensions do not make the entire editor unusable',async()=>{
 // The installed MCP connector uses this real DSH deny mechanism for project-only connections.
 const remove=agent.ctx.get('tools').restrict({deny:['ares_test_extension_read']});
 try{
  assert.equal(root.tools.get('ares_test_extension_read',agent),undefined);
  assert.equal((await native.inspectEditorTools(agent)).ready,true);
  const wire=await root.systemPrompt.assemble({agent,scope:agent});
  assert.equal(wire.tools.some(row=>row.name==='ares_test_extension_read'),false);
  assert.ok(wire.tools.some(row=>row.name==='read'));
  report.hostScopeRestrictionsRespected=true;
 }finally{remove();}
 assert.ok((await native.inspectEditorTools(agent)).visibleTools.includes('ares_test_extension_read'));
});
test('real native file write/read/search, PowerShell, skill and inherited extension calls execute successfully',async()=>{
 const file=join(connection.cwd,'native-tool-check.txt'),content='ARES real native tool execution '+randomUUID()+'\n';
 await execute('write',{file_path:file,content});assert.equal(readFileSync(file,'utf8'),content);
 assert.ok(JSON.stringify(await execute('read',{file_path:file})).includes(content.trim()));
 assert.ok(JSON.stringify(await execute('grep',{pattern:'ARES real native tool execution',path:connection.cwd})).includes('native-tool-check.txt'));
 assert.ok(JSON.stringify(await execute('pwsh',{description:'Verify native PowerShell reads the actual file',command:'Get-Content -LiteralPath ./native-tool-check.txt'})).includes(content.trim()));
 assert.ok(JSON.stringify(await execute('skill',{name:'ares'})).includes('ARES'));
 assert.ok(JSON.stringify(await execute('ares_test_extension_read',{})).includes('ARES actual global extension read'));
});
test('ARES configuration tools are callable through the real DSH execution pipeline and retain draft/revision safeguards',async()=>{
 const context=await execute('ares_config_read',{kind:'context'});
 assert.equal(JSON.parse(context.content[0].text).toolkitRoot,ROOT);
 const current=await editor.read(agent,{kind:'context'}),configuration=readConfiguration();
 await execute('ares_config_edit',{expectedRevision:current.revision,edits:[{type:'update_step',stepId:'context',changes:{title:'Isolated actual DSH configuration tool verification'}}]});
 const state=await editor.state();assert.equal(state.proposal.configuration.workflows[0].steps[0].title,'Isolated actual DSH configuration tool verification');
 assert.equal(readConfiguration().revision,configuration.revision);
 assert.equal(readConfiguration().workflows[0].steps[0].title,configuration.workflows[0].steps[0].title);
 const stale=await root.tools.execute({name:'ares_config_edit',arguments:{expectedRevision:current.revision,edits:[]},callId:'stale-'+(++callId),agent,signal:new AbortController().signal});
 assert.equal(stale.isError,true);assert.match(JSON.stringify(stale),/草稿已变化/);
 report.configurationSavedByTool=false;report.staleRevisionRejected=true;
});
test('reconnecting an idle retained editor upgrades its retired tool scope without losing its Session or proposal',async()=>{
 const before=await editor.state(),session=agent.session,events=session.snapshotEvents();
 const lease=await root.agentPresets.acquireScope(EDITOR_PRESET_ID),oldScope=createScope(root,lease.key);
 const removeMask=oldScope.ctx.get('tools').restrict({allow:[]});
 try{
  await native.dispose();
  await root.plugin(Object.assign(ctx=>{native=createNativeCatalog(ctx);},{inject:['agentPresets','tools']})).await();
  await native.publish();await native.forEditor();
  assert.equal((await editor.state()).toolSurface.ready,false,'Retained Agent still uses the retired mask before reconnect');
  agent.status='running';assert.equal(await native.refreshEditor(agent),false);
  assert.equal((await editor.state()).toolSurface.ready,false,'A running turn must not be rebound');
  agent.status='idle';
  const reopened=await editor.open({configuration:readConfiguration(),workflowId:'venture',activeStepId:'context'});
  assert.equal(reopened.sessionId,session.id);assert.equal(reopened.needsSession,false);assert.equal(reopened.toolSurface.ready,true);
  assert.equal(reopened.proposal.id,before.proposal.id);assert.equal(agent.session,session);assert.deepEqual(session.snapshotEvents(),events);
  await root.systemPrompt.assemble({agent,scope:agent});
  report.retainedSessionUpgraded=true;report.retainedProposalPreserved=true;
 }finally{agent.status='idle';removeMask();await oldScope.dispose();await lease[Symbol.asyncDispose]();}
});
test('an explicit save commits the reviewed proposal and native publication in one operation',async()=>{
 const before=await editor.state(),configuration=readConfiguration();
 const body={configuration,proposalId:before.proposal.id,configurationHash:before.proposal.configurationHash,expectedRevision:before.revision,contextToken:before.contextToken,expectedConfigurationRevision:configuration.revision};
 agent.status='running';await assert.rejects(()=>editor.saveProposal(body),/仍在运行/);assert.equal(readConfiguration().revision,configuration.revision);agent.status='idle';
 const saved=await editor.saveProposal(body);assert.equal(saved.savedConfiguration.revision,configuration.revision+1);assert.equal(saved.proposal,null);assert.equal(saved.lastSaved.proposalId,before.proposal.id);assert.equal(readConfiguration().workflows[0].steps[0].title,'Isolated actual DSH configuration tool verification');
 assert.equal(agent.id,before.sessionId);report.proposalSavedByExplicitAction=true;
});
test('a fixed skill prepares real Python/Node environments, runs actual code and follows one background job',async()=>{
 const source=join(base,'runtime-fixture-source');mkdirSync(source);writeFileSync(join(source,'SKILL.md'),'---\nname: native-runtime-fixture\ndescription: Explicit software test; no competition evidence.\n---\n# Native runtime fixture\nRead calculate.py, prepare the selected runtime, then run the actual script against the actual CSV.\n');
 writeFileSync(join(source,'calculate.py'),'import csv,json,hashlib\nfrom pathlib import Path\np=Path("input.csv")\nvalues=[int(row["value"]) for row in csv.DictReader(p.open())]\nPath("calculated.json").write_text(json.dumps({"sum":sum(values),"count":len(values),"input_sha256":hashlib.sha256(p.read_bytes()).hexdigest()}))\n');
 const pack=readLocalPackage(source),skill=packageReference(pack,'native-runtime-fixture'),configuration=readConfiguration();configuration.skills.push(skill);configuration.workflows.find(item=>item.id==='modeling').steps[0].skills.push(skill.id);await native.commitConfiguration(configuration,configuration.revision);
 const projectRoot=join(base,'runtime-project');mkdirSync(projectRoot);writeFileSync(join(projectRoot,'input.csv'),'value\n2\n3\n5\n');linkRoot(projectRoot);const competition=competitionCatalog().find(item=>item.id===5),project=initializeProject({root:projectRoot,name:'Explicit native runtime fixture',competitionId:5,track:competition.tracks[0].track,edition:'TEST',workflowId:'modeling'}),preset=await native.forProject(project);
 const id='session-'+randomUUID(),session=root.sessions.create(id,{meta:{cwd:projectRoot,agentPreset:preset}}),worker={id,session,status:'idle',options:{}},scope=createScope(root,worker);worker.ctx=scope.ctx;await root.agentPresets.mount(worker.ctx,preset);const detach=root.agents.enter(worker,undefined);
 const invoke=async args=>root.tools.execute({name:'ares_library',arguments:{stepId:'context',skillId:skill.id,...args},callId:'runtime-'+(++callId),agent:worker,signal:new AbortController().signal});
 const data=result=>{assert.equal(result.isError,false,JSON.stringify(result));return JSON.parse(result.content[0].text);};
 try{
  data(await invoke({action:'open'}));assert.equal((await invoke({action:'prepare',environment:{runtime:'python'}})).isError,true);
  data(await invoke({action:'load'}));const requirements=data(await invoke({action:'requirements'}));assert.equal(requirements.runtimeHints.python,true);
  const pipProbe=await root.tools.execute({name:'pwsh',arguments:{description:'Inspect the actual bundled pip version without installing dependencies',command:'python -c "import ensurepip; print(ensurepip.version())"'},callId:'pip-probe-'+(++callId),agent:worker,signal:new AbortController().signal});assert.equal(pipProbe.isError,false);const pipVersion=pipProbe.value.stdout.text.trim();assert.match(pipVersion,/^\d+\.\d+(?:\.\d+)?$/);
  const python=data(await invoke({action:'prepare',environment:{runtime:'python',packages:['pip=='+pipVersion],modules:['csv','json','hashlib']}}));assert.equal(python.readyForNativeRun,true,JSON.stringify(python));assert.equal(python.environment.checks.length,3);assert.equal(python.environment.packages[0].version,pipVersion);
  const run=data(await invoke({action:'run',command:'python '+"'"+python.environment.sourceDirectory.replaceAll("'","''")+"/calculate.py'"}));assert.equal(run.status,'succeeded',JSON.stringify(run));assert.equal(run.workCompleted,false);const actual=JSON.parse(readFileSync(join(projectRoot,'calculated.json'),'utf8'));assert.equal(actual.sum,10);assert.equal(actual.count,3);
  const failed=data(await invoke({action:'prepare',environment:{runtime:'node',modules:['node:fs'],commands:['ARES_INTENTIONALLY_MISSING_TEST_CLI']}}));assert.equal(failed.readyForNativeRun,false);assert.equal(failed.status,'failed');assert.equal((await invoke({action:'run',command:'Write-Output should-not-run'})).isError,true);
  const options={runtime:'node',modules:['node:fs','node:crypto'],background:true};let prepared=data(await invoke({action:'prepare',environment:options}));const jobId=prepared.jobId;assert.equal(prepared.status,'preparing',JSON.stringify(prepared));assert.ok(jobId);
  for(let attempt=0;attempt<30&&!prepared.readyForNativeRun;attempt++){await new Promise(resolve=>setTimeout(resolve,150));prepared=data(await invoke({action:'prepare',environment:options}));if(prepared.jobId)assert.equal(prepared.jobId,jobId);if(prepared.status==='failed')break;}
  assert.equal(prepared.readyForNativeRun,true,JSON.stringify(prepared));assert.equal(prepared.environment.runtime,'node');assert.equal(prepared.environment.checks.length,2);
  const node=data(await invoke({action:'run',command:'node -e '+"'"+'const fs=require("node:fs"),crypto=require("node:crypto");const bytes=fs.readFileSync("input.csv");fs.writeFileSync("node-hash.txt",crypto.createHash("sha256").update(bytes).digest("hex"));'+"'"}));assert.equal(node.status,'succeeded',JSON.stringify(node));assert.equal(readFileSync(join(projectRoot,'node-hash.txt'),'utf8'),actual.input_sha256);
  const cancelled=new AbortController();cancelled.abort();const stopped=await root.tools.execute({name:'ares_library',arguments:{action:'run',stepId:'context',skillId:skill.id,command:'Write-Output cancelled-must-not-run'},callId:'cancelled-'+(++callId),agent:worker,signal:cancelled.signal});assert.equal(stopped.isError,true);
  report.runtime={pythonReceipt:python.environment,nodeReceipt:prepared.environment,backgroundJobId:jobId,actualComputedResult:actual,workCompleted:false};
 }finally{detach();await scope.dispose();}
});
test('live standard settings and PTC presentation propagate without changing its Session or MCP policy',async()=>{
 const registry=root.agentPresets,rows=structuredClone(standardRows);
 rows.find(row=>row.id==='tool-fs').config={...(rows.find(row=>row.id==='tool-fs').config||{}),edit:false};
 rows.push({id:'test-standard-ptc',name:'@deepseek-ai/dsh-agent-tool-presentation',config:{mode:'ptc'}});
 await offStandard();offStandard=await registry.register({id:'standard',plugins:rows});
 await native.forEditor();await native.refreshEditor(agent);
 assert.equal(root.tools.get('edit',agent),undefined,'User standard configuration is retained');
 const status=await native.inspectEditorTools(agent);assert.equal(status.ready,true,JSON.stringify(status));assert.equal(status.presentation,'ptc');assert.equal(status.standardPresentation,'ptc');assert.equal(status.permissions.available,true);
 const wire=await root.systemPrompt.assemble({agent,scope:agent});assert.ok(wire.tools.some(tool=>tool.name==='run_code'));assert.equal(wire.tools.some(tool=>tool.name==='ares_config_read'),false);
 const result=await execute('run_code',{description:'Read an actual file through the standard PTC SDK',code:'return await tools.read({file_path:'+JSON.stringify(join(connection.cwd,'native-tool-check.txt'))+'});'});
 assert.match(JSON.stringify(result),/ARES real native tool execution/);
 report.dynamicStandardInherited=true;report.ptcExecuted=true;
});
