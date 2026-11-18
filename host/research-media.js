import {execFile,spawn} from 'node:child_process';
import {createReadStream} from 'node:fs';
import {basename,extname,isAbsolute} from 'node:path';
import {promisify} from 'node:util';
import {AresError} from './storage.js';
import {researchProject,researchVersion,requireKind,saveResearchVersion} from './project-research.js';
import {blankInterview,interviewMeta} from './research-interviews.js';
import {checkResearchFile,publishResearchFile,withResearchFile} from './research-files.js';

const exec=promisify(execFile),MAX_SECONDS=3*60*60,MEDIA_LIMIT=2*1024*1024*1024;
const formats={
  wav:{demux:'wav',mime:'audio/wav'},mp3:{demux:'mp3',mime:'audio/mpeg'},flac:{demux:'flac',mime:'audio/flac'},
  ogg:{demux:'ogg',mime:'audio/ogg'},m4a:{demux:'mov',mime:'audio/mp4'},mp4:{demux:'mov',mime:'video/mp4'},
  mov:{demux:'mov',mime:'video/quicktime'},webm:{demux:'matroska',mime:'video/webm'},
};
function mediaType(name) {
  if(typeof name!=='string'||name.length>180||name!==basename(name)||/[\\/\0-\x1f]/.test(name))throw new AresError('媒体文件名称无效');
  const extension=extname(name).toLowerCase().slice(1);
  if(!Object.hasOwn(formats,extension))throw new AresError('请选择支持的 WAV、MP3、FLAC、OGG、M4A、MP4、MOV 或 WebM');
  return {extension,...formats[extension]};
}
function executable(variable,command) {
  const value=process.env[variable];
  if(value&&!isAbsolute(value))throw new AresError('媒体工具路径需要是本机的绝对路径',503);
  return value||command;
}
const inputArgs=(demux,file)=>['-protocol_whitelist','file,pipe','-f',demux,'-i',file];
async function probe(path,{demux},signal) {
  try {
    const {stdout}=await exec(executable('ARES_FFPROBE','ffprobe'),[
      '-v','error',...inputArgs(demux,path),'-show_entries','format=duration:stream=codec_type','-of','json'
    ],{signal,timeout:20000,windowsHide:true,maxBuffer:128*1024});
    const value=JSON.parse(stdout),seconds=Number(value.format?.duration);
    if(!value.streams?.some(row=>row.codec_type==='audio')||!Number.isFinite(seconds)||seconds<=0||seconds>MAX_SECONDS)
      throw new AresError('媒体需要有音轨，时长须在3小时内');
    return {duration:seconds,video:value.streams.some(row=>row.codec_type==='video')};
  }catch(error){
    signal?.throwIfAborted();
    if(error instanceof AresError)throw error;
    if(error.code==='ENOENT')throw new AresError('音视频导入需要已安装的 ffprobe',503);
    throw new AresError('无法读出此文件的音频流或时长');
  }
}
export async function importInterviewMedia(body,source,{signal}={}) {
  if(body.confirmLocal!==true)throw new AresError('请确认仅把选中的音视频导入本机项目',403);
  const p=researchProject(body.root);
  if(p.revision!==body.expectedRevision)throw new AresError('项目已更新，请刷新后重试',409);
  const type=mediaType(body.name),meta=interviewMeta(body);
  const guide=body.guideId?requireKind(researchVersion(p,body.guideId,body.guideVersion),'guide'):null;
  if(guide?.version.payload.status==='proposal')throw new AresError('请先采用访谈提纲');
  return withResearchFile(p.root,source,{signal,limit:MEDIA_LIMIT,size:body.bytes},async(temp,file)=>{
    const metadata=await probe(temp,type,signal);
    const saved=await publishResearchFile(p.root,temp,file,'media',type.extension,signal);
    const media={...saved,...type,...metadata,name:body.name,storage:'local'};
    return saveResearchVersion(body,{
      kind:'interview',title:meta.title,status:'media-ready',provenance:'source-material',
      source:guide?{itemId:guide.item.id,versionId:guide.version.id}:null,
      data:blankInterview(meta,{media,sourceLabel:'media'})
    });
  });
}
export async function interviewMedia(root,id,versionId,signal,integrity=false) {
  const project=researchProject(root),entry=requireKind(researchVersion(project,id,versionId),'interview'),media=entry.data.media;
  if(!media)throw new AresError('访谈没有关联音视频',404);
  const file=await checkResearchFile(project.root,media,'media',signal,{integrity});
  return {project,entry,media,file};
}
export async function streamInterviewMedia(query,request,response,{signal}) {
  const {media,file}=await interviewMedia(query.get('root'),query.get('id'),query.get('versionId'),signal);
  const range=request.headers.range,headers={'content-type':media.mime,'cache-control':'private, no-store',
    'x-content-type-options':'nosniff','accept-ranges':'bytes','cross-origin-resource-policy':'same-origin'};
  let start=0,end=media.bytes-1;
  if(range){
    const match=/^bytes=(\d*)-(\d*)$/.exec(range);
    if(match&&(match[1]||match[2])){
      if(match[1]) { start=Number(match[1]);if(match[2])end=Math.min(end,Number(match[2])); }
      else start=Math.max(0,media.bytes-Number(match[2]));
    }else start=media.bytes;
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=media.bytes){
      response.writeHead(416,{...headers,'content-range':'bytes */'+media.bytes});return;
    }
  }
  response.writeHead(range?206:200,{...headers,'content-length':end-start+1,...(range?{'content-range':'bytes '+start+'-'+end+'/'+media.bytes}:{})});
  return createReadStream(file,{start,end,signal});
}
export async function interviewWaveform(body,{signal}={}) {
  const {media,file}=await interviewMedia(body.root,body.id,body.versionId,signal);
  const count=200,bins=Array(count).fill(0),rate=800,per=Math.max(1,Math.ceil(media.duration*rate/count)),timeout=AbortSignal.timeout(45000);
  const cancel=signal?AbortSignal.any([signal,timeout]):timeout;
  const child=spawn(executable('ARES_FFMPEG','ffmpeg'),['-v','error','-nostdin',...inputArgs(media.demux,file),'-vn','-map','0:a:0','-t',String(Math.min(MAX_SECONDS,media.duration+1)),
    '-ac','1','-ar',String(rate),'-c:a','pcm_s16le','-f','s16le','pipe:1'],{signal:cancel,windowsHide:true,stdio:['ignore','pipe','ignore']});
  const exit=new Promise(resolve=>{child.once('error',error=>resolve({error}));child.once('close',code=>resolve({code}));});
  let samples=0,carry=null;
  function record(value) {const slot=Math.min(count-1,Math.floor(samples/per));bins[slot]=Math.max(bins[slot],Math.abs(value)/32768);samples++;}
  try{
    for await(const bytes of child.stdout){
      let offset=0;
      if(carry!==null&&bytes.length){const value=carry|bytes[0]<<8;record(value>=32768?value-65536:value);offset=1;carry=null;}
      while(offset+1<bytes.length){record(bytes.readInt16LE(offset));offset+=2;}
      if(offset<bytes.length)carry=bytes[offset];
    }
  }catch(error){child.kill();if(error.name==='AbortError')throw error;}
  const result=await exit;
  if(result.code!==0||!samples)throw new AresError(result.error?.code==='ENOENT'?'波形读取需要本机 ffmpeg':'音频波形解码失败或超时',422);
  return {bins,duration:media.duration,sha256:media.sha256};
}
