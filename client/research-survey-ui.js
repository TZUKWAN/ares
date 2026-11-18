import {QUESTION_TYPES,makeQuestion,inspectSurvey,normalizeSurvey,evaluateSurvey,surveyTemplate} from './research-survey-model.js';
import {html,button,option,field,input,area,select,empty,heading,badge,dataLink} from './research-ui.js';

const id=prefix=>prefix+crypto.randomUUID().replaceAll('-','').slice(0,10);
const pathAttrs=path=>'data-edit="'+html(path)+'" data-focus="'+html(path)+'"';
const checked=(name,value,attrs='')=>'<input type="checkbox" name="'+html(name)+'" '+(value?'checked ':'')+attrs+'>';
const typeOptions=Object.entries(QUESTION_TYPES);
const typeOperators={single:['eq','neq'],likert:['eq','neq'],multi:['has','lacks'],number:['eq','neq','gt','gte','lt','lte'],date:['eq','neq','gt','gte','lt','lte'],text:['eq','neq'],longtext:['eq','neq']};
const operators={eq:'等于',neq:'不等于',has:'包含',lacks:'不包含',gt:'大于',gte:'至少',lt:'小于',lte:'至多',answered:'已作答',missing:'未作答'};
const createPage=(title='问题')=>({id:id('p'),title,description:'',questions:[],jumps:[]});
const editInput=(path,value,type='text')=>input(path,value,'type="'+type+'" '+pathAttrs(path));
const editArea=(path,value)=>area(path,value,pathAttrs(path));
const editSelect=(path,choices,value,attrs='')=>select(path,choices.map(([id,label])=>option(id,label,id===value)).join(''),pathAttrs(path)+' '+attrs);
const pathValue=(root,path)=>path.split('.').reduce((value,key)=>value?.[key],root);
const newDefinition=()=>({schemaVersion:1,title:'未命名问卷',description:'',completion:'感谢填写。',study:'',pages:[createPage()]});

