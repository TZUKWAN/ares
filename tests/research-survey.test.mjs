import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {makeQuestion,inspectSurvey,evaluateSurvey,surveyTemplate} from '../client/research-survey-model.js';
import {initializeProject,linkRoot,readProject} from '../host/projects.js';
import {competitionCatalog} from '../host/catalog.js';
import {buildExtension,surveyExtension} from '../host/project-extensions.js';
import {researchEntry,bindResearch} from '../host/project-research.js';
import {saveSurvey,importSurveyResponses,pretestSurvey} from '../host/research-surveys.js';

const definition=()=>{
  const route=makeQuestion('single','route','route','您是否使用过？');
  route.options=[{id:'yes',label:'是'},{id:'no',label:'否'}];
  const amount=makeQuestion('number','amount','amount','近一月使用次数');
  amount.min=1;amount.max=30;
  const needs=makeQuestion('multi','needs','needs','使用方式');
  needs.options=[{id:'app',label:'应用'},{id:'site',label:'网站',showIf:[{source:'amount',op:'gte',value:3}]},{id:'none',label:'其他',exclusive:true}];
  const note=makeQuestion('longtext','note','note','补充说明');note.required=false;
  note.showIf=[{source:'needs',op:'has',value:'app'}];
  return {schemaVersion:1,title:'使用情况软件验收',pages:[
    {id:'start',title:'筛选',questions:[route],jumps:[{to:'end',when:[{source:'route',op:'eq',value:'no'}]}]},
    {id:'usage',title:'使用情况',questions:[amount,needs,note]},
    {id:'end',title:'反馈',questions:[makeQuestion('likert','trust','trust','我能够独立完成第一次操作')]}
  ]};
};
test('a JSON survey executes forward jumps, dependent options and validation through the actual answer path',()=>{
  const compiled=inspectSurvey(definition());
  assert.deepEqual(compiled.issues.filter(i=>i.severity==='error'),[]);
  assert.deepEqual(evaluateSurvey(compiled,{route:'no',trust:'o4'}).path,['start','end']);
  assert.equal(evaluateSurvey(compiled,{route:'no',trust:'o4'}).complete,true);
  assert.ok(evaluateSurvey(compiled,{route:'no',amount:7,trust:'o4'},{rejectUnused:true}).errors.amount);
  assert.ok(evaluateSurvey(compiled,{route:'yes',amount:31,needs:['app'],trust:'o4'}).errors.amount);
  assert.ok(evaluateSurvey(compiled,{route:'yes',amount:2,needs:['site'],trust:'o4'}).errors.needs);
  assert.match(evaluateSurvey(compiled,{route:'yes',amount:7,needs:['app','none']}).errors.needs,/互斥/);
  assert.equal(evaluateSurvey(compiled,{route:'yes',amount:7,needs:['app'],note:'软件验证',trust:'o4'}).complete,true);
  assert.equal(evaluateSurvey(compiled,{route:'yes'},{throughPage:'start'}).nextPage,'usage');
});
test('static checks reject cycles, backward jumps, duplicate variables and unreachable pages',()=>{
  const survey=definition();
  survey.pages[0].jumps=[{to:'end',when:[]}];
  survey.pages[0].questions[0].showIf=[{source:'amount',op:'lt',value:5}];
  survey.pages[1].questions[1].name='amount';
  survey.pages[2].jumps=[{to:'start',when:[{source:'amount',op:'lt',value:5},{source:'amount',op:'gte',value:5}]}];
  const result=inspectSurvey(survey);
  assert.equal(result.valid,false);
  for (const code of ['cycle-or-order','jump-target','conflict','duplicate-variable','unreachable-page','unreachable-source']) assert.ok(result.issues.some(row=>row.code===code),code);
  assert.throws(()=>evaluateSurvey(result,{}),/问卷逻辑/);
});
test('the quick template is a runnable nine-type design with no responses',()=>{
  const spec=surveyTemplate({title:'操作负担',study:'按首次使用者和熟悉使用者比较',dimensions:['学习','效率'],count:9,types:['single','multi','text','longtext','number','likert','matrix','ranking','date']});
  assert.equal(inspectSurvey(spec).valid,true);
  assert.equal(new Set(spec.pages[0].questions.map(q=>q.type)).size,9);
  const answers={q1:'o1',q2:['o1'],q3:'短答',q4:'多行\n答复',q5:5,q6:'o4',q7:{r1:'o1',r2:'o2'},q8:['o2','o1'],q9:'2024-02-29'};
  assert.equal(evaluateSurvey(inspectSurvey(spec),answers).complete,true);
  assert.ok(evaluateSurvey(inspectSurvey(spec),{...answers,q9:'2025-02-29'}).errors.q9);
});

