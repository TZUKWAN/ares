import {randomUUID} from 'node:crypto';
import {AresError,hash,now} from './storage.js';
import {readProject,changeProject} from './projects.js?v=2.3.0-directory1';
import {ensureProjectWorkbench,projectEvent} from './project-artifacts.js';
import {kdocsAnnotationCall} from './kdocs-client.js';
import {withCloudPublication} from './cloud-operations.js';

export function annotationRows(value){if(!Array.isArray(value?.comments)||value.comments.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw new AresError('金山批注列表结构不符，未采用未知结果',502);return value.comments;}
// WPS returns its own final paragraph mark (CR) after the comment body. Remove
// exactly that representation marker; preserve user spaces and line feeds.
export function annotationText(value){return typeof value==='string'&&value.endsWith('\r')?value.slice(0,-1):value;}
export async function annotateCloudDocument(body,actor={kind:'user',id:'owner'},{signal,call=kdocsAnnotationCall}={}){
 if(actor.kind!=='user')throw new AresError('文档批注需要用户明确操作',403);
 const paragraph=body.paragraphIndex??1;if(!Number.isSafeInteger(paragraph)||paragraph<1||paragraph>100000||typeof body.content!=='string'||!body.content.trim()||body.content.length>3000)throw new AresError('请填写3000字以内批注及有效段落位置');
 return withCloudPublication(body.root,async()=>{
  const p=readProject(body.root),c=ensureProjectWorkbench(p).collaboration,doc=c.documents?.find(row=>row.id===body.fileId);if(c.provider!=='kdocs'||!doc||! /\.(docx?|wps)$/i.test(doc.name||''))throw new AresError('请先关联此项目的Word工作稿',403);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
  const contentHash=hash(body.content),previous=(c.annotationOperations||[]).find(row=>row.fileId===doc.id&&row.contentHash===contentHash&&row.paragraphIndex===paragraph),before=annotationRows(await call('read-element',{file_id:doc.id,type:'comment',action:'list'},{signal}));
  const matching=rows=>rows.filter(row=>typeof row.text==='string'&&hash(annotationText(row.text))===contentHash&&Number.isSafeInteger(row.index)&&row.index>=1);
  const existing=matching(before);if(previous&&existing.length!==1)throw new AresError('原批注结果仍待核对，未重复写入；请保留记录并在文档中核对',409);
  const operationId=previous?.operationId||randomUUID();if(!previous)changeProject(body,current=>{current.workbench.collaboration.annotationOperations??=[];current.workbench.collaboration.annotationOperations.push({operationId,fileId:doc.id,paragraphIndex:paragraph,contentHash,status:'pending',at:now()});projectEvent(current.root,current,'collaboration.annotation-requested',{operationId,fileId:doc.id,paragraphIndex:paragraph},actor);});
  let verified=false,index=null,wrote=false;
  try{
   signal?.throwIfAborted();if(!existing.length){wrote=true;await call('write-element',{file_id:doc.id,type:'comment',action:'paragraph_insert',paragraph_index:paragraph,text:body.content},{signal});}
   const after=annotationRows(await call('read-element',{file_id:doc.id,type:'comment',action:'list'},{signal})),found=matching(after);if(found.length!==1)throw new AresError('批注写入后未找到唯一的实际内容，保留待核对记录，未重复发送',502);index=found[0].index;verified=true;
  }finally{const latest=readProject(p.root);changeProject({root:p.root,expectedRevision:latest.revision},current=>{const record=current.workbench.collaboration.annotationOperations.find(row=>row.operationId===operationId);if(!record)throw new AresError('批注记录缺失',409);Object.assign(record,{status:verified?'annotation-readback-verified':'needs-reconciliation',index,finishedAt:now()});projectEvent(current.root,current,'collaboration.annotation-result',{operationId,fileId:doc.id,index,status:record.status},actor);});}
  return {project:readProject(p.root),status:'annotation-readback-verified',index,created:wrote,note:wrote?'批注已写入Word工作稿并独立读回。':'已独立读回现有批注，未重复写入。'};
 });
}
