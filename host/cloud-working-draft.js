/** Upload a NEW Kdocs working document. Never replace a cloud file or share a folder. */
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {AresError,now,hash} from './storage.js';
import {readProject,changeProject,sourceFiles} from './projects.js?v=2.3.0-directory1';
import {readRegisteredArtifact} from './artifact-viewer.js?v=2.3.0-directory1';
import {projectEvent,syntheticEvidence} from './project-artifacts.js';
import {putProjectObject} from './project-objects.js';
import {kdocsCall,resolveCloudLink,safeCloudInfo} from './kdocs-client.js';
import {withCloudPublication} from './cloud-operations.js';

const pending=status=>['uploading','needs-reconciliation'].includes(status);
function connected(root){const project=readProject(root),cloud=project.workbench?.collaboration;if(cloud?.provider!=='kdocs'||cloud.status!=='connected'||!cloud.driveId||!cloud.folderId)throw new AresError('请先为本项目选择金山协作目录',409);return {project,cloud};}
function artifactId(body){if(typeof body.artifactId!=='string'||!body.artifactId)throw new AresError('请选择要共编的作品');return body.artifactId;}
function stillConnected(project,operation){const cloud=project.workbench.collaboration;if(cloud.driveId!==operation.driveId||cloud.folderId!==operation.folderId)throw new AresError('协作目录已改变，请核对原上传结果',409);return cloud;}
function verifyInfo(info,operation){
 if(String(info.id??info.file_id)!==operation.fileId||String(info.drive_id)!==operation.driveId||String(info.parent_id)!==operation.folderId||info.type==='folder'||info.name!==operation.name||!Number.isSafeInteger(info.size)||info.size<=0)throw new AresError('上传后的实际文件、目录、名称或大小不符，原上传待核对',502);
 if(operation.representation==='original-binary'&&info.size!==operation.sourceBytes)throw new AresError('云端文件大小与上传原件不同，未宣称原件已核对',502);
}
async function finish(root,operation,{call,signal}){
 const info=await call('get-file-info',{drive_id:operation.driveId,file_id:operation.fileId},{signal});verifyInfo(info,operation);
 const link=await resolveCloudLink(info,{signal},call);
 let project=readProject(root);project=changeProject({root,expectedRevision:project.revision},current=>{
  const cloud=stillConnected(current,operation),row=cloud.workingUploads.find(row=>row.operationId===operation.operationId);if(!row)throw new AresError('上传操作记录缺失，原文件保留',409);
  const existing=cloud.documents.find(doc=>doc.artifactId===operation.artifactId);if(existing&&existing.id!==operation.fileId)throw new AresError('此作品已关联另一份金山工作稿，未替换',409);
  Object.assign(row,{status:'uploaded-verified',verification:'metadata-readback',finishedAt:now(),cloudVersion:info.version??null,link});
  cloud.documents=cloud.documents.filter(doc=>doc.id!==operation.fileId);cloud.documents.push({...(existing||{}),...safeCloudInfo(info),id:operation.fileId,artifactId:operation.artifactId,link,localSource:{path:operation.path,sha256:operation.sourceSha256,bytes:operation.sourceBytes,representation:operation.representation,provenance:operation.provenance,uploadedAt:row.at},uploadOperationId:operation.operationId});
  projectEvent(current.root,current,'collaboration.working-uploaded',{operationId:operation.operationId,artifactId:operation.artifactId,fileId:operation.fileId,sourceSha256:operation.sourceSha256,verification:'metadata-readback'});
 });return {project,link,fileId:operation.fileId,status:'uploaded-verified',sharing:'unchanged',verification:'metadata-readback'};
}
export async function uploadWorkingDraft(body,{call=kdocsCall,signal}={}){
 const id=artifactId(body);return withCloudPublication(body.root,async()=>{
  const {project,cloud}=connected(body.root);if(project.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
  if(cloud.documents.some(doc=>doc.artifactId===id))throw new AresError('此作品已有金山工作稿，请在金山共编或读取云稿，未覆盖云端',409);
  if(cloud.workingUploads?.some(row=>row.artifactId===id&&pending(row.status)))throw new AresError('此作品已有上传结果待核对，未重复上传',409);
  const source=readRegisteredArtifact({root:project.root,id,...(body.file?{file:body.file}:{})});if(!source.bytes?.length||source.model.immutable||!['.md','.txt','.docx','.pptx','.xlsx'].includes(source.model.extension))throw new AresError('金山工作稿支持非空 Markdown、文本和新版Office文件；请先打开具体作品',400);
  if(source.bytes.length>16*1024*1024)throw new AresError('金山快捷上传限制16MiB，请在金山上传较大作品',413);
  if(body.version!==source.model.version)throw new AresError('本地作品已变化，请先刷新后上传',409);
  await delay(160,undefined,{signal});const latest=readRegisteredArtifact({root:project.root,id,...(body.file?{file:body.file}:{})});if(latest.model.version!==source.model.version)throw new AresError('作品仍在保存，未上传半成品',409);
  const convert=['.md','.txt'].includes(source.model.extension),operationId=randomUUID(),title=source.selected.title.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,70);
  const synthetic=syntheticEvidence(project.root,project,{valid:true,path:source.workingPath,sha256:source.model.version},{kind:'file'},{sourceFiles});
  const operation={operationId,artifactId:source.output.id,path:source.workingPath,sourceSha256:hash(source.bytes),sourceBytes:source.bytes.length,driveId:cloud.driveId,folderId:cloud.folderId,name:(synthetic?'模拟预测试-':'')+title+'-工作稿-'+operationId.slice(0,8)+(convert?'.docx':source.model.extension),representation:convert?'markdown-to-docx':'original-binary',provenance:synthetic?{kind:'synthetic',purpose:'model-pretest',sourceSha256:source.model.version}:{kind:'unverified',reviewRequired:true},status:'uploading',fileId:null,at:now()};
  changeProject(body,current=>{stillConnected(current,operation);putProjectObject(current.root,source.bytes);current.workbench.collaboration.workingUploads??=[];current.workbench.collaboration.workingUploads.push(operation);projectEvent(current.root,current,'collaboration.working-upload-started',{operationId,artifactId:id,sourceSha256:operation.sourceSha256});});
  try{
   signal?.throwIfAborted();const result=await call('upload-new-file',{drive_id:cloud.driveId,parent_id:cloud.folderId,name:operation.name,content_base64:source.bytes.toString('base64'),...(convert?{content_format:'markdown'}:{})},{signal});
   const fileId=String(result.id??result.file_id??'');if(!/^[A-Za-z0-9_-]{1,160}$/.test(fileId))throw new AresError('上传返回没有可核对文件ID，未自动重传',502);operation.fileId=fileId;
   const current=readProject(project.root);changeProject({root:project.root,expectedRevision:current.revision},p=>{const row=stillConnected(p,operation).workingUploads.find(row=>row.operationId===operationId);row.fileId=fileId;});
   return await finish(project.root,operation,{call,signal});
  }catch(error){const current=readProject(project.root);changeProject({root:project.root,expectedRevision:current.revision},p=>{const row=stillConnected(p,operation).workingUploads.find(row=>row.operationId===operationId);if(row.status!=='uploaded-verified')Object.assign(row,{fileId:operation.fileId,status:'needs-reconciliation',error:'原上传结果需核对，未重复发送',finishedAt:now()});});throw error;}
 });
}
export async function reconcileWorkingDraft(body,{call=kdocsCall,signal}={}){
 return withCloudPublication(body.root,async()=>{
  const {project,cloud}=connected(body.root);if(project.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
  const operation=cloud.workingUploads?.find(row=>row.operationId===body.operationId);if(!operation)throw new AresError('上传操作不属于当前项目',403);stillConnected(project,operation);
  if(!operation.fileId){let pageToken;const found=[];for(let page=0;page<4;page++){const result=await call('list-files',{drive_id:operation.driveId,parent_id:operation.folderId,page_size:30,filter_type:'file',...(pageToken?{page_token:pageToken}:{})},{signal});if(!Array.isArray(result.items))throw new AresError('金山目录结果无效',502);found.push(...result.items.filter(item=>item.name===operation.name));pageToken=result.next_page_token;if(!pageToken)break;}if(found.length!==1)throw new AresError(found.length?'原上传文件不唯一，请在金山核对':'尚未在读取范围内找到原上传，请在金山核对后关联；未重新上传',409);operation.fileId=String(found[0].id??found[0].file_id??'');if(!/^[A-Za-z0-9_-]{1,160}$/.test(operation.fileId))throw new AresError('原上传文件ID无效',502);}
  return finish(project.root,operation,{call,signal});
 });
}
