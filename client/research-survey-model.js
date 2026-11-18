/** JSON contract shared by the project store and the browser preview. */
export const QUESTION_TYPES = Object.freeze({
  single:'单选', multi:'多选', text:'填空', longtext:'长文本', number:'数值',
  likert:'量表', matrix:'矩阵', ranking:'排序', date:'日期'
});
const choices = new Set(['single','multi','likert','matrix','ranking']);
const scalarChoices = new Set(['single','likert']);
const identifiers = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
const forbidden = new Set(['constructor','prototype','toString','valueOf','hasOwnProperty','isPrototypeOf','propertyIsEnumerable','toLocaleString']);
const own = (object,key) => Object.prototype.hasOwnProperty.call(object,key);
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function requireValue(condition,message) { if (!condition) throw new Error(message); }
export function researchText(value, label, max, optional=false) {
  if (optional && (value === undefined || value === null)) return '';
  requireValue(typeof value === 'string' && value.length <= max && !value.includes('\0') && (optional || value.trim()), label+'需要'+(optional?'':'非空且')+max+'字符以内的文本');
  return value.trim();
}
export function researchId(value,label) {
  requireValue(typeof value==='string' && identifiers.test(value) && !forbidden.has(value),label+'须使用英文字母开头的短标识');
  return value;
}
function list(value, limit, label) {
  const rows = value === undefined ? [] : value;
  requireValue(Array.isArray(rows) && rows.length<=limit,label+'最多'+limit+'项');
  return rows;
}
function unique(values,label) {
  requireValue(new Set(values).size===values.length,label+'不能重复');
}
const operators = new Set(['eq','neq','has','lacks','gt','gte','lt','lte','answered','missing']);
function normalizeRules(value,label) {
  return list(value,8,label).map(rule=>{
    requireValue(record(rule)&&operators.has(rule.op),label+'运算符无效');
    const source = researchId(rule.source,label+'的来源题');
    if (['answered','missing'].includes(rule.op)) return {source,op:rule.op};
    requireValue(typeof rule.value==='string'&&rule.value.length<=500 || Number.isFinite(rule.value),label+'的比较值无效');
    return {source,op:rule.op,value:rule.value};
  });
}
function options(values,label,limit=40) {
  const items=list(values,limit,label).map(row=>{
    requireValue(record(row),label+'需要选项对象');
    return {id:researchId(row.id,label),label:researchText(row.label,label,200),showIf:normalizeRules(row.showIf,label),exclusive:row.exclusive===true};
  });
  unique(items.map(row=>row.id),label+'标识');
  unique(items.map(row=>row.label),label+'名称');
  return items;
}
export function normalizeSurvey(value) {
  requireValue(record(value)&&value.schemaVersion===1,'请选择 ARES 问卷 JSON（schemaVersion 1）');
  let count=0;
  const pages=list(value.pages,24,'问卷页').map(page=>{
    requireValue(record(page),'问卷页无效');
    const questions=list(page.questions,120,'题目').map(question=>{
      requireValue(record(question)&&own(QUESTION_TYPES,question.type),'题型无效');
      const {type}=question;
      const item={
        id:researchId(question.id,'题目标识'), name:researchId(question.name,'变量名'), type,
        title:researchText(question.title,'题目',500), description:researchText(question.description,'题目说明',1500,true),
        group:researchText(question.group,'分组',80,true), dimension:researchText(question.dimension,'维度',80,true),
        required:question.required===true, showIf:normalizeRules(question.showIf,'显示条件')
      };
      if (choices.has(type)) {
        item.options=options(question.options,'选项',type==='likert'?11:40);
        if (type!=='multi') requireValue(item.options.every(row=>!row.exclusive),'互斥选项适用于多选题');
      }
      if (type==='matrix') {
        item.rows=list(question.rows,24,'矩阵行').map(row=>{
          requireValue(record(row),'矩阵行无效');
          return {id:researchId(row.id,'矩阵行'),label:researchText(row.label,'矩阵行',200)};
        });
        unique(item.rows.map(row=>row.id),'矩阵行标识');
        unique(item.rows.map(row=>row.label),'矩阵行名称');
      }
      if (type==='number') for (const bound of ['min','max']) {
        if (question[bound]===undefined || question[bound]===null) continue;
        requireValue(Number.isFinite(question[bound]),'数值边界需要有限数字');
        item[bound]=question[bound];
      }
      if (type==='multi') for (const bound of ['min','max']) {
        if (question[bound]===undefined || question[bound]===null) continue;
        requireValue(Number.isInteger(question[bound])&&question[bound]>=0&&question[bound]<=40,'多选数量边界须为0至40的整数');
        item[bound]=question[bound];
      }
      return item;
    });
    count+=questions.length;
    const jumps=list(page.jumps,8,'跳转').map(jump=>{
      requireValue(record(jump),'跳转无效');
      return {to:jump.to==='$end'?'$end':researchId(jump.to,'目标页'),when:normalizeRules(jump.when,'跳转条件')};
    });
    return {id:researchId(page.id,'页标识'),title:researchText(page.title,'页标题',160),description:researchText(page.description,'页说明',1500,true),questions,jumps};
  });
  requireValue(count<=120,'问卷最多120题');
  unique(pages.map(row=>row.id),'页标识');
  unique(pages.flatMap(row=>row.questions.map(q=>q.id)),'题目标识');
  return {
    schemaVersion:1, title:researchText(value.title,'问卷名称',160),
    description:researchText(value.description,'问卷说明',3500,true),
    completion:researchText(value.completion,'完成提示',1200,true)||'感谢填写。',
    study:researchText(value.study,'研究需求',12000,true), pages
  };
}
const present=value=>value!==undefined && value!==null && value!=='' && (!Array.isArray(value)||value.length>0);
function matches(rule, value) {
  if (rule.op==='answered') return present(value);
  if (rule.op==='missing') return !present(value);
  if (!present(value)) return false;
  switch (rule.op) {
    case 'eq': return value===rule.value;
    case 'neq': return value!==rule.value;
    case 'has': return value.includes(rule.value);
    case 'lacks': return !value.includes(rule.value);
    case 'gt': return value>rule.value;
    case 'gte': return value>=rule.value;
    case 'lt': return value<rule.value;
    case 'lte': return value<=rule.value;
    default: return false;
  }
}
const satisfies=(rules,answers)=>rules.every(rule=>matches(rule,answers[rule.source]));
const validDay=value=>typeof value==='string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
function typedRule(rule,q) {
  if (['answered','missing'].includes(rule.op)) return true;
  if (q.type==='multi') return ['has','lacks'].includes(rule.op)&&q.options.some(option=>option.id===rule.value);
  if (q.type==='number') return Number.isFinite(rule.value)&&!['has','lacks'].includes(rule.op);
  if (q.type==='date') return validDay(rule.value)&&!['has','lacks'].includes(rule.op);
  if (scalarChoices.has(q.type)) return ['eq','neq'].includes(rule.op)&&q.options.some(option=>option.id===rule.value);
  return ['text','longtext'].includes(q.type)&&['eq','neq'].includes(rule.op)&&typeof rule.value==='string';
}

