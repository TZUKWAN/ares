import {AresError,hash} from './storage.js';
import {putProjectObject} from './project-objects.js';
import {changeProject} from './projects.js?v=2.3.0-directory1';
import {runSurveyExperiment} from './survey-experiments.js';
import {evaluateSurvey,inspectSurvey,normalizeSurvey,QUESTION_TYPES,record,researchText,surveyTemplate} from '../client/research-survey-model.js';
import {requireKind,researchInput,researchOwner,researchProject,researchVersion,saveResearchVersion,writeResearchVersion} from './project-research.js';

export function saveSurvey(body,{actor=researchOwner,proposal=false}={}) {
  const data=researchInput(()=>body.templateInput?surveyTemplate(body.templateInput):normalizeSurvey(body.definition));
  const diagnostics=inspectSurvey(data);
  const status=proposal?'proposal':body.status??'draft';
  if (!['draft','template','final','proposal'].includes(status)||status==='proposal'&&!proposal) throw new AresError('问卷状态无效');
  if ((proposal||status==='final')&&!diagnostics.valid)
    throw new AresError('问卷逻辑未通过：'+diagnostics.issues.filter(row=>row.severity==='error').slice(0,5).map(row=>row.message).join('；'));
  if (status==='final'&&body.confirmFinal!==true) throw new AresError('请由负责人确认正式定稿',403);
  let source=null;
  if (body.sourceId) {
    const sourceVersion=requireKind(researchVersion(researchProject(body.root),body.sourceId,body.sourceVersion),'survey');
    source={itemId:sourceVersion.item.id,versionId:sourceVersion.version.id};
  }
  const result=saveResearchVersion(proposal?{...body,id:undefined}:body,{
    kind:'survey', title:data.title,data,status,source,provenance:proposal?'proposal':'design',actor
  });
  return {...result,diagnostics:diagnostics.issues};
}

export function pretestPlan(survey,body) {
  const compiled=researchInput(()=>inspectSurvey(survey));
  if (!compiled.valid) throw new AresError('请先修正问卷逻辑');
  const questions=[],excluded=[];
  const factors=new Map();
  for (const q of survey.pages.flatMap(page=>page.questions)) {
    if (!factors.has(q.dimension)) factors.set(q.dimension,'dimension_'+(factors.size+1));
    const base={id:q.name,label:q.title,factor:factors.get(q.dimension)};
    if (q.type==='likert') questions.push({...base,type:'likert',levels:q.options.length});
    else if (q.type==='single'&&q.options.length<=30) questions.push({...base,type:'categorical',categories:q.options.map(row=>row.id)});
    else if (q.type==='number'&&!(q.min!==undefined&&q.min===q.max)) questions.push({...base,type:'numeric',...(q.min!==undefined?{min:q.min}:{}),...(q.max!==undefined?{max:q.max}:{}),...(q.min!==undefined&&q.max!==undefined?{mean:q.min/2+q.max/2,std:Math.max(0.001,(q.max-q.min)/6)}:{})});
    else excluded.push({name:q.name,title:q.title,type:q.type});
  }
  if (questions.length<2||questions.length>80) throw new AresError('预测试需要2至80道受支持的量表、数值或单选题');
  return {
    spec:{seed:body.seed??'ares-research',count:body.count??120,questions,...(body.model!==undefined?{model:body.model}:{})},
    excluded,coverage:'统计预测试覆盖映射变量，条件显示和跳转路径在填写预览中验证',
    factors:[...factors].map(([dimension,id])=>({dimension,id}))
  };
}
export async function pretestSurvey(body,{signal}={}) {
  const project=researchProject(body.root);
  const version=requireKind(researchVersion(project,body.id,body.versionId),'survey');
  if (version.version.payload.status==='proposal') throw new AresError('请先采用该问卷方案');
  const plan=pretestPlan(version.data,body);
  const result=await runSurveyExperiment({...body,spec:plan.spec,scenarios:body.scenarios??['baseline']},{signal});
  const saved=saveResearchVersion({...body,id:undefined,expectedRevision:result.project.revision},{
    kind:'pretest',title:version.item.title.slice(0,145)+' · 预测试',status:result.experiment.status,
    data:{experiment:result.experiment,plan,dataKind:'synthetic',realSampleCount:0},provenance:'synthetic',
    source:{itemId:version.item.id,versionId:version.version.id}
  });
  return {...saved,experiment:result.experiment,plan};
}

