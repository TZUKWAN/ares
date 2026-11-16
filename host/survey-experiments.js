import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {AresError,atomicJson,readJson,safePath,now} from './storage.js';
import {readProject,changeProject} from './projects.js?v=2.3.0-loadfix1';
import {projectEvent} from './project-artifacts.js';
import {listExtensions,runExtension} from './project-extensions.js';
import {validateSurveySpec} from './survey-pretest.js';
import {readProjectObject} from './project-objects.js';

const active=new Set(),validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
const recordPath=(root,id)=>{if(!validId(id))throw new AresError('预测试实验标识无效');return safePath(root,'.ares/experiments/'+id+'.json');};
export function experimentPlan(body){const seeds=body.seeds||[body.spec?.seed],counts=body.counts||[body.spec?.count],scenarios=body.scenarios||['baseline','high-missingness','low-reliability'];if(!Array.isArray(seeds)||!seeds.length||seeds.length>5||!Array.isArray(counts)||!counts.length||counts.length>3||!Array.isArray(scenarios)||!scenarios.length||scenarios.length>3||seeds.length*counts.length*scenarios.length>12)throw new AresError('单次最多12组预测试；种子最多5个、样本量最多3档、场景最多3类');const rows=[];let cells=0;for(const count of counts)for(const scenario of scenarios)for(const seed of seeds){const spec=validateSurveySpec({...body.spec,count,scenario,seed});cells+=spec.count*spec.questions.length;rows.push(spec);}if(cells>1000000)throw new AresError('整组预测试样本×题目合计超过100万，请减少组合');if(new Set(rows.map(row=>JSON.stringify([row.count,row.scenario,String(row.seed)]))).size!==rows.length)throw new AresError('预测试组合重复，请去掉重复种子、样本量或场景');return rows;}
export function surveyExperiment(root,id){const p=readProject(root);if(!p.workbench?.experimentIds?.includes(id))throw new AresError('预测试实验不属于此项目',403);const record=readJson(recordPath(p.root,id));if(record.projectId!==p.id)throw new AresError('实验项目身份不符',409);if(record.status==='running'&&!active.has(id))return {...record,status:'unknown',error:'原实验未在当前进程收齐，不会自动重跑'};return record;}
export function listSurveyExperiments(root){const p=readProject(root);return (p.workbench?.experimentIds||[]).slice(-20).reverse().map(id=>surveyExperiment(root,id));}
export async function runSurveyExperiment(body,{signal}={}){
 const initial=readProject(body.root);if(initial.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);const specs=experimentPlan(body),extension=listExtensions(initial.root).extensions.find(row=>row.id==='ares-survey-pretest');if(!extension?.enabled||extension.kind!=='survey-generator')throw new AresError('请先在项目中启用问卷预测试能力',403);if(listSurveyExperiments(initial.root).some(row=>['running','unknown'].includes(row.status)))throw new AresError('此项目已有实验在运行或原结果待核对，未重复启动',409);
 const id=randomUUID(),record={schema_version:1,id,projectId:initial.id,status:'running',dataKind:'synthetic',realSampleCount:0,startedAt:now(),planned:specs.length,results:[]};let p=changeProject(body,value=>{value.workbench.experimentIds??=[];value.workbench.experimentIds.push(id);projectEvent(value.root,value,'pretest.experiment-started',{id,planned:specs.length}, {kind:'user',id:'owner'});});active.add(id);atomicJson(recordPath(p.root,id),record);
 try{for(const spec of specs){signal?.throwIfAborted();p=readProject(p.root);const run=await runExtension({root:p.root,expectedRevision:p.revision,id:extension.id,input:spec},undefined,{signal}),payload=run.run.payload;const source=payload.files.find(row=>row.path.endsWith('/来源与诊断.json'));let diagnostics;if(source){diagnostics=JSON.parse(readProjectObject(p.root,source.sha256).toString('utf8'));}record.results.push({count:spec.count,seed:spec.seed,scenario:spec.scenario,status:payload.status,runId:run.run.id,path:payload.path,files:payload.files,columns:diagnostics?.columns||null,reliability:diagnostics?.reliability||null,model:diagnostics?.model||null});atomicJson(recordPath(p.root,id),record);if(payload.status!=='succeeded'){record.status=signal?.aborted?'cancelled':'failed';record.error='一组预测试未成功，已保留真实已完成结果，没有继续启动后续组合';break;}}
  if(record.status==='running')record.status=record.results.length===record.planned?'completed':'failed';
 }catch(error){record.status=signal?.aborted?'cancelled':'failed';record.error=error instanceof AresError?error.message:'预测试实验已中断，已完成结果保留';}
 finally{active.delete(id);record.finishedAt=now();atomicJson(recordPath(p.root,id),record);}
 return {project:readProject(p.root),experiment:record,tasksAutoCompleted:false};
}