// Test satisfiability per source. For scalar ordered types only boundaries,
// between-boundary values and missingness can change a comparison's result.
function satisfiable(rules, byId) {
  const grouped=new Map();
  for (const rule of rules) {
    if (!grouped.has(rule.source)) grouped.set(rule.source,[]);
    grouped.get(rule.source).push(rule);
  }
  for (const [id,filter] of grouped) {
    const q=byId.get(id)?.question;
    if (!q || filter.some(rule=>!typedRule(rule,q))) continue;
    if (filter.every(rule=>matches(rule,undefined))) continue;
    let domain;
    if (q.type==='multi') {
      const required=[...new Set(filter.filter(rule=>rule.op==='has').map(rule=>rule.value))];
      const allowed=q.options.filter(option=>!filter.some(rule=>rule.op==='lacks'&&rule.value===option.id));
      const regular=allowed.filter(option=>!option.exclusive).map(option=>option.id);
      const min=Math.max(1,q.min??0),max=q.max??allowed.length;
      domain=allowed.filter(option=>option.exclusive).map(option=>[option.id]);
      if (required.every(id=>regular.includes(id))&&Math.max(min,required.length)<=Math.min(max,regular.length))
        domain.push([...required,...regular.filter(id=>!required.includes(id)).slice(0,Math.max(0,min-required.length))]);
      domain=domain.filter(row=>row.length>=min&&row.length<=max);
    } else if (scalarChoices.has(q.type)) domain=q.options.map(option=>option.id);
    else if (q.type==='number'||q.type==='date') {
      const isDate=q.type==='date';
      const values=[...new Set([...filter.filter(rule=>own(rule,'value')).map(rule=>isDate?Date.parse(rule.value)/86400000:rule.value),q.min??(isDate?-719528:-Number.MAX_VALUE),q.max??(isDate?2932896:Number.MAX_VALUE)])].sort((a,b)=>a-b);
      const points=values.flatMap((value,index)=>index?[value,isDate?values[index-1]+1:values[index-1]/2+value/2]:[value]);
      domain=[...new Set(points)].filter(value=>value>=(q.min??-Infinity)&&value<=(q.max??Infinity));
      if (isDate) domain=domain.map(value=>new Date(value*86400000).toISOString().slice(0,10));
    } else if (['text','longtext'].includes(q.type)) {
      const values=filter.filter(rule=>own(rule,'value')).map(rule=>rule.value);
      let other='a';
      while (values.includes(other)) other+='a';
      domain=[other,...values.filter(present)];
    } else domain=[true];
    if (!domain.some(value=>filter.every(rule=>matches(rule,value)))) return false;
  }
  return true;
}

