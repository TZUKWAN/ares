import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {join,resolve,relative,isAbsolute,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AresError,hash,atomicJson,readJson,safePath} from './storage.js';

const preparationProgram=fileURLToPath(new URL('./runtime-preparation.ps1',import.meta.url));
const quote=text=>"'"+String(text).replaceAll("'","''")+"'";
function outcome(result){
 const value=result.value;if(result.isError||value?.isError||value?.sandbox?.denied||value?.sandbox?.runnerFailed||value?.timedOut)return 'failed';if(value?.aborted)return 'cancelled';
 if(['background','promoted'].includes(value?.kind)||['running','stopping'].includes(value?.job?.status))return 'pending';
 if(value?.kind==='foreground')return value.exitCode===0?'succeeded':'failed';
 const job=value?.job;if(job?.status==='killed')return 'cancelled';if(job?.status==='failed')return 'failed';
 // DSH pwsh deliberately uses "completed" for nonzero exits too. Its
 // documented processOutcome encodes the actual exit code in job.detail.
 if(job?.kind==='pwsh'&&job.status==='completed'){const match=/^exit code: (-?\d+)(?:;|$)/.exec(job.detail||'');if(!match)return 'unknown';if(Number(match[1])!==0||/sandbox runner itself failed|command did not run|denied/i.test(job.detail))return 'failed';}
 return 'succeeded';
}
export {outcome as nativeToolOutcome};
export async function dispatchSkillTool(ctx,exec,name,args){
 exec.signal?.throwIfAborted();if(!exec.agent?.session?.append||!exec.token||!exec.callId)throw new AresError('技能执行需要真实DSH工具调用上下文');
 if(typeof name!=='string'||name==='ares_library'||name.startsWith('ares_config_')||!args||typeof args!=='object'||Array.isArray(args)||Buffer.byteLength(JSON.stringify(args))>2*1024*1024)throw new AresError('原生子调用名称或参数无效');
 const schema=ctx.tools.schemas(exec.agent).find(item=>item.name===name);if(!schema)throw new AresError('当前Agent没有这个真实工具：'+name+'；请先检查DSH连接与权限');
 const callId=String(exec.callId)+':ares:'+randomUUID(),rootCallId=exec.rootCallId||exec.callId,record={rootCallId,parentCallId:exec.callId,subCallId:callId,name,arguments:args};
 exec.agent.session.append('tool/ptc-dispatch-start',record);
 let result;try{result=await ctx.tools.execute({callId,rootCallId,name,schema,arguments:args,agent:exec.agent,parent:exec.token,signal:exec.signal});}catch{
  const failure=new AresError('原生工具调用未返回完整结果，请核对原调用后继续，未重复启动',502);failure.executionOutcome='unknown';failure.nativeCallId=callId;
  try{exec.agent.session.append('tool/ptc-dispatch',{...record,isError:true,content:[{type:'text',text:failure.message}],error:{type:'AresNativeOutcomeUnknown',subCallId:callId}});}catch{failure.dispatchLogUnavailable=true;}throw failure;
 }
 let logWarning=null;try{exec.agent.session.append('tool/ptc-dispatch',{...record,isError:result.isError,content:result.content,...(result.meta?{meta:result.meta}:{}),...(result.error?.info?{error:result.error.info}:{})});}catch(error){logWarning='调用已返回，但原生日志回执失败：'+error.message;}
 for(const context of result.additionalContexts||[])exec.deferContext?.(context);
 return {name,callId,status:outcome(result),result,...(exec.signal?.aborted?{cancellationRequested:true}:{}),...(logWarning?{logWarning}:{})};
}
export function skillCallResult(call){const value={nativeTool:call.name,callId:call.callId,status:call.status,...(call.result.value?.jobId||call.result.value?.job?.id?{jobId:call.result.value?.jobId||call.result.value?.job?.id}:{}),isError:call.result.isError,value:call.result.value,error:call.result.error,content:call.result.content,logWarning:call.logWarning},text=JSON.stringify(value,(_key,item)=>{if(typeof item==='number'&&!Number.isFinite(item))throw new AresError('原生工具回执含不可保存的非有限数值');return item;});if(text.length<=12000)return JSON.parse(text);return {nativeTool:call.name,callId:call.callId,status:call.status,...(value.jobId?{jobId:value.jobId}:{}),isError:call.result.isError,truncated:true,preview:call.result.content?.filter(item=>item.type==='text').map(item=>item.text).join('\n').slice(-7000),next:'完整真实调用与结果保存在本次DSH原生子调用记录；不要为取输出重复执行。'};}
export function skillRequirements(ctx,exec,skill,sourceRoot){
 const files=skill.resources.map(item=>item.path),declaredFiles=files.filter(path=>/(^|\/)(requirements[^/]*\.txt|pyproject\.toml|package\.json|environment\.ya?ml|renv\.lock)$/.test(path));
 const hints={python:files.some(path=>path.endsWith('.py')),node:files.some(path=>/\.(m?js|cjs|ts)$/.test(path))};
 return {skillId:skill.id,declaredFiles,runtimeHints:hints,visibleTools:ctx.tools.schemas(exec.agent).map(item=>item.name),sourceRoot,verification:'requirements-observed-not-installed',policy:'只安装本次明确指定的固定版本依赖；模块/CLI须通过真实探测，不把准备环境当任务完成。'};
}
export function environmentOptions(options,requirements,sourceRoot){
 let runtime=options.runtime||'auto';if(runtime==='auto')runtime=requirements.runtimeHints.python?'python':requirements.runtimeHints.node?'node':'none';if(!['python','node','none'].includes(runtime))throw new AresError('运行时需要python/node/none/auto');
 let packages=options.packages||[];const modules=options.modules||options.pythonModules||[],commands=options.commands||[];
 if(options.requirementsFile){if(runtime!=='python'||!requirements.declaredFiles.includes(options.requirementsFile))throw new AresError('requirementsFile必须属于本技能的真实Python声明资源');const text=readFileSync(safePath(sourceRoot,options.requirementsFile,{existing:true}),'utf8');packages=packages.concat(text.split(/\r?\n/).map(line=>line.replace(/\s+#.*$/,'').trim()).filter(line=>line&&!line.startsWith('#')));}
 if(!Array.isArray(packages)||packages.length>40||!Array.isArray(modules)||modules.length>40||!Array.isArray(commands)||commands.length>30)throw new AresError('依赖或探测列表无效/过多');
 for(const value of packages)if(typeof value!=='string'||!(runtime==='python'?/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\[[A-Za-z0-9_,.-]+\])?==[A-Za-z0-9_.+-]+$/:/^(?:@[A-Za-z0-9][A-Za-z0-9_.-]*\/)?[A-Za-z0-9][A-Za-z0-9_.-]*@\d+\.\d+\.\d+(?:[-+][A-Za-z0-9_.-]+)?$/).test(value))throw new AresError('安装依赖须固定具体版本，不接受URL、安装选项或未固定来源：'+value);
 for(const value of modules)if(typeof value!=='string'||!(runtime==='python'?/^[A-Za-z_]\w*(?:\.\w+)*$/:/^(?:node:)?(?:@[A-Za-z0-9_.-]+\/)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/).test(value)||runtime==='node'&&value.replace(/^node:/,'').split('/').some(part=>part==='.'||part==='..'))throw new AresError('模块探测名称无效');
 for(const value of commands)if(typeof value!=='string'||!/^[A-Za-z0-9_.-]+$/.test(value))throw new AresError('CLI探测名称无效');
 if(runtime==='none'&&(packages.length||modules.length))throw new AresError('不能用none跳过指定依赖和模块检查');
 return {runtime,packages:[...new Set(packages)],modules:[...new Set(modules)],commands:[...new Set(commands)]};
}
function receiptFor(plan,call){
 if(call.status!=='succeeded'||!existsSync(plan.receipt))return null;const receipt=JSON.parse(readFileSync(plan.receipt,'utf8').replace(/^\uFEFF/,''));
 if(receipt.planKey!==plan.key||receipt.attemptId!==plan.attemptId||receipt.ready!==true||receipt.exitCode!==0||hash(receipt.sourceHashes)!==hash(plan.files))return null;return receipt;
}
export async function prepareSkillEnvironment(ctx,exec,skill,sourceRoot,definitionId,options={}){
 const requirements=skillRequirements(ctx,exec,skill,sourceRoot),selected=environmentOptions(options,requirements,sourceRoot),cwd=exec.agent?.session?.header?.cwd;
 if(!cwd)throw new AresError('无法读取当前真实会话目录');
 const files=[{path:'SKILL.md',sha256:hash(skill.content)},...skill.resources.filter(item=>item.path!=='SKILL.md').map(({path,sha256})=>({path,sha256}))];
 for(const item of files)if(hash(readFileSync(safePath(sourceRoot,item.path,{existing:true})))!==item.sha256)throw new AresError('固定技能资源已改变：'+item.path,409);
 const key=hash({definitionId,skillId:skill.id,agentId:exec.agent.id,files,...selected}),root=safePath(cwd,'.ares/skill-environments/'+key),tracking=safePath(cwd,'.ares/skill-environments/requests/'+key+'.json');
 const existing=readJson(tracking,null);if(existing?.status==='preparing'){
  if(existing.owner!==exec.agent.id)return {status:'preparing',owner:existing.owner,jobId:existing.jobId,readyForNativeRun:false,workCompleted:false};
  if(!existing.jobId&&existing.command){
   const listed=await dispatchSkillTool(ctx,exec,'job_list',{}),jobs=listed.result.value,matches=Array.isArray(jobs)?jobs.filter(job=>job.kind==='pwsh'&&typeof job.id==='string'&&job.label===existing.command):[];
   if(listed.status==='succeeded'&&matches.length===1){existing.jobId=matches[0].id;atomicJson(tracking,existing);}
  }
  if(!existing.jobId)return {status:'unknown-job',reason:'尚未找到唯一对应原准备命令的实际job，未重复启动；请在原DSH助手中核对。',readyForNativeRun:false,workCompleted:false};
  const call=await dispatchSkillTool(ctx,exec,'job_output',{job_id:existing.jobId,wait:false}),job=call.result.value?.job;
  if(!job||job.id!==existing.jobId||call.result.isError||!['running','stopping','completed','failed','killed'].includes(job.status))return {status:'unknown-job',jobId:existing.jobId,nativeCall:skillCallResult(call),readyForNativeRun:false,workCompleted:false};
  if(['running','stopping'].includes(job.status)||call.status==='unknown')return {status:'preparing',jobId:existing.jobId,nativeCall:skillCallResult(call),readyForNativeRun:false,workCompleted:false};
  const receipt=receiptFor(existing.plan,call),state={...existing,status:receipt?'ready':call.status==='cancelled'?'cancelled':'failed',receipt};atomicJson(tracking,state);return {status:state.status,environment:{...existing.plan,...receipt},nativeCall:skillCallResult(call),readyForNativeRun:!!receipt,workCompleted:false};
 }

 const names=new Set(ctx.tools.schemas(exec.agent).map(item=>item.name));if(!names.has('write')||!names.has('pwsh'))return {status:'needs-native-tools',requirements,reason:'自动隔离环境准备需要当前DSH的write与pwsh；可用call通过实际可见终端准备其他运行时。',readyForNativeRun:false,workCompleted:false};
 const attemptId=randomUUID(),plan={schema_version:1,key,attemptId,...selected,root,sourceRoot,sourceDirectory:join(root,'project','source'),files,receipt:join(root,'environment.json')},planFile=safePath(cwd,'.ares/skill-environments/requests/'+key+'-'+attemptId+'.json');
 // The plan file and all environment effects pass through DSH's native execution pipeline.
 const written=await dispatchSkillTool(ctx,exec,'write',{file_path:planFile,content:JSON.stringify(plan)});if(written.status!=='succeeded')return {status:written.status,nativeCall:skillCallResult(written),readyForNativeRun:false,workCompleted:false};
 const command='& '+quote(preparationProgram)+' -PlanFile '+quote(planFile);
 // Persist the attempt before dispatch. A lost reply never permits a second
 // environment installer to race the first; recovery uses the exact command
 // that DSH records as the pwsh job label, including its unique plan filename.
 atomicJson(tracking,{status:'preparing',owner:exec.agent.id,jobId:null,command,plan});
 let call;try{call=await dispatchSkillTool(ctx,exec,'pwsh',{description:'Prepare the current skill environment and verify actual dependencies',command,...(options.background?{run_in_background:true}:{})});}catch(error){atomicJson(tracking,{status:error.executionOutcome==='unknown'?'preparing':'failed',owner:exec.agent.id,jobId:null,nativeCallId:error.nativeCallId||null,command,plan});throw error;}

 const jobId=call.result.value?.jobId||call.result.value?.job?.id;
 if(call.status==='pending'){atomicJson(tracking,{status:'preparing',owner:exec.agent.id,jobId,command,plan});return {status:'preparing',jobId,nativeCall:skillCallResult(call),readyForNativeRun:false,workCompleted:false};}
 const receipt=receiptFor(plan,call),state={status:receipt?'ready':call.status==='cancelled'?'cancelled':'failed',owner:exec.agent.id,plan,receipt};atomicJson(tracking,state);
 return {status:state.status,environment:{...plan,...receipt},requirements,nativeCall:skillCallResult(call),readyForNativeRun:!!receipt,workCompleted:false};
}
export async function runSkillCommand(ctx,exec,environment,command,workdir){
 if(!environment?.key||!environment.ready||typeof command!=='string'||!command.trim()||command.length>20000)throw new AresError('先prepare并通过真实环境探测，再提供实际执行命令');
 const cwd=exec.agent.session.header.cwd,target=workdir?resolve(cwd,workdir):cwd,inside=base=>{const rel=relative(base,target);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..\\')&&!rel.startsWith('../');};
 if(!inside(cwd)&&!inside(environment.root))throw new AresError('运行目录必须位于当前项目或本技能隔离环境内');
 const receipt=readJson(environment.receipt);if(receipt.attemptId!==environment.attemptId||receipt.planKey!==environment.key||receipt.ready!==true)throw new AresError('环境回执已变化，请重新prepare',409);
 const prefix="$ErrorActionPreference='Stop'; $PSNativeCommandUseErrorActionPreference=$true; $env:TEMP="+quote(join(environment.root,'.tmp'))+"; $env:TMP=$env:TEMP; $env:TMPDIR=$env:TEMP; $env:PATH="+quote((environment.binPaths||[]).join(';'))+'+[IO.Path]::PathSeparator+$env:PATH; Set-Location -LiteralPath '+quote(target)+';\n';
 const call=await dispatchSkillTool(ctx,exec,'pwsh',{description:'Execute the current skill command using its verified isolated environment',command:prefix+command});return {status:call.status,nativeCall:skillCallResult(call),workCompleted:false};
}
