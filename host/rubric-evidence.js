/** Historical archive provenance. Unknown scope never means all editions. */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,sep} from 'node:path';
import {safePath} from './storage.js';

const ROOT=fileURLToPath(new URL('../',import.meta.url));
const sha=value=>createHash('sha256').update(value).digest('hex');
const adviceKeys=new Set(['scoring_points','common_deductions','judge_preferences','past_winning_patterns','notes']);
const categories=new Set(['official-rule','official-supplement','supported-interpretation','advice','unverified']);
const states=new Set(['unverified','verified','withdrawn']);
export function rubricFieldValues(rubric){
 const fields=new Map();
 function walk(value,path,advice=false){
  if(typeof value==='string')fields.set(path,{value,advice});
  else if(Array.isArray(value))value.forEach((child,index)=>walk(child,path+'/'+index,advice));
  else if(value&&typeof value==='object')for(const [key,child]of Object.entries(value))if(!['provenance','sources','confidence','last_updated'].includes(key))walk(child,path+'/'+key,advice||adviceKeys.has(key));
 }
 walk(rubric,'');return fields;
}
function exactScope(scope,requested){return !!scope&&!!requested&&scope.competitionId===requested.competitionId&&typeof scope.edition==='string'&&!!scope.edition.trim()&&scope.edition===requested.edition&&Array.isArray(scope.tracks)&&scope.tracks.includes(requested.track)&&Array.isArray(scope.groups)&&typeof requested.group==='string'&&!!requested.group.trim()&&scope.groups.includes(requested.group);}
function readSourceSnapshot(path){
 if(typeof path!=='string'||isAbsolute(path))throw Error('Invalid source snapshot path');
 const directory=resolve(ROOT,'data/rule-sources'),target=resolve(ROOT,path),rel=relative(directory,target);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw Error('Source snapshot escapes archive');
 return readFileSync(safePath(ROOT,path,{existing:true}));
}
export function assessRubric(rubric,requested,{readSnapshot=readSourceSnapshot}={}){
 const provenance=rubric?.provenance,values=rubricFieldValues(rubric),fields=provenance?.fields;
 const validStructure=provenance?.schemaVersion===1&&provenance.ruleVersion===rubric.last_updated&&typeof provenance.ruleVersion==='string'&&provenance.scope?.competitionId===rubric?.competition_id&&fields&&typeof fields==='object'&&!Array.isArray(fields)&&Object.keys(fields).length===values.size&&values.size>0&&Array.isArray(provenance.sourceChecks)&&provenance.sourceChecks.length===rubric.sources?.length;
 const sources=new Map((Array.isArray(provenance?.sourceChecks)?provenance.sourceChecks:[]).map((row,index)=>[row.id,{...row,urlCurrent:row.id==='source-'+(index+1)&&row.urlSha256===sha(String(rubric.sources?.[index]?.url||''))}]));
 const result=[];
 for(const [path,{value}]of values){
  const field=fields?.[path],scope=field?.scope||provenance?.scope;
  let state=!validStructure||!field?'missing':field.sha256!==sha(value)?'stale':states.has(field.state)&&categories.has(field.category)?field.state:'invalid';
  const refs=field?.sourceIds,refsValid=Array.isArray(refs)&&refs.every(id=>sources.get(id)?.urlCurrent);
  if(!refsValid)state='stale';
  if(state==='verified'){
   const evidence=field.evidence,source=sources.get(evidence?.sourceId);
   try{
    if(!refs.length||!refs.includes(evidence?.sourceId)||!source?.urlCurrent||source.state!=='verified'||source.locatorKind!=='document'||!evidence.locator||!evidence.reviewer||!/^\d{4}-\d{2}-\d{2}$/.test(evidence.verifiedAt||''))throw Error('No clause evidence');
    const bytes=readSnapshot(evidence.snapshotPath);
    if(!/^[a-f0-9]{64}$/.test(evidence.snapshotSha256||'')||sha(bytes)!==evidence.snapshotSha256||!evidence.quote||!bytes.toString('utf8').includes(evidence.quote))throw Error('Changed source evidence');
   }catch{state='stale';}
   if(state==='verified'&&!exactScope(scope,requested))state='out-of-scope';
  }
  const official=state==='verified'&&['official-rule','official-supplement'].includes(field.category);
  const weight=path.endsWith('/weight')&&official&&field.category==='official-rule'&&typeof field.officialWeight==='number'&&Number.isFinite(field.officialWeight)&&field.officialWeight>=0&&field.officialWeight<=100?field.officialWeight:null;
  result.push({path,state,category:field?.category||'unverified',official,officialWeight:weight,sourceIds:Array.isArray(refs)?refs:[],scope});
 }
 const officialWeights=result.filter(row=>row.path.endsWith('/weight'));
 const scoreEligible=officialWeights.length>0&&officialWeights.every(row=>row.officialWeight!==null)&&Math.abs(officialWeights.reduce((sum,row)=>sum+row.officialWeight,0)-100)<1e-8;
 return {schemaVersion:1,competitionId:rubric?.competition_id,status:!validStructure?'invalid':result.every(row=>row.official||row.category==='advice')?'verified':'unverified',revision:sha(JSON.stringify(rubric)),fieldCount:result.length,verifiedFields:result.filter(row=>row.state==='verified').length,adviceFields:result.filter(row=>row.category==='advice').length,unverifiedFields:result.filter(row=>!row.official&&row.category!=='advice').length,scoreEligible,officialScore:null,fields:result,note:'档案是规则线索；只有对应届次、赛道、组别及原文条款的核验项才是已确认官方规则。负责人登记的项目原文与逐项确认另行核查。'};
}
export function projectRubricEvidence(project){
 const competition=project.competition||{},id=competition.id;
 if(!Number.isSafeInteger(id)||id<1||id>132)return {schemaVersion:1,competitionId:id,status:'not-catalogued',fieldCount:0,verifiedFields:0,unverifiedFields:0,scoreEligible:false,officialScore:null,note:'自建比赛须使用项目实际原文，未套用内置档案。'};
 try{return assessRubric(JSON.parse(readFileSync(new URL('../data/rubrics/'+String(id).padStart(3,'0')+'.json',import.meta.url),'utf8')),{competitionId:id,edition:competition.edition,track:competition.track,group:competition.group});}
 catch{return {schemaVersion:1,competitionId:id,status:'unavailable',scoreEligible:false,officialScore:null,note:'档案不可读取，未替换成已确认规则。'};}
}
