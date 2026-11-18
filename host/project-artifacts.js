import {readFileSync,readdirSync,statSync,openSync,readSync,closeSync} from 'node:fs';
import {join,relative} from 'node:path';
import {AresError,hash,safePath,now,clone} from './storage.js';
import {putProjectObject,putProjectRecord,readProjectRecord,readProjectObject} from './project-objects.js';

export const relativeName=value=>String(value).split('\\').join('/');
export const sensitiveFile=path=>path.split(/[\\/]/).some(part=>/^\.env(?:\.|$)|^(?:\.npmrc|\.pypirc|\.netrc|\.git-credentials|id_rsa|id_ed25519|\.?credentials(?:\..*)?|\.?secrets?(?:\..*)?)$/i.test(part)||/\.(pem|key|pfx|p12)$/i.test(part));
export function ensureProjectWorkbench(project){
 project.workbench??={schema_version:1,artifacts:{},releaseIds:[],eventIds:[],team:[{id:'owner',name:'本机项目负责人',role:'leader'}],syntheticHashes:{},collaboration:{provider:null,status:'not-connected'}};
 if(project.workbench.schema_version!==1||!project.workbench.artifacts||!Array.isArray(project.workbench.releaseIds)||!Array.isArray(project.workbench.eventIds)||!Array.isArray(project.workbench.team))throw new AresError('竞赛项目工作台记录损坏',409);
 project.workbench.syntheticHashes??={};return project.workbench;
}
export function projectEvent(root,project,type,detail,actor={kind:'user',id:'owner'}){const state=ensureProjectWorkbench(project),record=putProjectRecord(root,'events',{projectId:project.id,sequence:state.eventIds.length+1,baseRevision:project.revision,type,detail,actor,at:now()});state.eventIds.push(record.id);return record;}
export function completeDirectory(base){const files=[];let bytes=0;function walk(path){for(const item of readdirSync(path,{withFileTypes:true})){if(['.git','node_modules','__pycache__','.ares'].includes(item.name))continue;if(item.isSymbolicLink())throw new AresError('作品目录包含链接');const full=join(path,item.name);if(item.isDirectory())walk(full);else if(item.isFile()){const size=statSync(full).size;bytes+=size;if(size>64*1024*1024||bytes>256*1024*1024||files.length>=1000)throw new AresError('作品版本目录超过大小限制');files.push({path:relativeName(relative(base,full)),sha256:hash(readFileSync(full))});}}}walk(base);return files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);}
export function captureCheckedArtifact(root,project,step,output,check,{actor={kind:'user',id:'owner'},sourceFiles,inputVersions=[],provenance,inputHash=null,sourceVersionId=null}={}){
 if(!check.valid||!check.path||!check.sha256)throw new AresError('只有通过实际检查的作品才能固定版本');
 const state=ensureProjectWorkbench(project),path=relativeName(check.path),source=safePath(root,path,{existing:true});
 const core=output.kind==='directory'?sourceFiles(source):null,raw=output.kind==='directory'?completeDirectory(source):[{path:'',sha256:check.sha256}],files=[];
 if(!raw.length)throw new AresError('作品目录为空，未创建空版本');
 for(const item of raw){const workingPath=relativeName(item.path?join(path,item.path):path);if(sensitiveFile(workingPath))throw new AresError('作品范围内含凭据文件，请调整交付范围：'+workingPath);const bytes=readFileSync(safePath(root,workingPath,{existing:true}));if(hash(bytes)!==item.sha256)throw new AresError('作品在固定过程中变化，请重试',409);files.push({path:relativeName(item.path||workingPath),workingPath,...putProjectObject(root,bytes)});}
 if(output.kind==='directory'&&hash(core)!==check.sha256)throw new AresError('目录内容与刚才的检查不一致',409);
 if(output.kind==='directory'&&hash(sourceFiles(source))!==check.sha256)throw new AresError('目录在保存过程中变化',409);
 if(output.kind==='directory'&&hash(completeDirectory(source))!==hash(raw))throw new AresError('完整目录在固定过程中变化',409);
 const inherited=inputVersions.map(id=>readProjectRecord(root,'artifact-versions',id).payload.provenance).some(value=>value?.kind==='synthetic');
 const known=files.map(file=>state.syntheticHashes[file.sha256]).find(Boolean),detected=syntheticEvidence(root,project,check,output,{sourceFiles}),origin=known||(inherited||detected?{kind:'synthetic',purpose:'model-pretest',inherited}:provenance||{kind:'unverified',reviewRequired:true});
 const payload={projectId:project.id,definitionId:project.definitionId,stepId:step.id,artifactId:output.id,title:output.title,kind:output.kind,workingPath:path,format:output.format||null,heading:output.heading||null,artifactHash:check.sha256,inputHash,inputVersions:[...new Set(inputVersions)].sort(),provenance:clone(origin),files,...(sourceVersionId?{sourceVersionId}:{})};
 const version=putProjectRecord(root,'artifact-versions',payload),entry=state.artifacts[output.id]||{id:output.id,title:output.title,stepId:step.id,versionIds:[]};
 if(!entry.versionIds.includes(version.id))entry.versionIds.push(version.id);entry.currentVersionId=version.id;state.artifacts[output.id]=entry;return version;
}
export function captureTaskArtifacts(root,project,workflow,step,checks,{actor,sourceFiles,inputHash:checkedInputHash}={}){
 const inputVersions=step.dependsOn.flatMap(id=>project.tasks[id]?.acceptedVersionIds||[]),versions=[];
 for(const check of checks.filter(item=>item.valid)){const output=step.outputs.find(item=>item.id===check.id);if(output)versions.push(captureCheckedArtifact(root,project,step,output,check,{actor,sourceFiles,inputVersions,inputHash:checkedInputHash||project.tasks[step.id]?.inputHash||null}));}
 const task=project.tasks[step.id];if(task?.reviewPath){try{task.reviewObject=putProjectObject(root,readFileSync(safePath(root,task.reviewPath,{existing:true}))).sha256;}catch(error){if(task.status==='done')throw error;delete task.reviewObject;task.reviewWarning='旧复核文件缺失；此工作版本没有通过验收';}}
 return versions.map(item=>item.id);
}
export function artifactVersion(root,id,{verify=true}={}){const record=readProjectRecord(root,'artifact-versions',id);if(verify)for(const file of record.payload.files)if(readProjectObject(root,file.sha256).length!==file.bytes)throw new AresError('作品版本大小不符',409);return record;}
export function addReleaseFiles(fileMap,files){
 for(const file of files){
  const key=relativeName(file.workingPath);
  if(sensitiveFile(key))throw new AresError('不能固定凭据文件');
  const previous=fileMap.get(key);
  if(previous&&previous.sha256!==file.sha256)throw new AresError('相同文件对应不同作品内容，请刷新',409);
  fileMap.set(key,{...file,workingPath:key});
 }
}
export function artifactHeads(root,project){const state=ensureProjectWorkbench(project);return Object.values(state.artifacts).map(entry=>{if(!entry.currentVersionId)return {...entry,versionCount:entry.versionIds.length,current:null};try{const record=artifactVersion(root,entry.currentVersionId,{verify:false});return {...entry,versionCount:entry.versionIds.length,current:record};}catch(error){return {...entry,versionCount:entry.versionIds.length,current:null,error:error.message};}});}
export function acceptedVersionsCurrent(root,project,ids){try{return ids.every(id=>{const v=readProjectRecord(root,'artifact-versions',id).payload;if(v.projectId!==project.id)return false;if(v.kind==='directory')return hash(completeDirectory(safePath(root,v.workingPath,{existing:true})))===hash(v.files.map(f=>({path:f.path,sha256:f.sha256})));return v.files.every(file=>hash(readFileSync(safePath(root,file.workingPath,{existing:true})))===file.sha256);});}catch{return false;}}
export function syntheticEvidence(root,project,check,output,{sourceFiles}={}){
 if(!check.valid||!check.path)return false;const path=relativeName(check.path);if(path.split('/').includes('预测试'))return true;
 const known=ensureProjectWorkbench(project).syntheticHashes,items=output.kind==='directory'?sourceFiles(safePath(root,path,{existing:true})).map(item=>({path:path+'/'+relativeName(item.path),sha256:item.sha256})):[{path,sha256:check.sha256}];
 return items.some(item=>{if(known[item.sha256])return true;return syntheticContent(safePath(root,item.path,{existing:true}));});
}
function syntheticContent(path){
 const fd=openSync(path,'r'),prefix=Buffer.alloc(8192);let text;try{text=prefix.subarray(0,readSync(fd,prefix,0,prefix.length,0)).toString('utf8').replace(/^\uFEFF/,'');}finally{closeSync(fd);}
 const first=text.split(/\r?\n/,1)[0];if(first.trim()==='ARES_SYNTHETIC_DATA')return true;
 for(const delimiter of [',','\t',';']){const fields=[];let field='',quoted=false;for(let i=0;i<first.length;i++){const char=first[i];if(char==='"'){if(quoted&&first[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(char===delimiter&&!quoted){fields.push(field.trim());field='';}else field+=char;}fields.push(field.trim());if(fields.includes('__data_kind')&&fields.includes('__synthetic_seed'))return true;}
 // A data declaration is interpreted as JSON, not as a string found inside
 // source code or documentation. This avoids tainting the software itself.
 if(!/^[\s]*[\[{]/.test(text))return false;
 if(statSync(path).size>2*1024*1024)return /"(?:dataKind|__data_kind)"\s*:\s*"synthetic"/.test(text);
 let value;try{value=JSON.parse(readFileSync(path,'utf8').replace(/^\uFEFF/,''));}catch{return false;}
 if(value?.schema_version===1&&['survey-generator','native-tool','http-json'].includes(value.kind)&&typeof value.id==='string'&&typeof value.version==='string'&&value.inputSchema&&value.config)return false;
 const pending=[value];while(pending.length){const item=pending.pop();if(!item||typeof item!=='object')continue;if(Object.hasOwn(item,'dataKind')&&item.dataKind==='synthetic'||Object.hasOwn(item,'__data_kind')&&item.__data_kind==='synthetic')return true;for(const child of Object.values(item))if(child&&typeof child==='object')pending.push(child);}
 return false;
}
