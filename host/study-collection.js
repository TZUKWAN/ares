import {AresError,hash,now} from './storage.js';
import {changeProject} from './projects.js?v=2.3.0-directory1';
import {putProjectObject} from './project-objects.js';
import {cloudLink,kdocsTableCall} from './kdocs-client.js';
import {researchEntry,researchProject,researchVersion,requireKind,saveResearchVersion,writeResearchVersion} from './project-research.js';
import {writeSurveyResponses} from './research-surveys.js';
import {inspectSurvey,evaluateSurvey} from '../client/research-survey-model.js';

const fieldsOf=sheet=>sheet.fields.map(({id,name,type,items})=>({id,name,type,...(items?{items}: {})}));
const marker=value=>/ARES_SYNTHETIC_DATA|SOFTWARE_QA_ONLY|"(?:dataKind|__data_kind)"\s*:\s*"synthetic"/.test(JSON.stringify(value));
function endpoint(body){const url=cloudLink(body.url);if(!url)throw new AresError('请粘贴金山文档的正式文档链接');return url;}
async function schemaAt(url,call,signal){
  const data=await call('get-schema',{url},{signal});
  if(!Array.isArray(data?.sheets)||!data.sheets.length)throw new AresError('此链接未返回可读取的数据表',422);
  return data.sheets.filter(s=>Number.isSafeInteger(s.id)&&Array.isArray(s.fields)&&s.fields.length).map(s=>({id:s.id,name:s.name,fields:fieldsOf(s),views:s.views??[],schemaSha256:hash(fieldsOf(s))}));
}
export async function inspectCollection(body,{call=kdocsTableCall,signal}={}){
  researchProject(body.root);if(body.approveRead!==true)throw new AresError('请确认读取这份金山文档',403);
  const url=endpoint(body);return {url,sheets:await schemaAt(url,call,signal)};
}
function questionnaire(project,source){
  const survey=requireKind(researchVersion(project,source.itemId,source.versionId),'survey');
  if(survey.version.payload.status!=='final')throw new AresError('回收必须绑定一份已定稿的问卷');
  return survey;
}
function mappingFor(body,sheet,survey){
  if(!body.mapping||typeof body.mapping!=='object'||Array.isArray(body.mapping))throw new AresError('请选择答卷字段映射');
  const questions=survey.pages.flatMap(p=>p.questions),known=new Set(questions.map(q=>q.name)),used=new Set();
  for(const [name,field] of Object.entries(body.mapping)){
    if(!known.has(name)||typeof field!=='string'||!sheet.fields.some(f=>f.name===field)||used.has(field))throw new AresError('答卷字段未知、重复或不属于所选数据表');
    used.add(field);
  }
  if(questions.some(q=>q.required&&!body.mapping[q.name])||!used.size)throw new AresError('请映射所有必填题目和至少一个实际字段');
  return {...body.mapping};
}
export async function saveCollection(body,{call=kdocsTableCall,signal}={}){
  const p=researchProject(body.root);if(body.approveRead!==true)throw new AresError('请确认读取所选金山表与保存绑定',403);
  const source={itemId:body.surveyId,versionId:body.surveyVersion},survey=questionnaire(p,source),url=endpoint(body);
  const sheets=await schemaAt(url,call,signal),sheet=sheets.find(s=>s.id===body.sheetId);
  if(!sheet||sheet.schemaSha256!==body.schemaSha256)throw new AresError('金山表结构已变化，请重新读取字段',409);
  const mapping=mappingFor(body,sheet,survey.data);
  return saveResearchVersion(body,{kind:'collection',title:survey.item.title.slice(0,135)+' · 金山回收',status:'ready',source,provenance:body.softwareTest===true?'synthetic':'collection',
    data:{url,sheetId:sheet.id,sheetName:sheet.name,schemaSha256:sheet.schemaSha256,mapping,softwareTest:body.softwareTest===true,rows:[],pulledAt:null}});
}
function answer(value,q){
  if(value===null||value===undefined||value==='')return undefined;
  if(q.type==='number'&&typeof value==='string'&&value.trim()&&Number.isFinite(Number(value)))return Number(value);
  const option=v=>q.options?.find(o=>o.id===v)?.id??q.options?.find(o=>o.label===v)?.id??v;
  if(['single','likert'].includes(q.type))return option(value);
  if(['multi','ranking'].includes(q.type))return Array.isArray(value)?value.map(option):value;
  return value;
}
export async function pullCollection(body,{call=kdocsTableCall,signal,update=()=>{}}={}){
  if(body.approveRead!==true)throw new AresError('请确认本次从金山读取答卷',403);
  const entry=requireKind(researchVersion(researchProject(body.root),body.id,body.versionId),'collection');
  if(entry.item.head!==entry.version.id)throw new AresError('回收配置已更新，请刷新',409);
  const config=entry.data,source=entry.version.payload.source,survey=questionnaire(researchProject(body.root),source);
  const before=(await schemaAt(config.url,call,signal)).find(s=>s.id===config.sheetId);
  if(before?.schemaSha256!==config.schemaSha256)throw new AresError('答卷字段已变化，请重新建立映射',409);
  const raw=[],seenIds=new Set(),cursors=new Set();let offset='',rawSize=2;
  do{
    signal?.throwIfAborted();
    const batch=await call('list-records',{url:config.url,sheet_id:config.sheetId,page_size:100,offset,prefer_id:false,text_value:'original'},{signal});
    // WPS returns null rather than [] for a genuinely empty table.
    const records=batch?.records===null?[]:batch?.records;
    if(!Array.isArray(records))throw new AresError('金山答卷响应缺少实际记录列表',502);
    for(const row of records){
      if(typeof row?.id!=='string'||!row.id||seenIds.has(row.id)||!row.fields||typeof row.fields!=='object'||Array.isArray(row.fields))throw new AresError('金山答卷身份重复或结构无效，未保存部分结果',502);
      const size=Buffer.byteLength(JSON.stringify(row));rawSize+=size+1;
      seenIds.add(row.id);raw.push(row);if(raw.length>10000||size>65536||rawSize>4*1024*1024)throw new AresError('单次回收最多10000份、4MiB，每份64KiB，请在金山分表整理',413);
    }
    update({phase:'collecting',done:raw.length,total:null});
    offset=batch.offset??'';
    if(typeof offset!=='string'||offset&&cursors.has(offset))throw new AresError('金山分页游标重复或无效，未保存部分结果',502);
    if(offset)cursors.add(offset);
  }while(offset);
  const after=(await schemaAt(config.url,call,signal)).find(s=>s.id===config.sheetId);
  if(after?.schemaSha256!==config.schemaSha256)throw new AresError('回收期间表结构已变化，未采用部分结果',409);
  const rawBytes=Buffer.from(JSON.stringify(raw));if(rawBytes.length>4*1024*1024)throw new AresError('本次原始答卷超过4MiB，请分表回收',413);
  const compiled=inspectSurvey(survey.data),questions=survey.data.pages.flatMap(p=>p.questions);
  const previous=new Map(config.rows.map(row=>[row.sourceId,row]));
  const rows=raw.map(row=>{
    const answers=Object.fromEntries(questions.flatMap(q=>{
      const value=answer(row.fields[config.mapping[q.name]],q);return value===undefined?[]:[[q.name,value]];
    }));
    const evaluated=evaluateSurvey(compiled,answers,{rejectUnused:true}),sourceSha256=hash(row),prior=previous.get(row.id);
    const values=Object.values(answers).filter(v=>typeof v==='string');
    return {sourceId:row.id,sourceSha256,answers,errors:evaluated.errors,flags:values.length>=5&&new Set(values).size===1?['straight-line']:[],
      decision:prior?.sourceSha256===sourceSha256?prior.decision:'pending',reason:prior?.sourceSha256===sourceSha256?prior.reason:''};
  });
  const counts=new Map();for(const row of rows){const key=hash(row.answers);counts.set(key,(counts.get(key)||0)+1);}
  for(const row of rows){
    if(counts.get(hash(row.answers))>1)row.flags.push('duplicate-answers');
    const prior=previous.get(row.sourceId);
    if(prior&&hash(prior.flags)!==hash(row.flags)){row.decision='pending';row.reason='';}
  }
  const softwareTest=config.softwareTest||marker(raw),current=researchProject(body.root);
  signal?.throwIfAborted();
  return saveResearchVersion({root:body.root,id:entry.item.id,baseVersion:entry.version.id,expectedRevision:current.revision},{kind:'collection',title:entry.item.title,status:'awaiting-review',source,provenance:softwareTest?'synthetic':'collection',
    data:{...config,softwareTest,rows,rawObject:putProjectObject(body.root,rawBytes),pulledAt:now(),adoptedResponse:null}});
}
export function startCollection(jobs,body){
  if(body.approveRead!==true)throw new AresError('请确认本次读取金山答卷',403);
  const entry=requireKind(researchVersion(researchProject(body.root),body.id,body.versionId),'collection');
  return jobs.start(body,{kind:'collection',title:'金山答卷回收',source:{itemId:entry.item.id,versionId:entry.version.id}},async options=>{
    const saved=await pullCollection({...body,versionId:entry.version.id},options);
    return {itemId:saved.item.id,versionId:saved.version.id,count:saved.item?researchEntry(body.root,saved.item.id).data.rows.length:0};
  });
}
export function reviewCollection(body){
  let result;const project=changeProject(body,p=>{
    const entry=requireKind(researchVersion(p,body.id,body.versionId),'collection');
    if(entry.item.head!==entry.version.id||!Array.isArray(body.decisions)||!body.decisions.length||body.decisions.length>10000)throw new AresError('请打开最新回收版本并选择复核结果',409);
    const decisions=new Map(),ids=new Set(entry.data.rows.map(row=>row.sourceId));for(const row of body.decisions){
      if(!row||!ids.has(row.sourceId)||decisions.has(row.sourceId)||!['approved','rejected','pending'].includes(row.decision)||typeof row.reason!=='string'||row.reason.length>1200)throw new AresError('复核记录、决定或原因无效');
      decisions.set(row.sourceId,row);
    }
    const rows=entry.data.rows.map(row=>{
      const decision=decisions.get(row.sourceId);if(!decision)return row;
      if(decision.decision==='approved'&&(Object.keys(row.errors).length||row.flags.length&&!decision.reason.trim()))throw new AresError('无效答卷不能采用；可疑答卷须写明人工复核理由');
      return {...row,decision:decision.decision,reason:decision.reason.trim(),reviewedAt:now()};
    });
    result=writeResearchVersion(p,{id:entry.item.id,baseVersion:entry.version.id},{kind:'collection',title:entry.item.title,status:'reviewed',source:entry.version.payload.source,provenance:entry.version.payload.provenance,data:{...entry.data,rows,adoptedResponse:null}});
  });return {...result,revision:project.revision};
}
export function adoptCollection(body){
  if(body.confirmActual!==true)throw new AresError('请确认这些已复核答卷来自实际采集',403);
  let result;const project=changeProject(body,p=>{
    const entry=requireKind(researchVersion(p,body.id,body.versionId),'collection');
    if(entry.item.head!==entry.version.id||entry.data.adoptedResponse)throw new AresError('回收版本已变化或已经采用',409);
    if(entry.data.softwareTest||entry.version.payload.provenance==='synthetic')throw new AresError('软件测试或模拟答卷不能登记为实际样本',403);
    const selected=entry.data.rows.filter(row=>row.decision==='approved');
    if(!selected.length||entry.data.rows.some(row=>row.decision==='pending'))throw new AresError('请逐份完成复核，并至少采用一份有效答卷');
    result=writeSurveyResponses(p,{id:entry.version.payload.source.itemId,versionId:entry.version.payload.source.versionId,content:JSON.stringify(selected.map(row=>row.answers)),format:'json',origin:entry.data.url+' · '+entry.data.sheetName},
      {lineage:{collectionId:entry.item.id,versionId:entry.version.id,rawObject:entry.data.rawObject,sourceIds:selected.map(row=>row.sourceId),excludedIds:entry.data.rows.filter(row=>row.decision==='rejected').map(row=>row.sourceId)}});
    writeResearchVersion(p,{id:entry.item.id,baseVersion:entry.version.id},{kind:'collection',title:entry.item.title,status:'adopted',source:entry.version.payload.source,provenance:entry.version.payload.provenance,data:{...entry.data,adoptedResponse:{itemId:result.item.id,versionId:result.version.id}}});
  });return {...result,revision:project.revision};
}
