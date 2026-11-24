import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {existsSync,statSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AresError,atomicJson,hash,readJson,safePath} from './storage.js';
import {fileHash} from './research-files.js';
import {researchProject,saveResearchVersion} from './project-research.js';
import {blankInterview} from './research-interviews.js';
import {interviewMedia} from './research-media.js';
import {previousResearchJob} from './research-jobs.js';
import {putProjectObject} from './project-objects.js';

const runner=fileURLToPath(new URL('../scripts/research_transcribe.py',import.meta.url));
const MAX_SEGMENTS=6000,MAX_TRANSCRIPT_BYTES=4*1024*1024;
const errorCodes={
  'model-incomplete':'本地模型缺少 config.json、model.bin 或 tokenizer.json',
  'alignment-model-incomplete':'未配置完整的本地 WhisperX 对齐模型',
  'diarization-model-incomplete':'未配置本地 WhisperX 说话人管线',
  'engine-unavailable':'本地 Python 环境未安装 faster-whisper 或其运行库',
  'optional-engine-unavailable':'本地 Python 环境缺少 WhisperX 或模型运行库',
  'processing-error':'离线音频识别失败，请检查模型权重、运行库或设备资源'
};
const checkpointPath=(root,id)=>safePath(root,'.ares/research/checkpoints/'+id+'.json');
function absoluteConfig(name,folder=false) {
  const path=process.env[name];
  if(!path||!isAbsolute(path))return null;
  try {return (folder?statSync(path).isDirectory():statSync(path).isFile())?path:null;}catch {return null;}
}
export function asrCapability() {
  const model=absoluteConfig('ARES_WHISPER_MODEL',true);
  return {engine:'faster-whisper',modelConfigured:!!model,offline:true,
    alignmentConfigured:!!absoluteConfig('ARES_WHISPERX_ALIGN_MODEL',true),
    diarizationConfigured:!!absoluteConfig('ARES_WHISPERX_DIARIZATION_CONFIG')};
}
function normalizeWorkerSegment(row) {
  if(!Number.isSafeInteger(row.start)||!Number.isSafeInteger(row.end)||row.start<0||row.end<=row.start||
    typeof row.text!=='string'||!row.text.trim()||row.text.length>10000||!Array.isArray(row.words)||row.words.length>4500)
    throw new AresError('转写过程返回了无效片段',422);
  return {start:row.start,end:row.end,text:row.text,speaker:typeof row.speaker==='string'?row.speaker.slice(0,80):'',uncertain:row.uncertain===true,
    words:row.words.filter(word=>Number.isSafeInteger(word.start)&&Number.isSafeInteger(word.end)&&word.start>=0&&word.end>=word.start&&typeof word.text==='string')
      .map(word=>({start:word.start,end:word.end,text:word.text.slice(0,200)}))};
}
function signatures(settings) {
  const model=absoluteConfig('ARES_WHISPER_MODEL',true);
  if(!model)throw new AresError('请由宿主设置 ARES_WHISPER_MODEL 指向已安装的本地模型目录',503);
  if(['config.json','model.bin','tokenizer.json'].some(file=>!existsSync(join(model,file))))
    throw new AresError(errorCodes['model-incomplete'],503);
  const align=settings.align?absoluteConfig('ARES_WHISPERX_ALIGN_MODEL',true):null;
  const diarization=settings.diarization?absoluteConfig('ARES_WHISPERX_DIARIZATION_CONFIG'):null;
  if(settings.align&&!align)throw new AresError(errorCodes['alignment-model-incomplete'],503);
  if(settings.diarization&&!diarization)throw new AresError(errorCodes['diarization-model-incomplete'],503);
  return {model,align,diarization};
}
async function transcribe(root,media,file,settings,job,previous,signal,update) {
  const {model,align,diarization}=signatures(settings);
  const identity=hash(await Promise.all(['model.bin','config.json','tokenizer.json'].map(name=>fileHash(join(model,name),signal))));
  const checkpointKey=hash({identity,source:media.sha256,device:settings.device,language:settings.language});
  const candidate=previous?.checkpoint?.key===checkpointKey?checkpointPath(root,previous.id):null;
  const previousCheckpoint=candidate?readJson(candidate,null):null;
  const reuse=previousCheckpoint?.key===checkpointKey&&previousCheckpoint.segments.length>0;
  const segments=reuse?previousCheckpoint.segments.map(normalizeWorkerSegment):[],aligned=[];
  let language=reuse?previousCheckpoint.language:'',serialized=Buffer.byteLength(JSON.stringify(segments));
  let lastCount=0,errorCode,finished=false,alignedMode=false;
  const ownCheckpoint=checkpointPath(root,job.id);
  const saveCheckpoint=()=>{
    if(!segments.length)return;
    atomicJson(ownCheckpoint,{key:checkpointKey,source:media.sha256,language,segments});
    lastCount=segments.length;
    update({phase:'transcribing',done:segments.at(-1).end,total:Math.round(media.duration*1000)},{key:checkpointKey,count:lastCount});
  };
  if(reuse)saveCheckpoint();
  const ffmpeg=process.env.ARES_FFMPEG;
  if(ffmpeg&&!isAbsolute(ffmpeg))throw new AresError('媒体工具路径需要是本机的绝对路径',503);
  const args=[runner,'--media',file,'--model',model,'--device',settings.device,'--duration',String(media.duration),
    '--demux',media.demux,'--ffmpeg',ffmpeg||'ffmpeg'];
  if(settings.language)args.push('--language',settings.language);
  if(reuse)args.push('--resume',ownCheckpoint);
  if(align)args.push('--align',align);
  if(diarization)args.push('--diarization',diarization);
  const env={...process.env,PYTHONIOENCODING:'utf-8',HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1',HF_HUB_DISABLE_TELEMETRY:'1'};
  for(const key of Object.keys(env))if(/(?:token|api.?key|secret|passw|credential)/i.test(key))delete env[key];
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(3*60*60*1000)]);
  const child=spawn(absoluteConfig('ARES_ASR_PYTHON')||'python',args,{env,windowsHide:true,stdio:['ignore','pipe','ignore'],signal:deadline});
  const exit=new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('close',code=>resolve({code}));});
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  try{
    for await(const line of lines){
      if(line.length>MAX_TRANSCRIPT_BYTES)throw new AresError('单条转写输出过大',413);
      let row;try{row=JSON.parse(line);}catch{continue;}
      if(row.kind==='info'){language=row.language;update({phase:'transcribing',total:row.duration});}
      if(row.kind==='error')errorCode=row.code;
      if(row.kind==='progress')update({phase:'transcribing',done:row.position,total:Math.round(media.duration*1000)});
      if(row.kind==='aligning'){saveCheckpoint();update({phase:'aligning',done:0,total:null});}
      if(row.kind==='done'){finished=true;alignedMode=row.aligned===true;}
      if(row.kind!=='segment'&&row.kind!=='aligned-segment')continue;
      const normalized=normalizeWorkerSegment(row);
      const list=row.kind==='segment'?segments:aligned;
      serialized+=Buffer.byteLength(JSON.stringify(normalized));
      if(serialized>MAX_TRANSCRIPT_BYTES||list.length>=MAX_SEGMENTS)throw new AresError('转写片段过多，请分段导入媒体',413);
      list.push(normalized);
      if(row.kind==='segment'){
        if(segments.length-lastCount>=5||segments.length===1)saveCheckpoint();
        else update({phase:'transcribing',done:normalized.end,total:Math.round(media.duration*1000)});
      }
    }
  }catch(error){child.kill();await exit;throw error;}
  finally{lines.close();if(segments.length!==lastCount)saveCheckpoint();}
  const result=await exit;
  signal.throwIfAborted();
  if(result.code!==0||!finished)throw new AresError(errorCodes[errorCode]||(result.error?.code==='ENOENT'?'未找到本地 Python 转写运行环境':'转写进程中断或超时'),422);
  const rows=alignedMode?aligned:segments;
  if(!rows.length)throw new AresError('未识别到可用语句，请核对音轨和语种',422);
  return {rows,identity,language,engine:alignedMode?'faster-whisper + WhisperX':'faster-whisper',resumedFrom:reuse?previous.id:null};
}

