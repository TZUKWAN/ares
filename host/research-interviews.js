import {randomUUID} from 'node:crypto';
import {AresError,hash,now} from './storage.js';
import {changeProject} from './projects.js?v=2.3.0-directory1';
import {putProjectObject,readProjectObject} from './project-objects.js';
import {record,researchText,researchId} from '../client/research-survey-model.js';
import {requireKind,researchInput,researchOwner,researchProject,researchState,researchVersion,requireResearchHead,saveResearchVersion,writeResearchVersion} from './project-research.js';

const modes={semi:'半结构式',depth:'深度访谈',focus:'焦点小组'};
const makeId=prefix=>prefix+randomUUID().replaceAll('-','').slice(0,14);
const text=(value,field,max,optional=false)=>researchInput(()=>researchText(value,field,max,optional));
function array(value,max,label) {
  if(!Array.isArray(value)||value.length>max)throw new AresError(label+'最多 '+max+' 项');
  return value;
}
function duration(value,label,max=360) {
  if(!Number.isInteger(value)||value<1||value>max)throw new AresError(label+'须为1至'+max+'分钟');
  return value;
}
export function guideTemplate(input) {
  const theme=text(input.theme,'研究主题',150),minutes=duration(input.minutes??40,'预计时长');
  if(minutes<5)throw new AresError('模板至少需要5分钟');
  const question=text(input.question,'核心研究问题',1500,true)||theme;
  const method=input.method??'semi';
  if(!Object.hasOwn(modes,method))throw new AresError('请选择访谈方式');
  const minutesOpening=Math.max(1,Math.floor(minutes*0.1)),minutesClosing=Math.max(1,Math.floor(minutes*0.1));
  const half=Math.floor((minutes-minutesOpening-minutesClosing)/2);
  const context={
    theme,goal:text(input.goal,'研究目标',2000,true),question,
    participants:text(input.participants,'访谈对象',500,true),method,minutes,
    priorities:text(input.priorities,'访谈重点',2000,true),background:text(input.background,'研究背景',8000,true)
  };
  const core=method==='focus'?'对这个问题，有哪些不同的经验或看法？':'请回忆一个最能说明这个问题的经历，可以按发生顺序说说吗？';
  return {
    ...context,minutesOpening,minutesClosing,
    intro:'说明研究目的、预计时长与参与方式。确认参与者自愿参与，有权跳过问题或退出。',
    consent:'说明资料用途、匿名方式及保留周期。单独征询录音同意，记录同意情况后再开始。',
    closing:'请参与者补充遗漏内容，说明后续使用范围并致谢。',
    modules:[
      {id:'background',title:'经历与背景',minutes:half,questions:[{id:'q1',text:'请介绍和「'+theme+'」相关的经历。',followups:['可以举一个具体例子吗？','当时还有哪些情况影响了您的选择？']}]},
      {id:'focus',title:'核心问题',minutes:minutes-minutesOpening-minutesClosing-half,questions:[
        {id:'q2',text:question,followups:[core,'有哪些地方需要补充或区分？']}
      ]}
    ]
  };
}
function normalizeGuide(input) {
  if(!record(input)||!Object.hasOwn(modes,input.method))throw new AresError('请选择有效访谈方式');
  const guide={
    theme:text(input.theme,'研究主题',150),goal:text(input.goal,'研究目标',2000,true),
    question:text(input.question,'研究问题',1500,true),participants:text(input.participants,'访谈对象',500,true),
    method:input.method,minutes:duration(input.minutes,'预计时长'),
    priorities:text(input.priorities,'访谈重点',2000,true),background:text(input.background,'研究背景',8000,true),
    minutesOpening:duration(input.minutesOpening,'开场'),minutesClosing:duration(input.minutesClosing,'结尾'),
    intro:text(input.intro,'开场说明',2500),consent:text(input.consent,'知情同意说明',2500),closing:text(input.closing,'结束语',2500),
    modules:array(input.modules,16,'模块').map(module=>{
      if(!record(module))throw new AresError('提纲模块无效');
      const questions=array(module.questions,30,'模块问题').map(q=>{
        if(!record(q))throw new AresError('提纲问题无效');
        return {id:researchInput(()=>researchId(q.id,'问题标识')),text:text(q.text,'核心问题',1500),
          followups:array(q.followups??[],12,'追问').map(v=>text(v,'追问问题',1000))};
      });
      if(!questions.length)throw new AresError('每个模块至少有一个问题');
      return {id:researchInput(()=>researchId(module.id,'模块标识')),title:text(module.title,'主题模块',120),minutes:duration(module.minutes,'模块时长'),questions};
    })
  };
  if(!guide.modules.length)throw new AresError('提纲至少需要一个模块');
  const identifiers=[...guide.modules.map(row=>row.id),...guide.modules.flatMap(row=>row.questions.map(q=>q.id))];
  if(new Set(identifiers).size!==identifiers.length)throw new AresError('模块与问题标识须唯一');
  if(guide.modules.reduce((sum,row)=>sum+row.minutes,guide.minutesOpening+guide.minutesClosing)>guide.minutes)
    throw new AresError('开场、模块和结尾时长合计超过预计时长');
  return guide;
}
export function saveInterviewGuide(body,{actor=researchOwner,proposal=false}={}) {
  const data=normalizeGuide(body.templateInput?guideTemplate(body.templateInput):body.design);
  return saveResearchVersion(proposal?{...body,id:undefined}:body,{
    kind:'guide',title:data.theme+' · 访谈提纲',status:proposal?'proposal':'draft',
    provenance:proposal?'proposal':'design',data,actor,
    source:body.sourceId?{itemId:body.sourceId,versionId:body.sourceVersion}:null
  });
}

