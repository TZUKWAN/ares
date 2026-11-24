import {execFile} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {AresError,now} from './storage.js';
import {kdocsExecutable,kdocsCapability,kdocsCall} from './kdocs-client.js';

/** Authentication and cloud access are checked independently of a project folder. */
export async function kdocsAccountStatus({signal}={}) {
  const capability=await kdocsCapability();
  const result={...capability,checkedAt:now(),status:'unavailable'};
  if(!capability.available)return result;
  let local;
  try {
    local=await new Promise((resolve,reject)=>{
      const child=execFile(kdocsExecutable(),['auth','status'],{
        windowsHide:true,encoding:'utf8',timeout:15000,maxBuffer:128*1024,signal
      },(error,stdout)=>{
        if(error)return reject(new AresError('暂时无法读取金山认证状态',503));
        try { resolve(JSON.parse(stdout)); }
        catch { reject(new AresError('金山认证状态格式无法识别',502)); }
      });
      child.stdin?.on('error',()=>{});
      child.stdin?.end();
    });
  }catch(error){return {...result,error:error.message};}
  // The CLI also returns credential fields. Only these explicit booleans escape.
  result.authenticated=local.authenticated===true;
  result.credentialStore=local.source==='system keychain'?'系统密钥链':'金山 CLI';
  if(!result.authenticated)return {...result,status:'login-required',error:'请先认证金山账号'};
  try {
    const listing=await kdocsCall('list-my-files',{page_size:1},{signal});
    if(!Array.isArray(listing?.items)||!listing.drive_id)throw new AresError('金山没有返回可核对的云目录',502);
    return {...result,status:'connected',connected:true,accessVerified:true,error:null};
  }catch(error){
    return {...result,status:error.reasonCode==='cloud-auth-required'?'login-required':'access-error',
      connected:false,authenticated:error.reasonCode==='cloud-auth-required'?false:result.authenticated,
      reasonCode:error.reasonCode||'cloud-request-failed',error:error.message};
  }
}

/** A login only starts after an explicit owner action in the ARES interface. */
export function createKdocsAccount() {
  let operation=null,child=null,deadline=null,disposed=false;
  const read=()=>operation?{...operation}:{status:'idle'};
  function finish(id,updates) {
    if(operation?.id===id)Object.assign(operation,updates);
  }
  function login(body) {
    if(disposed)throw new AresError('金山认证服务已关闭',503);
    if(body.confirmLogin!==true)throw new AresError('请在金山账号页面点击认证',403);
    if(operation&&['authorizing','verifying'].includes(operation.status))return read();
    const id=randomUUID();
    operation={id,status:'authorizing',startedAt:now(),expiresAt:new Date(Date.now()+305000).toISOString()};
    let tail='';
    child=execFile(kdocsExecutable(),['auth','login'],{
      windowsHide:true,encoding:'utf8',timeout:305000,maxBuffer:128*1024
    },async error=>{
      clearTimeout(deadline);child=null;
      if(disposed||operation?.id!==id)return;
      if(error)return finish(id,{status:'failed',error:'金山认证未完成，请重新认证或检查浏览器中的授权结果。',url:undefined});
      finish(id,{status:'verifying',url:undefined});
      const account=await kdocsAccountStatus();
      finish(id,{status:account.connected?'completed':'failed',account,
        error:account.connected?null:account.error||'金山认证后仍无法读取云目录',finishedAt:now()});
    });
    child.stdin?.on('error',()=>{});child.stdin?.end();
    child.stdout?.on('data',chunk=>{
      tail=(tail+chunk).slice(-8192);
      const match=/https:\/\/mcp-center\.wps\.cn\/kdocs-auth\/auth-guide\?auth_code=[a-f0-9-]{36}(?![a-f0-9-])/i.exec(tail+' ');
      if(match)finish(id,{url:match[0]});
    });
    deadline=setTimeout(()=>{
      child?.kill();
      finish(id,{status:'expired',url:undefined,error:'本次认证已到期，请重新开始'});
    },305000);
    deadline.unref?.();
    return read();
  }
  return {read,login,status:kdocsAccountStatus,dispose(){disposed=true;clearTimeout(deadline);child?.kill();child=null;}};
}
