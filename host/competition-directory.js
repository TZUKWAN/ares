/** User catalogue preferences. Never mutates shipped data, workflows or projects. */
import {join,dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {AresError,readJson,home,locked,atomicJson,clone,now} from './storage.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const directoryPath=()=>join(home(),'ares-competition-directory.json');
export const directoryPipelines={L1:'创新创业',L2:'数理建模',L3:'工程与软件',L4:'调研与商业',L5:'设计与影像',L6:'程序竞赛',E1:'人文社科',E2:'实验研究',E3:'仿真与专业技能'};
const empty=()=>({schema_version:1,revision:0,updatedAt:null,nextCompetitionId:1000000,edits:[]});
function name(value,label,max=180){if(typeof value!=='string'||!value.trim()||value.trim().length>max||/[\u0000-\u001f\u007f]/.test(value))throw new AresError(label+'不能为空且不能超过'+max+'字');return value.trim();}
const sameName=(a,b)=>a.normalize('NFKC').toLocaleLowerCase()===b.normalize('NFKC').toLocaleLowerCase();
function seeds(){const tracks=readJson(join(root,'data/tracks.json')).entries;return readJson(join(root,'data/competitions.json')).map(row=>({...row,tracks:tracks.filter(t=>t.competition_id===row.id)}));}
function validate(value){
 if(!value||value.schema_version!==1||!Number.isSafeInteger(value.revision)||value.revision<0||!Number.isSafeInteger(value.nextCompetitionId)||value.nextCompetitionId<1000000||value.nextCompetitionId>2147483647||!Array.isArray(value.edits)||value.edits.length>2000)throw new AresError('比赛目录覆盖记录损坏，未重置用户目录',409);
 const builtins=new Map(seeds().map(c=>[c.id,c])),ids=new Set();
 for(const row of value.edits){
  if(!row||!Number.isSafeInteger(row.id)||row.id<1||ids.has(row.id)||Object.keys(row).some(k=>!['id','custom','name','removed','tracks'].includes(k))||row.custom!==undefined&&row.custom!==true||row.removed!==undefined&&typeof row.removed!=='boolean'||!Array.isArray(row.tracks)||row.tracks.length>256)throw new AresError('比赛目录条目无效',409);
  ids.add(row.id);if(row.name!==undefined)name(row.name,'比赛名称',120);
  if(row.custom){if(row.id<1000000||row.id>=value.nextCompetitionId||builtins.has(row.id)||!row.name)throw new AresError('自建比赛身份无效',409);}else if(!builtins.has(row.id))throw new AresError('内置比赛覆盖身份不存在',409);
  const keys=new Set(),base=builtins.get(row.id)?.tracks||[];
  for(const track of row.tracks){
   if(!track||typeof track.key!=='string'||keys.has(track.key)||Object.keys(track).some(k=>!['key','custom','name','removed','pipeline'].includes(k))||track.custom!==undefined&&track.custom!==true||track.removed!==undefined&&typeof track.removed!=='boolean')throw new AresError('赛道覆盖记录无效',409);
   keys.add(track.key);if(track.name!==undefined)name(track.name,'赛道名称');
   if(track.custom){if(!/^user-[a-f0-9-]{36}$/.test(track.key)||!track.name||!Object.hasOwn(directoryPipelines,track.pipeline))throw new AresError('自建赛道身份或作品方向无效',409);}
   else if(!base.some(t=>t.track===track.key)||track.pipeline!==undefined)throw new AresError('内置赛道覆盖身份无效',409);
  }
 }
 return value;
}
function load(){return validate(readJson(directoryPath(),empty()));}
function merged(state){
 const values=new Map(seeds().map(c=>[c.id,{...c,source:'builtin',removed:false,tracks:c.tracks.map(t=>({...t,name:t.track,source:'builtin',removed:false}))}]));
 for(const row of state.edits){
  const c=row.custom?{id:row.id,name:row.name,aliases:[],level:'自建',category:'自定义',organizer:'',official_url:'',deliverables_required:[],tracks:[],source:'user',removed:false}:values.get(row.id);
  if(row.name!==undefined)c.name=row.name;c.removed=row.removed===true;
  for(const item of row.tracks){let t=c.tracks.find(t=>t.track===item.key);if(item.custom){t={competition_id:c.id,competition_name:c.name,track:item.key,name:item.name,pipeline:item.pipeline,source:'user',removed:false,notes:'用户自建赛道，须核对本届实际规则。'};c.tracks.push(t);}if(item.name!==undefined)t.name=item.name;t.removed=item.removed===true;}
  values.set(c.id,c);
 }
 return [...values.values()];
}
export function directoryCatalog({includeRemoved=false}={}){const rows=merged(load());return rows.filter(c=>includeRemoved||!c.removed).map(c=>({...c,tracks:c.tracks.filter(t=>includeRemoved||!t.removed)}));}
export function competitionDirectory(){const state=load();return {revision:state.revision,pipelines:directoryPipelines,competitions:merged(state).map(c=>({id:c.id,name:c.name,source:c.source,removed:c.removed,tracks:c.tracks.map(t=>({track:t.track,name:t.name,pipeline:t.pipeline,source:t.source,removed:t.removed,legacy:!!t.legacy}))}))};}
export function changeCompetitionDirectory(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['action','expectedRevision','competitionId','track','name','pipeline'].includes(k)))throw new AresError('比赛目录操作字段无效');
 if(!Number.isSafeInteger(body.expectedRevision)||body.expectedRevision<0)throw new AresError('需要当前比赛目录修订号');
 if(!['competition-add','competition-rename','competition-remove','competition-restore','track-add','track-rename','track-remove','track-restore'].includes(body.action))throw new AresError('未知比赛目录操作');
 return locked(directoryPath(),()=>{
  const state=load();if(body.expectedRevision!==state.revision)throw new AresError('比赛目录已被其他窗口更新，输入已保留；请读取最新目录后重试',409);
  const all=merged(state);let changed=true,id=Number(body.competitionId),key=body.track;
  function edit(c){let row=state.edits.find(r=>r.id===c.id);if(!row){row={id:c.id,tracks:[]};state.edits.push(row);}return row;}
  function editTrack(c,t){const row=edit(c);let item=row.tracks.find(r=>r.key===t.track);if(!item){item={key:t.track};row.tracks.push(item);}return item;}
  function uniqueCompetition(label,except){if(all.some(c=>c.id!==except&&sameName(c.name,label)))throw new AresError('已有同名比赛；已删除的比赛可在管理中恢复');}
  function uniqueTrack(c,label,except){if(c.tracks.some(t=>t.track!==except&&sameName(t.name,label)))throw new AresError('本比赛已有同名赛道；已删除的赛道可恢复');}
  if(body.action==='competition-add'){
   const label=name(body.name,'比赛名称',120);uniqueCompetition(label);const pipeline=body.pipeline||'L1';if(!Object.hasOwn(directoryPipelines,pipeline))throw new AresError('请选择实际作品方向');
   if(all.length>=2000)throw new AresError('比赛目录最多保留2000项');id=state.nextCompetitionId++;key='user-'+randomUUID();state.edits.push({id,custom:true,name:label,tracks:[{key,custom:true,name:'默认赛道',pipeline}]});
  }else{
   const c=all.find(c=>c.id===id);if(!c)throw new AresError('比赛不存在',404);
   if(body.action==='competition-rename'){const label=name(body.name,'比赛名称',120);uniqueCompetition(label,c.id);changed=label!==c.name;if(changed)edit(c).name=label;}
   else if(body.action==='competition-remove'||body.action==='competition-restore'){const remove=body.action==='competition-remove';changed=c.removed!==remove;if(changed)edit(c).removed=remove;}
   else{
    if(c.removed)throw new AresError('请先恢复比赛，再管理其赛道',409);
    if(body.action==='track-add'){
     const label=name(body.name,'赛道名称');uniqueTrack(c,label);const pipeline=body.pipeline||c.tracks.find(t=>!t.removed)?.pipeline||'L1';if(!Object.hasOwn(directoryPipelines,pipeline))throw new AresError('请选择实际作品方向');if(c.tracks.length>=256)throw new AresError('每个比赛最多保留256个赛道');key='user-'+randomUUID();edit(c).tracks.push({key,custom:true,name:label,pipeline});
    }else{
     const t=c.tracks.find(t=>t.track===key);if(!t)throw new AresError('赛道不属于当前比赛',404);
     if(body.action==='track-rename'){const label=name(body.name,'赛道名称');uniqueTrack(c,label,t.track);changed=label!==t.name;if(changed)editTrack(c,t).name=label;}
     else{const remove=body.action==='track-remove';changed=t.removed!==remove;if(changed)editTrack(c,t).removed=remove;}
    }
   }
  }
  if(changed){state.revision++;state.updatedAt=now();validate(state);atomicJson(directoryPath(),state);}
  return {changed,competitionId:id,track:key||null,directory:competitionDirectory()};
 });
}