const timePattern=/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/;
function timestamp(value) {
  const m=timePattern.exec(value);
  if(!m)return null;
  const hours=Number(m[1]||0),minutes=Number(m[2]),seconds=Number(m[3]);
  if(minutes>=60||seconds>=60)return null;
  return (hours*3600+minutes*60+seconds)*1000+Number((m[4]||'').padEnd(3,'0'));
}
const speakerLine=/^([^:\n：]{1,38})[:：]\s*(.+)$/s;
function parseSegment(line) {
  const match=/^\[?([0-9:.,]+)\s*-->\s*([0-9:.,]+)\]?\s*([\s\S]*)$/.exec(line);
  let start=null,end=null,value=line;
  if(match){
    start=timestamp(match[1]);end=timestamp(match[2]);
    if(start===null||end===null||end<=start)throw new AresError('逐字稿片段的时间戳无效');
    value=match[3].trim();
  }
  const identified=value.match(speakerLine);
  if(!value)throw new AresError('逐字稿片段缺少原始文本');
  return {id:makeId('s'),speaker:identified?.[1].trim()||'',start,end,original:identified?.[2].trim()||value,words:[]};
}
function parseTranscript(input,format) {
  const normalized=input.replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n').trim();
  if(!normalized)return [];
  if(format==='srt'||format==='vtt'){
    const body=normalized.replace(/^WEBVTT[^\n]*(?:\n[^\n]*)*?\n\n/,'');
    const blocks=body.split(/\n\s*\n/).filter(block=>block.trim()&&!/^NOTE(?:\s|$)/.test(block));
    return array(blocks,6000,'转写片段').map(block=>{
      const lines=block.split('\n');if(!lines[0].includes('-->'))lines.shift();
      const [clock,...content]=lines;
      if(!clock?.includes('-->')||!content.length)throw new AresError('逐字稿字幕块缺少时间或正文');
      return parseSegment(clock.replace(/(\d)[ \t]+(?:position|line|size|align|vertical):.*$/,'$1')+' '+content.join('\n'));
    });
  }
  if(format!=='text'&&format!=='notes')throw new AresError('逐字稿支持文本、SRT 或 VTT');
  const rows=array(normalized.split('\n').map(v=>v.trim()).filter(Boolean),6000,'文本片段');
  return rows.map(parseSegment);
}
export function interviewMeta(body) {
  return {
    title:text(body.title,'访谈名称',150),theme:text(body.theme,'访谈主题',500,true),
    participant:text(body.participant,'匿名编号',80,true),
    place:text(body.place,'访谈方式或地点',200,true),
    note:text(body.note,'研究者备忘录',6000,true)
  };
}
export function blankInterview(meta,{source=null,media=null,synthetic=false,transcript=[],sourceLabel='blank'}={}) {
  return {meta,source,media,transcript,edits:{},assignments:[],sourceLabel,dataKind:synthetic?'synthetic':'interview-material'};
}
export function importInterview(body) {
  const meta=interviewMeta(body);
  if(!['notes','text','srt','vtt','blank'].includes(body.format))throw new AresError('请选择访谈材料来源');
  if(body.synthetic===true&&body.confirmSynthetic!==true)throw new AresError('请确认这是单独管理的模拟资料',403);
  const original=body.format==='blank'?'':body.content;
  if(typeof original!=='string'||Buffer.byteLength(original)>4*1024*1024)throw new AresError('访谈文本最多4MiB');
  let result;
  const project=changeProject(body,p=>{
    if(body.synthetic!==true&&(p.workbench.syntheticHashes[hash(original)]||original.trimStart().startsWith('ARES_SYNTHETIC_DATA')))
      throw new AresError('该材料标记为模拟，请单独登记');
    const inherited=body.guideId?requireKind(researchVersion(p,body.guideId,body.guideVersion),'guide'):null;
    if(inherited?.version.payload.status==='proposal')throw new AresError('请先采用访谈提纲');
    const data=blankInterview(meta,{
      source:original.trim()?putProjectObject(p.root,Buffer.from(original)):null, synthetic:body.synthetic===true,
      transcript:parseTranscript(original,body.format==='blank'?'text':body.format),sourceLabel:body.format
    });
    if(data.dataKind==='synthetic'&&data.source)
      p.workbench.syntheticHashes[data.source.sha256]={kind:'synthetic',purpose:'simulated-interview',realSampleCount:0};
    result=writeResearchVersion(p,{...body,id:undefined},{
      kind:'interview',title:meta.title,status:data.transcript.length?'needs-review':'blank',
      data,provenance:data.dataKind==='synthetic'?'synthetic':'source-material',
      source:inherited?{itemId:inherited.item.id,versionId:inherited.version.id}:null
    });
  });
  return {...result,revision:project.revision};
}
export function transcriptText(data,segment) {
  return data.edits[segment.id]?.text??segment.original;
}
export function interviewSource(root,id,versionId) {
  const version=requireKind(researchVersion(researchProject(root),id,versionId),'interview');
  const source=version.data.source;
  if(!source)throw new AresError('暂无原始访谈文本',404);
  return readProjectObject(root,source.sha256);
}
export function correctInterview(body) {
  let result;
  const project=changeProject(body,p=>{
    const entry=requireResearchHead(p,body,'interview');
    const data=entry.data;
    if(body.meta)data.meta=interviewMeta(body.meta);
    const edits=array(body.edits??[],6000,'校订片段'),segments=new Map(data.transcript.map(seg=>[seg.id,seg]));
    for(const edit of edits){
      if(!record(edit)||!segments.has(edit.segmentId))throw new AresError('校订目标不属于当前转写');
      const segment=segments.get(edit.segmentId),before=data.edits[segment.id]??{};
      data.edits[segment.id]={
        text:edit.text===undefined?before.text??segment.original:text(edit.text,'校订文本',10000,true),
        speaker:edit.speaker===undefined?before.speaker??segment.speaker:text(edit.speaker,'说话人标识',80,true),
        memo:edit.memo===undefined?before.memo??'':text(edit.memo,'片段备忘录',6000,true),
        uncertain:edit.uncertain===undefined?before.uncertain??false:edit.uncertain===true,
        key:edit.key===undefined?before.key??false:edit.key===true
      };
    }
    const status=body.reviewed===true&&data.transcript.length?'corrected':edits.length?'needs-review':entry.version.payload.status;
    result=writeResearchVersion(p,body,{
      kind:'interview',title:data.meta.title,status,data,
      provenance:entry.version.payload.provenance,source:entry.version.payload.source
    });
  });
  return {...result,revision:project.revision};
}
export function saveCodebook(body) {
  const title=text(body.title,'编码本名称',150);
  const items=array(body.codes,160,'编码').map(code=>{
    if(!record(code))throw new AresError('编码记录无效');
    return {id:researchInput(()=>researchId(code.id,'编码标识')), parent:code.parent||'',name:text(code.name,'编码名称',80),
      memo:text(code.memo,'编码说明',2500,true),archived:code.archived===true};
  });
  const byCode=new Map(items.map(code=>[code.id,code]));
  if(byCode.size!==items.length||new Set(items.map(code=>code.parent+'|'+code.name)).size!==items.length)throw new AresError('同层编码或标识重复');
  if(items.some(code=>code.parent&&(!byCode.has(code.parent)||byCode.get(code.parent).parent||code.parent===code.id)))
    throw new AresError('编码本支持一级和二级编码');
  let result;
  const p=changeProject(body,p=>{
    if(body.id){
      const old=requireResearchHead(p,body,'codebook');
      if(old.data.codes.some(code=>!byCode.has(code.id)))throw new AresError('已有编码可归档，请保留标识以便旧片段溯源');
    }
    result=writeResearchVersion(p,body,{kind:'codebook',title,status:'draft',data:{codes:items},provenance:'design'});
  });
  return {...result,revision:p.revision};
}
export function codingEvidence(entry,segmentId,start,end) {
  const segment=entry.data.transcript.find(row=>row.id===segmentId);
  if(!segment)throw new AresError('证据片段不属于当前访谈');
  const current=transcriptText(entry.data,segment);
  if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<=start||end>current.length||end-start>5000)
    throw new AresError('请选择不超过5000字符的实际语句');
  return {segmentId,start,end,quote:current.slice(start,end),basisVersion:entry.version.id,originalHash:hash(segment),
    sourceStart:segment.start,sourceEnd:segment.end};
}
export function applyCodes(body,{proposal=null}={}) {
  let result;
  const project=changeProject(body,p=>{
    const entry=requireResearchHead(p,body,'interview');
    const book=requireKind(researchVersion(p,body.bookId,body.bookVersion),'codebook');
    const active=new Set(book.data.codes.filter(code=>!code.archived&&!book.data.codes.find(parent=>parent.id===code.parent)?.archived).map(code=>code.id));
    const data=entry.data;
    for(const row of array(body.assignments??[],500,'标注')){
      if(!record(row))throw new AresError('标注无效');
      const proof=codingEvidence(entry,row.segmentId,row.start,row.end);
      if(row.quote!==undefined&&row.quote!==proof.quote)throw new AresError('校订后证据片段已变化，请重新选择',409);
      const ids=array(row.codeIds,15,'片段编码');
      if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!active.has(id)))throw new AresError('请选择编码本中的有效编码');
      data.assignments.push({...proof,id:makeId('a'),codebookId:book.item.id,codebookVersion:book.version.id,
        codeIds:ids, memo:text(row.memo,'分析备忘录',5000,true),status:'confirmed',at:now(),...(proposal?{proposal}:{} )});
    }
    const removals=array(body.removeIds??[],500,'取消标注');
    if(removals.some(id=>!data.assignments.some(a=>a.id===id)))throw new AresError('标注不可撤回');
    data.assignments=data.assignments.filter(a=>!removals.includes(a.id));
    if(data.assignments.length>6000)throw new AresError('访谈标注达到上限');
    result=writeResearchVersion(p,body,{
      kind:'interview',title:entry.item.title,status:data.assignments.length?'coded':entry.version.payload.status,
      data,provenance:entry.version.payload.provenance,source:entry.version.payload.source
    });
  });
  return {...result,revision:project.revision};
}
export function proposeInterviewCodes(body,actor) {
  const project=researchProject(body.root);
  const entry=requireKind(researchVersion(project,body.design?.itemId,body.design?.versionId),'interview');
  const book=requireKind(researchVersion(project,body.design.bookId,body.design.bookVersion),'codebook');
  const segment=body.design.evidence;
  const proof=codingEvidence(entry,segment?.segmentId,segment?.start,segment?.end);
  const ids=array(body.design.codeIds,15,'候选编码');
  if(!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!book.data.codes.some(code=>code.id===id&&!code.archived)))
    throw new AresError('建议须引用编码本中存在的编码');
  if(segment.quote!==proof.quote)throw new AresError('建议中的逐字证据与指定版本不符');
  return saveResearchVersion(body,{
    kind:'report',title:entry.item.title.slice(0,140)+' · 编码建议',status:'proposal',provenance:'proposal',actor,
    source:{itemId:entry.item.id,versionId:entry.version.id},
    data:{kind:'code-proposal',evidence:proof,bookId:book.item.id,bookVersion:book.version.id,codeIds:ids,
      memo:text(body.design.memo,'主题分析建议',5000),dataKind:entry.data.dataKind}
  });
}
export function acceptCodingProposal(body) {
  if(body.confirm!==true)throw new AresError('请明确确认采用该代码建议',403);
  const p=researchProject(body.root),proposal=researchVersion(p,body.id,body.versionId);
  if(proposal.version.payload.status!=='proposal'||proposal.data.kind!=='code-proposal')throw new AresError('请选择当前项目的编码建议');
  const source=proposal.version.payload.source,original=researchVersion(p,source.itemId,source.versionId),current=researchVersion(p,source.itemId);
  if(current.data.assignments.some(row=>row.proposal?.versionId===proposal.version.id))throw new AresError('此编码建议已采用',409);
  const {evidence,bookId,bookVersion,codeIds,memo}=proposal.data;
  if(!matchesAssignment(original,evidence)||!matchesAssignment(current,evidence))throw new AresError('当前校订已改变证据，请重新选择原句',409);
  return applyCodes({...body,id:current.item.id,baseVersion:current.version.id,bookId,bookVersion,assignments:[{...evidence,codeIds,memo}]},
    {proposal:{itemId:proposal.item.id,versionId:proposal.version.id}});
}
function matchesAssignment(entry,assignment) {
  const segment=entry.data.transcript.find(row=>row.id===assignment.segmentId);
  return segment&&hash(segment)===assignment.originalHash&&transcriptText(entry.data,segment).slice(assignment.start,assignment.end)===assignment.quote;
}
export function searchInterviewCodes(body) {
  const p=researchProject(body.root);
  const book=requireKind(researchVersion(p,body.bookId,body.bookVersion),'codebook');
  const query=text(body.query,'检索内容',400,true).toLowerCase(),matches=[];
  if(body.codeId&&!book.data.codes.some(code=>code.id===body.codeId))throw new AresError('请选择编码本内的编码');
  for(const item of Object.values(researchState(p).items)){
    if(item.kind!=='interview'||(item.provenance==='synthetic')!==(body.synthetic===true))continue;
    const entry=researchVersion(p,item.id);
    for(const row of entry.data.assignments){
      if(row.codebookId!==book.item.id||row.status!=='confirmed'||body.codeId&&!row.codeIds.includes(body.codeId)||!matchesAssignment(entry,row))continue;
      if(query&&![row.quote,row.memo,item.title,entry.data.meta.participant].some(value=>value.toLowerCase().includes(query)))continue;
      matches.push({itemId:item.id,title:item.title,versionId:entry.version.id,participant:entry.data.meta.participant,...row});
      if(matches.length===100)return {matches,limited:true};
    }
  }
  return {matches,limited:false};
}
export function linkInterviewMedia(body) {
  let result;
  const p=changeProject(body,project=>{
    const target=requireResearchHead(project,body,'interview');
    const media=requireKind(researchVersion(project,body.mediaId,body.mediaVersion),'interview');
    if(!media.data.media||target.item.provenance==='synthetic')throw new AresError('请选择可用于当前实录的本机音视频');
    if(target.data.transcript.some(row=>row.end!=null&&row.end>Math.round(media.data.media.duration*1000)+200))
      throw new AresError('逐字稿时间戳超出所选音视频时长');
    target.data.media=media.data.media;
    target.data.mediaSource={itemId:media.item.id,versionId:media.version.id};
    result=writeResearchVersion(project,body,{kind:'interview',title:target.item.title,status:target.version.payload.status,data:target.data,
      source:target.version.payload.source,provenance:target.version.payload.provenance});
  });
  return {...result,revision:p.revision};
}
export function analyzeInterviews(body) {
  let result;
  const project=changeProject(body,p=>{
    const book=requireKind(researchVersion(p,body.bookId,body.bookVersion),'codebook');
    const candidates=array(body.interviews??Object.values(researchState(p).items).filter(item=>item.kind==='interview').map(item=>item.id),120,'访谈分析');
    if(new Set(candidates).size!==candidates.length)throw new AresError('比较的访谈须唯一');
    const interviews=candidates.map(id=>requireKind(researchVersion(p,id),'interview'));
    const dataKind=body.synthetic===true?'synthetic':'interview-material';
    const eligible=interviews.filter(entry=>entry.data.dataKind===dataKind&&entry.data.transcript.length>0);
    if(!eligible.length)throw new AresError('此来源类别暂无已整理的访谈');
    const matrix=[['访谈','来源版本',...book.data.codes.map(code=>(book.data.codes.find(parent=>parent.id===code.parent)?.name?book.data.codes.find(parent=>parent.id===code.parent).name+' / ':'')+code.name)]];
    const evidence=[],frequencies=new Map();
    let staleCount=0;
    for(const entry of eligible){
      const counts=new Map();
      for(const assignment of entry.data.assignments.filter(row=>row.codebookId===book.item.id&&row.status==='confirmed')){
        if(!matchesAssignment(entry,assignment)){staleCount++;continue;}
        for(const id of assignment.codeIds){counts.set(id,(counts.get(id)??0)+1);frequencies.set(id,(frequencies.get(id)??0)+1);}
        if(evidence.length>=6000)throw new AresError('证据较多，请按访谈分批分析');
        evidence.push({itemId:entry.item.id,versionId:entry.version.id,participant:entry.data.meta.participant,...assignment});
      }
      matrix.push([entry.data.meta.participant||entry.item.title,entry.version.id,...book.data.codes.map(code=>counts.get(code.id)??0)]);
    }
    const frequenciesList=book.data.codes.map(code=>({id:code.id,parent:code.parent,name:code.name,count:frequencies.get(code.id)??0}));
    const markdown=['# '+book.item.title+' · 主题对比','研究来源 '+(dataKind==='synthetic'?'模拟资料':'已登记访谈材料'),
      '纳入 '+eligible.length+' 份，校订后待定位的历史标注 '+staleCount,
      '## 主题分布',...frequenciesList.map(item=>'- '+item.name+'：'+item.count+' 处'),
      '## 跨访谈矩阵',...matrix.map(row=>row.join(' | ')),
      '## 核对过的证据',...evidence.slice(0,100).map(row=>'- '+(row.participant||row.itemId)+' ['+row.segmentId+'] '+row.quote)
    ].join('\n');
    result=writeResearchVersion(p,{...body,id:undefined},{
      kind:'report',title:book.item.title.slice(0,140)+' · 主题对比',status:'completed',provenance:dataKind==='synthetic'?'synthetic':'source-material',
      source:{itemId:book.item.id,versionId:book.version.id},
      data:{dataKind,markdown,matrix,frequencies:frequenciesList,evidence,staleCount,sources:eligible.map(entry=>({itemId:entry.item.id,versionId:entry.version.id}))}
    });
  });
  return {...result,revision:project.revision};
}
export function guideMarkdown(data) {
  return ['# '+data.theme,'访谈方式 '+modes[data.method]+' · '+data.minutes+' 分钟','研究目标 '+data.goal,'研究问题 '+data.question,
    '访谈对象 '+data.participants,'访谈重点 '+data.priorities,'背景 '+data.background,'## 开场（'+data.minutesOpening+'分钟）',data.intro,data.consent,
    ...data.modules.flatMap(module=>['## '+module.title+'（'+module.minutes+'分钟）',...module.questions.flatMap((q,i)=>[String(i+1)+'. '+q.text,...q.followups.map(line=>'   - '+line)])]),
    '## 结束（'+data.minutesClosing+'分钟）',data.closing].join('\n')+'\n';
}
const clock=(milliseconds,separator='.')=>{
  const v=milliseconds;
  return [Math.floor(v/3600000),Math.floor(v/60000)%60,Math.floor(v/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')+separator+String(v%1000).padStart(3,'0');
};
export function interviewMarkdown(data) {
  return ['# '+data.meta.title,data.meta.theme,data.meta.participant&&'匿名编号 '+data.meta.participant,data.meta.place,data.meta.note,
    ...data.transcript.flatMap(segment=>{
      const edit=data.edits[segment.id]??{};
      return ['## '+[segment.start!==null?clock(segment.start):'',edit.speaker??segment.speaker,edit.key?'关键陈述':'',edit.uncertain?'待复核':''].filter(Boolean).join(' · '),
        transcriptText(data,segment),edit.memo&&'备忘 '+edit.memo];
    })].filter(line=>line&&line!=='## ').join('\n')+'\n';
}
export function interviewSrt(data) {
  const rows=data.transcript.filter(row=>row.start!==null&&row.end!==null);
  if(!rows.length)throw new AresError('当前记录没有可导出的时间戳');
  return rows.map((row,index)=>{
    const speaker=data.edits[row.id]?.speaker??row.speaker;
    return (index+1)+'\n'+clock(row.start,',')+' --> '+clock(row.end,',')+'\n'+(speaker?speaker+'：':'')+transcriptText(data,row);
  }).join('\n\n')+'\n';
}
