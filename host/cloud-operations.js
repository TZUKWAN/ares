import {realpathSync} from 'node:fs';
import {AresError} from './storage.js';
const publications=new Map();
const keyFor=root=>{const value=realpathSync(root);return process.platform==='win32'?value.toLowerCase():value;};
export function assertCloudPublicationIdle(root){if(publications.has(keyFor(root)))throw new AresError('该项目的云发布请求仍在执行，请结束后再核对结果或切换目录',409);}
/** A live promise, not a persisted flag, owns this in-process operation. */
export async function withCloudPublication(root,work){
 const key=keyFor(root);assertCloudPublicationIdle(root);const running={};publications.set(key,running);
 try{return await work();}finally{if(publications.get(key)===running)publications.delete(key);}
}
