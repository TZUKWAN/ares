import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {AresError} from './storage.js';

const actions=new Set(['get-file-info','get-file-link','list-my-files','list-files','read-file','download-file','list-file-versions','get-file-version-download','upload-new-file','list-document-collaborators','list-drive-roles','create-document-comment','list-document-comments','get-share-info','share-file','search-document-collaborators','set-collaborator-permissions']);
export function kdocsExecutable(){const installed=join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'kdocs-cli','kdocs-cli.exe');return existsSync(installed)?installed:'kdocs-cli';}
const writes=new Set(['upload-new-file','create-document-comment','share-file','set-collaborator-permissions']);
/** Only documented numeric codes are classified; raw provider/process text is never echoed. */
function cloudFailure(kind,{write=false,uncertain=false,businessCode}={}){
 const messages={'tool-missing':'未找到金山CLI，请安装后使用CLI自身的登录功能。','tool-unavailable':'金山CLI无法启动，请检查可执行文件及本机执行权限。','auth-required':'金山账号尚未登录或认证已过期，请在本机金山CLI重新登录。','permission-denied':'金山拒绝访问，当前账号没有此文件或操作权限（企业账号限制也可能返回此状态）。','service-unavailable':'金山服务暂时不可用或请求受限；未自动重试，请按服务恢复时间再核对。','request-failed':'金山请求失败，未把错误结果记录为成功。','cancelled':'金山请求已取消。'};
 const unknown=write&&uncertain,error=new AresError(unknown?'金山写入结果未知；请先核对原操作记录和云端结果，勿重复提交。':messages[kind],unknown?409:kind==='auth-required'?401:kind==='permission-denied'?403:kind.startsWith('tool-')||kind==='service-unavailable'?503:502);
 error.reasonCode=unknown?'cloud-write-unknown':'cloud-'+kind;error.outcome=unknown?'unknown':'rejected';error.retryable=false;if(unknown)error.causeCode='cloud-'+kind;if(businessCode!==undefined){error.businessCode=businessCode;error.message+=' 业务码 '+businessCode+'。';}return error;
}
function execute(args,input,{signal,write=false}={}){return new Promise((resolve,reject)=>{const child=execFile(kdocsExecutable(),args,{windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,signal},(error,stdout)=>{
 if(error){
  // Some CLI versions use a nonzero exit with a valid structured API error.
  // A successful payload with a failed process is never accepted as success.
  if(stdout)try{decodeKdocsResponse(JSON.parse(stdout),{write});}catch(parsed){if(parsed instanceof AresError)return reject(parsed);}
  const kind=error.code==='ENOENT'?'tool-missing':['EACCES','EPERM'].includes(error.code)?'tool-unavailable':error.name==='AbortError'?'cancelled':error.killed||error.code==='ETIMEDOUT'?'service-unavailable':'request-failed';
  return reject(cloudFailure(kind,{write,uncertain:!kind.startsWith('tool-')}));
 }resolve(stdout);
 });child.stdin?.on('error',()=>{});child.stdin?.end(input);});}