export function createSurveyWorkspace(ctx) {
  let draft,loaded,pageIndex=0,questionId,undo=[],redo=[],lastInput='',mode='design',preview,settings='',dragged,diagnostics=[],job=null,pollTimer=null,historyRoot=null,watching=false,pretestPending=false;
  const scratches=new Map();
  const rows=()=>ctx.index.items.filter(row=>row.kind==='survey');
  const page=()=>draft.pages[pageIndex];
  const questionIndex=()=>page().questions.findIndex(q=>q.id===questionId);
  const selected=()=>page().questions[questionIndex()];
  const networkKeys=()=>({id:loaded.item.id,versionId:loaded.version.id});
  const unsaved=()=>!!draft&&(!loaded||JSON.stringify(draft)!==JSON.stringify(loaded.data));
  function loadDraft(value,entry){
    draft=structuredClone(value);loaded=entry;
    pageIndex=0;questionId=draft.pages[0]?.questions[0]?.id;mode='design';settings='';preview=null;
    undo=[];redo=[];lastInput='';diagnostics=[];
  }
  const jobSeat=()=>ctx.element.querySelector('[data-survey-job]');
  function updateJobStatus() {
    const target=jobSeat();
    if(target)target.innerHTML=pretestStatus();
  }
  function watchPretest(){
    if(!watching||job?.status!=='running'||pollTimer)return;
    pollTimer=setInterval(pollPretest,1200);
    void pollPretest();
  }
  async function pollPretest() {
    if(!job||job.status!=='running'||pretestPending)return;
    const current=job.id,root=ctx.root;
    pretestPending=true;
    try {
      const state=(await ctx.get('job',{id:current})).job;
      if(ctx.root!==root||job?.id!==current)return;
      job=state;
      updateJobStatus();
      if(state.status!=='running'){
        clearInterval(pollTimer);pollTimer=null;
        await ctx.refresh({redraw:false});
      }
    }catch(error){
      if(ctx.root!==root)return;
      clearInterval(pollTimer);pollTimer=null;
      const target=jobSeat();
      if(target)target.textContent=error.message;
    }finally {pretestPending=false;}
  }
  function pretestStatus() {
    if(!job)return '';
    return '<div class="research-inline research-setting">'+(job.status==='running'?'<progress aria-label="预测试进度"></progress><span>正在执行模拟预测试</span>'+button('pretest-cancel','取消预测试',{data:{id:job.id}}):
      job.result?button('item','打开预测试诊断',{data:{id:job.result.itemId}}):html(job.message??job.status))+'</div>';
  }
  function retain() {
    if (unsaved()) scratches.set(loaded?.item.id??'new',{draft:structuredClone(draft),loaded});
  }
  function edit(fn,coalesce='') {
    const previous=JSON.stringify(draft);
    fn(draft);
    if (JSON.stringify(draft)===previous) return;
    if (!coalesce||lastInput!==coalesce) {undo.push(previous);if(undo.length>80)undo.shift();}
    lastInput=coalesce;redo=[];
    diagnostics=[];
  }
  function browse(id) {
    retain();
    return ctx.task(()=>open(id));
  }
  async function open(key) {
    const scratch=scratches.get(key);
    if(scratch){loadDraft(scratch.draft,scratch.loaded);ctx.draw();return;}
    const entry=await ctx.entry(key);loadDraft(entry.data,entry);ctx.draw();
  }
  function editable() {
    return loaded?.version.payload.status!=='proposal';
  }
  function changePage(index) {
    pageIndex=Math.max(0,Math.min(index,draft.pages.length-1));
    questionId=page()?.questions[0]?.id;
    lastInput='';
  }
  function backOrForward(source,target) {
    if(!source.length)return;
    target.push(JSON.stringify(draft));draft=JSON.parse(source.pop());lastInput='';settings='';diagnostics=[];
    changePage(pageIndex);
  }
  function add(type) {
    const key=id('q'),n=draft.pages.reduce((count,row)=>count+row.questions.length,0);
    edit(()=>page().questions.push(makeQuestion(type,key,key,QUESTION_TYPES[type]+'题 '+(n+1))));
    questionId=key;
  }
  function move(q,fromPage,toPage,toIndex) {
    const source=draft.pages[fromPage].questions,from=source.findIndex(row=>row.id===q);
    if(from<0||!draft.pages[toPage]||toIndex<0||fromPage===toPage&&from===toIndex)return;
    edit(()=>{
      const [row]=source.splice(from,1);
      draft.pages[toPage].questions.splice(toIndex,0,row);
    });
    pageIndex=toPage;questionId=q;ctx.draw();
  }
  const modeButton=(current,label)=>button('mode',label,{primary:mode===current,data:{id:current}});
  function generator() {
    return '<form class="research-form research-stackbar" data-research-form="survey-create">'+heading('新建问卷','从研究需求开始')+
      '<div class="research-form-grid">'+field('研究主题',input('title','','required maxlength="100" data-focus="study-title"'))+
      field('调查对象',input('population','','maxlength="250"'))+field('调查目的',input('aim','','maxlength="250"'))+
      field('研究问题',input('question','','maxlength="500"'))+field('核心变量',input('variables','','maxlength="500"'))+
      field('测量维度（用逗号分隔）',input('dimensions','','maxlength="500"'))+field('题数',input('count',6,'type="number" min="1" max="48" required'))+
      field('题型偏好',select('type',typeOptions.map(([key,name])=>option(key,name,key==='likert')).join('')))+
      field('量表形式和人口统计变量',input('scale','','maxlength="500"'))+'</div>'+
      field('其他要求',area('study','','maxlength="3600" data-focus="study-text"'))+
      '<div class="research-actions">'+button('model','请项目助手起草',{type:'submit',primary:true,disabled:ctx.busy})+
      button('template','使用本地模板',{type:'submit',disabled:ctx.busy})+
      button('blank','空白问卷')+'</div>'+empty('助手起草后在本页打开建议，验证题目与作答路径再定稿。')+'</form>';
  }
  function library() {
    const list=rows();
    return '<aside class="research-shelf" aria-label="问卷列表">'+heading('问卷列表','',button('new','新建'))+
      (list.length?list.map(item=>'<button type="button" class="research-record" data-r="survey-open" data-id="'+html(item.id)+'" aria-current="'+(loaded?.item.id===item.id)+'"><span>'+html(item.title)+'</span><small>'+html(item.status==='template'?'模板':item.status==='proposal'?'助手建议':item.status==='final'?'已定稿':'草稿')+'</small></button>').join(''):empty('保存后显示问卷和模板。'))+
      '<label class="research-button research-file">导入问卷 JSON<input type="file" accept=".json,application/json" data-import-definition aria-label="导入问卷 JSON"></label>'+
      (draft&&editable()?'<h4>添加题目</h4><div class="research-palette">'+typeOptions.map(([key,label])=>button('add',label,{data:{id:key},disabled:!page()})).join('')+'</div>':'')+'</aside>';
  }
  function specs() {
    if(!draft)return generator();
    const disabled=!editable(),pageTabs=draft.pages.map((p,index)=>'<button type="button" class="research-page-tab" data-r="page" data-id="'+index+'" data-drop-page="'+index+'" aria-current="'+(index===pageIndex)+'">'+html(p.title)+'</button>').join('');
    const existing=loaded&&loaded.version.payload.status!=='proposal';
    const canPublish=existing&&loaded.version.payload.status==='final'&&!unsaved();
    const exports=loaded?['json','docx'].map(format=>'<a class="research-button" download href="'+html(dataLink('export',{root:ctx.root,...networkKeys(),format}))+'">'+format.toUpperCase()+'</a>').join(''):'';
    return heading(draft.title,unsaved()?'尚未保存':(loaded.version.payload.status==='proposal'?'助手建议 · 等待采用':loaded.version.payload.status==='final'?'正式版本 · 可登记实际答卷':'已保存版本'),button('list-refresh','刷新列表'))+
      '<div class="research-toolbar">'+modeButton('design','设计')+modeButton('preview','预览')+button('check','检查逻辑')+
      (disabled?button('adopt','采用为草稿',{primary:true,disabled:ctx.busy}):
        button('undo','撤销',{disabled:!undo.length})+button('redo','重做',{disabled:!redo.length})+
        button('save','保存草稿',{primary:true,disabled:ctx.busy})+button('settings','更多操作'))+exports+'</div>'+
      (settings?settingsPanel(canPublish):'')+
      (diagnostics.length?'<ul class="research-diagnostics" aria-label="逻辑检查结果">'+diagnostics.map(row=>'<li data-severity="'+row.severity+'">'+html(row.message)+'</li>').join('')+'</ul>':'')+
      (mode==='preview'?renderPreview():design(pageTabs,disabled));
  }
  function design(pageTabs,disabled) {
    return '<div class="research-survey-canvas"><details class="research-rule-details"><summary>问卷说明与设置</summary><div class="research-form-grid">'+field('问卷名称',editInput('title',draft.title))+
      field('填写说明',editArea('description',draft.description))+field('完成提示',editInput('completion',draft.completion))+'</div></details>'+
      '<nav class="research-page-tabs" aria-label="问卷页面">'+pageTabs+button('add-page','添加页',{disabled})+'</nav>'+
      (page()?pageEditor(disabled):empty('先添加一个问卷页。'))+'</div>';
  }
  function pageEditor(disabled) {
    const p=page(),base='pages.'+pageIndex;
    let group;
    const questions=p.questions.map((q,index)=>{
      const title=q.group&&q.group!==group?'<h4 class="research-group">'+html(q.group)+'</h4>':'';
      group=q.group;
      return title+'<div class="research-question'+(q.id===questionId?' is-selected':'')+'" '+(disabled?'':'draggable="true"')+' data-question-id="'+html(q.id)+'" data-question-index="'+index+'">'+
        '<button type="button" data-r="question" data-id="'+html(q.id)+'" aria-current="'+(q.id===questionId)+'"><span class="research-index">'+(index+1)+'</span>'+
        '<span><strong>'+html(q.title)+'</strong><small>'+html(QUESTION_TYPES[q.type])+' · '+html(q.name)+(q.required?' · 必填':'')+'</small></span></button>'+
        (!disabled&&q.id===questionId?'<div class="research-actions">'+button('up','上移',{disabled:index===0})+button('down','下移',{disabled:index===p.questions.length-1})+button('copy','复制')+button('remove','删除')+'</div>':'')+'</div>';
    }).join('');
    const jumps=p.jumps.map((jump,index)=>'<div class="research-rule-card">'+
      field('答完本页后跳转',editSelect(base+'.jumps.'+index+'.to',[...draft.pages.slice(pageIndex+1).map(row=>[row.id,row.title]),['$end','完成']],jump.to))+
      rules(jump.when,base+'.jumps.'+index+'.when',draft.pages.slice(0,pageIndex+1).flatMap(row=>row.questions))+
      button('remove-jump','删除跳转',{data:{index}})+'</div>').join('');
    return '<fieldset '+(disabled?'disabled':'')+' class="research-page-editor"><div class="research-question-list" data-r-scroll="questions">'+
      (questions||empty('从题型组件库添加一道题。'))+'</div><details class="research-rule-details"><summary>页面名称与说明</summary><div class="research-form-grid">'+field('页名称',editInput(base+'.title',p.title))+field('页说明',editInput(base+'.description',p.description))+'</div></details>'+
      '<details class="research-rule-details" '+(jumps?'open':'')+'><summary>本页跳题逻辑</summary>'+jumps+
      button('add-jump','添加跳转',{disabled:p.jumps.length>=8})+
      '</details><div class="research-actions">'+button('page-up','前移本页',{disabled:pageIndex===0})+button('page-down','后移本页',{disabled:pageIndex===draft.pages.length-1})+
      button('remove-page','删除本页',{disabled:draft.pages.length<=1})+'</div></fieldset>';
  }
  function rules(rows,path,sources) {
    const items=rows.map((rule,index)=>{
      const base=path+'.'+index,q=sources.find(question=>question.id===rule.source),ops=[...typeOperators[q?.type]??[],'answered','missing'];
      let values='';
      if (q&&!['answered','missing'].includes(rule.op)) {
        if(q.options)values=field('比较值',editSelect(base+'.value',q.options.map(row=>[row.id,row.label]),rule.value));
        else values=field('比较值',editInput(base+'.value',rule.value,q.type==='number'?'number':q.type==='date'?'date':'text'));
      }
      return '<div class="research-rule">'+field('来源题',editSelect(base+'.source',q?sources.map(question=>[question.id,question.title]):[['','请选择题目'],...sources.map(question=>[question.id,question.title])],rule.source))+
        field('条件',editSelect(base+'.op',ops.map(op=>[op,operators[op]]),rule.op))+values+button('remove-rule','删除条件',{data:{path,index}})+'</div>';
    }).join('');
    const source=sources[0]?.id;
    return items+button('add-rule','添加条件',{data:{path,source},disabled:!source||rows.length>=8});
  }
  function propertyPanel() {
    const q=selected();
    if(!q)return '<aside class="research-properties">'+heading('所选题目')+empty('在画布中选择一道题。')+'</aside>';
    const index=questionIndex(),path='pages.'+pageIndex+'.questions.'+index;
    const prior=[...draft.pages.slice(0,pageIndex).flatMap(p=>p.questions),...page().questions.slice(0,index)];
    const options=(q.options??[]).map((row,i)=>{
      const base=path+'.options.'+i;
      return '<div class="research-option">'+field('选项 '+(i+1),editInput(base+'.label',row.label))+
        '<code>'+html(row.id)+'</code>'+(q.type==='multi'?field('单独选择',checked(base+'.exclusive',row.exclusive,pathAttrs(base+'.exclusive'))):'')+
        button('remove-option','删除',{data:{index:i}})+
        '<details '+(row.showIf.length?'open':'')+'><summary>选项依赖</summary>'+rules(row.showIf,base+'.showIf',prior)+'</details></div>';
    }).join('');
    return '<aside class="research-properties" data-r-scroll="properties">'+heading('题目属性',QUESTION_TYPES[q.type])+
      '<fieldset '+(!editable()?'disabled':'')+'>'+field('题目名称',editArea(path+'.title',q.title))+field('变量名',editInput(path+'.name',q.name))+
      '<div class="research-form-grid">'+field('分组',editInput(path+'.group',q.group))+field('测量维度',editInput(path+'.dimension',q.dimension))+'</div>'+
      field('必填',checked(path+'.required',q.required,pathAttrs(path+'.required')))+
      '<details class="research-rule-details"><summary>题目说明</summary>'+field('说明',editArea(path+'.description',q.description))+'</details>'+
      (['number','multi'].includes(q.type)?'<div class="research-form-grid">'+field(q.type==='multi'?'最少选几项':'最小值',editInput(path+'.min',q.min,'number'))+field(q.type==='multi'?'最多选几项':'最大值',editInput(path+'.max',q.max,'number'))+'</div>':'')+
      (q.options?'<h4>选项</h4>'+options+button('add-option','添加选项',{disabled:q.options.length>=(q.type==='likert'?11:40)}):'')+
      (q.rows?'<h4>矩阵行</h4>'+q.rows.map((row,i)=>'<div class="research-inline">'+field('行 '+(i+1),editInput(path+'.rows.'+i+'.label',row.label))+button('remove-row','删除',{data:{index:i}})+'</div>').join('')+
        button('add-row','添加矩阵行',{disabled:q.rows.length>=24}):'')+
      '<details class="research-rule-details" '+(q.showIf.length?'open':'')+'><summary>显示条件</summary>'+rules(q.showIf,path+'.showIf',prior)+'</details></fieldset></aside>';
  }
  function settingsPanel(canPublish) {
    if(settings==='final')return '<form class="research-inline research-setting" data-research-form="survey-final">'+
      field('确认当前逻辑与预览已复核',checked('confirm',false,'required'))+
      button('final','正式定稿',{type:'submit',primary:true,disabled:ctx.busy})+'</form>';
    if(settings==='pretest')return '<form class="research-inline research-setting" data-research-form="survey-pretest">'+
      field('模拟样本数',input('count',120,'type="number" min="10" max="20000" required'))+
      field('随机种子',input('seed','ares-research','required maxlength="100"'))+
      field('允许在当前项目执行本地预测试',checked('approve',false,'required'))+
      button('pretest','运行预测试',{type:'submit',primary:true,disabled:ctx.busy})+'</form>';
    if(settings==='responses')return '<form class="research-form research-setting" data-research-form="survey-responses">'+
      field('实际答卷 CSV 或 JSON',input('file','','type="file" accept=".csv,.json" required'))+
      field('采集来源',input('origin','','required maxlength="1200"'))+
      field('确认该文件属于此问卷的实际采集',checked('confirm',false,'required'))+
      button('responses','导入并分析',{type:'submit',primary:true,disabled:ctx.busy})+'</form>';
    return '<div class="research-setting research-actions">'+button('as-template','另存模板',{disabled:ctx.busy})+
      button('use-copy','复制为新问卷',{disabled:ctx.busy})+button('settings-final','正式定稿',{disabled:ctx.busy})+
      button('settings-pretest','模型预测试',{disabled:!loaded||unsaved()})+
      button('settings-responses','导入实际答卷',{disabled:!canPublish})+
      (loaded?field('打开版本',select('surveyVersion',loaded.item.versions.slice().reverse().map((key,index)=>option(key,'第 '+(loaded.item.versions.length-index)+' 版',key===loaded.version.id)).join(''),'data-survey-version')):'')+'</div>';
  }
  function renderPreview() {
    if(!preview)return empty('修正问卷逻辑后开始填写预览。');
    const {compiled,answers,current,device,finished}=preview,result=evaluateSurvey(compiled,answers,{throughPage:current});
    const p=compiled.survey.pages.find(row=>row.id===current);
    const btns=button('device','桌面',{data:{id:'desktop'},primary:device==='desktop'})+button('device','手机',{data:{id:'mobile'},primary:device==='mobile'})+button('preview-reset','重置答案');
    return '<div class="research-toolbar" aria-label="预览设备">'+btns+'</div>'+
      '<div class="research-preview '+device+'">'+heading(compiled.survey.title,compiled.survey.description)+
      '<p class="research-path" aria-label="实际页面路径">'+result.path.map(key=>html(compiled.survey.pages.find(row=>row.id===key).title)).join(' → ')+'</p>'+
      (finished?'<h4>预览已完成</h4><p>'+html(compiled.survey.completion)+'</p><pre>'+html(JSON.stringify(result.values,null,2))+'</pre>':
        '<h4>'+html(p.title)+'</h4>'+(p.description?'<p>'+html(p.description)+'</p>':'')+
        result.visible.filter(row=>row.pageId===current).map(row=>renderAnswer(row,answers[row.question.name],preview.errors?.[row.question.name])).join('')+
        '<div class="research-toolbar">'+button('preview-back','上一页',{disabled:result.path.length<2})+button('preview-next',result.nextPage?'下一页':'完成预览',{primary:true})+'</div>')+'</div>';
  }
  function renderAnswer({question:q,available},value,error) {
    const attr='data-answer="'+q.name+'" data-focus="answer-'+q.name+'"';
    let control;
    if(q.type==='matrix'){
      control='<div class="research-matrix">'+q.rows.map(row=>field(row.label,select(q.name,option('','请选择')+available.map(o=>option(o.id,o.label,value?.[row.id]===o.id)).join(''),attr+' data-row="'+row.id+'"'))).join('')+'</div>';
    } else if(q.type==='ranking') {
      control=available.map((_,index)=>field('第 '+(index+1)+' 位',select(q.name,option('','请选择')+available.map(o=>option(o.id,o.label,value?.[index]===o.id)).join(''),attr+' data-rank="'+index+'"'))).join('');
    } else if(q.options) {
      control='<div class="research-answer-options">'+available.map(o=>'<label><input name="answer-'+q.name+'" value="'+o.id+'" type="'+(q.type==='multi'?'checkbox':'radio')+'" '+attr+' '+(q.type==='multi'&&value?.includes(o.id)||value===o.id?'checked':'')+'> '+html(o.label)+'</label>').join('')+'</div>';
    } else if(q.type==='longtext')control=area(q.name,value,attr+' maxlength="6000" aria-label="'+html(q.title)+'"');
    else control=input(q.name,value,attr+' type="'+(q.type==='number'?'number':q.type==='date'?'date':'text')+'" '+(q.type==='number'?'step="any" ':'')+'aria-label="'+html(q.title)+'" maxlength="500"');
    return '<fieldset class="research-answer"><legend>'+html(q.title)+(q.required?' · 必填':'')+'</legend>'+(q.description?'<p>'+html(q.description)+'</p>':'')+control+(error?'<p role="alert" class="research-error">'+html(error)+'</p>':'')+'</fieldset>';
  }
  function inspect(show=true) {
    try { const compiled=inspectSurvey(draft);diagnostics=show?compiled.issues:[];return compiled; }
    catch(error) {diagnostics=[{severity:'error',message:error.message}];return null;}
  }
  function startPreview() {
    const compiled=inspect();
    if(!compiled?.valid){mode='design';ctx.fail(new Error('逻辑检查发现问题'));return;}
    mode='preview';settings='';preview={compiled,answers:Object.create(null),current:compiled.survey.pages[0].id,device:'desktop',finished:false};
    ctx.draw();
  }
  async function save(status='draft',copy=false) {
    const value=normalizeSurvey(draft),from=loaded,canUpdate=from&&from.item.head===from.version.id&&editable()&&!copy;
    const result=await ctx.mutate('survey/save',{definition:value,status,confirmFinal:status==='final',
      ...(canUpdate?{id:from.item.id,baseVersion:from.version.id}:from?{sourceId:from.item.id,sourceVersion:from.version.id}:{})});
    const next=await ctx.entry(result.item.id);
    scratches.delete(from?.item.id??'new');
    const index=pageIndex,q=questionId;
    loadDraft(next.data,next);changePage(index);if(page()?.questions.some(row=>row.id===q))questionId=q;
    ctx.report(status==='final'?'已保存正式问卷。':status==='template'?'模板已保存到本项目。':'问卷草稿已保存。');
  }
  function setValue(target) {
    const path=target.dataset.edit;
    if(!path||!editable())return;
    const bits=path.split('.'),key=bits.pop(),object=pathValue(draft,bits.join('.'))??draft;
    const value=target.type==='checkbox'?target.checked:target.type==='number'?(target.value===''?undefined:target.valueAsNumber):target.value;
    edit(()=>{
      if(value===undefined)delete object[key];
      else object[key]=value;
      if(key==='source'){object.op='answered';delete object.value;}
      if(key==='op'){
        const source=draft.pages.flatMap(row=>row.questions).find(q=>q.id===object.source);
        if(['answered','missing'].includes(value))delete object.value;
        else object.value=source?.options?.[0]?.id??(source?.type==='number'?0:source?.type==='date'?'2000-01-01':'');
      }
    },path);
  }
  function answer(target) {
    const {answer:name,row,rank}=target.dataset;
    if(!preview||!name)return;
    const {answers,compiled,current}=preview;
    const q=compiled.survey.pages.flatMap(page=>page.questions).find(item=>item.name===name);
    if(q.type==='multi'){
      const previous=answers[name]??[],choice=q.options.find(o=>o.id===target.value);
      if(target.checked)answers[name]=choice.exclusive?[choice.id]:[...previous.filter(id=>!q.options.find(o=>o.id===id)?.exclusive),choice.id];
      else answers[name]=previous.filter(id=>id!==choice.id);
    }else if(q.type==='matrix'){
      answers[name]??={};
      if(target.value)answers[name][row]=target.value;else delete answers[name][row];
    }else if(q.type==='ranking'){
      answers[name]??=[];
      answers[name][Number(rank)]=target.value;
    }else if(q.type==='number')answers[name]=target.value===''?'':target.valueAsNumber;
    else answers[name]=target.value;
    delete preview.errors?.[name];
    const result=evaluateSurvey(compiled,answers,{throughPage:current});
    const visibleHere=new Set(result.visible.map(item=>item.question.name));
    for(const item of compiled.survey.pages.find(p=>p.id===current).questions)
      if(!visibleHere.has(item.name))delete answers[item.name];
    ctx.draw();
  }
  return {
    open,
    afterRender(){
      watching=true;
      if(historyRoot!==ctx.root){
        const root=ctx.root;historyRoot=root;
        ctx.get('jobs').then(result=>{
          if(ctx.root!==root||job)return;
          job=result.jobs.find(row=>row.kind==='survey-pretest')??null;
          updateJobStatus();watchPretest();
        }).catch(error=>{const target=jobSeat();if(target&&ctx.root===root)target.textContent=error.message;});
      }
      watchPretest();
    },
    pause(){watching=false;clearInterval(pollTimer);pollTimer=null;},
    reset(){this.pause();job=null;historyRoot=null;scratches.clear();draft=loaded=null;preview=null;pageIndex=0;diagnostics=[];settings='';mode='design';},
    render(){
      const huge=mode==='preview'||!draft;
      return '<div class="research-workspace'+(huge?' is-wide':'')+'">'+library()+'<section class="research-section research-designer" aria-label="问卷设计"><div data-survey-job>'+pretestStatus()+'</div>'+specs()+'</section>'+(!huge&&page()?propertyPanel():'')+'</div>';
    },
    click(action,target) {
      const {id:key,index,path,source}=target.dataset;
      if(action==='pretest-cancel')return ctx.task(async()=>{await ctx.call('job/cancel',{id:key});await pollPretest();});
      if(action==='survey-open')return browse(key);
      if(action==='list-refresh')return ctx.task(ctx.refresh);
      if(action==='new'){retain();draft=loaded=null;mode='design';settings='';ctx.draw();return;}
      if(action==='blank'){const scratch=scratches.get('new');loadDraft(scratch?.draft??newDefinition(),null);ctx.draw();return;}
      if(action==='mode'){if(key==='preview')startPreview();else{mode='design';settings='';ctx.draw();}return;}
      if(action==='check'){const result=inspect();if(result?.valid)ctx.report('逻辑检查通过。请填写预览核对路径。');else ctx.fail(new Error('请修正下列问题'));return;}
      if(action==='adopt')return ctx.task(()=>save('draft',true));
      if(['save','as-template','use-copy'].includes(action))return ctx.task(()=>save(action==='as-template'?'template':'draft',action!=='save'));
      if(action==='settings'){settings=settings?'':'menu';ctx.draw();return;}
      if(action.startsWith('settings-')){settings=action.slice(9);ctx.draw();return;}
      if(action==='device'&&preview)preview.device=key;
      if(action==='preview-reset'&&preview)startPreview();
      if(action==='preview-back'||action==='preview-next'){
        const result=evaluateSurvey(preview.compiled,preview.answers,{throughPage:preview.current});
        if(action==='preview-back'){preview.current=result.path.at(-2);preview.errors=null;}
        else if(Object.keys(result.errors).length)preview.errors=result.errors;
        else if(result.nextPage)preview.current=result.nextPage;
        else preview.finished=true;
      }
      if(action==='page')changePage(Number(key));
      if(action==='question')questionId=key;
      if(editable()&&draft) {
        if(action==='add-page') { edit(()=>draft.pages.push(createPage('第 '+(draft.pages.length+1)+' 页')));changePage(draft.pages.length-1); }
        if(action==='remove-page'&&draft.pages.length>1){edit(()=>draft.pages.splice(pageIndex,1));changePage(pageIndex);}
        if(action==='page-up'||action==='page-down'){const next=pageIndex+(action==='page-up'?-1:1);edit(()=>{const [p]=draft.pages.splice(pageIndex,1);draft.pages.splice(next,0,p);});changePage(next);}
        if(action==='add')add(key);
        if(action==='remove'){edit(()=>page().questions.splice(questionIndex(),1));changePage(pageIndex);}
        if(action==='copy'){
          const q=structuredClone(selected());
          q.id=id('q');q.name=q.id;q.title=q.title.slice(0,490)+'（副本）';
          edit(()=>page().questions.splice(questionIndex()+1,0,q));questionId=q.id;
        }
        if(action==='up'||action==='down')return move(questionId,pageIndex,pageIndex,questionIndex()+(action==='up'?-1:1));
        if(action==='undo')backOrForward(undo,redo);
        if(action==='redo')backOrForward(redo,undo);
        if(action==='add-option')edit(()=>selected().options.push({id:id('o'),label:'选项 '+(selected().options.length+1),showIf:[],exclusive:false}));
        if(action==='remove-option')edit(()=>selected().options.splice(Number(index),1));
        if(action==='add-row')edit(()=>selected().rows.push({id:id('r'),label:'行 '+(selected().rows.length+1)}));
        if(action==='remove-row')edit(()=>selected().rows.splice(Number(index),1));
        if(action==='add-rule')edit(()=>pathValue(draft,path).push({source,op:'answered'}));
        if(action==='remove-rule')edit(()=>pathValue(draft,path).splice(Number(index),1));
        if(action==='add-jump')edit(()=>page().jumps.push({to:draft.pages[pageIndex+1]?.id??'$end',when:[]}));
        if(action==='remove-jump')edit(()=>page().jumps.splice(Number(index),1));
      }
      ctx.draw();
    },
    async submit(action,values,form,submitter) {
      if(action==='survey-create'){
        const study=[['研究主题',values.title],['调查对象',values.population],['调查目的',values.aim],['核心研究问题',values.question],['变量',values.variables],['测量维度',values.dimensions],['题数',values.count],['题型',QUESTION_TYPES[values.type]],['量表和人口统计',values.scale],['补充要求',values.study]].filter(([,v])=>v).map(([key,v])=>key+' '+v).join('\n');
        if(submitter?.dataset.r==='model'){
          ctx.prompt?.('请为本项目设计可填写的研究问卷。先调用 ares_workbench research 读取项目修订号和问卷结构，再调用 research-proposal 保存可运行 JSON。写清变量和测量条目，检查中立性、选项与条件逻辑。\n\n'+study);
          ctx.report('请在右侧项目助手发送草拟请求。完成后点刷新列表查看结果。');
          return;
        }
        loadDraft(surveyTemplate({title:values.title,study,dimensions:values.dimensions.split(/[，,]/).map(v=>v.trim()).filter(Boolean),count:Number(values.count),types:[values.type]}),null);
      }
      if(action==='survey-final') {if(!values.confirm)throw new Error('请确认已复核');await save('final');}
      if(action==='survey-pretest'){
        await ctx.mutate('survey/enable-pretest',{approve:values.approve==='on'});
        const result=await ctx.mutate('survey/pretest',{...networkKeys(),approve:true,count:Number(values.count),seed:values.seed});
        job=result.job;settings='';ctx.report('已启动模拟预测试。');
      }
      if(action==='survey-responses'){
        if(values.file.size>4*1024*1024)throw new Error('每批实际答卷最多4MiB');
        const result=await ctx.mutate('survey/responses',{...networkKeys(),content:await values.file.text(),
          format:values.file.name.toLowerCase().endsWith('.json')?'json':'csv',origin:values.origin,confirmActual:values.confirm==='on'});
        ctx.report('实际答卷已登记，在研究产物查看 '+result.item.title+'。');
      }
    },
    input(event){
      const t=event.target;
      if(!t.matches('input[type=text][data-edit],textarea[data-edit],input[type=number][data-edit]'))return;
      setValue(t);
      if(t.dataset.edit==='title'){
        const title=ctx.element.querySelector('.research-designer > .research-heading h3');
        if(title)title.textContent=draft.title;
      }
      if(t.dataset.edit.endsWith('.title')&&selected()){
        const label=ctx.element.querySelector('.research-question.is-selected strong');
        if(label)label.textContent=selected().title;
      }
    },
    async change(event) {
      const target=event.target;
      if(target.matches('[data-import-definition]')){
        const file=target.files[0];if(!file)return;if(file.size>4*1024*1024)throw new Error('问卷 JSON 超过4MiB');
        retain();loadDraft(normalizeSurvey(JSON.parse(await file.text())),null);ctx.draw();return;
      }
      if(target.matches('[data-survey-version]'))return ctx.task(async()=>{retain();const result=await ctx.entry(loaded.item.id,target.value);loadDraft(result.data,result);});
      if(target.dataset.answer){answer(target);return;}
      if(target.dataset.edit){setValue(target);lastInput='';if(target.matches('select,input[type=checkbox]'))ctx.draw();}
    },
    keydown(event){
      if(!draft||!editable()||mode!=='design'||!(event.ctrlKey||event.metaKey)||event.key.toLowerCase()!=='z'||event.target.matches('input,textarea,select'))return;
      event.preventDefault();if(event.shiftKey)backOrForward(redo,undo);else backOrForward(undo,redo);ctx.draw();
    },
    dragstart(event){
      const row=event.target.closest('[data-question-id]');
      if(!row||!editable())return;
      dragged={id:row.dataset.questionId,page:pageIndex};
      event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',dragged.id);
    },
    dragover(event){if(dragged&&event.target.closest('[data-question-index],[data-drop-page]'))event.preventDefault();},
    drop(event){
      const target=event.target.closest('[data-question-index],[data-drop-page]');
      if(!target||!dragged)return;
      event.preventDefault();
      const {id:key,page:from}=dragged;dragged=null;
      const to=target.dataset.dropPage===undefined?pageIndex:Number(target.dataset.dropPage);
      move(key,from,to,target.dataset.questionIndex===undefined?draft.pages[to].questions.length:Number(target.dataset.questionIndex));
    }
  };
}
