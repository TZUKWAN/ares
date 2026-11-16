import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isIP} from 'node:net';
import {AresError} from './storage.js';

export function publicAddress(ip){
 if(isIP(ip)===4){const p=ip.split('.').map(Number);return !(p[0]===0||p[0]===10||p[0]===127||p[0]>=224||p[0]===169&&p[1]===254||p[0]===172&&p[1]>=16&&p[1]<=31||p[0]===192&&(p[1]===168||p[1]===0||p[1]===2)||p[0]===100&&p[1]>=64&&p[1]<=127||p[0]===198&&(p[1]===18||p[1]===19||p[1]===51)||p[0]===203&&p[1]===0&&p[2]===113);}
 // Reject mapped/transition/special IPv6 ranges as well as private/link-local addresses.
 return isIP(ip)===6&&/^2[0-9a-f]{3}:/i.test(ip)&&!/^2001:(?:0{0,4}:|0?db8:|0?10:|0?20:)/i.test(ip)&&!/^2002:/i.test(ip);
}
export function extensionUrl(value){let url;try{url=new URL(value);}catch{throw new AresError('接口地址无效');}if(url.protocol!=='https:'||url.username||url.password||url.hash||url.port&&url.port!=='443'||url.hostname.length>253)throw new AresError('扩展接口须为不含凭据的HTTPS标准端口地址');for(const name of url.searchParams.keys())if(/token|secret|password|api.?key|signature/i.test(name))throw new AresError('接口密钥请通过环境变量引用，不能写入URL');return url;}
function resolutionWithin(promise,signal){return new Promise((resolve,reject)=>{
 const abort=()=>{signal.removeEventListener('abort',abort);reject(new DOMException('请求已取消','AbortError'));};
 signal.addEventListener('abort',abort,{once:true});
 Promise.resolve(promise).then(value=>{signal.removeEventListener('abort',abort);resolve(value);},error=>{signal.removeEventListener('abort',abort);reject(error);});
 if(signal.aborted)abort();
});}
export function extensionResponseValue(value,path){
 if(path)for(const key of path.split('.')){if(!value||typeof value!=='object'||!Object.prototype.propertyIsEnumerable.call(value,key))throw new AresError('接口未返回符合响应路径的JSON',502);value=value[key];}
 if(value===undefined)throw new AresError('接口未返回符合响应路径的JSON',502);return value;
}
export function parseExtensionResponse(raw,path){
 try{return extensionResponseValue(JSON.parse(raw,(_key,value)=>{if(typeof value==='number'&&!Number.isFinite(value))throw new Error('Nonfinite JSON number');return value;}),path);}
 catch{throw new AresError('接口未返回符合响应路径的有效JSON，未采用派生属性或超范围数值',502);}
}
export async function requestExtensionJson(config,input,{signal,onDispatch,deadlineMs=30000,resolveHost=hostname=>lookup(hostname,{all:true})}={}){
 if(!Number.isInteger(deadlineMs)||deadlineMs<1||deadlineMs>30000||typeof resolveHost!=='function')throw new AresError('接口请求时限或解析服务无效');
 const controller=new AbortController(),abort=()=>controller.abort();let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},deadlineMs);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 try{
 controller.signal.throwIfAborted();
 const url=extensionUrl(config.url),hostname=url.hostname.replace(/^\[|\]$/g,''),addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await resolutionWithin(resolveHost(hostname),controller.signal);controller.signal.throwIfAborted();if(!Array.isArray(addresses)||!addresses.length||addresses.some(row=>!publicAddress(row?.address)))throw new AresError('接口解析到本地、私网或保留地址，未发起请求',403);
 const selected=addresses[0],headers={accept:'application/json','content-type':'application/json','user-agent':'ARES/2.1'};
 for(const [name,environmentName] of Object.entries(config.headerEnv||{})){if(!/^[A-Za-z][A-Za-z0-9-]{0,60}$/.test(name)||['host','content-length','connection','transfer-encoding','proxy-authorization'].includes(name.toLowerCase())||!/^[A-Z][A-Z0-9_]{0,100}$/.test(environmentName))throw new AresError('接口请求头或密钥引用无效');const value=process.env[environmentName];if(!value||/[\r\n]/.test(value))throw new AresError('接口需要已配置的环境变量：'+environmentName);headers[name]=value;}
 const payload=config.method==='GET'?undefined:JSON.stringify(input);if(payload&&Buffer.byteLength(payload)>2*1024*1024)throw new AresError('接口输入超过2MiB限制');
 if(config.method==='GET')for(const [key,value] of Object.entries(input)){if(/token|secret|password|api.?key|signature/i.test(key))throw new AresError('GET密钥请改为headerEnv引用');if(value!==null&&!['string','number','boolean'].includes(typeof value))throw new AresError('GET输入仅支持简单查询字段，请用POST传递对象或数组');if(value!==null)url.searchParams.set(key,String(value));}
 return await new Promise((resolve,reject)=>{const req=request(url,{method:config.method||'POST',headers,signal:controller.signal,lookup:(_host,opts,cb)=>opts?.all?cb(null,[selected]):cb(null,selected.address,selected.family),timeout:30000},res=>{if(res.statusCode<200||res.statusCode>=300){res.resume();reject(new AresError('接口返回HTTP '+res.statusCode+'，未跟随重定向或返回模拟结果',502));return;}let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)req.destroy(new AresError('接口结果超过8MiB'));else chunks.push(chunk);});res.on('end',()=>{try{resolve(parseExtensionResponse(Buffer.concat(chunks).toString('utf8'),config.responsePath));}catch{reject(new AresError('接口未返回符合响应路径的JSON',502));}});res.on('error',()=>reject(new AresError('接口响应传输失败',502)));});req.once('finish',()=>onDispatch?.());req.on('timeout',()=>req.destroy(new AresError('接口请求超时，未自动重试写入',504)));req.on('error',error=>reject(error instanceof AresError?error:new AresError(error.name==='AbortError'?'接口请求已取消':'接口连接失败，未记录可能含密钥的原始错误',502)));req.end(payload);});
 }catch(error){if(controller.signal.aborted)throw new AresError(timedOut?'接口请求超过总时限，未自动重试写入':'接口请求已取消',timedOut?504:502);if(error instanceof AresError)throw error;throw new AresError('接口地址解析或连接失败，未记录原始错误',502);}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
