import {randomUUID} from 'node:crypto';
import {join,relative,isAbsolute,resolve} from 'node:path';
import {realpathSync} from 'node:fs';
import {AresError,home,readJson,atomicJson,locked,hash,now,safePath} from './storage.js';

const authorityPath=()=>join(home(),'ares-extension-authority.json');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function scopeFor(root,project,extension){return {root:realpathSync(root),projectId:project.id,extensionId:extension.id,manifestHash:extension.manifestHash};}
function outsideProject(root){const path=relative(realpathSync(root),resolve(authorityPath()));return isAbsolute(path)||path==='..'||path.startsWith('../')||path.startsWith('..\\');}
function store(){const value=readJson(authorityPath(),{schema_version:1,receipts:{}});if(value.schema_version!==1||!object(value.receipts))throw new AresError('宿主子插件授权记录损坏，未从项目状态推断授权',409);return value;}
function checked(record){if(!object(record))return false;const {fingerprint,...payload}=record;return typeof fingerprint==='string'&&fingerprint===hash(payload)&&['prepared','active','revoked'].includes(record.status);}
function saveReceipt(state,id,payload){state.receipts[id]={...payload,fingerprint:hash(payload)};atomicJson(authorityPath(),state);return id;}
export function prepareExtensionApproval(root,project,extension,actor){
 if(actor.kind!=='user'||!outsideProject(root))throw new AresError('启用子插件需负责人确认，并使用不包含DSH全局设置的独立项目目录',403);
 return locked(authorityPath(),()=>{const state=store(),id=randomUUID();saveReceipt(state,id,{id,scope:scopeFor(root,project,extension),status:'prepared',requestedBy:actor.id,requestedAt:now(),projectRevision:project.revision});return id;});
}
export function activateExtensionApproval(root,project,extension,id){
 return locked(authorityPath(),()=>{const state=store(),receipt=state.receipts[id];if(!checked(receipt)||receipt.status!=='prepared'||hash(receipt.scope)!==hash(scopeFor(root,project,extension)))throw new AresError('子插件授权准备记录无效，未启用',409);
  const persisted=readJson(safePath(root,'.ares/project.json',{existing:true})),current=persisted.workbench?.extensions?.[extension.id];if(persisted.id!==project.id||!current?.enabled||current.grantReceiptId!==id||current.manifestHash!==extension.manifestHash)throw new AresError('项目在启用授权前已变化，请刷新后重新确认',409);
  const {fingerprint,...payload}=receipt;saveReceipt(state,id,{...payload,status:'active',activatedAt:now()});
 });
}
export function revokeExtensionApproval(root,project,extension){
 if(!extension?.grantReceiptId)return;
 return locked(authorityPath(),()=>{const state=store(),id=extension.grantReceiptId,receipt=state.receipts[id];if(!receipt)return;if(!checked(receipt)||hash(receipt.scope)!==hash(scopeFor(root,project,extension)))throw new AresError('原授权记录与项目不符，未覆盖其他项目授权',409);const {fingerprint,...payload}=receipt;saveReceipt(state,id,{...payload,status:'revoked',revokedAt:now()});});
}
export function extensionAccess(root,project,extension){
 if(!extension.enabled)return {allowed:false,status:'disabled'};
 if(!outsideProject(root))return {allowed:false,status:'unsafe-project-scope',error:'项目目录包含宿主全局授权设置，需使用独立竞赛目录'};
 try{const record=extension.grantReceiptId?store().receipts[extension.grantReceiptId]:null;if(!record)return {allowed:false,status:'approval-required'};if(!checked(record))return {allowed:false,status:'authority-damaged'};if(hash(record.scope)!==hash(scopeFor(root,project,extension)))return {allowed:false,status:'scope-mismatch'};return {allowed:record.status==='active',status:record.status};}catch(error){return {allowed:false,status:'authority-unavailable',error:error.message};}
}
