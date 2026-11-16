/** Real registered artifacts only. No model, document execution, network or acceptance. */
import {readFileSync,statSync,existsSync,readdirSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {join,extname,relative} from 'node:path';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ROOT} from './catalog.js?v=2.3.0-directory1';
import {AresError,hash,safePath,readJson} from './storage.js';
import {readProject,changeProject,inspectOutput,sourceFiles,inputHash} from './projects.js?v=2.3.0-directory1';
import {sensitiveFile,artifactVersion,captureCheckedArtifact,projectEvent} from './project-artifacts.js';
import {putProjectObject,readProjectObject} from './project-objects.js';

const MAX_BYTES=32*1024*1024,MAX_TEXT=1024*1024;
const editable=new Set(['.md','.txt','.json','.csv','.tsv','.html','.htm','.css','.js','.mjs','.ts','.tsx','.jsx','.py','.r','.R','.sql','.yaml','.yml','.toml','.xml','.tex','.bib']);
const office=new Set(['.docx','.pptx','.xlsx','.doc','.ppt','.xls']);
const images=new Map([['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.gif','image/gif'],['.webp','image/webp']]);
const norm=value=>value.split('\\').join('/');
const requestKey=body=>JSON.stringify([body.root,body.id,body.file||'',body.versionId||'']);
function outputSource(body){
 const project=readProject(body.root);if(project.kind!=='v2')throw new AresError('请先建立新版竞赛项目');
 const all=project.workflow.steps.flatMap(step=>step.outputs),selected=all.find(row=>row.id===body.id);if(!selected)throw new AresError('作品不属于当前项目',403);
 const output=selected.kind==='section'?all.find(row=>row.id===selected.parentId):selected;if(!output)throw new AresError('章节父作品不存在',409);
 const step=project.workflow.steps.find(row=>row.outputs.some(value=>value.id===output.id));
 const path=norm(join(project.outputDir,output.path));if(sensitiveFile(path))throw new AresError('凭据文件不能预览',403);
 let child='';if(body.file!==undefined&&body.file!==''){if(output.kind!=='directory'||typeof body.file!=='string'||body.file.length>800)throw new AresError('作品文件选择无效');child=norm(body.file);if(child.split('/').some(part=>!part||part==='.'||part==='..'||['.ares','.git','node_modules','__pycache__'].includes(part))||/^[A-Za-z]:|^\//.test(child))throw new AresError('子文件不属于作品目录',403);}
 const workingPath=child?norm(join(path,child)):path;if(sensitiveFile(workingPath))throw new AresError('凭据文件不能预览',403);
 const target=safePath(project.root,workingPath);return {project,selected,output,step,child,workingPath,target};
}
function listFiles(source){
 const files=[];let scanned=0;
 function walk(base){for(const entry of readdirSync(base,{withFileTypes:true})){if(++scanned>1800)throw new AresError('作品目录超过预览文件限制');if(entry.name.startsWith('.')||['node_modules','__pycache__'].includes(entry.name))continue;const path=join(base,entry.name),name=norm(relative(source.target,path));if(entry.isSymbolicLink()||sensitiveFile(name))continue;if(entry.isDirectory())walk(path);else if(entry.isFile())files.push({file:name,bytes:statSync(path).size});}}
 walk(source.target);return files.sort((a,b)=>a.file.localeCompare(b.file));
}
export function readRegisteredArtifact(body){
 const source=outputSource(body),{project,selected,output,step,workingPath,target}=source;
 let bytes,files=null,immutable=null;
 if(body.versionId){
  const entry=project.workbench?.artifacts?.[output.id];if(!entry?.versionIds.includes(body.versionId))throw new AresError('该固定版本不属于当前作品',403);
  const record=artifactVersion(project.root,body.versionId,{verify:false});if(record.payload.projectId!==project.id||record.payload.artifactId!==output.id)throw new AresError('作品版本绑定不符',409);immutable=record;
  if(output.kind==='directory'&&!source.child)files=record.payload.files.filter(row=>!sensitiveFile(row.path)).map(row=>({file:row.path,bytes:row.bytes}));
  else{const file=record.payload.files.find(row=>output.kind==='directory'?row.path===source.child:row.workingPath===workingPath);if(!file)throw new AresError('固定版本中没有此文件',404);bytes=readProjectObject(project.root,file.sha256);}
 }else if(!existsSync(target))return {...source,model:{id:selected.id,title:selected.title,stepId:step.id,path:workingPath,status:'missing',mode:'missing',version:null}};
 else{
  const before=statSync(target);if(output.kind==='directory'&&!source.child){if(!before.isDirectory())throw new AresError('作品预期为目录');files=listFiles(source);}
  else{if(!before.isFile())throw new AresError('此作品不是文件');if(before.size>MAX_BYTES)throw new AresError('预览文件超过32MiB限制',413);bytes=readFileSync(safePath(project.root,workingPath,{existing:true}));const after=statSync(target);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino||bytes.length!==after.size)throw new AresError('作品正在保存，稍后自动重试',409);}
 }
 if(bytes?.length>MAX_BYTES)throw new AresError('预览文件超过32MiB限制',413);
 const version=bytes?hash(bytes):hash(files),extension=extname(workingPath).toLowerCase(),entry=project.workbench?.artifacts?.[output.id];
 const mode=files?'directory':extension==='.pdf'||office.has(extension)?'pdf':images.has(extension)?'image':extension==='.md'?'markdown':/\.html?$/.test(extension)?'html':editable.has(extension)||['.log','.ipynb','.svg'].includes(extension)?'text':'binary';
 const saved=entry?.currentVersionId?artifactVersion(project.root,entry.currentVersionId,{verify:false}):null;
 const model={id:selected.id,artifactId:output.id,title:selected.title,stepId:step.id,path:workingPath,file:source.child,heading:selected.heading||null,extension,status:bytes?.length===0?'empty':'ready',mode,version,bytes:bytes?.length??0,files,immutable:!!immutable,versionId:immutable?.id||null,savedVersionId:entry?.currentVersionId||null,savedMatches:output.kind!=='directory'&&saved?.payload.artifactHash===version,accepted:!immutable?project.tasks[step.id]?.status==='done':project.tasks[step.id]?.acceptedVersionIds?.includes(immutable.id)===true,editable:!immutable&&editable.has(extension)&&(bytes?.length??MAX_TEXT+1)<=MAX_TEXT};
 return {...source,bytes,model};
}
const snapshot=readRegisteredArtifact;
function render(request,{signal}={}){
 return new Promise((resolve,reject)=>{
  signal?.throwIfAborted();const process=spawn('python',[join(ROOT,'scripts','render_artifact.py')],{windowsHide:true,stdio:['pipe','pipe','pipe']}),chunks=[];let total=0,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const abort=()=>{process.kill();finish(new AresError('预览请求已取消',499));};
  const timer=setTimeout(()=>{process.kill();finish(new AresError('文档渲染超时，原件未修改',504));},45000);
  signal?.addEventListener('abort',abort,{once:true});
  process.stdout.on('data',chunk=>{total+=chunk.length;if(total>18*1024*1024){process.kill();finish(new AresError('预览输出超过限制',413));}else chunks.push(chunk);});process.stderr.resume();process.stdin.on('error',()=>{});
  process.on('error',()=>finish(new AresError('Python预览环境未就绪，需要PyMuPDF和Office读取依赖',503)));
  process.on('close',code=>{if(settled)return;let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return finish(new AresError('文档暂不能渲染，请确认文件保存完整',422));}if(code!==0||value.error)return finish(new AresError(value.error||'文档渲染失败',422));finish(null,value);});
  process.stdin.end(JSON.stringify(request));
 });
}
export function createArtifactViewer(ctx={}){
 const cache=new Map(),pending=new Map();let disposed=false,totalBytes=0;
 function remember(key,value){if(disposed)return;const old=cache.get(key);if(old)totalBytes-=old.pdf?.length||0;cache.delete(key);cache.set(key,value);totalBytes+=value.pdf?.length||0;while(cache.size>8||totalBytes>96*1024*1024){const first=cache.keys().next().value;totalBytes-=cache.get(first).pdf?.length||0;cache.delete(first);}}
 async function open(body,{signal}={}){
  if(disposed)throw new AresError('作品预览服务已卸载',503);const source=snapshot(body);if(!source.bytes)return source.model;
  if(body.version&&source.model.version!==body.version)throw new AresError('作品已变化，请读取最新预览',409);
  // A short settle window catches multi-part writes and Office atomic-save replacement.
  if(!body.versionId){await delay(160,undefined,{signal});const next=snapshot(body);if(next.model.version!==source.model.version)throw new AresError('作品正在保存，稍后自动重试',409);}
  const key=requestKey(body)+source.model.version,cached=cache.get(key);if(cached)return {...source.model,...cached.view};
  if(pending.has(key))return {...source.model,...await pending.get(key)};
  const work=(async()=>{
   const model=source.model,{bytes}=source;let view={},pdf;
   if(model.mode==='pdf'){
    if(model.extension==='.pdf')pdf=bytes;
    else{
     const provider=ctx.get?.('officeToPdf');
     if(!provider?.convert){if(!['.docx','.pptx','.xlsx'].includes(model.extension))throw new AresError('DSH Office转换服务尚未就绪，旧版Office文档不能预览',503);view={mode:model.extension==='.xlsx'?'table':'office-text',warning:'当前为内容视图；DSH Office版式转换服务尚未就绪',...await render({operation:'office-content',extension:model.extension.slice(1),bytes:bytes.toString('base64')},{signal})};}
     else{const result=await provider.convert({extension:model.extension.slice(1),priority:'foreground',source:{key:'ares:'+source.project.id+':'+source.workingPath,version:model.version,bytes:bytes.length,read:async()=>({bytes,version:model.version})}},signal||new AbortController().signal);pdf=Buffer.from(result.pdf);if(result.missingFonts?.length)view.warning='缺少字体：'+result.missingFonts.join('、');}
    }
    if(pdf){if(pdf.length>64*1024*1024)throw new AresError('转换后的PDF超过64MiB预览限制',413);view={...view,...await render({operation:'pdf-info',bytes:pdf.toString('base64')},{signal})};}
   }else if(['markdown','text','html'].includes(model.mode)){
    if(bytes.length>MAX_TEXT)view.truncated=true;
    try{view.text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,MAX_TEXT),{stream:bytes.length>MAX_TEXT}).replace(/^\uFEFF/,'');}catch{view={mode:'binary',editable:false,warning:'此文件不是UTF-8文本，未强行转换编码'};}
   }else if(model.mode==='image'){
    const valid=model.extension==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):model.extension==='.jpg'||model.extension==='.jpeg'?bytes[0]===255&&bytes[1]===216:model.extension==='.gif'?bytes.subarray(0,6).toString().match(/^GIF8[79]a$/):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';if(!valid)throw new AresError('图片格式与实际字节不符',422);view.mime=images.get(model.extension);
   }
   remember(key,{view,pdf});return view;
  })();pending.set(key,work);try{return {...source.model,...await work};}finally{pending.delete(key);}
 }
 async function page(body,options={}){
  if(!/^[a-f0-9]{64}$/.test(body.version||'')||!Number.isInteger(body.page)||body.page<1)throw new AresError('请提供文档指纹和有效页码');
  outputSource(body);const key=requestKey(body)+body.version;let cached=cache.get(key);if(!cached){await open(body,options);cached=cache.get(key);}if(!cached?.pdf)throw new AresError('当前不是可分页的版式预览');
  const result=await render({operation:'pdf-page',bytes:cached.pdf.toString('base64'),page:body.page,scale:body.scale??1.5},options);return Buffer.from(result.png,'base64');
 }
 async function image(body,options={}){const source=snapshot(body);if(body.version!==source.model.version)throw new AresError('图片已变化，请刷新预览',409);const model=await open(body,options);if(model.mode!=='image')throw new AresError('当前不是可预览图片');return {bytes:source.bytes,mime:model.mime};}
 function save(body,actor={kind:'user',id:'owner'}){
  const initial=snapshot(body);if(body.versionId||!initial.model.editable)throw new AresError('此作品只读，请使用原编辑器或金山共编',403);
  if(typeof body.text!=='string'||Buffer.byteLength(body.text)>MAX_TEXT)throw new AresError('文本编辑限制为1MiB',413);
  if(body.expectedRevision!==initial.project.revision||body.version!==initial.model.version)throw new AresError('文件或项目已被其他编辑器修改，未覆盖；请先保留草稿再刷新',409);
  try{new TextDecoder('utf-8',{fatal:true}).decode(initial.bytes);}catch{throw new AresError('此文件不是UTF-8文本，请在原编辑器中处理编码',415);}
  const encoded=Buffer.from(body.text,'utf8'),bytes=initial.bytes.subarray(0,3).equals(Buffer.from([239,187,191]))&&!body.text.startsWith('\uFEFF')?Buffer.concat([Buffer.from([239,187,191]),encoded]):encoded,afterHash=hash(bytes);
  if(afterHash===initial.model.version)return {project:initial.project,version:afterHash,unchanged:true};
  const temp=initial.target+'.ares-edit-'+randomUUID();let written=false;const operationId=randomUUID();
  try{
   const project=changeProject(body,(project,definition)=>{
    const current=snapshot(body);if(body.version!==current.model.version)throw new AresError('文件已被其他编辑器修改，未覆盖；请先保留草稿再刷新',409);
    const previous=putProjectObject(project.root,current.bytes);writeFileSync(temp,bytes,{flag:'wx'});if(hash(readFileSync(current.target))!==body.version)throw new AresError('保存前文件已改变，未覆盖',409);renameSync(temp,current.target);written=true;
    const all=definition.workflow.steps.flatMap(step=>step.outputs),check=inspectOutput(project.root,project,current.output,all);let versionId=null;
    if(check.valid)versionId=captureCheckedArtifact(project.root,project,current.step,current.output,check,{actor,sourceFiles,inputHash:inputHash(project,current.step),inputVersions:current.step.dependsOn.flatMap(id=>project.tasks[id]?.acceptedVersionIds||[])}).id;
    const task=project.tasks[current.step.id];if(task.status==='done'){task.status='stale';task.reason='作品已编辑，需要重新检查与验收';}delete task.review;
    project.workbench.viewerSaves??=[];project.workbench.viewerSaves.push({operationId,path:current.workingPath,beforeSha256:previous.sha256,afterSha256:afterHash,versionId});
    projectEvent(project.root,project,'artifact.edited',{operationId,artifactId:current.output.id,path:current.workingPath,beforeSha256:previous.sha256,afterSha256:afterHash,versionId},actor);
   });return {project,version:afterHash};
  }catch(error){
   const committed=readJson(safePath(initial.project.root,'.ares/project.json')).workbench?.viewerSaves?.some(row=>row.operationId===operationId);if(committed)throw new AresError('作品已保存，但返回状态未收齐；请刷新核对，未撤回已保存文件',409);
   if(written&&existsSync(initial.target)&&hash(readFileSync(initial.target))===afterHash){writeFileSync(temp,initial.bytes,{flag:'wx'});renameSync(temp,initial.target);}throw error;
  }finally{if(existsSync(temp))unlinkSync(temp);}
 }
 return {status:body=>snapshot(body).model,open,page,image,save,dispose(){disposed=true;cache.clear();pending.clear();totalBytes=0;}};
}