export function inspectSurvey(definition) {
  const survey=normalizeSurvey(definition);
  const issues=[];
  const issue=(code,id,message,severity='error')=>issues.push({code,id,message,severity});
  const byId=new Map();
  const pageById=new Map(survey.pages.map((page,index)=>[page.id,index]));
  const names=new Set(),titles=new Set();
  for (const [pageIndex,page] of survey.pages.entries()) for (const q of page.questions)
    byId.set(q.id,{question:q,position:byId.size,pageIndex});
  function checkRules(rules,itemId,before) {
    for (const rule of rules) {
      const source=byId.get(rule.source);
      if (!source) issue('missing-source',itemId,'条件引用了不存在的题目 '+rule.source);
      else if (source.position>=before) issue('cycle-or-order',itemId,'条件只能引用已经到达的题目 '+source.question.title);
      else if (!typedRule(rule,source.question)) issue('type-mismatch',itemId,'条件比较值与来源题型不符');
    }
    const required=rules.slice(),expanded=new Set();
    for(const rule of required){
      if(rule.op==='missing'||expanded.has(rule.source))continue;
      const q=byId.get(rule.source)?.question;
      if(!q)continue;
      expanded.add(rule.source);required.push(...q.showIf);
      if(['eq','has'].includes(rule.op)&&q.options)required.push(...(q.options.find(row=>row.id===rule.value)?.showIf??[]));
    }
    if (!satisfiable(required,byId)) issue('conflict',itemId,'条件及其前置题无法同时成立');
  }
  if (!survey.pages.length || !byId.size) issue('empty','','问卷至少需要一页和一道题');
  const reachable=new Set([0]);
  const jumpSources=[];
  for (const [pageIndex,page] of survey.pages.entries()) {
    if (!reachable.has(pageIndex)) issue('unreachable-page',page.id,'无法到达页面 '+page.title);
    if (!page.questions.length) issue('empty-page',page.id,'页面至少需要一道题');
    for (const q of page.questions) {
      const position=byId.get(q.id).position;
      const heading=q.title.normalize('NFKC').replace(/[\p{P}\s]/gu,'').toLowerCase();
      if (names.has(q.name)) issue('duplicate-variable',q.id,'变量重名 '+q.name);
      if (titles.has(heading)) issue('duplicate-question',q.id,'题目文本重复','warning');
      if (/您也同意|难道|显而易见|无疑|众所周知|当然应该|是不是应该/.test(q.title))
        issue('neutrality',q.id,'措辞可能引导作答，建议人工复核','warning');
      names.add(q.name);titles.add(heading);
      if (q.options&&q.options.length<2) issue('options',q.id,'请提供至少两个选项');
      if (q.options&&['single','multi'].includes(q.type)&&!q.options.some(row=>/其他|都不|没有|不适用|不愿|不限|不确定|适用情形/.test(row.label)))
        issue('coverage',q.id,'请核对选项是否覆盖目标群体','warning');
      if (q.type==='matrix'&&!q.rows.length) issue('matrix-rows',q.id,'请至少添加一个矩阵行');
      if (q.min!==undefined&&q.max!==undefined&&q.min>q.max || q.type==='multi'&&(q.min??0)>q.options.length)
        issue('bounds',q.id,'下限、上限或可选数量有冲突');
      checkRules(q.showIf,q.id,position);
      for (const option of q.options??[]) checkRules([...q.showIf,...option.showIf],q.id,position);
    }
    const last=page.questions.at(-1);
    const before=last?byId.get(last.id).position+1:[...byId.values()].filter(row=>row.pageIndex<pageIndex).length;
    for (const [index,jump] of page.jumps.entries()) {
      const target=pageById.get(jump.to);
      checkRules(jump.when,page.id,before);
      if (jump.to!=='$end'&&(target===undefined||target<=pageIndex)) issue('jump-target',page.id,'跳转目标须是后续页面或结束');
      for (const previous of page.jumps.slice(0,index)) {
        if (previous.to!==jump.to&&satisfiable([...previous.when,...jump.when],byId)) issue('ambiguous-jump',page.id,'跳转条件可能同时成立且目标不同');
      }
      if (reachable.has(pageIndex)&&target>pageIndex) reachable.add(target);
      jumpSources.push(...jump.when.map(rule=>({id:page.id,rule})));
    }
    if (reachable.has(pageIndex)&&!page.jumps.some(jump=>!jump.when.length)) reachable.add(pageIndex+1);
  }
  const references=[...jumpSources,...[...byId.values()].flatMap(({question:q})=>[...q.showIf,...(q.options??[]).flatMap(row=>row.showIf)].map(rule=>({id:q.id,rule})))];
  for (const {id,rule} of references) {
    const source=byId.get(rule.source);
    if (source&&!reachable.has(source.pageIndex)&&rule.op!=='missing') issue('unreachable-source',id,'条件来源在无法到达的页面');
  }
  return {survey,issues,valid:issues.every(item=>item.severity!=='error')};
}

