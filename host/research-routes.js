import {readFileSync} from 'node:fs';
import {Readable} from 'node:stream';
import {AresError} from './storage.js';
import {researchIndex,researchEntry,bindResearch} from './project-research.js';
import {createResearchJobs,getResearchJob,listResearchJobs} from './research-jobs.js';
import {saveInterviewGuide,importInterview,interviewSource,correctInterview,saveCodebook,applyCodes,analyzeInterviews,acceptCodingProposal,searchInterviewCodes,linkInterviewMedia} from './research-interviews.js';
import {importInterviewMedia,streamInterviewMedia,interviewWaveform} from './research-media.js';
import {asrCapability,startTranscription} from './research-asr.js';
import {createDatasetTools,streamDatasetFile,profileDataset} from './research-datasets.js';
import {importSurveyResponses,pretestPlan,startSurveyPretest,saveSurvey} from './research-surveys.js';
import {researchExport,researchWorkDraft} from './research-exports.js';
import {buildExtension,listExtensions,surveyExtension,toggleExtension} from './project-extensions.js';
import {importRequirements,saveRequirements,adoptRequirements,requirementsCoverage} from './study-requirements.js';
import {readProjectObject} from './project-objects.js';
import {saveFact,registerFactReference,projectEvidence,previewFactUpdate,applyFactUpdate} from './study-evidence.js';
import {startAnalysis,compareExperiments,previewScriptAnalysis,prepareScriptAnalysis,collectScriptAnalysis,previewExperimentData} from './study-experiments.js';
import {inspectCollection,saveCollection,startCollection,reviewCollection,adoptCollection} from './study-collection.js';
import {defenseContext,prepareDefense,adoptDefense,saveDefenseAnswers,defenseFollowup,resolveDefenseFollowup} from './study-defense.js';
import {reuseCatalog,reuseTargets,previewReuse,applyReuse,resumeReuse} from './study-reuse.js';