test('actual project storage preserves finalized survey lineage, owner checks and simulated pretest isolation',async()=>{
  const base=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-research-survey-'));
  process.env.ARES_HOME=join(base,'home');
  const root=join(base,'project');mkdirSync(root);linkRoot(root);
  const comp=competitionCatalog().find(c=>c.id===5);
  let p=initializeProject({root,name:'研究工具验收',competitionId:5,track:comp.tracks[0].track,workflowId:'modeling'});
  const proposal=saveSurvey({root,expectedRevision:p.revision,definition:definition(),status:'final',confirmFinal:true},{actor:{kind:'agent',id:'test-protocol'},proposal:true});
  assert.equal(proposal.item.status,'proposal');
  assert.throws(()=>bindResearch({root,expectedRevision:proposal.revision,id:proposal.item.id,stepId:'context'}),/采用/);
  const draft=saveSurvey({root,expectedRevision:proposal.revision,sourceId:proposal.item.id,sourceVersion:proposal.version.id,definition:definition()});
  const next={root,id:draft.item.id,baseVersion:draft.version.id,expectedRevision:draft.revision,definition:definition(),status:'final'};
  assert.throws(()=>saveSurvey(next),/确认/);
  assert.throws(()=>saveSurvey({...next,expectedRevision:0,confirmFinal:true}),{status:409,message:"项目已更新，请刷新后重试"});
  const final=saveSurvey({...next,confirmFinal:true});
  assert.equal(researchEntry(root,draft.item.id,draft.version.id).version.payload.status,'draft');
  assert.equal(researchEntry(root,draft.item.id).version.payload.status,'final');
  p=buildExtension({root,expectedRevision:final.revision,manifest:surveyExtension,enabled:true}).project;
  const sim=await pretestSurvey({root,expectedRevision:p.revision,id:final.item.id,count:40,seed:'software-qa'});
  assert.equal(sim.experiment.status,'completed');assert.equal(sim.experiment.realSampleCount,0);
  const path=sim.experiment.results[0].files.find(row=>row.path.endsWith('.csv')).path;
  assert.throws(()=>importSurveyResponses({root,expectedRevision:sim.revision,id:final.item.id,content:readFileSync(join(root,path),'utf8'),format:'csv',confirmActual:true,origin:'测试'}),/模拟/);
  const fields='route,amount,needs,note,trust\r\nno,,,,o2\r\nyes,8,"[""app""]","软件验收样例，含引号""\n含换行",o4';
  const request={root,expectedRevision:sim.revision,id:final.item.id,content:fields,format:'csv',origin:'软件验收人员填写的两条输入'};
  assert.throws(()=>importSurveyResponses(request),/确认/);
  const actual=importSurveyResponses({...request,confirmActual:true});
  const entry=researchEntry(root,actual.item.id);
  assert.equal(entry.data.summary.sampleCount,2);
  assert.equal(entry.data.summary.columns.find(row=>row.name==='amount').mean,8);
  assert.match(entry.data.rows[1].note,/含换行/);
  assert.equal(entry.version.payload.source.versionId,final.version.id);
  assert.equal(readProject(root).progress.done,0);
});
