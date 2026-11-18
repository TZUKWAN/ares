import {createReadStream,readFileSync} from 'node:fs';
import {extname} from 'node:path';
import {changeProject} from './projects.js?v=2.3.0-directory1';
import {projectEvent,sensitiveFile} from './project-artifacts.js';
import {putProjectRecord,readProjectRecord} from './project-objects.js';
import {AresError,hash,now} from './storage.js';
import {requireKind,researchInput,researchProject,researchState,researchVersion,saveResearchVersion} from './project-research.js';
import {checkResearchFile,publishResearchFile,withResearchFile,FILE_LIMIT} from './research-files.js';
import {datasetNetwork} from './research-network.js';
import {parseResearchCsv} from './research-surveys.js';
import {previousResearchJob} from './research-jobs.js';
import {researchText,record} from '../client/research-survey-model.js';

const hf='https://huggingface.co',kaggle='https://api.kaggle.com/v1/datasets.DatasetApiService/';
const providers=new Set(['hf','kaggle']),objectHash=/^[a-f0-9]{64}$/,gitRevision=/^[a-f0-9]{40}$/;
const number=value=>{
  const parsed=typeof value==='string'&&/^\d{1,16}$/.test(value)?Number(value):value;
  return Number.isSafeInteger(parsed)&&parsed>=0?parsed:null;
};
const safeText=(value,limit)=>typeof value==='string'?value.replace(/[\0-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(0,limit):'';
const scopedId=(provider,id)=>{
  if(typeof id!=='string'||id.length>160||!(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(id)||provider==='hf'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$/.test(id)))
    throw new AresError('数据集标识须为提供方仓库名称');
  return id;
};
const displayPath=id=>id.split('/').map(encodeURIComponent).join('/');
const canonical=(provider,id)=>provider==='hf'?hf+'/datasets/'+displayPath(id):'https://www.kaggle.com/datasets/'+displayPath(id);
function sourceFile(value) {
  return typeof value==='string'&&value.length>0&&value.length<=640&&!/[\\:\0-\x1f]/.test(value)&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'&&part!=='.git')&&!sensitiveFile(value)?value:null;
}
function kaggleRef(id) {const [ownerSlug,datasetSlug]=id.split('/');return {ownerSlug,datasetSlug};}
function requiredApproval(body,extra=false) {
  if(body.approveExternal!==true)throw new AresError('请明确授权此操作连接所选数据提供方',403);
  if(extra&&body.confirmLicense!==true)throw new AresError('请先核对数据集许可与使用条件',403);
}
function licenseName(provider,data) {
  if(provider==='hf'){
    const card=data.cardData?.license;
    return safeText(Array.isArray(card)?card.filter(v=>typeof v==='string').join(', '):card,360)||
      safeText((Array.isArray(data.tags)?data.tags:[]).find(tag=>typeof tag==='string'&&tag.startsWith('license:'))?.slice(8),360)||null;
  }
  return safeText(data.licenseName,360)||null;
}
function datasetSummary(provider,data) {
  const id=scopedId(provider,provider==='hf'?data.id??data._id:data.ref);
  return {id,provider,title:safeText(data.title,180)||id,license:licenseName(provider,data),url:canonical(provider,id),
    description:safeText(provider==='kaggle'?data.subtitle??data.description:data.description,1800),
    updatedAt:safeText(data.lastModified??data.lastUpdated,80)||null,bytes:number(data.totalBytes),
    gated:data.gated===true||typeof data.gated==='string'||data.isPrivate===true||data.private===true};
}
function knownSearchRow(provider,row) {
  try {return datasetSummary(provider,row);}catch {return null;}
}
async function readJson(stream,limit=5*1024*1024) {
  let bytes=0;const chunks=[];
  for await (const chunk of stream) {
    bytes+=chunk.length;
    if(bytes>limit)throw new AresError('数据集元数据超过读取上限',502);
    chunks.push(chunk);
  }
  try {
    const response=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(number(response.code)>=400||response.error||response.errorMessage)throw Error();
    return response;
  }catch{throw new AresError('数据提供方未返回有效元数据',502);}
}
function authorize(body,action,detail) {
  return changeProject(body,p=>projectEvent(p.root,p,'research.dataset-'+action,detail));
}
function formalSnapshot(p,snapshot){
  if(!objectHash.test(snapshot)||!researchState(p).catalogSnapshots?.includes(snapshot))throw new AresError('请选择此项目近期核对的数据版本',404);
  const entry=readProjectRecord(p.root,'research-catalog',snapshot);
  if(entry.payload.projectId!==p.id)throw new AresError('数据集快照项目不一致',403);
  return entry.payload;
}
function versionView(provider,dataset,version,files,truncated) {
  if(!files.length)throw new AresError('所选版本未返回可登记的文件',404);
  return {...dataset,provider,version,files,truncated,licenseStatus:dataset.license?'provider-declared':'unspecified'};
}

export function createDatasetTools(jobs,{transport=datasetNetwork}={}) {
  async function metadata(provider,address,data,options) {
    const reply=await transport(provider,address,{...options,data});
    return readJson(reply.body);
  }
  async function search(body,{signal}={}) {
    requiredApproval(body);
    const provider=body.provider;
    if(!providers.has(provider))throw new AresError('请选择数据提供方');
    const q=researchInput(()=>researchText(body.query,'查询关键词',160));
    authorize(body,'search',{provider,queryChars:q.length,credentials:body.useCredentials===true});
    const credentialOptions={signal,useCredentials:body.useCredentials===true};
    const result=provider==='hf'?await metadata(provider,hf+'/api/datasets?'+new URLSearchParams({search:q,limit:'24'}),undefined,credentialOptions):
      await metadata(provider,kaggle+'ListDatasets',{search:q,pageSize:24},credentialOptions);
    const rows=provider==='hf'?result:result.datasets;
    if(!Array.isArray(rows))throw new AresError('数据提供方返回了无效搜索结果',502);
    return {provider,matches:rows.slice(0,24).map(row=>knownSearchRow(provider,row)).filter(Boolean)};
  }
  async function details(body,{signal}={}) {
    requiredApproval(body);
    const provider=body.provider;
    if(!providers.has(provider))throw new AresError('请选择数据提供方');
    const id=scopedId(provider,body.datasetId),project=authorize(body,'metadata',{provider,id,credentials:body.useCredentials===true});
    const auth={signal,useCredentials:body.useCredentials===true};
    let details;
    if(provider==='hf'){
      const address=hf+'/api/datasets/'+displayPath(id);
      const value=await metadata(provider,address,undefined,auth),summary=datasetSummary(provider,value);
      if(summary.id!==id||!gitRevision.test(value.sha))throw new AresError('Hugging Face 未返回所选仓库的固定提交',502);
      const reply=await transport(provider,address+'/tree/'+value.sha+'?recursive=true',auth);
      const contents=await readJson(reply.body);
      if(!Array.isArray(contents))throw new AresError('Hugging Face 未提供有效文件列表',502);
      const files=contents.filter(row=>row.type==='file'&&sourceFile(row.path)).slice(0,400).map(row=>({
        path:row.path,bytes:number(row.size),sha256:objectHash.test(row.lfs?.oid)?row.lfs.oid:null,
        gitBlob:!row.lfs&&gitRevision.test(row.oid)?row.oid:null
      }));
      details=versionView(provider,summary,value.sha,files,contents.length>400||!!reply.headers.link?.includes('rel="next"'));
    }else{
      const ref=kaggleRef(id);
      const value=await metadata(provider,kaggle+'GetDataset',ref,auth);
      const summary=datasetSummary(provider,{...value,ref:value.ref||id}),version=number(value.currentVersionNumber);
      if(summary.id!==id||!version)throw new AresError('Kaggle 未返回所选数据集的固定版本号',502);
      const files=[],seen=new Set();
      let pageToken;
      do {
        const data=await metadata(provider,kaggle+'ListDatasetFiles',{...ref,datasetVersionNumber:version,pageSize:100,...(pageToken?{pageToken}:{})},auth);
        if(!Array.isArray(data.datasetFiles??data.files))throw new AresError('Kaggle 文件列表格式无效',502);
        for(const row of data.datasetFiles??data.files){
          const path=sourceFile(row.name??row.ref);
          if(path&&!files.some(item=>item.path===path))files.push({path,bytes:number(row.totalBytes)||null,sha256:null});
        }
        pageToken=safeText(data.nextPageToken,1500);
        if(pageToken&&seen.has(pageToken))throw new AresError('Kaggle 文件分页回执重复',502);
        seen.add(pageToken);
      }while(pageToken&&seen.size<4&&files.length<400);
      details=versionView(provider,summary,version,files.slice(0,400),!!pageToken||files.length>400);
    }
    let snapshot;
    const current=researchProject(project.root);
    const written=changeProject({root:current.root,expectedRevision:current.revision},p=>{
      if(p.id!==project.id)throw new AresError('当前项目已变化',409);
      const state=researchState(p,{create:true});state.catalogSnapshots??=[];
      if(state.catalogSnapshots.length>=500)throw new AresError('此项目数据版本查询达到上限',409);
      snapshot=putProjectRecord(p.root,'research-catalog',{projectId:p.id,...details,checkedAt:now()});
      state.catalogSnapshots.push(snapshot.id);
      projectEvent(p.root,p,'research.dataset-snapshot',{provider,id,version:details.version,snapshotId:snapshot.id});
    });
    return {...details,snapshotId:snapshot.id,revision:written.revision};
  }
  function download(body) {
    requiredApproval(body,true);
    const project=researchProject(body.root),previous=body.retryId?previousResearchJob(project.root,body.retryId,'dataset-download'):null;
    const snapshotId=previous?.settings.snapshotId??body.snapshotId;
    const snapshot=formalSnapshot(project,snapshotId);
    const selected=previous?.settings.file??body.file;
    const file=snapshot.files.find(row=>row.path===selected);
    if(!file)throw new AresError('请选择已核对的数据集文件',404);
    const catalogFile=hash([snapshot.provider,snapshot.id,snapshot.version,file.path]);
    const existing=Object.values(researchState(project).items).find(row=>row.kind==='dataset'&&row.catalogFile===catalogFile);
    if(existing)throw new AresError('这个文件已经在当前项目的数据资源中',409);
    const settings={provider:snapshot.provider,datasetId:snapshot.id,version:snapshot.version,snapshotId,file:file.path,useCredentials:body.useCredentials===true};
    return jobs.start(body,{kind:'dataset-download',title:('下载 '+file.path).slice(0,200),settings,source:{catalogFile},previous},async({job,signal,update})=>{
      const {provider,id,version}=snapshot,options={download:true,useCredentials:settings.useCredentials,signal};
      const reply=provider==='hf'?await transport(provider,hf+'/datasets/'+displayPath(id)+'/resolve/'+version+'/'+displayPath(file.path),options):
        await transport(provider,kaggle+'DownloadDatasetRaw',{...options,data:{...kaggleRef(id),datasetVersionNumber:version,fileName:file.path}});
      const length=number(reply.headers['content-length']),size=length??file.bytes,encoding=reply.headers['content-encoding'];
      if(encoding&&encoding!=='identity'||length!==null&&file.bytes!==null&&length!==file.bytes||size!==null&&size>FILE_LIMIT){
        reply.body.destroy();
        throw new AresError('提供方文件大小或传输编码与版本清单不符',409);
      }
      const providerMd5=typeof reply.headers['x-goog-hash']==='string'?/(?:^|,\s*)md5=([A-Za-z0-9+/]{22}==)(?:,|$)/.exec(reply.headers['x-goog-hash'])?.[1]:null;
      return withResearchFile(project.root,reply.body,{
        signal, ...(size!==null?{size}:{}), ...(file.sha256?{sha256:file.sha256}:{}),
        ...(providerMd5?{md5:providerMd5}:{}), ...(file.gitBlob&&size!==null?{gitBlob:file.gitBlob}:{}),
        onBytes:(bytes,total)=>update({phase:'downloading',done:bytes,total})
      },async(temp,content)=>{
        update({phase:'publishing',done:content.bytes,total:content.bytes});
        const extension=extname(file.path).slice(1).toLowerCase();
        const published=await publishResearchFile(project.root,temp,content,'datasets',/^[a-z0-9]{1,12}$/.test(extension)?extension:'bin',signal);
        signal.throwIfAborted();
        const current=researchProject(project.root);
        const saved=saveResearchVersion({root:current.root,expectedRevision:current.revision},{
          kind:'dataset',catalogFile,title:safeText(file.path.split('/').at(-1),150),status:'downloaded',provenance:'external-dataset',
          data:{dataKind:'external-dataset',jobId:job.id,provider,datasetId:id,version,snapshotId,license:snapshot.license,licenseStatus:snapshot.licenseStatus,
            sourceUrl:snapshot.url,fileName:file.path,downloadedAt:now(),file:published,
            verification:{sha256:published.sha256,providerDigest:file.sha256?'sha256':file.gitBlob&&size!==null?'git-blob-sha1':providerMd5?'md5':null,
              checkedSize:size!==null}}
        });
        return {itemId:saved.item.id,versionId:saved.version.id,bytes:published.bytes,sha256:published.sha256};
      });
    });
  }
  return {search,details,download};
}

export async function streamDatasetFile(query,_req,res,{signal}) {
  const project=researchProject(query.get('root'));
  const version=requireKind(researchVersion(project,query.get('id'),query.get('versionId')),'dataset');
  const {file,fileName}=version.data,path=await checkResearchFile(project.root,file,'datasets',signal,{integrity:true});
  res.writeHead(200,{'content-type':'application/octet-stream','cache-control':'private, no-store','x-content-type-options':'nosniff',
    'content-length':file.bytes,'content-disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(fileName.split('/').at(-1)).replace(/'/g,'%27')});
  return createReadStream(path,{signal});
}

export async function profileDataset(body,{signal}={}) {
  const project=researchProject(body.root);
  const source=requireKind(researchVersion(project,body.id,body.versionId),'dataset');
  const {file,fileName,sourceUrl}=source.data;
  if(file.bytes>4*1024*1024)throw new AresError('字段分析适用于4MiB以内的 CSV 或 JSON 对象数组，完整文件仍可下载',413);
  const path=await checkResearchFile(project.root,file,'datasets',signal,{integrity:true});
  const text=readFileSync(path,'utf8').replace(/^\uFEFF/,'');
  let columns,rows;
  if(/\.csv$/i.test(fileName)){
    [columns,...rows]=parseResearchCsv(text);
    if(!columns?.length||rows.some(row=>row.length!==columns.length))throw new AresError('CSV 表头或列数有误');
  }else if(/\.json$/i.test(fileName)){
    const data=researchInput(()=>JSON.parse(text));
    if(!Array.isArray(data)||!data.length||data.length>10000||!data.every(row=>record(row)))throw new AresError('JSON 需要1至10000个对象');
    const keys=new Set();
    for (const row of data) for(const key of Object.keys(row)){
      keys.add(key);if(keys.size>200)throw new AresError('字段分析最多200列');
    }
    columns=[...keys];
    rows=data.map(row=>columns.map(key=>Object.hasOwn(row,key)?row[key]:null));
  }else throw new AresError('请选择 CSV 或 JSON 文件');
  if(columns.length>200||new Set(columns).size!==columns.length||columns.some(name=>!name.trim()||name.length>200))
    throw new AresError('字段分析要求唯一非空字段名，最多200列');
  const profile=columns.map((name,index)=>{
    let present=0,numeric=0;
    for(const row of rows){
      const value=row[index];
      if(value===null||value===undefined||value==='')continue;
      present++;if(typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.trim()&&Number.isFinite(Number(value)))numeric++;
    }
    return {name,present,missing:rows.length-present,numeric};
  });
  const markdown=['# 数据集字段概况','外部数据集 '+source.data.datasetId+' · '+source.data.version,
    '来源 '+sourceUrl,'许可 '+(source.data.license??'提供方未声明'),'实际读取 '+rows.length+' 行','## 字段完整性',
    ...profile.map(row=>'- '+row.name+'：有效 '+row.present+'，缺失 '+row.missing+'，可识别数值 '+row.numeric)].join('\n');
  return saveResearchVersion({...body,id:undefined},{kind:'report',title:source.item.title.slice(0,145)+' · 字段概况',status:'completed',
    provenance:'external-dataset',source:{itemId:source.item.id,versionId:source.version.id},
    data:{dataKind:'external-dataset',rowCount:rows.length,profile,markdown,matrix:[['字段','有效','缺失','数值'],...profile.map(row=>[row.name,row.present,row.missing,row.numeric])]}});
}
