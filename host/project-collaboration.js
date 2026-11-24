import {writeFileSync,mkdirSync,readFileSync,lstatSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as pause} from 'node:timers/promises';
import {createZip} from './zip-archive.js';
import {AresError,hash,safePath,now} from './storage.js';
import {readProject,changeProject} from './projects.js?v=2.3.0-directory1';
import {ensureProjectWorkbench,projectEvent,sensitiveFile} from './project-artifacts.js';
import {readRelease} from './project-workbench.js?v=2.3.0-directory1';
import {readProjectObject,putProjectObject,putProjectRecord} from './project-objects.js';
import {kdocsCall,safeCloudInfo,resolveCloudLink} from './kdocs-client.js';
import {kdocsAccountStatus} from './kdocs-account.js';
import {assertCloudPublicationIdle,withCloudPublication} from './cloud-operations.js';
import {cloudHistoryPage,cloudCommentPresent,cloudPublicationMatches,cloudItems,cloudPageToken,cloudPublicationFiles} from './cloud-results.js';

const identifier=(value,label)=>{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(value))throw new AresError(label+'无效');return value;};
function configFor(root){const p=readProject(root),c=ensureProjectWorkbench(p).collaboration;if(c.provider!=='kdocs'||!c.driveId||!c.folderId)throw new AresError('项目尚未连接金山协作目录',409);return {p,c};}
function fileFor(c,id){const file=(c.documents||[]).find(f=>f.id===id);if(!file)throw new AresError('文档未在此项目登记，不能访问其他云文件',403);return file;}
export async function collaborationStatus(root){const p=readProject(root),c=ensureProjectWorkbench(p).collaboration;return {capability:await kdocsAccountStatus(),collaboration:c};}
export async function browseCollaborationFolders(body,{signal}={}){
 const p=readProject(body.root);if(p.kind!=='v2')throw new AresError('请先建立竞赛项目');
 let driveId=body.driveId?identifier(body.driveId,'云盘ID'):null,folderId=identifier(body.folderId||'0','目录ID');
 if(body.pageToken!==undefined&&(typeof body.pageToken!=='string'||body.pageToken.length>4000))throw new AresError('云目录分页标记无效');
 if(!driveId){const root=await kdocsCall('list-my-files',{page_size:1,filter_type:'folder'},{signal});driveId=identifier(root.drive_id,'云盘ID');folderId='0';}
 const listing=await kdocsCall('list-files',{drive_id:driveId,parent_id:folderId,page_size:30,filter_type:'folder',...(body.pageToken?{page_token:body.pageToken}:{})},{signal});
 if(!Array.isArray(listing.items))throw new AresError('金山目录结果结构不符，未将未知结果显示为空目录',502);
 return {driveId,folderId,folders:listing.items.filter(v=>v.type==='folder').map(v=>({id:identifier(String(v.id??v.file_id??''),'文件夹ID'),driveId:identifier(String(v.drive_id||driveId),'云盘ID'),name:String(v.name||'文件夹').slice(0,300)})),nextPageToken:listing.next_page_token||null,accessVerified:true,checkedAt:now()};
}
export async function connectCollaboration(body,actor={kind:'user',id:'owner'},{signal}={}){
 const p=readProject(body.root);assertCloudPublicationIdle(p.root);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
 const driveId=identifier(body.driveId,'云盘ID'),folderId=identifier(body.folderId,'协作目录ID');
 // This is a real access check; storing configuration alone never means connected.
 let folder;if(folderId==='0'){const listing=await kdocsCall('list-files',{drive_id:driveId,parent_id:folderId,page_size:1},{signal});folder={id:'0',drive_id:driveId,type:'folder',name:'所选云盘根目录'};if(!Array.isArray(listing.items))throw new AresError('不能读取此云盘目录',502);}else{folder=await kdocsCall('get-file-info',{drive_id:driveId,file_id:folderId},{signal});if(folder.type!=='folder'||String(folder.drive_id)!==driveId)throw new AresError('请选择同一云盘中的文件夹');}
 return changeProject(body,(p)=>{assertCloudPublicationIdle(p.root);const state=ensureProjectWorkbench(p),old=state.collaboration;if((old.workingUploads||[]).some(row=>['uploading','needs-reconciliation'].includes(row.status))||(old.publications||[]).some(v=>v.status==='publishing')||(old.permissionOperations||[]).some(v=>v.status==='pending')||(old.commentOperations||[]).some(v=>v.status==='pending'))throw new AresError('正在发布版本，请完成后再调整协作连接',409);const same=old.driveId===driveId&&old.folderId===folderId;if(!same&&old.provider){state.collaborationHistory??=[];state.collaborationHistory.push(old);}state.collaboration={...(same?old:{}),provider:'kdocs',status:'connected',driveId,folderId,folder:safeCloudInfo(folder),publisherId:'owner',documents:same?old.documents||[]:[],publications:same?old.publications||[]:[],connectedAt:now()};projectEvent(p.root,p,'collaboration.connected',{provider:'kdocs',driveId,folderId},actor);});
}
export async function listCollaborationFiles(root,{pageToken,signal}={}){const {c}=configFor(root);if(pageToken!==undefined&&(typeof pageToken!=='string'||pageToken.length>4000))throw new AresError('云文件分页标记无效');const r=await kdocsCall('list-files',{drive_id:c.driveId,parent_id:c.folderId,page_size:30,filter_type:'file',...(pageToken?{page_token:pageToken}:{})},{signal});if(!Array.isArray(r.items))throw new AresError('金山文件列表结构不符，未显示为无文件',502);return {items:r.items.map(safeCloudInfo),nextPageToken:r.next_page_token||null};}
export async function bindCloudDocument(body,actor={kind:'user',id:'owner'},{signal}={}){
 const {p,c}=configFor(body.root);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);const id=identifier(body.fileId,'文档ID');const info=await kdocsCall('get-file-info',{drive_id:c.driveId,file_id:id},{signal});if(String(info.id??info.file_id)!==id||String(info.drive_id)!==c.driveId||String(info.parent_id)!==c.folderId||info.type==='folder')throw new AresError('仅可登记协作目录的直接文档');
 if(body.artifactId&&!p.workflow.steps.some(s=>s.outputs.some(o=>o.id===body.artifactId)))throw new AresError('作品不属于此项目');
 const link=await resolveCloudLink(info,{signal});
 return changeProject(body,(p)=>{const state=ensureProjectWorkbench(p).collaboration;state.documents=state.documents.filter(d=>d.id!==id);state.documents.push({...safeCloudInfo(info),id,artifactId:body.artifactId||null,link});projectEvent(p.root,p,'collaboration.document-bound',{fileId:id,artifactId:body.artifactId||null},actor);});
}
export async function cloudDocumentHistory(root,fileId,{signal,pageToken}={}){pageToken=cloudPageToken(pageToken);const {c}=configFor(root);fileFor(c,fileId);const r=await kdocsCall('list-file-versions',{drive_id:c.driveId,file_id:fileId,page_size:30,with_comment:true,...(pageToken?{page_token:pageToken}:{})},{signal});return cloudHistoryPage(r);}
/** Store the actual converted text locally, never claim this is an Office
 * binary or a cloud write. The caller still verifies the cloud version. */
