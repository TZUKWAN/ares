/** Real native-host CLI processes and owned files; no MCP root mutation or owner identity. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';

const source=dirname(dirname(fileURLToPath(import.meta.url)));
test('explicit-root local CLI uses actual competition/project/artifact data and preserves scope, owner and home boundaries',()=>{
  const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-local-cli-'));
  const root=join(base,'中文 项目目录'),outside=join(base,'范围以外 目录'),home=join(base,'独立 ARES 数据目录'),profile=join(base,'子进程 临时用户目录'),forbidden=join(base,'禁止写入 DSH目录');
  for(const path of [root,outside,profile])mkdirSync(path,{recursive:true});
  const environment={...process.env,DSH_HOME:forbidden,ARES_HOME:forbidden};
  delete environment.ARES_ALLOWED_ROOTS;
  let sequence=0;
  function call(tool,args,{ok=true,defaultHome=false}={}) {
    const input=join(base,'真实输入 '+(++sequence)+'.json');writeFileSync(input,JSON.stringify(args),'utf8');
    const child=spawnSync(process.execPath,[join(source,'scripts/ares-local.mjs'),'--host','codex','--root',root,...(defaultHome?[]:['--home',home]),'--tool',tool,'--input',input],{
      cwd:source,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:16*1024*1024,
      // Windows homedir uses the real child process USERPROFILE. It is an owned
      // profile directory, so exercising the default cannot touch user settings.
      env:{...environment,...(defaultHome?{USERPROFILE:profile}:{})},
    });
    assert.ifError(child.error);
    assert.equal(child.signal,null);
    assert.equal(child.status,ok?0:1,child.stderr||child.stdout);
    if(ok){assert.equal(child.stderr,'');return JSON.parse(child.stdout);}
    assert.equal(child.stdout,'');return JSON.parse(child.stderr);
  }
  const capability=call('ares_capabilities',{});assert.equal(capability.home,home);assert.deepEqual(capability.roots,[root]);assert.equal(capability.dshNativeExecution,false);
  assert.equal(existsSync(forbidden),false);
  const scope={competitionId:1,track:'高教主赛道',edition:'2026',group:''};
  const opened=call('ares_workflow',{action:'read',...scope});
  const workflow=structuredClone(opened.workflow);workflow.steps[0].title='当前宿主原生执行的软件检查';
  const saved=call('ares_workflow',{action:'save',...scope,workflow,configuration:opened.configuration,expectedRevision:opened.expectedRevision,expectedWorkflowHash:opened.workflowHash,expectedSkillHashes:opened.skillHashes});
  assert.equal(saved.saved,true);assert.equal(saved.expectedRevision,1);assert.equal(existsSync(join(home,'ares-workflows.json')),true);
  let project=call('ares_project',{action:'init',root,name:'中文 空格 本地CLI验收',...scope,flowMode:'library',workflowId:saved.workflow.id,expectedWorkflowHash:saved.workflowHash,expectedConfigurationRevision:saved.expectedRevision});
  assert.equal(project.workflow.steps[0].title,workflow.steps[0].title);assert.equal(project.progress.done,0);
  const step=project.workflow.steps[0],output=step.outputs.find(row=>row.kind==='file'&&row.format==='md');assert.ok(output);
  const artifact=join(root,project.outputDir,output.path);mkdirSync(dirname(artifact),{recursive:true});
  const before='# ARES 当前宿主本地CLI软件检查\n\n本文件由测试进程实际写入带有中文和空格的目录。\n\n仅用于文件与协议检查，不代表在线模型、调查样本或比赛成果。\n';writeFileSync(artifact,before,'utf8');
  const read=call('ares_artifact',{action:'read',root,id:output.id});assert.equal(read.text,before);
  const after=before+'\n通过实际 Node 子进程和登记作品接口保存的修改。\n';
  const edit=call('ares_artifact',{action:'save',root,id:output.id,expectedRevision:project.revision,version:read.version,text:after});project=edit.project;
  assert.equal(readFileSync(artifact,'utf8'),after);
  const reread=call('ares_artifact',{action:'read',root,id:output.id});assert.equal(reread.text,after);assert.equal(reread.version,edit.version);
  const check=call('ares_project',{action:'check',root,stepId:step.id});assert.equal(check.passed,true);assert.equal(check.artifactHashes[output.id],edit.version);
  const denied=call('ares_project',{action:'status',root:outside},{ok:false});assert.equal(denied.code,'scope-denied');assert.equal(existsSync(join(outside,'.ares')),false);
  const forged=call('ares_project',{action:'complete',root,stepId:step.id,expectedRevision:project.revision,principal:'owner'},{ok:false});assert.equal(forged.code,'invalid-arguments');assert.match(forged.error,/principal|Unrecognized/);
  const owner=call('ares_project',{action:'complete',root,stepId:step.id,expectedRevision:project.revision,review:{summary:'不能由模型自行批准',findings:[]}},{ok:false});assert.equal(owner.code,'needs-owner');
  const current=call('ares_project',{action:'status',root});assert.equal(current.progress.done,0);assert.equal(current.revision,project.revision);
  let defaultHome=null;
  if(process.platform==='win32') {
    const defaults=call('ares_capabilities',{}, {defaultHome:true});defaultHome=defaults.home;
    assert.equal(defaultHome,join(profile,'.ares','codex'));assert.equal(existsSync(join(defaultHome,'ares-mode.json')),true);assert.equal(existsSync(join(profile,'.dsh')),false);
  }
  assert.equal(existsSync(forbidden),false);
  const receipt={root,home,defaultHome,artifactPath:artifact,artifactSha256:edit.version,check,denied,forged,owner,projectProgress:current.progress,completedActualNodeProcesses:sequence};
  writeFileSync(join(base,'local-cli-receipt.json'),JSON.stringify(receipt,null,2));
  console.log('Local CLI evidence: '+base);
});
