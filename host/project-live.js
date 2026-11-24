import {resolvedPathKey} from './path-identity.js';
/** Read-only observation of the actual bound project Agent; no prompt/tool dispatch. */
import {resolve,relative,isAbsolute} from 'node:path';
import {readProject} from './projects.js?v=2.3.0-directory1';
import {nodeRuns} from './node-execution.js?v=2.3.0-directory1';
import {agentFamily} from './agent-state.js';
import {sensitiveFile} from './project-artifacts.js';
import {AresError} from './storage.js';

const pathKey=resolvedPathKey,active=new Set(['preparing','running','stopping']);
const iso=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
function argumentsFor(value){if(typeof value==='string'){if(value.length>100000)return null;try{return JSON.parse(value);}catch{return null;}}return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}
function filesFor(project,args){const rows=[];for(const key of ['path','file_path','filePath','filename','file','target']){const value=args?.[key];if(typeof value!=='string'||!value||value.length>2000)continue;const full=resolve(project.root,value),name=relative(project.root,full).replaceAll('\\','/');if(!name||name==='..'||name.startsWith('../')||isAbsolute(name)||sensitiveFile(name))continue;if(!rows.some(row=>row.path===name))rows.push({path:name});}return rows;}
function linkedSteps(project,paths){const all=project.workflow.steps.flatMap(step=>step.outputs);return project.workflow.steps.filter(step=>step.outputs.some(output=>{const target=output.kind==='section'?all.find(row=>row.id===output.parentId):output;if(!target?.path)return false;const name=relative(project.root,resolve(project.root,project.outputDir,target.path)).replaceAll('\\','/');return paths.some(row=>row.path===name||target.kind==='directory'&&row.path.startsWith(name+'/'));})).map(step=>step.id);}
function actionFor(name){const full=String(name||'').toLowerCase(),short=full.split(/__|[./:]/).at(-1);if(/kdocs|cloud/.test(full))return '处理云文档';if(['read','read_file','open_file','cat_file'].includes(short))return '读取文件或资料';if(['write','write_file','edit','edit_file','apply_patch','patch','save'].includes(short))return '写入或修改内容';if(['bash','pwsh','terminal','exec','exec_command','execute','python','shell','program'].includes(short))return '运行计算或终端任务';if(['search','find','grep','search_query'].includes(short))return '检索资料';return '调用工具';}
export function projectLive(ctx,body){
 if(!body||typeof body!=='object'||Array.isArray(body))throw new AresError('实时观察需要项目请求对象');
 const p=readProject(body.root);if(p.kind!=='v2')return {available:false,reason:'尚未建立项目',agents:[],operations:[]};
 if(body.stepId!==undefined&&!p.workflow.steps.some(step=>step.id===body.stepId))throw new AresError('步骤不属于当前项目',403);
 const base={projectId:p.id,definitionId:p.definitionId,observedAt:new Date().toISOString(),agents:[],operations:[]},binding=p.workbench?.nodeSession;
 if(!binding||binding.definitionId!==p.definitionId)return {...base,available:false,reason:'尚未连接当前项目的原生会话'};
 const registry=ctx.get?.('agents'),root=registry?.get?.(binding.sessionId);
 if(!root)return {...base,available:false,reason:'项目原生会话暂不在活动注册表中'};
 if(root.id!==binding.sessionId||registry.get(root.id)!==root||root.session?.header?.id!==root.id||pathKey(root.session?.header?.cwd||'')!==pathKey(p.root)||typeof root.session.snapshotEvents!=='function')throw new AresError('项目原生会话身份或目录不符，未读取其他会话',403);
 const rootEvents=root.session.snapshotEvents();if(!Array.isArray(rootEvents))throw new AresError('原生会话事件暂不可读取',503);
 const preset=rootEvents.filter(row=>row.type==='agent-preset/selected').at(-1)?.data?.agentPreset||root.session.header.agentPreset;
 if(!preset||preset!==binding.presetId)return {...base,available:false,reason:'当前原生模式尚未与固定项目核对'};
 const family=agentFamily(ctx,root.id),actual=family.agents.length?family.agents:[root],runs=nodeRuns(p.root).filter(row=>row.definitionId===p.definitionId),operations=[],agents=[];
 for(const agent of actual){
  if(registry.get(agent.id)!==agent||agent.session?.header?.id!==agent.id||pathKey(agent.session?.header?.cwd||'')!==pathKey(p.root)||typeof agent.session.snapshotEvents!=='function')continue;
  const events=agent===root?rootEvents:agent.session.snapshotEvents();if(!Array.isArray(events))continue;const start=events.filter(row=>row.type==='turn/start').at(-1),turn=start?.data?.turn;
  const user=start&&events.find(row=>row.type==='user/message'&&row.seq>start.seq&&(!row.data?.turn||row.data.turn===turn)),run=user&&runs.find(row=>row.sessionId===agent.id&&row.requestId===user.data?.source?.rpcId),current=run&&active.has(run.status)?run:null;
  const actorId='agent:'+agent.id,own=[];
  if(turn!==undefined)for(const event of events.filter(row=>row.type==='tool/call'&&row.data?.turn===turn&&row.seq>=start.seq).slice(-40)){
   const call=event.data||{},result=events.find(row=>row.type==='tool/result'&&row.data?.turn===turn&&row.data?.message?.toolCallId===call.callId&&row.seq>event.seq),paths=filesFor(p,argumentsFor(call.arguments)),stepIds=run?[run.stepId]:linkedSteps(p,paths),status=result?result.data?.message?.isError===false?'succeeded':result.data?.message?.isError===true?'failed':'unknown':'running';
   const row={id:agent.id+':'+event.seq+':'+(result?.seq??'pending'),actorId,sessionId:agent.id,callId:call.callId??null,name:String(call.name||'未命名工具').slice(0,180),action:actionFor(call.name),status,paths,stepIds,association:run?'node-request':stepIds.length?'registered-artifact-path':'project-session',callSeq:event.seq,resultSeq:result?.seq??null,at:iso(result?.at||event.at),note:status==='running'?'等待工具结果；未从此记录推断审批状态':status==='failed'?'工具返回失败；具体原因可在原生对话查看':status==='unknown'?'工具结果状态尚未确认':''};own.push(row);operations.push(row);
  }
  const stepIds=[...new Set([...(current?[current.stepId]:[]),...own.flatMap(row=>row.stepIds)])];agents.push({id:actorId,sessionId:agent.id,name:typeof agent.name==='string'&&agent.name?agent.name.slice(0,80):agent===root?'项目助手':'项目队友',kind:'agent',source:'actual-project-agent',status:['idle','running'].includes(agent.status)?agent.status:'unknown',stepIds});
 }
 return {...base,available:true,source:'actual-project-agent',agents,operations:operations.slice(-60),note:'只读原生工具事件；文件变化单独核对，不推断编辑人或人工验收'};
}