function answerError(q,value,available) {
  if (!present(value)) return q.required?'请填写此题':'';
  if (q.type==='number') return typeof value!=='number'||!Number.isFinite(value)||value<(q.min??-Infinity)||value>(q.max??Infinity)?'数值不在允许范围内':'';
  if (q.type==='date') return validDay(value)?'':'请输入有效日期';
  if (['text','longtext'].includes(q.type)) return typeof value==='string'&&value.trim()&&value.length<=(q.type==='text'?500:6000)?'':'文本为空或超过长度上限';
  const ids=available.map(row=>row.id);
  if (scalarChoices.has(q.type)) return ids.includes(value)?'':'请选择当前可用选项';
  if (q.type==='matrix') {
    if (!record(value)||Object.keys(value).some(id=>!q.rows.some(row=>row.id===id)||!ids.includes(value[id]))) return '矩阵含无效选项';
    return q.required&&q.rows.some(row=>!own(value,row.id))?'请填完所有矩阵行':'';
  }
  if (!Array.isArray(value)||Object.keys(value).length!==value.length||new Set(value).size!==value.length||value.some(id=>!ids.includes(id))) return '选择中存在重复或无效选项';
  const min=q.min??1,max=q.max??ids.length;
  if (q.type==='ranking') return value.length===ids.length?'':'请为全部可用选项排序';
  if (value.length<min||value.length>max) return '选择数量不符合要求';
  return value.length>1&&available.some(row=>row.exclusive&&value.includes(row.id))?'互斥选项只能单独选择':'';
}
export function evaluateSurvey(compiled,answers={}, {throughPage, rejectUnused=false}={}) {
  requireValue(compiled.valid,'请先修正问卷逻辑错误');
  requireValue(record(answers),'答卷必须是变量与答案组成的对象');
  const accepted=Object.create(null),values=Object.create(null),errors=Object.create(null),path=[],visible=[],used=new Set();
  const {survey}=compiled;
  const indexes=new Map(survey.pages.map((page,index)=>[page.id,index]));
  let index=0,finished=false;
  while (index<survey.pages.length) {
    const page=survey.pages[index];
    path.push(page.id);
    for (const q of page.questions) if (satisfies(q.showIf,accepted)) {
      const available=(q.options??[]).filter(option=>satisfies(option.showIf,accepted));
      visible.push({pageId:page.id,question:q,available});
      const value=own(answers,q.name)?answers[q.name]:undefined;
      used.add(q.name);
      const error=answerError(q,value,available);
      if (error) errors[q.name]=error;
      else if (present(value)) { accepted[q.id]=value;values[q.name]=value; }
    }
    const jump=page.jumps.find(item=>satisfies(item.when,accepted));
    index=jump?(jump.to==='$end'?survey.pages.length:indexes.get(jump.to)):index+1;
    finished=index>=survey.pages.length;
    if (throughPage===page.id) break;
  }
  if (rejectUnused) for (const [name,value] of Object.entries(answers))
    if (present(value)&&!used.has(name)) errors[name]='此变量不属于本次答题路径';
  return {path,visible,values,errors,nextPage:finished?null:survey.pages[index].id,complete:finished&&Object.keys(errors).length===0};
}

