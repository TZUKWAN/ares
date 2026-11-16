import {existsSync,readdirSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join,relative,basename} from 'node:path';
import {AresError,hash,home,readJson,atomicJson,locked,now} from './storage.js';
import {parseSkillMetadata,githubTree,readGithubPackage,readLocalPackage,loadPackage,packageReference,PACKAGE_LIMITS} from './skill-packages.js';

const root=()=>join(home(),'ares-skill-library');
const sourceFile=()=>join(root(),'sources.json');
const readSources=()=>readJson(sourceFile(),{schema_version:1,revision:0,sources:[]});
const catalogPath=id=>{if(!/^[a-f0-9]{64}$/.test(id))throw new AresError('技能目录指纹无效');return join(root(),'catalogs',id+'.json');};
function catalog(source){const value=readJson(catalogPath(source.catalogHash));if(hash(value)!==source.catalogHash)throw new AresError('技能来源目录已损坏',409);return value;}
export function libraryInfo(){const data=readSources();return {...data,total:data.sources.reduce((sum,item)=>sum+item.total,0),policy:'索引和来源核验不等于技能运行通过'};}
export function sourceAuthorized(source,authorization){const text=String(authorization||'').replaceAll('\\','/').toLowerCase(),key=source.kind==='github'?source.repository:String(source.path||'').replaceAll('\\','/').replace(/\/$/,'');return !!key&&text.includes(key.toLowerCase());}
export async function addLibrarySource(source,expectedRevision,{signal,authorization='',ownerAction=false}={}){
 if(!source||!['local','github'].includes(source.kind))throw new AresError('来源需要local或公开github');
 if(!ownerAction&&!sourceAuthorized(source,authorization))throw new AresError('技能来源必须由刘总真实用户消息明确提供',403);
 signal?.throwIfAborted();const identity=source.kind==='local'?{kind:'local',path:realpathSync(source.path)}:{kind:'github',repository:source.repository,ref:source.ref||'HEAD'};
 const id='source-'+hash(identity).slice(0,20),entries=[];let resolved;
 if(identity.kind==='local'){
  let visited=0;function walk(directory,depth=0){signal?.throwIfAborted();if(depth>40||++visited>20000)throw new AresError('来源索引超过目录深度/数量限制，未返回截断结果');const children=readdirSync(directory,{withFileTypes:true});
   const body=children.some(item=>item.name==='SKILL.md')?'SKILL.md':children.some(item=>item.name==='SKILL.yaml')&&children.some(item=>item.name==='INSTRUCTIONS.md')?'INSTRUCTIONS.md':null;
   if(body){const path=join(directory,body);if(lstatSync(path).isSymbolicLink()||lstatSync(path).size>PACKAGE_LIMITS.bodyBytes)throw new AresError('技能入口是链接或超过2MiB');const bytes=readFileSync(path),metadata=parseSkillMetadata(bytes.toString('utf8'),basename(directory));entries.push({id:'library-'+hash({source:id,path:relative(identity.path,directory)}).slice(0,24),root:directory,bodyPath:body,bodyHash:hash(bytes),...metadata});}
   for(const item of children)if(item.isDirectory()&&!['.git','.venv','venv','node_modules','__pycache__','.cache'].includes(item.name)){if(item.isSymbolicLink())throw new AresError('技能索引拒绝目录链接');walk(join(directory,item.name),depth+1);}else if(item.isSymbolicLink())throw new AresError('技能索引拒绝链接：'+item.name);
  }walk(identity.path);
 }else{
  resolved=await githubTree(identity.repository,identity.ref,signal);
  for(const item of resolved.tree)if(item.type==='blob'&&/(^|\/)SKILL\.md$/.test(item.path))entries.push({id:'library-'+hash({source:id,path:item.path}).slice(0,24),root:item.path.slice(0,-8).replace(/\/$/,''),bodyPath:'SKILL.md',bodyHash:item.sha,name:item.path.split('/').slice(-2,-1)[0]||identity.repository.split('/')[1],title:item.path,description:'固定提交的技能入口，正文按需读取',entry:item});
 }
 if(!entries.length||entries.length>10000)throw new AresError('来源没有可识别技能，或超过10000项索引限制');
 const data={identity,...(resolved?{commit:resolved.commit,tree:resolved.tree}:{}),entries},catalogHash=hash(data);atomicJson(catalogPath(catalogHash),data);
 return locked(sourceFile(),()=>{const current=readSources();if(current.revision!==expectedRevision)throw new AresError('技能来源目录已更新，请重新读取',409);const record={id,...identity,catalogHash,total:entries.length,indexedAt:now(),...(resolved?{commit:resolved.commit}:{}),authorization:'owner-provided-source'};current.sources=current.sources.filter(item=>item.id!==id);current.sources.push(record);current.revision++;atomicJson(sourceFile(),current);return libraryInfo();});
}
export function removeLibrarySource(id,expectedRevision){return locked(sourceFile(),()=>{const data=readSources();if(data.revision!==expectedRevision)throw new AresError('来源目录已更新',409);if(!data.sources.some(item=>item.id===id))throw new AresError('来源不存在');data.sources=data.sources.filter(item=>item.id!==id);data.revision++;atomicJson(sourceFile(),data);return libraryInfo();});}
export function libraryEntries(){return readSources().sources.flatMap(source=>catalog(source).entries.map(entry=>({...entry,sourceId:source.id,sourceKind:source.kind,repository:source.repository,commit:source.commit,sourceLabel:source.repository||source.path,verification:'indexed-not-executed'})));}
export function searchLibrary(active,{query='',source='',offset=0,limit=12}={}){
 if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>30)throw new AresError('技能目录分页无效');const q=String(query).trim().toLowerCase(),all=new Map(active.map(item=>[item.id,item]));
 for(const item of libraryEntries())if(!all.has(item.id))all.set(item.id,item);
 const rows=[...all.values()].filter(item=>(!q||[item.id,item.title,item.description,item.sourceLabel].filter(Boolean).join(' ').toLowerCase().includes(q))&&(!source||item.sourceId===source||item.repository===source||item.source===source));
 return {total:rows.length,items:rows.slice(offset,offset+limit).map(({content,root,entry,files,...metadata})=>metadata),nextOffset:offset+limit<rows.length?offset+limit:null};
}
export async function materializeLibrarySkill(id,{signal}={}){
 const source=readSources().sources.find(item=>catalog(item).entries.some(entry=>entry.id===id));if(!source)throw new AresError('真实技能索引中找不到此ID');
 const data=catalog(source),entry=data.entries.find(item=>item.id===id);signal?.throwIfAborted();let pack;
 if(source.kind==='local'){
  const body=readFileSync(join(entry.root,entry.bodyPath));if(hash(body)!==entry.bodyHash)throw new AresError('本地技能正文已变化，请重新索引来源',409);pack=readLocalPackage(entry.root);
 }else{
  const cache=join(root(),'materialized',hash({id,commit:source.commit})+'.json'),known=readJson(cache,null);
  if(known)pack=loadPackage(known.packageId,{verify:true});
  else{pack=await readGithubPackage({repository:source.repository,subdirectory:entry.root,ref:source.ref},{signal,pinned:{repository:source.repository,commit:data.commit,tree:data.tree}});atomicJson(cache,{packageId:pack.id});}
 }
 signal?.throwIfAborted();return {entry,pack,skill:packageReference(pack,id),readToken:pack.id};
}
export function knownSourceAllows(source){let path;if(source.kind==='local'){try{path=realpathSync(source.path);}catch{return false;}}return readSources().sources.some(item=>item.kind===source.kind&&(item.kind==='github'?item.repository===source.repository:item.path===path||path.startsWith(item.path+'\\')||path.startsWith(item.path+'/')));}
