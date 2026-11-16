import {createHash} from 'node:crypto';
import {AresError,hash,now} from './storage.js';
import {readProject,changeProject} from './projects.js?v=2.3.0-directory1';
import {ensureProjectWorkbench,projectEvent} from './project-artifacts.js';
import {readRelease} from './project-workbench.js?v=2.3.0-directory1';
import {cloudReleaseArchive} from './project-collaboration.js?v=2.3.0-directory1';
import {cloudPublicationMatches} from './cloud-results.js';
import {kdocsCall} from './kdocs-client.js';
import {withCloudPublication} from './cloud-operations.js';

export function verifyStorageChecksum(bytes,hashes){
 if(!Buffer.isBuffer(bytes)||!Array.isArray(hashes))throw new AresError('金山存储校验和结构不符',502);
 for(const [algorithm,length]of [['sha256',64],['sha1',40],['md5',32]]){
  const rows=hashes.filter(row=>row?.type===algorithm);if(!rows.length)continue;
  if(rows.length!==1||typeof rows[0].sum!=='string'||!new RegExp('^[a-fA-F0-9]{'+length+'}$').test(rows[0].sum))throw new AresError('金山存储校验和不完整或不唯一',502);
  const actual=rows[0].sum.toLowerCase(),expected=createHash(algorithm).update(bytes).digest('hex');if(actual!==expected)throw new AresError('云端归档存储校验和与固定项目版本不符',409);
  return {algorithm,actual,expected,verified:true,method:'provider-storage-checksum',rawCloudBytesDownloaded:false};
 }
 throw new AresError('金山未返回支持的存储校验和，未将未知结果当作完整性通过',502);
}
export async function verifyCloudArchive(body,actor={kind:'user',id:'owner'},{signal,call=kdocsCall}={}){
 if(actor.kind!=='user')throw new AresError('归档核对需要用户操作',403);
 return withCloudPublication(body.root,async()=>{
  const p=readProject(body.root),c=ensureProjectWorkbench(p).collaboration,operation=(c.publications||[]).find(row=>row.operationId===body.operationId);if(c.provider!=='kdocs'||!operation||operation.files?.length!==1||operation.expectedFiles?.length!==1)throw new AresError('没有可核对的整套归档发布记录',409);if(p.revision!==body.expectedRevision)throw new AresError('项目已变化，请刷新',409);
  const published=operation.files[0],expected=operation.expectedFiles[0],archive=cloudReleaseArchive(p.root,readRelease(p.root,operation.releaseId));if(hash(archive)!==expected.sha256||published.sha256!==expected.sha256||archive.length!==expected.bytes)throw new AresError('本地固定版本与原发布记录不符，未使用其他字节核对',409);
  const metadata={fileId:published.fileId,driveId:c.driveId,folderId:c.folderId,name:expected.name,bytes:archive.length,version:published.version};let integrity;
  try{
   const before=await call('get-file-info',{drive_id:c.driveId,file_id:published.fileId},{signal});if(!cloudPublicationMatches(before,metadata))throw new AresError('归档实际文件或云版本与发布回执不符',409);
   const storage=await call('download-file',{drive_id:c.driveId,file_id:published.fileId,with_hash:true},{signal});if(storage.physical_size!==undefined&&Number(storage.physical_size)!==archive.length)throw new AresError('云端存储字节数与归档不符',409);
   integrity={...verifyStorageChecksum(archive,storage.hashes),fileId:published.fileId,bytes:archive.length,checkedAt:now()};
   const after=await call('get-file-info',{drive_id:c.driveId,file_id:published.fileId},{signal});if(!cloudPublicationMatches(after,metadata))throw new AresError('归档在校验期间发生变化',409);
  }catch(error){const current=readProject(p.root);changeProject({root:p.root,expectedRevision:current.revision},value=>{const record=value.workbench.collaboration.publications.find(row=>row.operationId===operation.operationId);record.integrity={verified:false,status:'unverified',checkedAt:now()};projectEvent(value.root,value,'collaboration.archive-checksum',{operationId:operation.operationId,verified:false},actor);});throw error;}
  const current=readProject(p.root),project=changeProject({root:p.root,expectedRevision:current.revision},value=>{const record=value.workbench.collaboration.publications.find(row=>row.operationId===operation.operationId);record.integrity=integrity;projectEvent(value.root,value,'collaboration.archive-checksum',{operationId:operation.operationId,verified:true,algorithm:integrity.algorithm},actor);});
  return {project,complete:true,integrity,note:'已核对固定归档、云版本、大小和金山存储校验和；没有下载或伪称逐字节读取云端文件。'};
 });
}