export function startTranscription(jobs,body) {
  if(body.confirmLocal!==true)throw new AresError('请确认允许在本机使用所选音视频运行转写',403);
  const project=researchProject(body.root);
  const previous=body.retryId?previousResearchJob(project.root,body.retryId,'transcription'):null;
  const language=body.language??previous?.settings.language??'';
  if(typeof language!=='string'||language&&!/^[a-z]{2,3}$/.test(language))throw new AresError('语种需留空或使用语言短代码');
  const settings={language,device:body.device??previous?.settings.device??'cpu',
    align:body.align??previous?.settings.align??false,diarization:body.diarization??previous?.settings.diarization??false};
  if(!['cpu','cuda'].includes(settings.device)||typeof settings.align!=='boolean'||typeof settings.diarization!=='boolean'||settings.diarization&&!settings.align)
    throw new AresError('请选择有效设备和对齐方式');
  const source=previous?.source??{itemId:body.id,versionId:body.versionId};
  if(typeof source.itemId!=='string'||typeof source.versionId!=='string')throw new AresError('请选择已保存的原始音视频版本');
  return jobs.start(body,{kind:'transcription',title:'本地音视频转写',settings,previous,source},async({job,signal,update})=>{
    const {entry,media,file}=await interviewMedia(project.root,source.itemId,source.versionId,signal,true);
    const result=await transcribe(project.root,media,file,settings,job,previous,signal,update);
    update({phase:'publishing'});signal.throwIfAborted();
    const transcript=result.rows.map(row=>({id:'s'+randomUUID().replaceAll('-','').slice(0,16),
      speaker:row.speaker,start:row.start,end:row.end,original:row.text,words:row.words,uncertain:row.uncertain
    }));
    const original=putProjectObject(project.root,Buffer.from(JSON.stringify({engine:result.engine,language:result.language,segments:transcript})));
    const data={...blankInterview(entry.data.meta,{media,source:original,transcript,sourceLabel:'transcription'}),
      recognition:{jobId:job.id,engine:result.engine,language:result.language,modelFingerprint:result.identity,resumedFrom:result.resumedFrom}};
    const current=researchProject(project.root);
    const saved=saveResearchVersion({root:project.root,expectedRevision:current.revision},{
      kind:'interview',title:entry.item.title.slice(0,147)+' · 转写',status:'needs-review',provenance:'source-material',data,source
    });
    return {itemId:saved.item.id,versionId:saved.version.id,segments:transcript.length,engine:result.engine,modelFingerprint:result.identity,resumedFrom:result.resumedFrom};
  });
}
