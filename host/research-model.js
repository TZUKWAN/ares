import {AresError} from './storage.js';
import {researchIndex,researchEntry} from './project-research.js';
import {saveSurvey} from './research-surveys.js';
import {saveInterviewGuide,proposeInterviewCodes} from './research-interviews.js';
import {saveRequirements} from './study-requirements.js';
import {proposeDefense} from './study-defense.js';
import {readProjectObject} from './project-objects.js';

export function modelResearchIndex(root,body={}) {
  if(body.researchId){
    const entry=researchEntry(root,body.researchId,body.researchVersionId);
    if(!body.researchSourceId)return entry;
    const source=entry.item.kind==='requirements'&&body.researchSourceId==='original'?entry.data.source:
      entry.item.kind==='defense'?entry.data.sources.find(source=>source.id===body.researchSourceId):null;
    if(!source?.textObject)throw new AresError('原文依据不属于指定研究版本',404);
    const offset=body.researchSourceOffset??0;
    if(!Number.isSafeInteger(offset)||offset<0)throw new AresError('原文读取位置无效');
    const text=readProjectObject(root,source.textObject.sha256).toString('utf8');
    return {itemId:entry.item.id,versionId:entry.version.id,sourceId:body.researchSourceId,title:source.title||source.name,text:text.slice(offset,offset+12000),
      characters:text.length,offset,nextOffset:offset+12000<text.length?offset+12000:null,sha256:source.textObject.sha256};
  }
  const {items,history,...project}=researchIndex(root);
  return {...project,items:items.filter(row=>['survey','guide','requirements','fact','defense','experiment'].includes(row.kind)).map(({id,title,kind,head,status})=>({id,title,kind,head,status})),
    readSavedVersion:{action:'research',researchId:'项目中已有研究记录ID',researchVersionId:'可选固定版本ID'},
    readSavedSource:{action:'research',researchId:'已读研究记录ID',researchVersionId:'固定版本ID',researchSourceId:'比赛要求用 original；答辩用 sources 中的真实 id',researchSourceOffset:0,note:'按 nextOffset 继续读取，引用固定原文，不使用当前工作稿替代。'},
    proposalTool:{action:'research-proposal',requires:['expectedRevision','proposalKind','design'],publication:'human-confirmed-draft-only'},
    schemas:{defense:{sourceId:'已准备的答辩演练记录ID',sourceVersion:'已读取固定版本',questions:[{id:'q1',question:'根据作品提出的问题',stepId:'对应现有步骤',evidence:[{sourceId:'s1',quote:'所选固定依据中的逐字原文',location:'章节或幻灯片位置'}]}],feedbackAlternative:{feedback:[{questionId:'q1',observation:'只针对已保存的实际回答',suggestion:'可落实的改进',evidence:[{sourceId:'s1',quote:'固定依据中的逐字片段',location:'原文位置'}]}]},note:'questions 与 feedback 二选一；反馈须先读取保存后的实际回答，不给官方评分。'},requirements:{sourceId:'已有比赛原文记录ID',sourceVersion:'已读取版本ID',title:'要求整理建议',rows:[{id:'rule_1',label:'按原文整理的要求',quote:'必须是已保存原文中的逐字片段',kind:'mandatory',stepId:'项目步骤ID或null',artifactId:'步骤作品ID或null'}]},survey:{schemaVersion:1,title:'问卷标题',study:'研究问题、对象、变量和采集目的',description:'填写说明',completion:'感谢填写。',
      pages:[{id:'screening',title:'筛选题',
        questions:[{id:'used',name:'prior_use',type:'single',title:'过去一个月是否使用过该工具？',required:true,group:'经历',dimension:'使用',
          options:[{id:'yes',label:'使用过'},{id:'no',label:'没有使用过'}]}]}]},
      guide:{theme:'主题',goal:'研究目标',question:'核心研究问题',participants:'访谈对象',method:'semi',minutes:30,
        priorities:'研究重点',background:'背景',minutesOpening:3,minutesClosing:3,intro:'开场说明',consent:'知情同意',closing:'结束语',
        modules:[{id:'context',title:'工作经历',minutes:24,questions:[{id:'q1',text:'请介绍一个具体经历。',followups:['当时做了哪些选择？']}]}]},
      codes:{itemId:'指定访谈ID',versionId:'指定访谈版本',bookId:'编码本ID',bookVersion:'编码本版本',codeIds:['existing_code'],
        evidence:{segmentId:'指定证据片段',start:0,end:5,quote:'逐字文本'},memo:'归纳建议'}},

    designNotes:[
      '题型 single, multi, text, longtext, number, likert, matrix, ranking, date。变量和 ID 用英文字母开头，可带数字下划线。',
      '量表按顺序填写 options [{id,label}]，矩阵须有 rows [{id,label}]。数值可设置 min/max，多选可设置数量边界和选项 exclusive。',
      '题目与选项 showIf [{source:先前题目ID,op:answered|missing|eq|neq|has|lacks|gt|gte|lt|lte,value}] 组内且关系。单选比较选项 ID，数值用数字，日期用 YYYY-MM-DD。',
      '页 jumps [{to:后续页ID或 $end,when:条件列表}]，只允许向后续页跳转。比较已观测的类型，避免同条件指向不同页。',
      '本工具保存设计建议。不得生成实际调查数据或编造访谈回答，建议需研究人员采用。'
    ]};
}
export function modelResearchProposal(body,actor) {
  if(actor?.kind!=='agent'||typeof actor.id!=='string')throw new AresError('缺少项目助手权限',403);
  if(body.proposalKind==='survey')return saveSurvey({root:body.root,expectedRevision:body.expectedRevision,definition:body.design},{actor,proposal:true});
  if(body.proposalKind==='guide')return saveInterviewGuide({root:body.root,expectedRevision:body.expectedRevision,design:body.design},{actor,proposal:true});
  if(body.proposalKind==='codes')return proposeInterviewCodes({root:body.root,expectedRevision:body.expectedRevision,design:body.design},actor);
  if(body.proposalKind==='requirements')return saveRequirements({...body.design,root:body.root,expectedRevision:body.expectedRevision},{actor,proposal:true});
  if(body.proposalKind==='defense')return proposeDefense(body,actor);
  throw new AresError('未知研究建议类型');
}
