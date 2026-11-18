import {AresError} from './storage.js';
import {researchIndex} from './project-research.js';
import {saveSurvey} from './research-surveys.js';
import {saveInterviewGuide,proposeInterviewCodes} from './research-interviews.js';

export function modelResearchIndex(root) {
  const {items,history,...project}=researchIndex(root);
  return {...project,items:items.filter(row=>['survey','guide'].includes(row.kind)).map(({id,title,kind,head,status})=>({id,title,kind,head,status})),
    proposalTool:{action:'research-proposal',requires:['expectedRevision','proposalKind','design'],publication:'human-confirmed-draft-only'},
    schemas:{survey:{schemaVersion:1,title:'问卷标题',study:'研究问题、对象、变量和采集目的',description:'填写说明',completion:'感谢填写。',
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
  throw new AresError('未知研究建议类型');
}
