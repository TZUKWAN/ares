import {createHash, randomUUID} from 'node:crypto';
import {readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, unlinkSync, realpathSync, lstatSync,linkSync} from 'node:fs';
import {join, resolve, relative, isAbsolute, dirname,basename} from 'node:path';
import {homedir,hostname} from 'node:os';
import {withLockRecoveryGuard} from './lock-recovery.js';

export class AresError extends Error { constructor(message,status=400) { super(message); this.status=status; } }
export const clone=value=>JSON.parse(JSON.stringify(value));
export function stable(value){
 // Hash exactly the JSON representation that is written to disk. Optional
 // undefined object properties disappear; undefined array entries become null.
 const serialized=JSON.stringify(value);if(serialized===undefined)throw new AresError('无法为未定义的JSON值计算指纹');
 const order=item=>item&&typeof item==='object'?(Array.isArray(item)?item.map(order):Object.fromEntries(Object.keys(item).sort().map(key=>[key,order(item[key])]))):item;
 return JSON.stringify(order(JSON.parse(serialized)));
}
export const hash=value=>createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:stable(value)).digest('hex');
export const now=()=>new Date().toISOString();
export const home=()=>process.env.ARES_HOME||process.env.DSH_HOME||join(homedir(),'.dsh');
export function readJson(path,fallback){if(!existsSync(path)){if(fallback!==undefined)return clone(fallback);throw new AresError('文件不存在：'+path,404);}try{return JSON.parse(readFileSync(path,'utf8'));}catch(error){throw new AresError('无法读取 JSON：'+path+'；'+error.message,409);}}
export function atomicJson(path,value){mkdirSync(dirname(path),{recursive:true});const temp=path+'.tmp-'+randomUUID();try{writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{encoding:'utf8',flag:'wx'});renameSync(temp,path);}finally{if(existsSync(temp))unlinkSync(temp);}}
export function locked(path,fn){
 mkdirSync(dirname(resolve(path)),{recursive:true});const target=join(realpathSync(dirname(resolve(path))),basename(path)),lock=target+'.lock',token=randomUUID(),candidate=lock+'.candidate-'+token,owner={schema_version:1,pid:process.pid,host:hostname(),token,createdAt:now()};
 function record(){try{const stat=lstatSync(lock);if(stat.isSymbolicLink())return null;const file=stat.isDirectory()?join(lock,'owner.json'):lock,info=lstatSync(file);if(!info.isFile()||info.isSymbolicLink()||info.size>4096)return null;const value=JSON.parse(readFileSync(file,'utf8'));return value?.schema_version===1&&Number.isSafeInteger(value.pid)&&value.pid>0&&typeof value.token==='string'&&/^[a-f0-9-]{36}$/.test(value.token)&&value.host===hostname()?value:null;}catch{return null;}}
 function dead(value){if(!value)return false;try{process.kill(value.pid,0);return false;}catch(error){return error.code==='ESRCH';}}
 function acquire(){try{linkSync(candidate,lock);return true;}catch(error){if(error.code==='EEXIST')return false;throw new AresError('无法建立保存锁，请检查目录权限与硬链接支持：'+path,503);}}
 function busy(value){throw new AresError(value?'文件正在更新或进程状态尚未确认，请稍后重试：'+path:'保存锁来源未知，未擅自删除；请保留文件并核对旧进程：'+lock,409);}
 function run(){try{return fn();}finally{if(record()?.token!==token)throw new AresError('保存锁发生变化，未删除其他进程的锁',409);unlinkSync(lock);}}
 // Atomic no-replace publication prevents an incomplete owner record and keeps
 // legacy locks intact. NTFS and ordinary local POSIX filesystems support this.
 writeFileSync(candidate,JSON.stringify(owner),{encoding:'utf8',flag:'wx'});
 try{
  if(acquire())return run();const previous=record();if(!dead(previous))return busy(previous);
  return withLockRecoveryGuard(lock,()=>{if(!acquire()){const current=record();if(!dead(current))return busy(current);renameSync(lock,lock+'.abandoned-'+current.token+'-'+randomUUID());if(!acquire())return busy(record());}return run();});
 }finally{unlinkSync(candidate);}
}
export function safePath(root,path,{existing=false}={}){
 if(typeof path!=='string'||!path.trim()||path.includes('\0')||isAbsolute(path)||/^[A-Za-z]:/.test(path))throw new AresError('需要项目内相对路径');
 const base=realpathSync(root),target=resolve(base,path),rel=relative(base,target);
 if(rel==='..'||rel.startsWith('..\\')||rel.startsWith('../')||isAbsolute(rel))throw new AresError('路径越出项目范围');
 let cursor=dirname(target);while(!existsSync(cursor)&&cursor!==base)cursor=dirname(cursor);
 const actual=realpathSync(cursor),r=relative(base,actual);if(r==='..'||r.startsWith('..\\')||r.startsWith('../')||isAbsolute(r))throw new AresError('目录链接越出项目范围');
 if(existsSync(target)){if(lstatSync(target).isSymbolicLink())throw new AresError('不接受链接作为项目证据');const r2=relative(base,realpathSync(target));if(r2==='..'||r2.startsWith('..\\')||r2.startsWith('../')||isAbsolute(r2))throw new AresError('证据链接越出项目范围');}
 else if(existing)throw new AresError('文件不存在：'+path,404);
 return target;
}
