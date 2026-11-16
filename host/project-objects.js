import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,renameSync} from 'node:fs';
import {join,dirname,relative} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AresError,hash,readJson,atomicJson,safePath,now} from './storage.js';

const CATEGORIES=new Set(['artifact-versions','releases','events','extension-runs','cloud-candidates']);
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function objectPath(root,sha){if(!digest(sha))throw new AresError('作品内容指纹无效');return safePath(root,'.ares/objects/'+sha.slice(0,2)+'/'+sha);}
export function putProjectObject(root,bytes){
 if(!Buffer.isBuffer(bytes)||bytes.length>256*1024*1024)throw new AresError('作品对象超过256MiB限制或类型无效');
 const sha256=hash(bytes),file=objectPath(root,sha256);mkdirSync(dirname(file),{recursive:true});
 if(!existsSync(file)){try{writeFileSync(file,bytes,{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}}
 if(lstatSync(file).isSymbolicLink()||hash(readFileSync(file))!==sha256)throw new AresError('作品历史对象损坏，未替换成工作稿',409);
 return {sha256,bytes:bytes.length};
}
export function readProjectObject(root,sha){const file=objectPath(root,sha),bytes=readFileSync(file);if(lstatSync(file).isSymbolicLink()||hash(bytes)!==sha)throw new AresError('作品历史对象损坏，未采用最新文件',409);return bytes;}
export function repairProjectObject(root,sha,knownBytes){
 return repairProjectFile(root,relative(root,objectPath(root,sha)),sha,knownBytes);
}
export function repairProjectFile(root,path,sha,knownBytes){
 if(!Buffer.isBuffer(knownBytes)||hash(knownBytes)!==sha)throw new AresError('修复内容必须与原始对象指纹完全一致');
 const file=safePath(root,path);if(existsSync(file)&&hash(readFileSync(file))===sha)return {repaired:false,sha256:sha};mkdirSync(dirname(file),{recursive:true});
 const temp=safePath(root,relative(root,file)+'.repair-'+randomUUID()),backup=existsSync(file)?safePath(root,relative(root,file)+'.damaged-'+randomUUID()):null;
 writeFileSync(temp,knownBytes,{flag:'wx',mode:0o600});if(hash(readFileSync(temp))!==sha)throw new AresError('修复暂存内容校验失败',409);
 if(backup){if(dirname(backup)!==dirname(file))throw new AresError('修复备份目录无效');renameSync(file,backup);}
 try{renameSync(temp,file);if(lstatSync(file).isSymbolicLink()||hash(readFileSync(file))!==sha)throw new AresError('修复文件指纹不一致',409);}catch(error){if(backup&&!existsSync(file))renameSync(backup,file);throw error;}
 return {repaired:true,sha256:sha,backupPath:backup?relative(root,backup).split('\\').join('/'):null};
}
export function recordPath(root,category,id){if(!CATEGORIES.has(category)||!digest(id))throw new AresError('项目历史记录ID或类型无效');return safePath(root,'.ares/'+category+'/'+id+'.json');}
export function putProjectRecord(root,category,payload){
 const id=hash(payload),path=recordPath(root,category,id);if(!existsSync(path))atomicJson(path,{schema_version:1,id,createdAt:now(),payload});
 return readProjectRecord(root,category,id);
}
export function readProjectRecord(root,category,id){const record=readJson(recordPath(root,category,id));if(record.schema_version!==1||record.id!==id||hash(record.payload)!==id)throw new AresError('项目历史记录指纹损坏，未回退最新版本',409);return record;}
