import {existsSync,readFileSync,readdirSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {AresError,clone,hash,home,readJson,atomicJson,locked,safePath,now} from './storage.js';
import {loadVersion} from './catalog.js?v=2.3.0-directory1';

const PREFIX='ares-native-';
const directory=()=>join(home(),'ares-native-versions');
const pathFor=id=>{if(typeof id!=='string'||!/^ares-native-[a-f0-9]{64}$/.test(id))throw new AresError('ARES完整预设版本ID无效');return join(directory(),id+'.json');};
function canonicalRows(rows,base){return rows.map(row=>{const value=clone(row);if(/^\.\.?\//.test(value.name)){if(!base)throw new AresError('相对插件来源缺少固定解析Context');value.name=new URL(value.name,base).href;}if(value.group&&Array.isArray(value.config))value.config=canonicalRows(value.config,base);return value;});}
export function verifyFrozenResources(version){
 let files=0,bytes=0;const root=join(home(),'ares-versions',version.id,'resources');
 for(const skill of version.skills){const base=join(root,skill.id),body=safePath(base,'SKILL.md',{existing:true});if(hash(readFileSync(body))!==hash(skill.content))throw new AresError('固定技能正文已损坏：'+skill.id,409);
  for(const item of skill.resources){const path=safePath(base,item.path,{existing:true});if(!lstatSync(path).isFile())throw new AresError('固定资源不是文件',409);const content=readFileSync(path);bytes+=content.length;files++;if(files>512||bytes>64*1024*1024)throw new AresError('完整会话资源超过512文件/64MiB限制');if(hash(content)!==item.sha256)throw new AresError('固定技能资源已损坏：'+item.path,409);}
 }
}
export function freezeNativeDefinition(definition,{definitionId,resolutionBase=null}={}){
 const version=loadVersion(definitionId);verifyFrozenResources(version);
 const payload={schema_version:1,definitionId,resolutionBase,name:definition.name,description:definition.description||'',order:definition.order??30,plugins:canonicalRows(definition.plugins,resolutionBase)};
 if(Buffer.byteLength(JSON.stringify(payload))>32*1024*1024)throw new AresError('完整原生预设超过32MiB限制');
 const id=PREFIX+hash(payload),file=pathFor(id);
 if(!existsSync(file))atomicJson(file,{id,createdAt:now(),...payload});
 return loadNativeDefinition(id);
}
export function loadNativeDefinition(id){
 const record=readJson(pathFor(id)),{id:stored,createdAt,...payload}=record;
 if(stored!==id||payload.schema_version!==1||PREFIX+hash(payload)!==id)throw new AresError('ARES完整预设声明损坏，未采用最新版',409);
 verifyFrozenResources(loadVersion(payload.definitionId));return record;
}
export function nativeDeclaration(record){return {id:record.id,name:record.name,description:record.description,order:record.order,plugins:clone(record.plugins)};}
export function nativeVersionList(){return existsSync(directory())?readdirSync(directory()).filter(name=>/^ares-native-[a-f0-9]{64}\.json$/.test(name)).map(name=>{const id=name.slice(0,-5);try{const record=loadNativeDefinition(id);return {id,name:record.name,definitionId:record.definitionId,createdAt:record.createdAt,status:'available',scope:'complete-declaration'};}catch(error){return {id,status:'damaged',error:error.message};}}).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))):[];}
export function projectNativeBinding(root,definitionId,presetId){
 const file=safePath(root,'.ares/native-binding.json');
 const checked=()=>{const record=readJson(file,null);if(record&&(record.schema_version!==1||!/^ares-native-[a-f0-9]{64}$/.test(record.presetId)||!/^[a-f0-9]{64}$/.test(record.definitionId)))throw new AresError('项目完整声明绑定损坏，未替换原版本',409);return record;};
 if(presetId===undefined){const record=checked();return record?.definitionId===definitionId?record:null;}
 if(!/^ares-native-[a-f0-9]{64}$/.test(presetId)||!/^[a-f0-9]{64}$/.test(definitionId))throw new AresError('项目完整声明绑定参数无效');
 return locked(file,()=>{const previous=checked();if(previous?.definitionId===definitionId)return previous;
  if(previous)atomicJson(safePath(root,'.ares/native-history/'+Date.now()+'-'+previous.presetId+'.json'),previous);
  const record={schema_version:1,definitionId,presetId,boundAt:now()};atomicJson(file,record);return record;
 });
}
