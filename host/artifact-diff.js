import {readFileSync,existsSync,mkdirSync,writeFileSync,statSync} from 'node:fs';
import {join,dirname,extname,basename} from 'node:path';
import {spawnSync} from 'node:child_process';
import {AresError,hash,safePath} from './storage.js';
import {ROOT} from './catalog.js?v=2.3.0-directory1';
import {readProject} from './projects.js?v=2.3.0-directory1';
import {readRelease,artifactHistory} from './project-workbench.js?v=2.3.0-directory1';
import {readProjectObject} from './project-objects.js';
import {sensitiveFile,completeDirectory} from './project-artifacts.js';

export function textDifference(before,after,{maxLines=800}={}){
 const left=before.replace(/\r\n/g,'\n').split('\n'),right=after.replace(/\r\n/g,'\n').split('\n');if(before===after)return {changed:false,lines:[],truncated:false};
 let prefix=0,suffix=0;while(prefix<left.length&&prefix<right.length&&left[prefix]===right[prefix])prefix++;while(suffix<left.length-prefix&&suffix<right.length-prefix&&left.at(-1-suffix)===right.at(-1-suffix))suffix++;
 const a=left.slice(prefix,left.length-suffix),b=right.slice(prefix,right.length-suffix),rows=[];let limited=false;
 if((a.length+1)*(b.length+1)<=250000){const lengths=Array.from({length:a.length+1},()=>new Uint32Array(b.length+1));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)lengths[i][j]=a[i]===b[j]?lengths[i+1][j+1]+1:Math.max(lengths[i+1][j],lengths[i][j+1]);let i=0,j=0;while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){rows.push({type:'equal',beforeLine:prefix+i+1,afterLine:prefix+j+1,text:a[i]});i++;j++;}else if(i<a.length&&(j===b.length||lengths[i+1][j]>=lengths[i][j+1])){rows.push({type:'remove',beforeLine:prefix+i+1,text:a[i++]});}else rows.push({type:'add',afterLine:prefix+j+1,text:b[j++]});}}
 else{limited=true;for(let i=0;i<Math.min(a.length,maxLines/2);i++)rows.push({type:'remove',beforeLine:prefix+i+1,text:a[i]});for(let j=0;j<Math.min(b.length,maxLines/2);j++)rows.push({type:'add',afterLine:prefix+j+1,text:b[j]});}
 return {changed:true,beforeLines:left.length,afterLines:right.length,unchangedPrefix:prefix,unchangedSuffix:suffix,lines:rows.slice(0,maxLines),truncated:limited||rows.length>maxLines,comparison:limited?'bounded-changed-region':'line-difference'};
}
export function readableBytes(root,name,bytes){
 if(bytes.length===0)return {text:''};
 const format=extname(name).slice(1).toLowerCase();if(bytes.length>16*1024*1024)return {text:null,note:'文件较大，仅比较内容指纹和大小'};
 if(['docx','xlsx','pptx','pdf'].includes(format)){
  const path=safePath(root,'.ares/compare-cache/'+hash(bytes)+'.'+format);mkdirSync(dirname(path),{recursive:true});if(!existsSync(path))writeFileSync(path,bytes,{flag:'wx'});if(hash(readFileSync(path))!==hash(bytes))throw new AresError('比较副本内容已变化',409);
  const result=spawnSync('python',[join(ROOT,'scripts','inspect_artifact.py'),path,'--format',format],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:4*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}});let data;try{data=JSON.parse(result.stdout);}catch{}if(result.status!==0||!data?.valid)return {text:null,note:'未取得可核对的文档正文，仅比较实际字节指纹'};return {text:data.text.slice(0,150000),truncated:data.text.length>=150000,note:'按实际文档提取正文比较，版式仍需查看原文件'};
 }
 if(['png','jpg','jpeg','gif','webp','mp4','mp3','wav','zip','rar','bin'].includes(format))return {text:null,note:'二进制作品按实际字节指纹比较'};
 try{return {text:new TextDecoder('utf-8',{fatal:true}).decode(bytes).slice(0,150000),truncated:bytes.length>150000};}catch{return {text:null,note:'此文件未按文本解释，仅比较实际字节指纹'};}
}
function filesFor(p,reference){
 if(reference?.kind==='release'){const record=readRelease(p.root,reference.id),prefix=record.payload.outputDir.replaceAll('\\','/').replace(/\/$/,'')+'/';return {title:record.payload.title,files:record.payload.files.map(row=>({...row,comparisonPath:row.workingPath.startsWith(prefix)?row.workingPath.slice(prefix.length):row.workingPath})),definition:record.payload.definition,facts:record.payload.facts,competition:record.payload.competition,tasks:record.payload.tasks};}
 const artifactId=reference?.artifactId,step=p.workflow.steps.find(row=>row.outputs.some(output=>output.id===artifactId)),output=step?.outputs.find(row=>row.id===artifactId);if(!output)throw new AresError('请选择此项目的实际作品',403);
 if(reference.kind==='artifact'){const record=artifactHistory(p.root,artifactId).versions.find(row=>row.id===reference.id);if(!record)throw new AresError('版本不属于所选作品',403);const base=record.payload.workingPath.replace(/\/$/,'')+'/';return {title:record.payload.title+' · 历史版本',files:record.payload.files.map(row=>({...row,comparisonPath:record.payload.kind==='directory'&&row.workingPath.startsWith(base)?row.workingPath.slice(base.length):basename(row.workingPath)}))};}
 if(reference.kind!=='working')throw new AresError('版本比较来源无效');const target=output.kind==='section'?p.workflow.steps.flatMap(row=>row.outputs).find(row=>row.id===output.parentId):output;if(!target)throw new AresError('作品父文档不存在');const path=join(p.outputDir,target.path);if(sensitiveFile(path))throw new AresError('凭据文件不能作为比较内容',403);const full=safePath(p.root,path,{existing:true}),rows=target.kind==='directory'?completeDirectory(full).map(row=>({workingPath:join(path,row.path).replaceAll('\\','/'),sha256:row.sha256})): [{workingPath:path,sha256:hash(readFileSync(full))}];
 return {title:output.title+' · 当前工作稿',files:rows.map(row=>({...row,comparisonPath:target.kind==='directory'?row.workingPath.slice(path.length+1):basename(row.workingPath),bytes:statSync(safePath(p.root,row.workingPath,{existing:true})).size,working:true}))};
}
export function compareProjectVersions(body){
 const p=readProject(body.root),left=filesFor(p,body.left),right=filesFor(p,body.right),a=new Map(left.files.map(row=>[row.comparisonPath||row.workingPath,row])),b=new Map(right.files.map(row=>[row.comparisonPath||row.workingPath,row])),files=[];
 for(const path of [...new Set([...a.keys(),...b.keys()])].sort()){
  if(sensitiveFile(path))throw new AresError('比较内容包含凭据路径，已拒绝');const old=a.get(path),next=b.get(path),status=!old?'added':!next?'removed':old.sha256===next.sha256?'unchanged':'modified';let difference=null,note=null;
  if(status!=='unchanged'&&(!body.path||body.path===path)&&files.filter(row=>row.difference).length<10){const read=row=>!row?Buffer.alloc(0):row.working?readFileSync(safePath(p.root,row.workingPath,{existing:true})):readProjectObject(p.root,row.sha256),before=read(old),after=read(next);if(old&&hash(before)!==old.sha256||next&&hash(after)!==next.sha256)throw new AresError('比较期间实际文件已变化，请重新比较',409);const x=readableBytes(p.root,path,before),y=readableBytes(p.root,path,after);note=x.note||y.note;if(x.text!==null&&y.text!==null)difference=textDifference(x.text,y.text);}
  files.push({path,beforePath:old?.workingPath||null,afterPath:next?.workingPath||null,status,beforeSha256:old?.sha256||null,afterSha256:next?.sha256||null,beforeBytes:old?.bytes??null,afterBytes:next?.bytes??null,difference,note});
 }
 const changed=files.filter(row=>row.status!=='unchanged'),affectedSteps=p.workflow.steps.filter(step=>step.outputs.some(output=>changed.some(file=>[file.beforePath,file.afterPath].filter(Boolean).some(path=>path===join(p.outputDir,output.path||'').replaceAll('\\','/')||output.kind==='directory'&&path.startsWith(join(p.outputDir,output.path).replaceAll('\\','/')+'/'))))).map(row=>({id:row.id,title:row.title}));
 const recordChanges=[];if(left.definition&&right.definition){const oldSteps=new Map(left.definition.workflow.steps.map(row=>[row.id,row])),newSteps=new Map(right.definition.workflow.steps.map(row=>[row.id,row]));for(const id of new Set([...oldSteps.keys(),...newSteps.keys()])){const old=oldSteps.get(id),next=newSteps.get(id);if(hash(old||null)!==hash(next||null)){recordChanges.push({kind:'workflow-step',id,title:next?.title||old?.title,change:!old?'added':!next?'removed':'modified',beforeObjective:old?.objective||null,afterObjective:next?.objective||null});if(!affectedSteps.some(row=>row.id===id))affectedSteps.push({id,title:next?.title||old?.title});}const before=left.tasks?.[id],after=right.tasks?.[id];if(hash(before||null)!==hash(after||null))recordChanges.push({kind:'task-state',id,title:next?.title||old?.title,beforeStatus:before?.status||null,afterStatus:after?.status||null});}for(const key of new Set([...Object.keys(left.facts||{}),...Object.keys(right.facts||{})]))if(hash(left.facts?.[key]??null)!==hash(right.facts?.[key]??null))recordChanges.push({kind:'project-fact',id:key,title:'项目事实：'+key,change:'modified'});if(hash(left.competition||null)!==hash(right.competition||null))recordChanges.push({kind:'competition',title:'赛事、规则或适用范围',change:'modified'});if(left.definition.id!==right.definition.id)recordChanges.unshift({kind:'fixed-workflow-version',title:'固定流程与技能版本',before:left.definition.id,after:right.definition.id});}
 return {leftTitle:left.title,rightTitle:right.title,files,recordChanges,summary:{added:files.filter(row=>row.status==='added').length,removed:files.filter(row=>row.status==='removed').length,modified:files.filter(row=>row.status==='modified').length,unchanged:files.filter(row=>row.status==='unchanged').length},affectedSteps,note:'比较读取实际工作稿或固定历史对象，不改变任何版本或验收。'};
}