async function framedUpload(request) {
  const input=request[Symbol.asyncIterator]();
  let pending=Buffer.alloc(0),size;
  while(size===undefined||pending.length<4+size){
    const next=await input.next();
    if(next.done)throw new AresError('媒体导入信息不完整');
    pending=Buffer.concat([pending,next.value]);
    if(size===undefined&&pending.length>=4){
      size=pending.readUInt32BE(0);
      if(size<2||size>65536)throw new AresError('媒体导入信息无效');
    }
  }
  let meta;
  try {meta=JSON.parse(pending.subarray(4,4+size).toString('utf8'));}
  catch {throw new AresError('媒体导入信息无效');}
  if(!meta||!Number.isSafeInteger(meta.bytes)||request.headers['content-length']&&Number(request.headers['content-length'])!==meta.bytes+4+size)
    throw new AresError('媒体大小声明不一致',411);
  const source=Readable.from((async function*(){
    if(pending.length>4+size)yield pending.subarray(4+size);
    pending=null;
    try{for(let item=await input.next();!item.done;item=await input.next())yield item.value;}
    finally{await input.return?.();}
  })());
  return {meta,source};
}
export function registerResearchRoutes(route,stream,{transport}={}) {
  const jobs=createResearchJobs(),datasets=createDatasetTools(jobs,{transport});
  const path='/ares/api/v2/research/';
  const get=(name,fn)=>route(path+name,'GET',fn);
  const post=(name,fn)=>route(path+name,'POST',fn);
  get('index',query=>researchIndex(query.get('root')));
  get('entry',query=>researchEntry(query.get('root'),query.get('id'),query.get('versionId')));
  post('bind',data=>bindResearch(data));
  post('work-draft',data=>researchWorkDraft(data));
  post('study/requirements/import',(data,_req,options)=>importRequirements(data,options));
  post('study/requirements/save',data=>saveRequirements(data));
  post('study/requirements/adopt',data=>adoptRequirements(data));
  get('study/requirements',query=>({items:requirementsCoverage(query.get('root'))}));
  post('study/fact',data=>saveFact(data));
  get('study/evidence',query=>projectEvidence(query.get('root')));
  post('study/reference',data=>registerFactReference(data));
  post('study/reference/preview',data=>previewFactUpdate(data));
  post('study/reference/apply',data=>applyFactUpdate(data));
  post('study/experiment/run',data=>startAnalysis(jobs,data));
  post('study/experiment/data',data=>previewExperimentData(data));
  post('study/experiment/compare',data=>compareExperiments(data));
  post('study/experiment/script/preview',data=>previewScriptAnalysis(data));
  post('study/experiment/script/prepare',data=>prepareScriptAnalysis(data));
  post('study/experiment/script/collect',data=>collectScriptAnalysis(data));
  post('study/collection/inspect',(data,_req,options)=>inspectCollection(data,options));
  post('study/collection/connect',(data,_req,options)=>saveCollection(data,options));
  post('study/collection/pull',data=>startCollection(jobs,data));
  post('study/collection/review',data=>reviewCollection(data));
  post('study/collection/adopt',data=>adoptCollection(data));
  get('study/defense',query=>defenseContext(query.get('root')));
  post('study/defense/prepare',(data,_req,options)=>prepareDefense(data,options));
  post('study/defense/adopt',data=>adoptDefense(data));
  post('study/defense/answers',data=>saveDefenseAnswers(data));
  post('study/defense/followup',data=>defenseFollowup(data));
  post('study/defense/followup/resolve',data=>resolveDefenseFollowup(data));
  get('study/reuse/catalog',query=>reuseCatalog(query.get('root')));
  post('study/reuse/targets',data=>reuseTargets(data));
  post('study/reuse/preview',data=>previewReuse(data));
  post('study/reuse/apply',data=>applyReuse(data));
  post('study/reuse/resume',data=>resumeReuse(data));
  stream(path+'study/source','GET',(query,_req,res)=>{
    const entry=researchEntry(query.get('root'),query.get('id'),query.get('versionId'));
    const source=entry.data.source;
    if(!source?.object)throw new AresError('此研究记录没有原文快照',404);
    const bytes=readProjectObject(query.get('root'),source.object.sha256);
    res.writeHead(200,{'content-type':source.format==='pdf'?'application/pdf':'application/octet-stream',
      'content-length':bytes.length,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(source.name.split(/[\\/]/).pop()).replace(/'/g,'%27'),
      'cache-control':'no-store','x-content-type-options':'nosniff'});
    return Readable.from([bytes]);
  });
  get('jobs',query=>({jobs:listResearchJobs(query.get('root'))}));
  get('job',query=>({job:getResearchJob(query.get('root'),query.get('id'))}));
  post('job/cancel',data=>jobs.cancel(data.root,data.id));
  get('interview/asr',()=>({asr:asrCapability()}));
  post('interview/guide',data=>saveInterviewGuide(data));
  post('interview/import',data=>importInterview(data));
  post('interview/correct',data=>correctInterview(data));
  post('interview/codebook',data=>saveCodebook(data));
  post('interview/codes',data=>applyCodes(data));
  post('interview/accept-codes',data=>acceptCodingProposal(data));
  post('interview/analyze',data=>analyzeInterviews(data));
  post('interview/search',data=>searchInterviewCodes(data));
  post('interview/link-media',data=>linkInterviewMedia(data));
  post('interview/transcribe',data=>startTranscription(jobs,data));
  post('interview/waveform',(data,_req,options)=>interviewWaveform(data,options));
  stream(path+'interview/media','GET',streamInterviewMedia);
  stream(path+'interview/original','GET',(query,_req,res)=>{
    const root=query.get('root'),id=query.get('id'),versionId=query.get('versionId');
    const entry=researchEntry(root,id,versionId),synthetic=entry.version.payload.provenance==='synthetic';
    const bytes=interviewSource(root,id,versionId);
    res.writeHead(200,{'content-type':'text/plain; charset=utf-8','content-length':bytes.length,
      'content-disposition':'attachment; filename='+(synthetic?'ARES_SYNTHETIC_':'')+'original-transcript.txt','cache-control':'no-store','x-content-type-options':'nosniff'});
    return Readable.from([bytes]);
  });
  stream(path+'interview/upload','POST',async(query,req,res,options)=>{
    if(req.headers['content-type']!=='application/octet-stream')throw new AresError('媒体上传需要原始字节流',415);
    const {meta,source}=await framedUpload(req);
    const result=await importInterviewMedia({...meta,root:query.get('root')},source,options);
    res.writeHead(200,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
    return Readable.from([JSON.stringify({ok:true,...result})]);
  });
  post('dataset/search',(data,_req,options)=>datasets.search(data,options));
  post('dataset/details',(data,_req,options)=>datasets.details(data,options));
  post('dataset/download',data=>datasets.download(data));
  post('dataset/profile',(data,_req,options)=>profileDataset(data,options));
  stream(path+'dataset/file','GET',streamDatasetFile);
  post('survey/save',data=>saveSurvey(data));
  post('survey/responses',data=>importSurveyResponses(data));
  post('survey/pretest-plan',data=>pretestPlan(researchEntry(data.root,data.id,data.versionId).data,data));
  post('survey/pretest',data=>startSurveyPretest(jobs,data));
  post('survey/enable-pretest',data=>{
    if (data.approve!==true) throw new AresError('请明确启用项目问卷预测试能力',403);
    const current=listExtensions(data.root).extensions.find(row=>row.id===surveyExtension.id);
    if(current&&current.kind!=='survey-generator')throw new AresError('现有子插件不是问卷预测试引擎',409);
    const project=current?toggleExtension({...data,id:current.id,manifestHash:current.manifestHash,enabled:true}):buildExtension({...data,manifest:surveyExtension,enabled:true}).project;
    return {revision:project.revision};
  });
  stream(path+'export','GET',(query,_request,res)=>{
    const file=researchExport({root:query.get('root'),id:query.get('id'),versionId:query.get('versionId'),format:query.get('format')});
    res.writeHead(200,{'content-type':file.contentType,'content-length':file.bytes.length,'x-content-type-options':'nosniff',
      'cache-control':'no-store','content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(file.filename).replace(/'/g,'%27')});
    return Readable.from([file.bytes]);
  });
  for (const file of ['research-center.js','research-survey-ui.js','research-survey-model.js','research-interview-ui.js','research-guide-ui.js','research-code-ui.js','research-ui.js','research-dataset-ui.js','project-study-ui.js','study-requirements-ui.js','study-evidence-ui.js','study-experiments-ui.js','study-collection-ui.js','study-defense-ui.js','study-reuse-ui.js'])
    route('/ares/api/v2/'+file,'GET',()=>readFileSync(new URL('../client/'+file,import.meta.url),'utf8'),'text/javascript; charset=utf-8');
  return jobs.dispose;
}
