import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {lstat,mkdir,link,unlink} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {AresError,safePath} from './storage.js';

export const FILE_LIMIT=4*1024*1024*1024;
const digestPattern=/^[a-f0-9]{64}$/;
export async function fileHash(path,signal) {
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(path,{signal}))digest.update(chunk);
  return digest.digest('hex');
}
export async function withResearchFile(root,source,options,use) {
  const {signal,limit=FILE_LIMIT,size,sha256,md5,gitBlob,onBytes}=options;
  if(size!==undefined&&(!Number.isSafeInteger(size)||size<1||size>limit))throw new AresError('文件大小超出可接收范围',413);
  const temp=safePath(root,'.ares/research/pending/'+randomUUID()+'.part');
  await mkdir(dirname(temp),{recursive:true,mode:0o700});
  const digest=createHash('sha256'),secondary=md5?createHash('md5'):null,git=gitBlob?createHash('sha1').update('blob '+size+'\0'):null;
  let bytes=0;
  const inspect=new Transform({transform(chunk,_encoding,callback){
    try{
      bytes+=chunk.length;
      if(bytes>limit||size!==undefined&&bytes>size)throw new AresError('文件超过声明大小或接收上限',413);
      digest.update(chunk);secondary?.update(chunk);git?.update(chunk);onBytes?.(bytes,size??null);callback(null,chunk);
    }catch(error){callback(error);}
  }});
  try{
    await pipeline(source,inspect,createWriteStream(temp,{flags:'wx',mode:0o600}),{signal});
    const fingerprint=digest.digest('hex');
    if(!bytes||size!==undefined&&bytes!==size||sha256&&fingerprint!==sha256||secondary&&secondary.digest('base64')!==md5||git&&git.digest('hex')!==gitBlob)throw new AresError('接收文件的大小或 SHA-256 与提供方不一致',409);
    signal?.throwIfAborted();
    return await use(temp,{bytes,sha256:fingerprint});
  }finally { await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;}); }
}
export async function publishResearchFile(root,temp,file,namespace,extension,signal) {
  if(!['media','datasets'].includes(namespace)||!/^([a-z0-9]{1,12})$/.test(extension)||!digestPattern.test(file.sha256))
    throw new AresError('研究文件记录无效',409);
  const path='.ares/research/'+namespace+'/'+file.sha256.slice(0,2)+'/'+file.sha256+'.'+extension;
  const target=safePath(root,path);
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  signal?.throwIfAborted();
  try { await link(temp,target); }
  catch(error) {
    if(error.code!=='EEXIST')throw error;
    const current=await lstat(target);
    if(!current.isFile()||current.size!==file.bytes||await fileHash(target,signal)!==file.sha256)
      throw new AresError('已登记研究文件损坏，未覆盖此前版本',409);
  }
  return {...file,path};
}
export async function checkResearchFile(root,file,namespace,signal,{integrity=false}={}) {
  const pattern=new RegExp('^\\.ares/research/'+namespace+'/([a-f0-9]{2})/([a-f0-9]{64})\\.[a-z0-9]{1,12}$');
  const match=pattern.exec(file?.path);
  if(!match||match[1]!==match[2].slice(0,2)||file.sha256!==match[2])throw new AresError('研究文件来源不符',409);
  const path=safePath(root,file.path,{existing:true}),info=await lstat(path);
  if(!info.isFile()||info.size!==file.bytes||integrity&&await fileHash(path,signal)!==file.sha256)
    throw new AresError('研究文件内容已变化，请重新导入',409);
  return path;
}