export function storeCloudCandidate(root,fileId,version,text){
 identifier(fileId,'文档ID');if(!Number.isInteger(version)||version<0||typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>4*1024*1024)throw new AresError('协作候选内容或版本无效');
 const bytes=Buffer.from(text),object=putProjectObject(root,bytes),base='协作候选/'+fileId+'-v'+version+'-'+object.sha256.slice(0,10);
 for(let attempt=0;attempt<4;attempt++){
  const path=base+(attempt?'-'+randomUUID():'')+'.md',full=safePath(root,path);mkdirSync(dirname(full),{recursive:true});
  try{writeFileSync(full,bytes,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;const stat=lstatSync(full);if(!stat.isFile()||stat.size!==bytes.length||hash(readFileSync(full))!==object.sha256)continue;}
  if(hash(readFileSync(full))!==object.sha256)throw new AresError('协作候选在写入后发生变化，未登记导入成功',409);
  return {path,sha256:object.sha256};
 }
 throw new AresError('协作候选文件名发生冲突，未覆盖本地修改，请重试',409);
}
export async function importCloudCandidate(body,actor={kind:'user',id:'owner'},{signal,call=kdocsCall}={}){
 const {p,c}=configFor(body.root);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);const doc=fileFor(c,body.fileId),params={drive_id:c.driveId,file_id:doc.id};
 const before=await call('get-file-info',params,{signal}),version=before.version;if(!Number.isInteger(version))throw new AresError('云端未给出可核对版本号，未导入');
 // read-file is a server-rendered text candidate, not an exact binary/history export.
 let content=await call('read-file',{file_id:doc.id,format:'markdown',enable_upload_medias:false},{signal});for(let attempt=0;content.status==='pending'&&content.task_id&&attempt<4;attempt++){await pause(1000,undefined,{signal});content=await call('read-file',{file_id:doc.id,task_id:content.task_id,format:'markdown',enable_upload_medias:false},{signal});}
 const text=typeof content==='string'?content:content.content??content.markdown??content.text;if(typeof text!=='string'||!text.trim()||Buffer.byteLength(text)>4*1024*1024)throw new AresError(content.status==='pending'?'云文档转换仍在处理中，请稍后再拉取':'此文档没有可用文本，需由队员下载原文件后作为本地候选登记');
 const after=await call('get-file-info',params,{signal});if(after.version!==version)throw new AresError('文档在读取期间被队员修改，请重新拉取',409);
 let path,candidateId;const project=changeProject(body,(p)=>{const stored=storeCloudCandidate(p.root,doc.id,version,text);path=stored.path;const candidate=putProjectRecord(p.root,'cloud-candidates',{projectId:p.id,fileId:doc.id,cloudVersion:version,artifactId:doc.artifactId||null,...stored,representation:'server-rendered-text',provenance:{...(doc.localSource?.provenance?.kind==='synthetic'?doc.localSource.provenance:{kind:'unverified'}),source:'kdocs',fileId:doc.id,cloudVersion:version},at:now()});candidateId=candidate.id;p.workbench.collaboration.candidateIds??=[];p.workbench.collaboration.candidateIds.push(candidate.id);
 projectEvent(p.root,p,'collaboration.candidate-imported',{fileId:doc.id,cloudVersion:version,candidateId,...stored,representation:'server-rendered-text',artifactId:doc.artifactId,acceptance:'requires-local-review'},actor);});return {project,path,candidateId,artifactId:doc.artifactId||null,representation:'server-rendered-text',cloudVersion:version};
}
export async function cloudCollaborators(root,fileId,{signal}={}){const {c}=configFor(root);fileFor(c,fileId);const r=await kdocsCall('list-document-collaborators',{file_id:fileId,limit:50},{signal});return {meaning:'最近访问成员，不等于权限名单',items:(r.users||[]).map(v=>({id:v.id,name:v.name,status:v.status}))};}
export async function commentOnCloudDocument(body,actor={kind:'user',id:'owner'},{signal}={}){
 const {p,c}=configFor(body.root);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);fileFor(c,body.fileId);if(typeof body.content!=='string'||!body.content.trim()||body.content.length>3000)throw new AresError('请输入3000字以内评论');const contentHash=hash(body.content);if((c.commentOperations||[]).some(o=>o.fileId===body.fileId&&o.contentHash===contentHash))throw new AresError('同一文档已有该留言操作记录，请先在金山核对，避免重复发送',409);
 const available=await kdocsCall('list-document-comments',{file_id:body.fileId,origin_id:'0',page_size:1},{signal});cloudItems(available,'留言能力检查');
 const operationId=randomUUID();changeProject(body,p=>{p.workbench.collaboration.commentOperations??=[];p.workbench.collaboration.commentOperations.push({operationId,fileId:body.fileId,contentHash,status:'pending',at:now()});projectEvent(p.root,p,'collaboration.comment-requested',{operationId,fileId:body.fileId,contentHash},actor);});
 let commentId=null,status='needs-reconciliation';try{const result=await kdocsCall('create-document-comment',{file_id:body.fileId,content:body.content},{signal});commentId=result.id??result.comment_id;if(commentId===undefined||commentId===null)throw new AresError('金山没有返回留言ID，请在文档中核对，未重复发送',502);const listed=await kdocsCall('list-document-comments',{file_id:body.fileId,origin_id:'0',page_size:10},{signal});if(!cloudCommentPresent(listed,commentId,body.content))throw new AresError('留言已返回ID，但独立读回尚未找到，请在金山核对',502);status='comment-readback-verified';
 }finally{const current=readProject(p.root);changeProject({root:p.root,expectedRevision:current.revision},p=>{const op=p.workbench.collaboration.commentOperations.find(v=>v.operationId===operationId);if(!op)throw new AresError('留言记录发生变化',409);Object.assign(op,{status,commentId,finishedAt:now()});projectEvent(p.root,p,'collaboration.comment-result',{operationId,fileId:body.fileId,commentId,status},actor);});}
 return readProject(p.root);
}

