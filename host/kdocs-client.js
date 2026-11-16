import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {AresError} from './storage.js';

const actions=new Set(['get-file-info','get-file-link','list-my-files','list-files','read-file','download-file','list-file-versions','get-file-version-download','upload-new-file','list-document-collaborators','list-drive-roles','create-document-comment','list-document-comments','get-share-info','share-file','search-document-collaborators','set-collaborator-permissions']);
export function kdocsExecutable(){const installed=join(process.env.LOCALAPPDATA||join(homedir(),'AppData','Local'),'kdocs-cli','kdocs-cli.exe');return existsSync(installed)?installed:'kdocs-cli';}
function execute(args,input,{signal}={}){return new Promise((resolve,reject)=>{const child=execFile(kdocsExecutable(),args,{windowsHide:true,encoding:'utf8',timeout:90000,maxBuffer:16*1024*1024,signal},(error,stdout)=>{if(error)return reject(new AresError(error.name==='AbortError'?'金山操作已取消':'金山CLI执行失败，请检查本机登录和文件权限（未保存命令原始输出）',502));resolve(stdout);});child.stdin?.on('error',()=>{});child.stdin?.end(input);});}
export async function kdocsCapability(){try{const version=(await execute(['version'])).trim();return {installed:true,version:version.slice(0,100),authenticated:null,connected:false,authentication:'使用金山CLI自身的系统密钥链；ARES不接收或保存Token',accountSupport:'本机此版CLI支持WPS个人账号，企业账号需单独的WPS365适配器',mode:'成员共同编辑工作稿，负责人发布不可变阶段副本'};}catch{return {installed:false,authenticated:null,connected:false,error:'未找到可用金山CLI；安装后在本机自行登录。'};}}
export async function kdocsCall(action,params,{signal}={}){
 if(!actions.has(action))throw new AresError('此金山操作未开放');
 const raw=await execute(['drive',action,'--output','json','--timeout','60000'],JSON.stringify(params),{signal});let result;try{result=JSON.parse(raw);}catch{throw new AresError('金山CLI未返回有效JSON，未采用原始输出',502);}
 return decodeKdocsResponse(result);
}
/** Only the two documented WPS annotation operations, never arbitrary commands. */
export async function kdocsAnnotationCall(action,params,{signal}={}){
 if(!['read-element','write-element'].includes(action)||params?.type!=='comment'||(action==='read-element'?params.action!=='list':params.action!=='paragraph_insert'))throw new AresError('此文档批注操作未开放');
 const raw=await execute(['wps',action,'--output','json','--timeout','60000'],JSON.stringify(params),{signal});let value;try{value=JSON.parse(raw);}catch{throw new AresError('金山批注未返回有效JSON',502);}return decodeKdocsResponse(value);
}
/** CLI output can contain both a transport envelope and an API envelope. */
export function decodeKdocsResponse(result){
 let value=result;
 for(let depth=0;depth<8;depth++){
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  if(value.isError===true||value.error)throw new AresError('金山请求失败，未采用错误结果',502);
  const codeField=Object.hasOwn(value,'code')?'code':Object.hasOwn(value,'ucode')?'ucode':null;
  if(codeField){const code=value[codeField];if(!(typeof code==='number'&&Number.isSafeInteger(code)||typeof code==='string'&&/^-?\d{1,10}$/.test(code)))throw new AresError('金山返回未知的业务状态格式',502);if(Number(code)!==0){if(Number(code)===400100&&/全文评论.*(?:关闭|禁用)/.test(String(value.message??value.msg??''))){const error=new AresError('该文档的全文留言已关闭，需要文档作者或团队管理员开启后才能使用。',409);error.reasonCode='document-comments-disabled';error.businessCode=400100;throw error;}throw new AresError('金山请求失败，业务码 '+String(code).slice(0,16)+'；请检查登录、目标和权限',502);}if(Object.hasOwn(value,'data')){value=value.data;continue;}return value;}
  if(typeof value.result==='string'&&['ERROR','FAILED','FAIL'].includes(value.result.toUpperCase()))throw new AresError('金山请求失败，未采用错误结果',502);
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
