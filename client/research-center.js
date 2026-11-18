import {createSurveyWorkspace} from './research-survey-ui.js';
import {createInterviewWorkspace} from './research-interview-ui.js';
import {createDatasetWorkspace} from './research-dataset-ui.js';

import {html,button,option,field,input,area,select,empty,heading,badge,dataLink,names,levels} from './research-ui.js';

export function createResearchCenter({request,onProjectMutation,onPrompt}) {
  const element=document.createElement('section');
  element.className='research-center';
  element.setAttribute('aria-label','研究工具中心');
  let root,projectId,projectTitle='',index,busy=false,notice='',problem='',tab='overview',loadGeneration=0,disposed=false,active=false,panel;
  const workspaces=new Map(),tabs=[['overview','总览'],['survey','问卷设计'],['interview','访谈工作台'],['datasets','数据资源'],['artifacts','研究产物']];
  const context={element, get index(){return index;}, get root(){return root;}, get busy(){return busy;},
    draw, call, get, mutate, refresh, open, entry, upload, prompt:onPrompt,
    async showArtifact(id,versionId){workspaces.get(tab)?.pause?.();tab='artifacts';await showItem(id,versionId);draw();},
    report(text){notice=text;problem='';draw();},
    fail(error){problem=error.message;notice='';draw();},
    async task(fn){
      if(busy||disposed)return;
      busy=true;problem='';notice='';feedback();
      let redraw=true;
      try { await fn(); }
      catch(error) { problem=error.message;redraw=false; }
      finally { busy=false;if(redraw)draw();else feedback(); }
    }
  };
  workspaces.set('survey',createSurveyWorkspace(context));
  workspaces.set('interview',createInterviewWorkspace(context));
  workspaces.set('datasets',createDatasetWorkspace(context));

  function call(path,data) {
    return request('research/'+path,{root,...data});
  }
  function get(path,args={}) {
    return request('research/'+path+'?'+new URLSearchParams({root,...args}));
  }
  async function upload(path,file,meta) {
    const selected=root;
    const json=new TextEncoder().encode(JSON.stringify({...meta,expectedRevision:index.revision}));
    const prefix=new DataView(new ArrayBuffer(4));prefix.setUint32(0,json.length);
    const body=new Blob([prefix.buffer,json,file],{type:'application/octet-stream'});
    const response=await fetch(dataLink(path,{root:selected}),{method:'POST',body});
    const result=await response.json();
    if(!response.ok||result.ok===false)throw new Error(result.error||'导入失败');
    if(root!==selected||disposed)throw new Error('项目已切换，请重新打开研究工具。');
    await refresh();await onProjectMutation?.();return result;
  }
  async function entry(id,versionId) {
    const selected=root;
    const result=await request('research/entry?'+new URLSearchParams({root:selected,id,...(versionId?{versionId}:{})}));
    if(disposed||root!==selected)throw new Error('项目已切换，请重新选择记录。');
    return result;
  }
  async function mutate(path,data) {
    const selected=root;
    const result=await call(path,{...data,expectedRevision:index.revision});
    if(root!==selected||disposed)throw new Error('项目已切换，请重新打开对应研究工具');
    await refresh();
    await onProjectMutation?.();
    return result;
  }
  async function refresh({redraw=true}={}) {
    if (!root) return;
    const selected=root,requestId=++loadGeneration;
    try {
      const result=await request('research/index?'+new URLSearchParams({root:selected}));
      if(root===selected&&requestId===loadGeneration&&!disposed){index=result;if(redraw)draw();}
    } catch(error) {
      if(root===selected&&requestId===loadGeneration&&!disposed){problem=error.message;if(redraw)draw();}
      throw error;
    }
  }
  function open(next,id,versionId) {
    if(tab!==next)workspaces.get(tab)?.pause?.();
    tab=next;notice='';problem='';panel=null;
    draw();
    if(id)context.task(()=>workspaces.get(next)?.open(id,versionId));
  }
  async function showItem(id,versionId) {
    panel=await entry(id,versionId);
  }
  const itemAction=(row,action='item')=>button(action,row.title,{data:{id:row.id}});
  function overview() {
    const count=kind=>index.items.filter(item=>item.kind===kind).length;
    return heading('研究工作台',projectTitle,button('refresh','刷新'))+
      '<div class="research-entry-grid">'+
      '<article><div><h4>问卷设计</h4><p>编排题目与路径，验证后定稿并处理实际答卷。</p></div>'+button('tab','打开问卷设计',{data:{id:'survey'},primary:true})+'</article>'+
      '<article><div><h4>访谈工作台</h4><p>保留原始资料，定位音视频、校订并比较主题。</p></div>'+button('tab','打开访谈工作台',{data:{id:'interview'}})+'</article>'+
      '<article><div><h4>数据资源</h4><p>查找带版本与许可的数据，将原始文件登记到项目。</p></div>'+button('tab','打开数据资源',{data:{id:'datasets'}})+'</article>'+
      '<article><div><h4>研究产物</h4><p>查看当前项目的 '+index.items.length+' 份研究记录与绑定步骤。</p></div>'+button('tab','查看版本与来源',{data:{id:'artifacts'}})+'</article></div>'+
      '<section class="research-section">'+heading('近期记录','')+
      (index.items.length?'<ul class="research-list">'+index.items.slice(0,6).map(row=>'<li>'+itemAction(row)+'<span>'+html(names[row.kind])+'</span>'+badge(row.status)+'</li>').join('')+'</ul>':empty('选择研究工具开始。'))+'</section>'+
      '<details class="research-section"><summary>工具说明与权限</summary><div class="research-tool-list">'+(index.tools??[]).map(tool=>
        '<div><strong>'+html(tool.title)+'</strong><p>输入 '+html(tool.inputs.join('、'))+'</p><p>产物 '+html(tool.result)+'</p><p>'+html(tool.access)+'</p></div>').join('')+'</div></details>'+
      (index.history?.length?'<details class="research-section"><summary>最近操作</summary><ul class="research-list">'+index.history.slice(0,12).map(row=>
        '<li><time>'+html(new Date(row.at).toLocaleString())+'</time><span>'+html(({ 'research.version-saved':'保存版本','research.job-started':'启动任务','research.bound':'绑定步骤',
          'research.unbound':'解除绑定','research.dataset-snapshot':'登记数据版本','research.dataset-search':'数据搜索','research.dataset-metadata':'查看数据版本','research.artifact-draft':'保存工作稿'})[row.type]??'研究操作')+'</span></li>').join('')+'</ul></details>':'');
  }
  function artifactDetails() {
    const {item,version,data}=panel,metadata=version.payload;
    const hasText=['survey','guide','interview'].includes(item.kind)||data.markdown;
    const synthetic=metadata.provenance==='synthetic';
    const formats=['json',...(hasText?['md',...(synthetic?[]:['docx'])]:[]),...(item.kind==='responses'||data.matrix?['csv']:[]),
      ...(!synthetic&&item.kind==='interview'&&data.transcript.some(row=>row.start!==null)?['srt']:[])];
    const links=formats.map(format=>'<a class="research-button" download href="'+html(dataLink('export',{root,id:item.id,versionId:version.id,format}))+'">'+html(format.toUpperCase())+'</a>').join('');
    const steps=index.steps;
    const bindings=item.bindings.filter(row=>row.versionId===version.id);
    const stats=item.kind==='responses'?'<h4>答卷分析 · '+data.summary.sampleCount+' 份</h4><div class="research-table"><table><thead><tr><th>变量</th><th>有效</th><th>缺失</th><th>均值</th><th>分布（选项标识）</th></tr></thead><tbody>'+
      data.summary.columns.map(row=>'<tr><th>'+html(row.name)+'</th><td>'+row.present+'</td><td>'+row.missing+'</td><td>'+html(row.mean?.toFixed(2)??'—')+'</td><td>'+html(Object.entries(row.distribution).map(([key,count])=>key+' '+count).join(' · '))+'</td></tr>').join('')+'</tbody></table></div>':'';
    let detail=item.kind==='pretest'?'<p>模拟研究材料 · 实际样本数 0</p>'+html(data.plan.coverage):
      item.kind==='responses'?'<p>来源 '+html(data.origin)+'</p>'+stats:'';
    if(data.kind==='code-proposal')detail+='<div class="research-option"><h4>编码建议</h4><blockquote>'+html(data.evidence.quote)+'</blockquote><p>'+html(data.memo)+'</p>'+
      '<p>候选编码 '+html(data.codeIds.join(' · '))+'</p><form class="research-inline" data-research-form="accept-codes">'+
      field('确认采用此证据与编码','<input type="checkbox" name="confirm" required>')+
      button('accept-codes','采用编码建议',{type:'submit',disabled:busy})+'</form></div>';
    if(data.frequencies?.length){
      const max=Math.max(1,...data.frequencies.map(row=>row.count));
      detail+='<h4>编码频次</h4><div class="research-bars">'+data.frequencies.map(row=>'<div><span>'+html(row.name)+'</span><meter min="0" max="'+max+
        '" value="'+row.count+'" aria-label="'+html(row.name)+'"></meter><strong>'+row.count+'</strong></div>').join('')+'</div>';
    }
    if(data.matrix?.length&&(data.frequencies||data.profile)){
      const [columns,...values]=data.matrix;
      detail+='<h4>'+html(data.frequencies?'访谈对比矩阵':'字段完整性')+'</h4><div class="research-table"><table><thead><tr>'+
        columns.map(label=>'<th scope="col">'+html(label)+'</th>').join('')+'</tr></thead><tbody>'+
        values.map(row=>'<tr>'+row.map((cell,index)=>index===0?'<th scope="row">'+html(cell)+'</th>':'<td>'+html(index===1&&data.frequencies?String(cell).slice(0,12):cell)+'</td>').join('')+'</tr>').join('')+
        '</tbody></table></div>';
    }
    if(data.markdown)detail+='<details class="research-rule-details"><summary>查看完整报告与证据</summary><pre class="research-report">'+html(data.markdown)+'</pre></details>';
    return heading(metadata.title,names[item.kind]+' · '+new Date(metadata.savedAt).toLocaleString(),links)+
      '<div class="research-meta">'+badge(metadata.status)+'<code title="'+html(version.id)+'">'+html(version.id.slice(0,12))+'</code>'+
      (metadata.source?button('item','查看来源版本',{data:{id:metadata.source.itemId,version:metadata.source.versionId}}):'')+
      field('查看版本',select('version',item.versions.slice().reverse().map((id,index)=>option(id,'第 '+(item.versions.length-index)+' 版',id===version.id)).join(''),'data-version'))+'</div>'+
      detail+
      (metadata.status!=='proposal'?'<form class="research-inline" data-research-form="bind">'+field('绑定项目步骤',select('stepId',steps.map(step=>option(step.id,step.title)).join('')))+button('bind','绑定当前版本',{type:'submit',disabled:busy||!steps.length})+'</form>'+
      bindings.map(row=>'<p class="research-binding">'+html(steps.find(step=>step.id===row.stepId)?.title||'原流程步骤')+button('unbind','解除绑定',{data:{id:row.stepId}})+'</p>').join(''):'')+
      (!['proposal','synthetic'].includes(metadata.provenance)&&steps.some(step=>step.outputs.some(output=>formats.includes(output.format)))?
        '<form class="research-inline" data-research-form="work-draft">'+field('写入项目工作稿',select('artifact',steps.flatMap(step=>step.outputs.filter(o=>formats.includes(o.format)).map(o=>option([step.id,o.id,o.format].join('|'),step.title+' / '+o.title+'（'+o.format+'）'))).join('')))+
        button('work-draft','生成工作稿',{type:'submit',disabled:busy})+'</form>':'')+
      (item.kind==='survey'?button('open-survey',metadata.status==='proposal'?'查看问卷建议':'在设计器打开',{data:{id:item.id}}):
        ['guide','interview','codebook'].includes(item.kind)?button('open-interview','在访谈工作台打开',{data:{id:item.id}}):
        item.kind==='dataset'?button('open-dataset','查看数据文件',{data:{id:item.id}}):'');
  }
  function artifacts() {
    return heading('研究产物','来源、版本和流程步骤',button('refresh','刷新'))+
      '<div class="research-two"><aside class="research-shelf" aria-label="研究记录列表">'+
      (index.items.length?index.items.map(row=>'<button class="research-record" type="button" data-r="item" data-id="'+html(row.id)+'" aria-current="'+(panel?.item.id===row.id)+'"><span>'+html(row.title)+'</span><small>'+html(names[row.kind])+' · '+html(levels[row.status]??row.status)+'</small></button>').join(''):empty('暂无研究记录。'))+
      '</aside><section class="research-section">'+(panel?artifactDetails():empty('从列表打开一份记录。'))+'</section></div>';
  }
  function feedback() {
    const seat=element.querySelector('.research-feedback');
    if(seat)seat.innerHTML=problem?'<p class="research-error" role="alert">'+html(problem)+'</p>':
      notice?'<p class="research-success">'+html(notice)+'</p>':busy?'<p class="research-loading">正在处理…</p>':'';
    element.setAttribute('aria-busy',String(busy));
  }
  function draw() {
    if (disposed||!active) return;
    const focused=element.contains(document.activeElement)?document.activeElement:null;
    const key=focused?.dataset.focus,selection=focused?.selectionStart,selectionEnd=focused?.selectionEnd;
    const scroll=new Map([...element.querySelectorAll('[data-r-scroll]')].map(node=>[node.dataset.rScroll,node.scrollTop]));
    const workspace=workspaces.get(tab);
    element.innerHTML='<nav class="research-tabs" aria-label="研究工具">'+tabs.map(([id,title])=>
      '<button class="research-tab" type="button" data-r="tab" data-id="'+id+'" aria-current="'+(tab===id?'page':'false')+'">'+title+'</button>').join('')+'</nav>'+
      '<div class="research-feedback" aria-live="polite"></div>'+
      '<div class="research-view" data-view="'+tab+'">'+(!root?empty('请打开一个项目。'):!index?(problem?button('refresh','重新读取'):empty('正在读取项目研究记录…')):workspace?workspace.render():tab==='artifacts'?artifacts():overview())+'</div>';
    feedback();workspace?.afterRender?.();
    for(const node of element.querySelectorAll('[data-r-scroll]'))node.scrollTop=scroll.get(node.dataset.rScroll)||0;
    if (key) {
      const next=[...element.querySelectorAll('[data-focus]')].find(node=>node.dataset.focus===key);
      next?.focus({preventScroll:true});
      if (next&&typeof selection==='number')try{next.setSelectionRange(selection,selectionEnd);}catch{/* Non-text input. */}
    }
  }
  element.addEventListener('click',async event=>{
    const target=event.target.closest('[data-r]');
    if (!target||target.disabled||target.type==='submit') return;
    const {r,id,version}=target.dataset;
    if(r==='tab'){open(id);return;}
    if(r==='open-survey'){open('survey',id);return;}
    if(r==='open-interview'){open('interview',id);return;}
    if(r==='open-dataset'){open('datasets',id);return;}
    if(r==='refresh')return context.task(refresh);
    if(r==='item')return context.task(async()=>{workspaces.get(tab)?.pause?.();tab='artifacts';await showItem(id,version);});
    if(r==='unbind')return context.task(async()=>{await mutate('bind',{id:panel.item.id,versionId:panel.version.id,stepId:id,remove:true});await showItem(panel.item.id,panel.version.id);notice='已解除绑定。';});
    try { await workspaces.get(tab)?.click?.(r,target,event); }
    catch(error) {context.fail(error);}
  });
  element.addEventListener('submit',event=>{
    event.preventDefault();
    const form=event.target,values=Object.fromEntries(new FormData(form)),workspace=workspaces.get(tab),snapshot=workspace?.prepareSubmit?.(form);
    context.task(async()=>{
      if(form.dataset.researchForm==='bind'){
        await mutate('bind',{id:panel.item.id,versionId:panel.version.id,stepId:values.stepId});
        await showItem(panel.item.id,panel.version.id);notice='已绑定项目步骤。';return;
      }
      if(form.dataset.researchForm==='work-draft'){
        const [stepId,artifactId,format]=values.artifact.split('|');
        await mutate('work-draft',{id:panel.item.id,versionId:panel.version.id,stepId,artifactId,format});
        notice='工作稿已生成，打开对应流程步骤复核与验收。';return;
      }
      if(form.dataset.researchForm==='accept-codes'){
        await mutate('interview/accept-codes',{id:panel.item.id,versionId:panel.version.id,confirm:values.confirm==='on'});
        notice='编码建议已采用并保存到校订稿。';return;
      }
      await workspace?.submit?.(form.dataset.researchForm,values,form,event.submitter,snapshot);
    });
  });
  for(const name of ['change','input','dragstart','dragover','drop','keydown'])element.addEventListener(name,event=>{
    if(name==='change'&&event.target.matches('[data-version]')&&panel){context.task(()=>showItem(panel.item.id,event.target.value));return;}
    try{const result=workspaces.get(tab)?.[name]?.(event);result?.catch?.(context.fail);}
    catch(error){context.fail(error);}
  });
  return {element,
    setProject(project){
      if(root===project?.root&&projectId===project?.id){
        if(index&&project.revision>index.revision&&!busy)refresh().catch(()=>{});
        return;
      }
      root=project?.kind==='v2'?project.root:null;projectId=project?.id;projectTitle=project?.name??'';
      index=null;notice='';problem='';panel=null;tab='overview';
      for(const workspace of workspaces.values())workspace.reset?.();
      draw();if(root)refresh().catch(()=>{});
    },
    setActive(value){
      if(active===value)return;
      active=value;
      if(value)draw();
      else workspaces.get(tab)?.pause?.();
    },
    openArtifact(id,versionId){if(!index)return refresh().then(()=>context.showArtifact(id,versionId));return context.showArtifact(id,versionId);},
    dispose(){disposed=true;for(const workspace of workspaces.values())workspace.reset?.();element.remove();}
  };
}
