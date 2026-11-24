import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {AresError} from './storage.js';
import {publicAddress} from './extension-network.js';

const primary={hf:'huggingface.co',kaggle:'api.kaggle.com'};
const hfTransfers=new Set(['cdn-lfs.huggingface.co','cdn-lfs.hf.co','cdn-lfs-us-1.hf.co','cdn-lfs-eu-1.hf.co','cas-bridge.xethub.hf.co','transfer.xethub.hf.co']);
const redirectCodes=new Set([301,302,303,307,308]);
export function allowedDatasetUrl(provider,url,{download=false,redirect=false}={}) {
  if(url.protocol!=='https:'||url.username||url.password||url.hash||(url.port&&url.port!=='443'))return false;
  if(url.hostname===primary[provider])return true;
  if(!download||!redirect)return false;
  if(provider==='hf')return hfTransfers.has(url.hostname);
  return provider==='kaggle'&&(
    url.hostname==='storage.googleapis.com'&&/^\/(?:kagglesdsdata|kaggle-data-sets|kaggle-datasets)\//.test(url.pathname)||
    ['kagglesdsdata.storage.googleapis.com','kaggle-data-sets.storage.googleapis.com','kaggle-datasets.storage.googleapis.com'].includes(url.hostname)||
    url.hostname==='objects.kaggleusercontent.com'
  );
}
function withSignal(promise,signal) {
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(signal.reason);
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted)cancel();
    promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel));
  });
}
function credential(provider,useCredentials) {
  if(!useCredentials)return undefined;
  const name=provider==='hf'?'ARES_HF_TOKEN':'ARES_KAGGLE_TOKEN',token=process.env[name];
  if(!token||token.length>4096||!/^[\x21-\x7e]+$/.test(token))throw new AresError('宿主未配置有效的 '+name,503);
  return 'Bearer '+token;
}
export async function datasetNetwork(provider,address,options={}) {
  const {signal,download=false,useCredentials=false}=options;
  const limits=AbortSignal.timeout(download?60*60*1000:30000);
  const lifetime=signal?AbortSignal.any([signal,limits]):limits;
  let url=new URL(address),payload=options.data===undefined?undefined:JSON.stringify(options.data);
  let method=payload===undefined?'GET':'POST';
  for(let hop=0;hop<=5;hop++){
    lifetime.throwIfAborted();
    if(!allowedDatasetUrl(provider,url,{download,redirect:hop>0}))throw new AresError('数据提供方返回了不受支持的传输地址',502);
    let addresses;
    try { addresses=await withSignal(lookup(url.hostname,{all:true}),lifetime); }
    catch { lifetime.throwIfAborted();throw new AresError('无法解析数据提供方地址',502); }
    if(!addresses.length||addresses.some(row=>!publicAddress(row.address)))throw new AresError('数据提供方没有解析到公网地址',403);
    const selected=addresses[0],authorization=hop===0?credential(provider,useCredentials):undefined;
    const headers={'user-agent':'ARES-research/1.0',accept:download?'*/*':'application/json','accept-encoding':'identity',
      ...(authorization?{authorization}:{}),...(payload!==undefined?{'content-type':'application/json','content-length':Buffer.byteLength(payload)}:{})};
    const response=await new Promise((resolve,reject)=>{
      const outgoing=request(url,{method,headers,signal:lifetime,agent:false,timeout:30000,
        lookup:(_hostname,opts,callback)=>opts?.all?callback(null,[selected]):callback(null,selected.address,selected.family)},resolve);
      outgoing.on('timeout',()=>outgoing.destroy(new AresError('数据提供方响应超时',504)));
      outgoing.on('error',error=>reject(error instanceof AresError?error:new AresError(lifetime.aborted?'数据提供方请求已中断':'连接数据提供方失败',502)));
      outgoing.end(payload);
    });
    const status=response.statusCode;
    if(redirectCodes.has(status)&&download){
      response.destroy();
      if(!response.headers.location||hop===5)throw new AresError('数据下载重定向无效',502);
      try{url=new URL(response.headers.location,url);}catch{throw new AresError('提供方的传输地址无效',502);}
      if(status===303||[301,302].includes(status)&&method==='POST'){method='GET';payload=undefined;}
      // Never send API request bodies or bearer tokens to a transfer host.
      if(url.hostname!==primary[provider]&&method!=='GET')throw new AresError('提供方请求以不受支持的方式移交下载',502);
      continue;
    }
    if(status!==200){
      response.destroy();
      throw new AresError('数据提供方返回 HTTP '+status, status===401||status===403?403:502);
    }
    return {body:response,headers:response.headers};
  }
  throw new AresError('数据下载重定向次数过多',502);
}