function publicManifest(release){return {schema_version:1,projectId:release.projectId,title:release.title,kind:release.kind,definitionId:release.definition.id,steps:release.definition.workflow.steps.map(s=>({id:s.id,title:s.title,status:release.tasks[s.id]?.status})),artifactVersionIds:release.artifactVersionIds,files:release.files.map(f=>({path:f.workingPath,sha256:f.sha256,bytes:f.bytes})),at:release.at};}
export function cloudReleaseArchive(root,release){const entries=release.payload.files.map(f=>{if(sensitiveFile(f.workingPath))throw new AresError('不能发布凭据文件');return {name:f.workingPath,bytes:readProjectObject(root,f.sha256)};});entries.push({name:'ARES-项目版本清单.json',bytes:Buffer.from(JSON.stringify(publicManifest(release.payload),null,2))});return createZip(entries);}
export async function publishCloudRelease(body,actor={kind:'user',id:'owner'},options={}){const {p}=configFor(body.root);return withCloudPublication(p.root,()=>publishCloudReleaseNow(body,actor,options));}
async function publishCloudReleaseNow(body,actor,{signal}={}){
 const {p,c}=configFor(body.root);if(actor.kind!=='user'||actor.id!==c.publisherId)throw new AresError('只有本机指定发布者可以发布整套里程碑',403);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);const release=readRelease(p.root,body.releaseId);
 if((c.publications||[]).some(v=>v.releaseId===release.id&&v.status!=='failed-before-write'))throw new AresError('此版本已有发布记录；请先检查已有记录，避免重复上传',409);
 const archive=cloudReleaseArchive(p.root,release),queue=[{name:'ARES-'+release.id.slice(0,16)+'.zip',bytes:archive,sha256:hash(archive),path:'整套项目作品归档'}];
 const operationId=randomUUID();let latest=changeProject(body,p=>{ensureProjectWorkbench(p).collaboration.publications.push({operationId,releaseId:release.id,status:'publishing',files:[],expectedFiles:queue.map((item,i)=>({name:release.id.slice(0,12)+'-'+String(i+1).padStart(3,'0')+'-'+item.name,bytes:item.bytes.length,sha256:item.sha256})),startedAt:now()});projectEvent(p.root,p,'collaboration.publish-started',{operationId,releaseId:release.id},actor);});
 const record=(patch)=>{const current=readProject(p.root);latest=changeProject({root:p.root,expectedRevision:current.revision},p=>{const op=ensureProjectWorkbench(p).collaboration.publications.find(v=>v.operationId===operationId);if(!op)throw new AresError('发布记录发生冲突',409);Object.assign(op,patch);});};
 const uploaded=[];let attemptedWrite=false;try{for(let i=0;i<queue.length;i++){signal?.throwIfAborted();const item=queue[i],name=release.id.slice(0,12)+'-'+String(i+1).padStart(3,'0')+'-'+item.name;if(!/\.(docx?|xlsx?|pptx?|pdf|md|txt|html|zip|png|jpe?g|csv|json|dps|et|wps|gif)$/i.test(name))throw new AresError('金山不支持此文件类型：'+item.name);
 attemptedWrite=true;const response=await kdocsCall('upload-new-file',{drive_id:c.driveId,parent_id:c.folderId,name,content_base64:item.bytes.toString('base64'),file_sum:item.sha256,file_type:'sha256'},{signal}),id=identifier(response.id??response.file_id,'上传文件ID');uploaded.push({fileId:id,path:item.path,sha256:item.sha256,bytes:item.bytes.length,verification:'pending'});record({files:[...uploaded]});const info=await kdocsCall('get-file-info',{drive_id:c.driveId,file_id:id},{signal});if(!cloudPublicationMatches(info,{fileId:id,driveId:c.driveId,folderId:c.folderId,name,bytes:item.bytes.length}))throw new AresError('上传后独立读取的文件、名称、大小或目录不符');Object.assign(uploaded.at(-1),{version:info.version??null,verification:'metadata-size-verified'});record({files:[...uploaded]});uploaded.at(-1).link=await resolveCloudLink(info,{signal});record({files:[...uploaded]});}
 record({status:'published-metadata-verified',finishedAt:now(),verification:'整套真实文件打包为单个不可变ZIP并独立读回元数据；未声称逐字节云下载验证'});return {project:latest,publication:latest.workbench.collaboration.publications.find(v=>v.operationId===operationId)};
 }catch(error){record({status:attemptedWrite?'needs-reconciliation':'failed-before-write',files:uploaded,error:'发布未全部完成；保留已上传文件记录，未覆盖共享文档',finishedAt:now()});throw new AresError('云发布未完成，已保留操作记录。'+(error instanceof AresError?error.message:'请检查网络与权限'),502);}
}
export async function reconcileCloudPublication(body,actor={kind:'user',id:'owner'},{signal}={}){
 const {p,c}=configFor(body.root);assertCloudPublicationIdle(p.root);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);const operation=c.publications.find(v=>v.operationId===body.operationId);if(!operation)throw new AresError('找不到该发布操作');if(!operation.expectedFiles?.length)throw new AresError('旧发布记录没有完整预期清单，请人工核对');
 const candidates=[];let token;for(let page=0;page<10;page++){const listing=await kdocsCall('list-files',{drive_id:c.driveId,parent_id:c.folderId,page_size:100,filter_type:'file',...(token?{page_token:token}:{})},{signal});candidates.push(...cloudItems(listing,'发布目录'));token=cloudPageToken(listing.next_page_token);if(!token)break;}
 const verified=[];let complete=!token;for(const expected of operation.expectedFiles){const known=operation.files.find(v=>v.sha256===expected.sha256&&v.bytes===expected.bytes),matches=candidates.filter(v=>v.name===expected.name&&Number(v.size)===expected.bytes&&(!known?.fileId||String(v.id??v.file_id)===String(known.fileId)));if(matches.length!==1){complete=false;continue;}const info=await kdocsCall('get-file-info',{drive_id:c.driveId,file_id:matches[0].id},{signal});if(!cloudPublicationMatches(info,{fileId:String(matches[0].id??matches[0].file_id),driveId:c.driveId,folderId:c.folderId,name:expected.name,bytes:expected.bytes})){complete=false;continue;}const old=operation.files.find(v=>v.fileId===info.id);if(old?.version!==undefined&&old.version!==null&&old.version!==info.version){complete=false;continue;}verified.push({fileId:String(info.id??info.file_id),version:info.version??null,sha256:expected.sha256,bytes:expected.bytes,verification:'metadata-size-verified',path:'整套项目作品归档',link:await resolveCloudLink(info,{signal})});}
 const project=changeProject(body,p=>{const op=p.workbench.collaboration.publications.find(v=>v.operationId===body.operationId);op.status=complete?'published-metadata-verified':'needs-reconciliation';op.files=cloudPublicationFiles(op.files,verified,complete);op.lastReconciliation={complete,verifiedFileIds:verified.map(v=>v.fileId),directoryScanned:!token};op.reconciledAt=now();projectEvent(p.root,p,'collaboration.publish-reconciled',{operationId:op.operationId,status:op.status,fileCount:verified.length},actor);});return {project,complete,note:complete?'已独立核对云文件元数据；没有进行逐字节下载比对':'未找到唯一完整版本或目录未扫描完，请保留记录并在金山中核对，未重复上传'};
}