export function startSurveyPretest(jobs,body) {
  const project=researchProject(body.root);
  if(body.approve!==true)throw new AresError('请确认仅生成本机模拟预测试样本',403);
  const entry=requireKind(researchVersion(project,body.id,body.versionId),'survey');
  if(entry.version.payload.status==='proposal')throw new AresError('请先采用问卷方案');
  pretestPlan(entry.data,body);
  const source={itemId:entry.item.id,versionId:entry.version.id};
  return jobs.start(body,{kind:'survey-pretest',title:'问卷模型预测试',source,
    settings:{count:body.count??120,seed:body.seed??'ares-research'}},async({signal,update})=>{
    update({phase:'simulating',done:0,total:null});
    const current=researchProject(project.root);
    const result=await pretestSurvey({...body,expectedRevision:current.revision,id:entry.item.id,versionId:entry.version.id},{signal});
    signal.throwIfAborted();
    if(result.experiment.status!=='completed')throw new AresError(result.experiment.error||'模拟预测试未完成',422);
    return {itemId:result.item.id,versionId:result.version.id,experimentId:result.experiment.id,realSampleCount:0};
  });
}
export function parseResearchCsv(text,limit=10001) {
  const rows=[];
  let row=[],value='',state='start';
  for (let i=0;i<text.length;i++) {
    const char=text[i];
    if (state==='quoted') {
      if (char==='"'&&text[i+1]==='"') { value+='"';i++; }
      else if (char==='"') state='closed';
      else value+=char;
      continue;
    }
    if (char===','||char==='\n'||char==='\r') {
      row.push(value);value='';state='start';
      if (char===',') continue;
      if (char==='\r'&&text[i+1]==='\n') i++;
      rows.push(row);row=[];
      if (rows.length>limit) throw new AresError('单批导入最多10000份答卷',413);
    } else if (state==='closed') throw new AresError('CSV 引号后的列格式无效');
    else if (char==='"'&&state==='start') state='quoted';
    else if (char==='"') throw new AresError('CSV 包含未转义的引号');
    else { value+=char;state='unquoted'; }
  }
  if (state==='quoted') throw new AresError('CSV 中存在未闭合的引号');
  if (row.length||state!=='start') rows.push([...row,value]);
  if (rows.length>limit) throw new AresError('单批导入最多10000份答卷',413);
  return rows;
}

