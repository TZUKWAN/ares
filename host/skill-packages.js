import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,lstatSync,realpathSync} from 'node:fs';
import {join,basename,relative,resolve} from 'node:path';
import {AresError,hash,home,readJson,atomicJson,safePath} from './storage.js';

export const PACKAGE_LIMITS={files:128,fileBytes:4*1024*1024,totalBytes:20*1024*1024,bodyBytes:2*1024*1024};
const SKIP=new Set(['.git','.venv','venv','node_modules','__pycache__','.pytest_cache','.cache']);
const storeRoot=()=>join(home(),'ares-skill-packages');
export function packagePath(id){if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))throw new AresError('技能包ID无效');return join(storeRoot(),id);}
export function resourcePath(path){
 if(typeof path!=='string'||!path||path.length>500||path.includes('\\')||path.includes('\0')||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..'||/[<>:"|?*]/.test(part)||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part)))throw new AresError('技能资源路径无效或越界');
 if(path.split('/').some(part=>/^\.env(?:\.|$)|^(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_rsa|id_ed25519|\.?credentials(?:\..*)?|\.?secrets?(?:\..*)?)$/i.test(part)||/\.(pem|key|pfx|p12)$/i.test(part)))throw new AresError('技能包不得包含凭据文件：'+path);
 return path;
}
export function parseSkillMetadata(content,fallback='skill'){
 if(typeof content!=='string'||!content.trim()||Buffer.byteLength(content)>PACKAGE_LIMITS.bodyBytes)throw new AresError('技能正文为空或超过2MiB');
 let name='',description='';
 if(content.startsWith('---')){const match=/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);if(!match)throw new AresError('SKILL.md frontmatter未闭合');const lines=match[1].split(/\r?\n/);
  for(let index=0;index<lines.length;index++){const row=/^(name|description):\s*(.*)$/.exec(lines[index]);if(!row)continue;let value=row[2].trim();if(/^[>|][+-]?$/.test(value)){const parts=[];while(index+1<lines.length&&/^\s/.test(lines[index+1]))parts.push(lines[++index].trim());value=parts.join(' ');}else if(value.startsWith('"')){try{value=JSON.parse(value);}catch{throw new AresError('技能frontmatter字符串无效');}}else if(value.startsWith("'"))value=value.replace(/^'|'$/g,'').replaceAll("''","'");if(typeof value!=='string'||/^[\[{]/.test(value))throw new AresError('技能名称和说明必须为标量文本');if(row[1]==='name')name=value;else description=value;}
 }
 const title=(/^#\s+(.+)$/m.exec(content)||[])[1]||name||fallback;
 return {name:name||fallback,title:String(title).slice(0,120),description:description.slice(0,3000)};
}
function validateFiles(files){
 const seen=new Set();let total=0;
 if(!(files instanceof Map)||!files.size||files.size>PACKAGE_LIMITS.files)throw new AresError('技能包需要1–128个真实文件');
 for(const [path,data]of files){resourcePath(path);const key=path.toLowerCase();if(seen.has(key))throw new AresError('技能资源大小写冲突');seen.add(key);if(!Buffer.isBuffer(data)||data.length>PACKAGE_LIMITS.fileBytes)throw new AresError('技能资源单文件超过4MiB');total+=data.length;if(total>PACKAGE_LIMITS.totalBytes)throw new AresError('技能包超过20MiB');if(data.subarray(0,150).toString().startsWith('version https://git-lfs.github.com/spec/'))throw new AresError('拒绝未展开的Git LFS指针：'+path);}
 for(const path of seen){const pieces=path.split('/');pieces.pop();while(pieces.length){if(seen.has(pieces.join('/')))throw new AresError('技能文件与目录冲突');pieces.pop();}}
}
export function storePackage(files,origin){
 validateFiles(files);let bodyPath='SKILL.md',body=files.get(bodyPath);
 if(!body&&files.has('SKILL.yaml')&&files.has('INSTRUCTIONS.md')){bodyPath='INSTRUCTIONS.md';body=files.get(bodyPath);}
 if(!body)throw new AresError('技能包缺少SKILL.md或SKILL.yaml+INSTRUCTIONS.md');
 const content=new TextDecoder('utf-8',{fatal:true}).decode(body),metadata=parseSkillMetadata(bodyPath==='INSTRUCTIONS.md'?'---\n'+new TextDecoder('utf-8',{fatal:true}).decode(files.get('SKILL.yaml'))+'\n---\n'+content:content,origin.name||'skill');
 const manifest={schema_version:1,origin,metadata:{...metadata,bodyPath,characters:content.length},files:[...files].sort(([left],[right])=>left.localeCompare(right,'en')).map(([path,data])=>({path,bytes:data.length,sha256:hash(data)}))};
 const id=hash(manifest),target=packagePath(id);mkdirSync(storeRoot(),{recursive:true,mode:0o700});if(lstatSync(storeRoot()).isSymbolicLink())throw new AresError('技能包存储不能是链接');
 let repaired=false;
 if(existsSync(target)){try{return loadPackage(id,{verify:true});}catch(error){if(lstatSync(target).isSymbolicLink())throw error;const quarantine=join(storeRoot(),'.damaged-'+id+'-'+randomUUID());if(!resolve(target).startsWith(resolve(storeRoot())+'\\')&&!resolve(target).startsWith(resolve(storeRoot())+'/'))throw new AresError('缓存修复路径越界');renameSync(target,quarantine);repaired=true;}}
 if(!existsSync(target)){const stage=join(storeRoot(),'.stage-'+randomUUID());mkdirSync(join(stage,'files'),{recursive:true,mode:0o700});
  for(const [path,data]of files){const destination=join(stage,'files',...path.split('/'));mkdirSync(resolve(destination,'..'),{recursive:true});writeFileSync(destination,data,{flag:'wx',mode:0o600});}
  atomicJson(join(stage,'manifest.json'),{id,...manifest});try{renameSync(stage,target);}catch(error){if(!existsSync(target))throw error;}
 }
 return {...loadPackage(id,{verify:true}),...(repaired?{cacheRepaired:true}:{})};
}
export function loadPackage(id,{verify=false,body=false}={}){
 const root=packagePath(id);if(!existsSync(root))throw new AresError('固定技能包不存在：'+id,404);if(lstatSync(root).isSymbolicLink())throw new AresError('技能包目录不能是链接');const record=readJson(safePath(root,'manifest.json',{existing:true})),{id:stored,...manifest}=record;
 if(stored!==id||manifest.schema_version!==1||hash(manifest)!==id||!Array.isArray(manifest.files)||manifest.files.length>PACKAGE_LIMITS.files)throw new AresError('技能包清单已损坏',409);
 let content;
 if(verify||body){for(const item of manifest.files){resourcePath(item.path);if(!verify&&item.path!==manifest.metadata.bodyPath)continue;const path=safePath(join(root,'files'),item.path,{existing:true}),data=readFileSync(path);if(data.length!==item.bytes||hash(data)!==item.sha256)throw new AresError('技能包文件哈希不匹配：'+item.path,409);if(item.path===manifest.metadata.bodyPath)content=new TextDecoder('utf-8',{fatal:true}).decode(data);}}
 return {...record,root:join(root,'files'),...(body||verify?{content}:{}),verification:'source-files-verified-not-executed'};
}
export function packageReference(record,id){return {id:id||'imported-'+record.id.slice(0,24),title:record.metadata.title,description:record.metadata.description,packageId:record.id,source:'imported'};}
export function readPackageResource(id,path){const record=loadPackage(id),item=record.files.find(row=>row.path===path);if(!item)throw new AresError('资源不在真实技能包清单内');const data=readFileSync(safePath(record.root,resourcePath(path),{existing:true}));if(hash(data)!==item.sha256)throw new AresError('技能资源哈希不匹配',409);let content=null;try{content=new TextDecoder('utf-8',{fatal:true}).decode(data);}catch{}return {...item,content,binary:content===null,bodyHash:item.sha256};}
export function editPackage(id,{content,resources=[]}={}){
 const original=loadPackage(id,{verify:true}),files=new Map(original.files.map(item=>[item.path,readFileSync(safePath(original.root,item.path,{existing:true}))]));
 if(content!==undefined)files.set(original.metadata.bodyPath,Buffer.from(content));
 for(const item of resources){resourcePath(item.path);const old=files.get(item.path),expected=old?hash(old):null;if(item.expectedContentHash!==expected)throw new AresError('资源已变化或尚未读取：'+item.path,409);if(item.remove){if(item.path===original.metadata.bodyPath)throw new AresError('不能删除技能正文');files.delete(item.path);}else{if(typeof item.content!=='string')throw new AresError('资源编辑需要UTF-8文本');files.set(item.path,Buffer.from(item.content));}}
 return storePackage(files,{...original.origin,derivedFrom:id});
}
export function readLocalPackage(root){
 const source=realpathSync(root);if(!lstatSync(source).isDirectory())throw new AresError('本地技能来源必须是目录');const files=new Map();let total=0;
 function walk(directory,prefix=''){for(const entry of readdirSync(directory,{withFileTypes:true})){if(SKIP.has(entry.name))continue;const path=prefix+entry.name,full=join(directory,entry.name);if(entry.isSymbolicLink())throw new AresError('技能包拒绝符号链接：'+path);if(entry.isDirectory())walk(full,path+'/');else if(entry.isFile()){resourcePath(path);const size=lstatSync(full).size;if(size>PACKAGE_LIMITS.fileBytes||files.size>=PACKAGE_LIMITS.files||(total+=size)>PACKAGE_LIMITS.totalBytes)throw new AresError('技能包超过文件数量或大小限制');files.set(path,readFileSync(full));}}}
 walk(source);return storePackage(files,{kind:'local',path:source,name:basename(source)});
}
export const gitBlobHash=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
export async function githubRequest(url,{signal,maxBytes=8*1024*1024,json=false,timeoutMs=30000}={}){
 const parsed=new URL(url);if(!['api.github.com','raw.githubusercontent.com'].includes(parsed.hostname)||parsed.protocol!=='https:')throw new AresError('GitHub来源地址无效');
 for(let attempt=0;attempt<2;attempt++){
  signal?.throwIfAborted();try{
   const response=await fetch(parsed,{redirect:'error',headers:{accept:'application/vnd.github+json','user-agent':'ARES-skill-library','X-GitHub-Api-Version':'2022-11-28'},signal:signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs)});
   if(!response.ok)throw new AresError('GitHub读取失败：HTTP '+response.status+(response.status===403||response.status===429?'（可能达到公开接口额度）':''),502);
   let size=0;const chunks=[];for await(const chunk of response.body){size+=chunk.length;if(size>maxBytes)throw new AresError('GitHub响应超过允许大小');chunks.push(chunk);}const data=Buffer.concat(chunks);return json?JSON.parse(data.toString('utf8')):data;
  }catch(error){if(signal?.aborted)throw signal.reason;if(error instanceof AresError)throw error;if(attempt===1)throw new AresError('GitHub传输失败 '+parsed.hostname+parsed.pathname+'：'+(error.cause?.code||error.message),502);}
 }
}
export async function githubTree(repository,ref='HEAD',signal){
 if(typeof repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(repository)||repository.split('/').some(part=>part==='.'||part==='..')||typeof ref!=='string'||!ref||ref.length>256)throw new AresError('需要公开GitHub owner/repo及有效ref');
 const commit=await githubRequest('https://api.github.com/repos/'+repository+'/commits/'+encodeURIComponent(ref),{signal,json:true});if(!/^[a-f0-9]{40}$/.test(commit.sha))throw new AresError('GitHub没有返回真实固定提交');
 const treeSha=commit.commit?.tree?.sha;if(!/^[a-f0-9]{40}$/.test(treeSha))throw new AresError('GitHub未返回对应提交的真实树对象');const tree=await githubRequest('https://api.github.com/repos/'+repository+'/git/trees/'+treeSha+'?recursive=1',{signal,json:true});if(tree.truncated||!Array.isArray(tree.tree))throw new AresError('GitHub目录被截断，未假装完整导入');return {repository,commit:commit.sha,treeSha,tree:tree.tree};
}
export async function readGithubBlob(repository,commit,item,signal){
 resourcePath(item.path);if(item.type!=='blob'||!['100644','100755'].includes(item.mode)||!Number.isInteger(item.size)||item.size>PACKAGE_LIMITS.fileBytes)throw new AresError('GitHub资源类型、链接或大小不符合要求：'+item.path);
 let data;
 try{data=await githubRequest('https://raw.githubusercontent.com/'+repository+'/'+commit+'/'+item.path.split('/').map(encodeURIComponent).join('/'),{signal,maxBytes:PACKAGE_LIMITS.fileBytes,timeoutMs:10000});}
 catch(error){signal?.throwIfAborted();const blob=await githubRequest('https://api.github.com/repos/'+repository+'/git/blobs/'+item.sha,{signal,json:true,maxBytes:6*1024*1024});if(blob.encoding!=='base64'||blob.sha!==item.sha||typeof blob.content!=='string')throw new AresError('GitHub没有返回对应固定blob内容',502);data=Buffer.from(blob.content.replace(/\s/g,''),'base64');}
 if(data.length>PACKAGE_LIMITS.fileBytes||gitBlobHash(data)!==item.sha)throw new AresError('GitHub Git blob哈希核对失败：'+item.path,409);return data;
}
export async function readGithubPackage(source,{signal,pinned}={}){
 const resolved=pinned||await githubTree(source.repository,source.ref||'HEAD',signal),subdirectory=source.subdirectory?resourcePath(source.subdirectory.replace(/\/$/,'')):'';
 const prefix=subdirectory?subdirectory+'/':'',selected=resolved.tree.filter(item=>item.path.startsWith(prefix)&&item.type!=='tree'&&!item.path.slice(prefix.length).split('/').some(part=>SKIP.has(part)));
 if(selected.length>PACKAGE_LIMITS.files)throw new AresError('此技能超过128文件；请指定单个技能子目录');
 const files=new Map();for(const item of selected){signal?.throwIfAborted();files.set(item.path.slice(prefix.length),await readGithubBlob(resolved.repository,resolved.commit,item,signal));}
 // Preserve an ancestor license alongside the selected skill without importing sibling skills.
 const license=resolved.tree.find(item=>/^(LICENSE|COPYING)(\.[^/]*)?$/i.test(item.path)&&item.type==='blob');if(license&&!files.has(license.path))files.set(license.path,await readGithubBlob(resolved.repository,resolved.commit,license,signal));
 return storePackage(files,{kind:'github',repository:resolved.repository,commit:resolved.commit,subdirectory,requestedRef:source.ref||'HEAD'});
}
