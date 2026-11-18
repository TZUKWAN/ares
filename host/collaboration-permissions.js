import {randomUUID} from 'node:crypto';
import {AresError,now} from './storage.js';
import {readProject,changeProject} from './projects.js?v=2.3.0-loadfix1';
import {ensureProjectWorkbench,projectEvent} from './project-artifacts.js';
import {kdocsCall,resolveCloudLink} from './kdocs-client.js';
import {cloudItems} from './cloud-results.js';
import {withCloudPublication} from './cloud-operations.js';

const selections=new Map();
function context(root,fileId){const p=readProject(root),c=ensureProjectWorkbench(p).collaboration,doc=c.documents?.find(d=>d.id===fileId);if(c.provider!=='kdocs'||!doc)throw new AresError('请先关联此项目的协作文档',403);return {p,c,doc};}
const allowedCodes=name=>/\.(png|jpe?g|gif|webp|bmp)$/i.test(name)?['viewable','view_only']:/\.(otl|ap|ksheet|wps|docx?|wpp|pptx?|et|xlsx?|dbt)$/i.test(name)?['viewable','commentable','editable','view_only']:['viewable','editable','view_only'];
/** Explicit owner action for one bound working document, never a folder/archive. */
export async function enableCloudEditLink(body,actor={kind:'user',id:'owner'},{signal,call=kdocsCall}={}){
 if(actor.kind!=='user'||actor.id!=='owner'||body.confirmLinkEdit!==true)throw new AresError('需要明确选择开启此工作稿的链接共同编辑',403);
 const initial=context(body.root,body.fileId);return withCloudPublication(initial.p.root,async()=>{
  const {p,c,doc}=context(body.root,body.fileId);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
  if((c.publications||[]).some(row=>(row.files||[]).some(file=>file.fileId===doc.id))||! /\.(docx?|xlsx?|pptx?|otl|ksheet|wps|et|wpp|dbt)$/i.test(doc.name||''))throw new AresError('链接共同编辑只用于在线工作稿，不开放归档或目录',403);
  const [info,roles,share]=await Promise.all([call('get-file-info',{drive_id:c.driveId,file_id:doc.id},{signal}),call('list-drive-roles',{drive_id:c.driveId},{signal}),call('get-share-info',{file_id:doc.id},{signal})]);
  if(String(info.id??info.file_id)!==doc.id||String(info.drive_id)!==c.driveId||String(info.parent_id)!==c.folderId||info.type==='folder')throw new AresError('工作稿实际文件、云盘或目录不符，未更改分享',409);
  const editable=cloudItems(roles,'协作角色').find(row=>row.code==='editable'&&typeof row.id==='string'&&row.id);if(!editable)throw new AresError('当前云盘没有实际可编辑角色，未猜测角色ID',502);
  const matches=value=>value?.status==='open'&&value.scope==='anyone'&&String(value.role_id)===editable.id,operationId=randomUUID();
  changeProject(body,current=>{current.workbench.collaboration.linkOperations??=[];current.workbench.collaboration.linkOperations.push({operationId,fileId:doc.id,scope:'anyone',roleId:editable.id,status:'pending',at:now()});projectEvent(current.root,current,'collaboration.edit-link-requested',{operationId,fileId:doc.id},actor);});
  let verified=false,link=null;
  try{
   signal?.throwIfAborted();if(!matches(share))await call('share-file',{drive_id:c.driveId,file_id:doc.id,scope:'anyone',role_id:editable.id},{signal});
   const actual=await call('get-share-info',{file_id:doc.id},{signal});if(!matches(actual))throw new AresError('分享返回后实际范围或编辑角色不符，未当作协作成功',502);
   const actualInfo=await call('get-file-info',{drive_id:c.driveId,file_id:doc.id},{signal});if(String(actualInfo.id??actualInfo.file_id)!==doc.id)throw new AresError('分享链接实际文件不符',502);
   link=await resolveCloudLink(actualInfo,{signal},call);verified=true;
  }finally{
   const current=readProject(p.root);changeProject({root:p.root,expectedRevision:current.revision},latest=>{const operation=latest.workbench.collaboration.linkOperations.find(row=>row.operationId===operationId);if(!operation)throw new AresError('链接协作操作记录缺失，保留云端状态待核对',409);Object.assign(operation,{status:verified?'editable-link-verified':'needs-reconciliation',finishedAt:now()});if(verified){const target=latest.workbench.collaboration.documents.find(row=>row.id===doc.id);if(!target)throw new AresError('工作稿绑定已改变，请核对云端链接',409);target.link=link;target.collaborativeLink={status:'editable-link-verified',scope:'anyone',roleCode:'editable',roleId:editable.id,verifiedAt:now()};}projectEvent(latest.root,latest,'collaboration.edit-link-result',{operationId,fileId:doc.id,status:operation.status},actor);});
  }
  return {project:readProject(p.root),link,status:'editable-link-verified'};
 });
}
export async function searchCloudPermissions(body,{signal}={}){
 const {p,c,doc}=context(body.root,body.fileId);if(typeof body.query!=='string'||!body.query.trim()||body.query.length>100)throw new AresError('请输入100字以内的队员姓名或账号关键词');
 const [members,roles,share]=await Promise.all([kdocsCall('search-document-collaborators',{drive_id:c.driveId,file_id:doc.id,key:body.query,count:30},{signal}),kdocsCall('list-drive-roles',{drive_id:c.driveId},{signal}),kdocsCall('get-share-info',{file_id:doc.id},{signal})]);
 if(typeof share.id!=='string'||!share.id)throw new AresError('文档还没有可用分享设置，请先在金山中设置指定成员协作；ARES不会自动公开分享');
 const users=[...(members.joined||[]).map(v=>({...v,joined:true})),...(members.not_join||[]).map(v=>({...v,joined:false}))].filter(v=>v.kind==='contact').map(v=>({id:String(v.id),name:String(v.name),joined:v.joined,roleCode:v.compound_permission?.role_code||null}));
 const available=(roles.items||[]).filter(r=>allowedCodes(doc.name).includes(r.code)).map(r=>({id:r.id,code:r.code,name:r.name}));const token=randomUUID();for(const [key,selection]of selections)if(selection.expires<Date.now())selections.delete(key);if(selections.size>=100)selections.delete(selections.keys().next().value);selections.set(token,{root:p.root,fileId:doc.id,driveId:c.driveId,linkId:share.id,query:body.query,users,roles:available,expires:Date.now()+5*60*1000});return {selectionToken:token,users,roles:available,shareScope:share.scope||null,note:'仅列出可定位的个人联系人；显式协作者与分享范围共同决定实际访问，最近访客列表不作权限依据'};
}
export async function grantCloudPermission(body,actor={kind:'user',id:'owner'},{signal}={}){
 if(actor.kind!=='user'||actor.id!=='owner'||body.confirmGrant!==true)throw new AresError('请先明确确认对选中队员授予所选文档权限',403);const {p,c,doc}=context(body.root,body.fileId),selection=selections.get(body.selectionToken);if(!selection||selection.expires<Date.now()||selection.root!==p.root||selection.fileId!==doc.id||selection.driveId!==c.driveId)throw new AresError('队员搜索结果已过期，请重新查询',409);
 const user=selection.users.find(v=>v.id===body.subjectId),role=selection.roles.find(v=>v.id===body.roleId);if(!user||!role)throw new AresError('队员或角色不在实际查询结果内');
 const opId=randomUUID();changeProject(body,p=>{p.workbench.collaboration.permissionOperations??=[];p.workbench.collaboration.permissionOperations.push({opId,fileId:doc.id,subjectId:user.id,roleId:role.id,status:'pending',at:now()});projectEvent(p.root,p,'collaboration.permission-requested',{opId,fileId:doc.id,subjectId:user.id,roleId:role.id},actor);});selections.delete(body.selectionToken);
 let status='needs-reconciliation';try{const share=await kdocsCall('get-share-info',{file_id:doc.id},{signal});if(share.id!==selection.linkId)throw new AresError('文档分享设置发生变化，请重新搜索核对',409);const roles=await kdocsCall('list-drive-roles',{drive_id:c.driveId},{signal});if(!(roles.items||[]).some(v=>v.id===role.id&&v.code===role.code))throw new AresError('可用角色发生变化，请重新查询',409);
 await kdocsCall('set-collaborator-permissions',{drive_id:c.driveId,link_id:share.id,role_id:role.id,subjects:[{subject_type:'user',subject_id:user.id}],notify_subject_user:false,overwrite:false},{signal});const after=await kdocsCall('search-document-collaborators',{drive_id:c.driveId,file_id:doc.id,key:selection.query,count:100},{signal});const found=(after.joined||[]).find(v=>String(v.id)===user.id);if(!found||!(found.compound_permission?.role_code===role.code||String(found.compound_permission?.compound_id)===String(role.id)))throw new AresError('权限写入后尚未独立核对成功，请检查该队员的显式角色',502);status='explicit-role-verified';
 }finally{const current=readProject(p.root);changeProject({root:p.root,expectedRevision:current.revision},p=>{const op=p.workbench.collaboration.permissionOperations.find(v=>v.opId===opId);if(!op)throw new AresError('权限操作记录变化',409);op.status=status;op.finishedAt=now();projectEvent(p.root,p,'collaboration.permission-result',{opId,status,fileId:doc.id,subjectId:user.id,roleId:role.id},actor);});}
 return {project:readProject(p.root),status};
}