export function makeQuestion(type,id,name,title) {
  requireValue(own(QUESTION_TYPES,type),'题型无效');
  const q={id,name,type,title,required:true,description:'',group:'',dimension:'',showIf:[]};
  if (choices.has(type)) {
    const labels=type==='likert'?['非常不同意','不同意','一般','同意','非常同意']:['选项一','选项二'];
    q.options=labels.map((label,i)=>({id:'o'+(i+1),label,showIf:[],exclusive:false}));
  }
  if (type==='matrix') q.rows=[{id:'r1',label:'项目一'},{id:'r2',label:'项目二'}];
  return q;
}

/** The quick template is local. Model-authored JSON goes through normalizeSurvey. */
export function surveyTemplate(input) {
  requireValue(record(input),'请输入研究设计');
  const title=researchText(input.title,'研究主题',100);
  const study=researchText(input.study,'研究需求',12000,true);
  const dimensions=list(input.dimensions,12,'测量维度').map(v=>researchText(v,'测量维度',80));
  unique(dimensions,'测量维度');
  const types=list(input.types??['likert'],9,'题型偏好');
  requireValue(types.length&&types.every(type=>own(QUESTION_TYPES,type)),'请选择有效题型');
  const count=input.count??6;
  requireValue(Number.isInteger(count)&&count>=1&&count<=48,'模板题数须为1至48');
  const prompts=['过去一个月接触的频率','目前的使用意愿','遇到的困难','对当前体验的评价','对改进的优先需求','获得帮助的便利程度'];
  const questions=Array.from({length:count},(_,index)=>{
    const dimension=dimensions[index%dimensions.length]||title,type=types[index%types.length],id='q'+(index+1);
    const q=makeQuestion(type,id,id,dimension+'：'+prompts[Math.floor(index/Math.max(1,dimensions.length))%prompts.length]+(index>=prompts.length*Math.max(1,dimensions.length)?'（补充 '+(index+1)+'）':''));
    q.dimension=dimension;
    return q;
  });
  return normalizeSurvey({schemaVersion:1,title,study,description:'请按实际情况填写。',pages:[{id:'p1',title:'调查问题',questions}]});
}