function responseRows(body,compiled) {
  const source=researchInput(()=>researchText(body.content,'导入原文',4*1024*1024)).replace(/^\uFEFF/,'');
  if (source.startsWith('ARES_SYNTHETIC_DATA')) throw new AresError('模拟文件不能作为实际答卷');
  if (body.format==='json') {
    const parsed=researchInput(()=>JSON.parse(source));
    if (parsed?.dataKind==='synthetic'||parsed?.__data_kind==='synthetic') throw new AresError('模拟文件不能作为实际答卷');
    if (!Array.isArray(parsed)||!parsed.length||parsed.length>10000||!parsed.every(record))
      throw new AresError('JSON 需要1至10000个以变量名为键的答卷对象');
    return parsed;
  }
  if (body.format!=='csv') throw new AresError('请选择 CSV 或 JSON');
  const [header,...rows]=parseResearchCsv(source);
  const questions=new Map(compiled.survey.pages.flatMap(page=>page.questions).map(q=>[q.name,q]));
  if (header?.includes('__data_kind')||header?.includes('dataKind')) throw new AresError('带来源标记的外部数据不能直接登记为实际答卷');
  if (!header?.length||!rows.length||new Set(header).size!==header.length||header.some(name=>!questions.has(name)))
    throw new AresError('CSV 表头须填写问卷变量名，且不能重名');
  return rows.map((row,index)=>{
    if (row.length!==header.length) throw new AresError('CSV 第'+(index+2)+'行列数不一致');
    return Object.fromEntries(row.flatMap((value,col)=>{
      if (value==='') return [];
      const name=header[col],q=questions.get(name);
      if (q.type==='number') return [[name,value.trim()&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())?Number(value):value]];
      if (['multi','matrix','ranking'].includes(q.type)) return [[name,researchInput(()=>JSON.parse(value))]];
      return [[name,value]];
    }));
  });
}
export function importSurveyResponses(body) {
  if (body.confirmActual!==true) throw new AresError('请选择真实采集文件并确认来源',403);
  const origin=researchInput(()=>researchText(body.origin,'实际采集来源',1200));
  let result;
  const project=changeProject(body,p=>{
    const version=requireKind(researchVersion(p,body.id,body.versionId),'survey');
    if (version.version.payload.status!=='final') throw new AresError('实际答卷必须关联已定稿的问卷');
    if (typeof body.content!=='string') throw new AresError('请选择实际答卷文件');
    if (p.workbench.syntheticHashes[hash(Buffer.from(body.content))]) throw new AresError('该文件来自模拟预测试');
    const compiled=inspectSurvey(version.data),rows=responseRows(body,compiled),allNames=new Set(compiled.survey.pages.flatMap(page=>page.questions.map(q=>q.name)));
    const values=rows.map((row,index)=>{
      if (Object.keys(row).some(key=>!allNames.has(key))) throw new AresError('第'+(index+1)+'份答卷含未知变量或模拟来源标记');
      const result=evaluateSurvey(compiled,row,{rejectUnused:true});
      const error=Object.entries(result.errors)[0];
      if (error) throw new AresError('第'+(index+1)+'份答卷的 '+error[0]+' '+error[1]);
      return result.values;
    });
    const object=putProjectObject(p.root,Buffer.from(body.content));
    const source={itemId:version.item.id,versionId:version.version.id};
    const summary=summarizeResponses(compiled.survey,values);
    result=writeResearchVersion(p,{...body,id:undefined},{
      kind:'responses',status:'owner-attested',title:version.item.title.slice(0,140)+' · 实际答卷',source,provenance:'owner-attested',
      data:{dataKind:'field-responses',origin,sourceObject:object,sourceFormat:body.format,summary,rows:values}
    });
  });
  return {...result,revision:project.revision};
}
function summarizeResponses(survey,rows) {
  const columns=survey.pages.flatMap(page=>page.questions).map(q=>{
    let present=0,sum=0,min=Infinity,max=-Infinity;
    const distribution=new Map();
    function increment(key) { distribution.set(key,(distribution.get(key)||0)+1); }
    for (const row of rows) {
      if (!Object.hasOwn(row,q.name)) continue;
      present++;
      const v=row[q.name];
      if (q.type==='number') { sum+=v/rows.length;min=Math.min(min,v);max=Math.max(max,v); }
      else if (['single','likert'].includes(q.type)) increment(v);
      else if (q.type==='multi') for (const option of v) increment(option);
      else if (q.type==='ranking') for (const [index,option] of v.entries()) increment(option+'@'+(index+1));
      else if (q.type==='matrix') for (const [rowId,option] of Object.entries(v)) increment(rowId+'@'+option);
    }
    return {name:q.name,title:q.title,type:q.type,present,missing:rows.length-present,
      ...(q.type==='number'&&present?{mean:(sum/present)*rows.length,min,max}:{}),distribution:Object.fromEntries(distribution)};
  });
  return {sampleCount:rows.length,columns};
}

export function surveyMarkdown(survey) {
  const condition=rules=>rules.map(({source,op,value})=>source+' '+op+(value===undefined?'':' '+JSON.stringify(value))).join(' 且 ');
  return [
    '# '+survey.title,survey.description,
    ...survey.pages.flatMap(page=>['## '+page.title,page.description,
      ...page.questions.flatMap((q,index)=>[
        '### '+(index+1)+'. '+q.title+' ['+QUESTION_TYPES[q.type]+(q.required?' · 必填':'')+']',
        '变量 '+q.name+(q.group?' / '+q.group:''),q.description,q.showIf.length?'显示条件 '+condition(q.showIf):'',
        ...(q.rows??[]).map(row=>'矩阵行 '+row.label),
        ...(q.options??[]).map(row=>'□ '+row.label+(row.exclusive?'（互斥）':'')+(row.showIf.length?'（'+condition(row.showIf)+'）':'')),
        ...(['text','longtext','date','number'].includes(q.type)?['________________________']:[]),
        ...([q.min,q.max].some(bound=>bound!==undefined)?['范围 '+(q.min??'不限')+' 至 '+(q.max??'不限')]:[])
      ]),
      ...page.jumps.map(jump=>'跳转 '+(jump.when.length?condition(jump.when)+' → ':'')+(survey.pages.find(row=>row.id===jump.to)?.title??'完成'))
    ]),
    survey.completion
  ].filter(Boolean).join('\n')+'\n';
}
export function csvText(rows) {
  return rows.map(row=>row.map(value=>{
    const raw=value===undefined||value===null?'':typeof value==='object'?JSON.stringify(value):String(value);
    const cell=typeof value==='string'&&/^[\t\r\n ]*[=+\-@]/.test(raw)?"'"+raw:raw;
    return '"'+cell.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n')+'\r\n';
}
export {normalizeSurvey};
