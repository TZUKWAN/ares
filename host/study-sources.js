import {execFile} from 'node:child_process';
import {lookup} from 'node:dns/promises';
import {readFileSync,statSync} from 'node:fs';
import {request} from 'node:https';
import {extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {AresError,hash,safePath} from './storage.js';
import {sensitiveFile} from './project-artifacts.js';
import {putProjectObject,readProjectObject,objectPath} from './project-objects.js';
import {researchProject} from './project-research.js';
import {extensionUrl,publicAddress} from './extension-network.js';

const LIMIT=4*1024*1024;
const inspector=fileURLToPath(new URL('../scripts/inspect_artifact.py',import.meta.url));
const extractHtml='from html.parser import HTMLParser\nimport sys,json\nclass Reader(HTMLParser):\n def __init__(self): super().__init__(); self.hidden=0; self.parts=[]\n def handle_starttag(self,t,a):\n  if t in ("script","style","noscript"): self.hidden+=1\n  if t in ("p","br","div","li","h1","h2","h3","tr"): self.parts.append("\\n")\n def handle_endtag(self,t):\n  if t in ("script","style","noscript"): self.hidden=max(0,self.hidden-1)\n def handle_data(self,s):\n  if not self.hidden: self.parts.append(s)\nr=Reader();r.feed(sys.stdin.read());print(json.dumps({"valid":True,"text":"".join(r.parts)},ensure_ascii=False))';

async function remoteSource(address,{signal}={}) {
  const first=extensionUrl(address),lifetime=AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])]);
  let url=first;
  for(let hop=0;hop<4;hop++){
    lifetime.throwIfAborted();
    if(url.origin!==first.origin)throw new AresError('原文重定向到其他网站，请直接填写最终公开地址',403);
    const addresses=await lookup(url.hostname,{all:true});lifetime.throwIfAborted();
    if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw new AresError('原文地址解析到私网或保留地址',403);
    const selected=addresses[0];
    const response=await new Promise((resolve,reject)=>{
      const outgoing=request(url,{signal:lifetime,agent:false,headers:{accept:'text/html,application/pdf,text/plain','user-agent':'ARES-study/1.0','accept-encoding':'identity'},
        lookup:(_host,options,callback)=>options?.all?callback(null,[selected]):callback(null,selected.address,selected.family)},resolve);
      outgoing.on('error',()=>reject(new AresError('原文网页读取失败，请导入本机原文文件',502)));outgoing.end();
    });
    if([301,302,303,307,308].includes(response.statusCode)){
      response.destroy();if(!response.headers.location)break;
      url=extensionUrl(new URL(response.headers.location,url).href);continue;
    }
    if(response.statusCode!==200){response.destroy();throw new AresError('原文网页返回 HTTP '+response.statusCode,502);}
    const parts=[];let count=0;
    for await(const part of response){count+=part.length;if(count>LIMIT){response.destroy();throw new AresError('原文文件超过4MiB，请选用精简原文');}parts.push(part);}
    const mime=String(response.headers['content-type']||'');
    return {bytes:Buffer.concat(parts),format:mime.includes('pdf')?'pdf':mime.includes('html')?'html':mime.includes('text/plain')?'txt':extname(url.pathname).slice(1),url:url.href};
  }
  throw new AresError('原文网页重定向超过限制',502);
}
async function parseSource(root,source,signal) {
  const path=objectPath(root,source.object.sha256),args=source.format==='html'?['-c',extractHtml]:[inspector,path,'--format',source.format];
  const value=await new Promise((resolve,reject)=>{
    const child=execFile('python',args,{windowsHide:true,encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,
      env:{...process.env,PYTHONIOENCODING:'utf-8'},signal},(error,stdout)=>{
      if(error)return reject(new AresError('原文读取失败，请确认文档可提取文本且依赖已安装',422));
      try{resolve(JSON.parse(stdout));}catch{reject(new AresError('原文解析结果无效',422));}
    });
    child.stdin?.on('error',()=>{});child.stdin?.end(source.format==='html'?readProjectObject(root,source.object.sha256).toString('utf8'):undefined);
  });
  if(!value.valid||!value.text?.trim()||value.text.length>=300000||value.details?.textTruncated)throw new AresError('原文为空或提取被截断，请导入完整可读原文',422);
  return value.text.replace(/\r\n?/g,'\n');
}
/** Extract only an already verified immutable work object, without consulting its mutable working path. */
export async function studyObjectText(root,object,format,{signal}={}) {
  const bytes=readProjectObject(root,object.sha256);
  if(!bytes.length||bytes.length>LIMIT||!['txt','md','pdf','docx','pptx','xlsx','csv','json'].includes(format))
    throw new AresError('请选择4MiB以内可提取文字的已固定文档或数据作品');
  const text=await parseSource(root,{object,format},signal);
  return {textObject:putProjectObject(root,Buffer.from(text)),textSha256:hash(text)};
}
export async function captureStudySource(body,{signal}={}) {
  const p=researchProject(body.root);let bytes,format,name,url=null,sourcePath=null;
  if(body.url){
    if(body.approveNetwork!==true)throw new AresError('请确认本次读取公开原文网页',403);
    const remote=await remoteSource(body.url,{signal});({bytes,format,url}=remote);name=new URL(url).pathname.split('/').pop()||'网页原文';
  }else if(body.sourcePath){
    if(sensitiveFile(body.sourcePath))throw new AresError('不能将内部或凭据文件登记为原文');
    const path=safePath(p.root,body.sourcePath,{existing:true});
    if(!statSync(path).isFile()||statSync(path).size>LIMIT)throw new AresError('原文须为4MiB以内的文件');
    bytes=readFileSync(path);format=extname(path).slice(1).toLowerCase();name=body.sourcePath;sourcePath=body.sourcePath;
  }else{
    name=String(body.fileName||'原文.txt').slice(0,200);format=extname(name).slice(1).toLowerCase();
    if(typeof body.contentBase64==='string'){
      bytes=Buffer.from(body.contentBase64,'base64');
      if(bytes.toString('base64')!==body.contentBase64)throw new AresError('原文上传编码无效');
    }else if(typeof body.text==='string'){bytes=Buffer.from(body.text);format='txt';}
    else throw new AresError('请选择原文文件、项目路径或网页');
  }
  if(!bytes.length||bytes.length>LIMIT||!['txt','md','pdf','docx','html','htm','csv','json'].includes(format))throw new AresError('原文须为4MiB以内的文本、PDF、Word或网页文件');
  if(format==='htm')format='html';
  const object=putProjectObject(p.root,bytes),source={name,format,object,url,sourcePath};
  const text=await parseSource(p.root,source,signal);
  return {...source,textObject:putProjectObject(p.root,Buffer.from(text)),text,textSha256:hash(text)};
}