export async function kdocsCapability(){try{const version=(await execute(['version'])).trim();if(!/^(?:kdocs(?:-cli)?\s+)?v?\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/i.test(version))throw cloudFailure('tool-unavailable');return {installed:true,available:true,version,authenticated:null,connected:false,authentication:'使用金山CLI自身的系统密钥链；ARES不接收或保存Token',accountSupport:'本机此版CLI支持WPS个人账号，企业账号需单独的WPS365适配器',mode:'成员共同编辑工作稿，负责人发布不可变阶段副本'};}catch(error){return {installed:error.reasonCode!=='cloud-tool-missing',available:false,authenticated:null,connected:false,reasonCode:error.reasonCode||'cloud-tool-unavailable',error:error instanceof AresError?error.message:'金山CLI状态暂不可用，未采用原始错误。'};}}
export async function kdocsCall(action,params,{signal}={}){
 if(!actions.has(action))throw new AresError('此金山操作未开放');
 const write=writes.has(action),raw=await execute(['drive',action,'--output','json','--timeout','60000'],JSON.stringify(params),{signal,write});let result;try{result=JSON.parse(raw);}catch{throw cloudFailure('request-failed',{write,uncertain:true});}
 return decodeKdocsResponse(result,{write});
}
/** Only the two documented WPS annotation operations, never arbitrary commands. */
export async function kdocsAnnotationCall(action,params,{signal}={}){
 if(!['read-element','write-element'].includes(action)||params?.type!=='comment'||(action==='read-element'?params.action!=='list':params.action!=='paragraph_insert'))throw new AresError('此文档批注操作未开放');
 const write=action==='write-element',raw=await execute(['wps',action,'--output','json','--timeout','60000'],JSON.stringify(params),{signal,write});let value;try{value=JSON.parse(raw);}catch{throw cloudFailure('request-failed',{write,uncertain:true});}return decodeKdocsResponse(value,{write});
}
/** CLI output can contain both a transport envelope and an API envelope. */
export function decodeKdocsResponse(result,{write=false}={}){
 let value=result;
 for(let depth=0;depth<8;depth++){
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  if(value.isError===true||value.error)throw cloudFailure('request-failed',{write,uncertain:true});
  const codeField=Object.hasOwn(value,'code')?'code':Object.hasOwn(value,'ucode')?'ucode':null;
  if(codeField){const code=value[codeField];if(!(typeof code==='number'&&Number.isSafeInteger(code)||typeof code==='string'&&/^-?\d{1,10}$/.test(code)))throw cloudFailure('request-failed',{write,uncertain:true});if(Number(code)!==0){if(Number(code)===400100&&/全文评论.*(?:关闭|禁用)/.test(String(value.message??value.msg??''))){const error=new AresError('该文档的全文留言已关闭，需要文档作者或团队管理员开启后才能使用。',409);error.reasonCode='document-comments-disabled';error.businessCode=400100;throw error;}const number=Number(code),kind=[401,400006].includes(number)?'auth-required':[403,403001].includes(number)?'permission-denied':[429,429001,429002].includes(number)||number>=500&&number<=599?'service-unavailable':'request-failed';throw cloudFailure(kind,{write,uncertain:kind==='service-unavailable',businessCode:number});}if(Object.hasOwn(value,'data')){value=value.data;continue;}return value;}
  if(typeof value.result==='string'&&['ERROR','FAILED','FAIL'].includes(value.result.toUpperCase()))throw cloudFailure('request-failed',{write,uncertain:true});
  if(Object.hasOwn(value,'data')&&typeof value.result==='string'&&value.result.toUpperCase()==='OK'){value=value.data;continue;}
  return value;
 }
 throw new AresError('金山结果包装层数异常，未将未知结果当作成功',502);
}
export function safeCloudInfo(value){return Object.fromEntries(['id','file_id','drive_id','parent_id','name','type','size','version','mtime'].filter(k=>['string','number','boolean'].includes(typeof value?.[k])).map(k=>[k,value[k]]));}
export function cloudLink(value){try{const u=new URL(value);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&/^(?:www\.|365\.)?kdocs\.cn$/.test(u.hostname)&&/^\/l\/[a-zA-Z0-9_-]{1,256}$/.test(u.pathname))return u.origin+u.pathname;}catch{}return null;}
/** Resolve a document URL from its actual metadata; never activate public sharing. */
export async function resolveCloudLink(info,{signal}={},call=kdocsCall){
 const id=String(info?.id??info?.file_id??'');if(!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw new AresError('金山文件信息没有可核对ID',502);
 const direct=cloudLink(info.link_url);if(direct)return direct;
 const result=await call('get-file-link',{file_id:id},{signal});
 if(String(result?.file_id??result?.id)!==id)throw new AresError('金山链接的文件ID与实际文件不符，未采用链接',502);
 const link=cloudLink(result.file_url??result.link_url);if(!link)throw new AresError('金山没有返回可用的官方文档链接，未使用临时下载地址',502);
 return link;
}
