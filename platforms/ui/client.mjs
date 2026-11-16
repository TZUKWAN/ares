import {App} from '@modelcontextprotocol/ext-apps';
import {workflowCanvasMarkup,createWorkflowCanvas} from '../../client/workflow-canvas.js';

const app=new App({name:'ARES',version:'2.4.0'},{},{autoResize:false});
const root=document.querySelector('#app'),e=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>structuredClone(value),views=new Map();
const state={workspace:'projects',caps:null,catalog:null,root:null,project:null,flow:null,scope:null,flowStepId:null,projectStepId:null,focusId:null,artifactId:null,dirty:false,busy:0,error:'',epoch:0};
let canvas,scene,sceneApi,sceneElement,artifact,dragId=null,pan=null,initial={},disposed=false;
const objectUrls=[];
const button=(action,label,_icon='',kind='',attrs='')=>`<button type="button" class="ares-btn ${kind}" data-action="${e(action)}" ${attrs}>${e(label)}</button>`;
const input=(label,key,value,extra='')=>`<label class="ares-field"><span class="ares-label">${e(label)}</span><input class="ares-input" data-edit="${e(key)}" value="${e(value)}" ${extra}></label>`;
function message(text,error=false){const node=root.querySelector('[data-feedback]');if(node){node.textContent=text;node.dataset.error=String(error);node.hidden=!text;}}
function setBusy(change){state.busy+=change;root.dataset.busy=String(state.busy>0);root.querySelectorAll('[data-mutation]').forEach(node=>{node.disabled=state.busy>0;node.setAttribute('aria-busy',String(state.busy>0));});}
async function call(name,args){
 const result=await app.callServerTool({name,arguments:args});let value=result.structuredContent;
 if(value===undefined){const text=(result.content||[]).filter(row=>row.type==='text').map(row=>row.text).join('\n');try{value=JSON.parse(text);}catch{value={message:text};}}
 if(result.isError||value?.ok===false){const error=new Error(value?.message||value?.error||'宿主工具请求失败');error.code=value?.code;throw error;}
 return value;
}
async function action(run){if(state.busy)return;setBusy(1);message('');try{await run();}catch(error){message(error.message,true);}finally{setBusy(-1);}}
function destroyView(){canvas?.dispose();canvas=null;scene?.();scene=null;sceneElement=null;}
function scope(){const competition=state.catalog?.competitions.find(row=>row.id===Number(root.querySelector('[data-competition]')?.value||state.scope?.competitionId))||state.catalog?.competitions[0];const track=root.querySelector('[data-track]')?.value||state.scope?.track||competition?.tracks[0]?.track;return{competitionId:competition?.id,track,edition:root.querySelector('[data-edition]')?.value??state.scope?.edition??'',group:''};}
function currentStep(){return state.flow?.workflow.steps.find(row=>row.id===state.flowStepId)||state.flow?.workflow.steps[0];}
function board(){return{productCentric:true,selectedStepId:state.projectStepId,neuralStageId:state.focusId,artifactFocused:!!state.artifactId,liveArtifactId:state.artifactId};}
function nodeDetails(step){
 const projectMode=state.workspace==='projects';
 const list=projectMode?state.project.workflow.steps:state.flow.workflow.steps;
 const fields=projectMode?`<p>${e(step.objective)}</p><div class="portable-tags">${step.skills.map(id=>`<span class="ares-pill">${e(id)}</span>`).join('')}</div>`:
  `${input('步骤名称','title',step.title)}<label class="ares-field"><span class="ares-label">执行目标</span><textarea class="ares-input" data-edit="objective" rows="5">${e(step.objective)}</textarea></label><label class="ares-field"><span class="ares-label">前置步骤</span><select class="ares-input" multiple data-edit="dependsOn" size="3">${list.slice(0,list.indexOf(step)).map(row=>`<option value="${e(row.id)}" ${step.dependsOn.includes(row.id)?'selected':''}>${e(row.title)}</option>`).join('')}</select></label><label class="ares-field"><span class="ares-label">技能</span><select class="ares-input" multiple data-edit="skills" size="4">${(state.catalog.skills||[]).map(row=>`<option value="${e(row.id)}" ${step.skills.includes(row.id)?'selected':''}>${e(row.title||row.id)}</option>`).join('')}</select></label>`;
 return `<section class="portable-step-details"><p class="portable-eyebrow">STEP ${String(list.indexOf(step)+1).padStart(2,'0')}</p>${fields}<h3>交付物</h3>${step.outputs.map((output,index)=>`<article class="ares-output"><strong>${e(output.title)}</strong>${projectMode?`<small>${e(output.path||output.heading)}</small>`:`${input('文件或章节','output-'+index,output.path||output.heading)}`}${projectMode?button('artifact-open','查看作品','','quiet',`data-id="${e(output.id)}"`):''}</article>`).join('')}${projectMode?`<div class="portable-actions">${button('assistant','交给原生助手','','primary')}${button('check','检查作品','','quiet','data-mutation')}${button('capture','记录工作版本','','quiet','data-mutation')}</div><p class="ares-help">结构检查与工作版本分别记录；负责人验收保留在受信宿主操作中。</p>`:''}</section>`;
}
function composerHtml(){
 const c=state.catalog?.competitions||[],competition=c.find(row=>row.id===state.scope?.competitionId)||c[0],tracks=competition?.tracks||[],w=state.flow?.workflow,s=currentStep();
 return `<section class="ares-composer-editor"><div class="portable-scope"><label>比赛<select class="ares-input" data-competition aria-label="比赛">${c.map(row=>`<option value="${row.id}" ${row.id===competition?.id?'selected':''}>${e(row.name)}</option>`).join('')}</select></label><label>赛道<select class="ares-input" data-track aria-label="赛道">${tracks.map(row=>`<option ${row.track===state.scope?.track?'selected':''}>${e(row.track)}</option>`).join('')}</select></label><label>届次<input class="ares-input" data-edition value="${e(state.scope?.edition||'')}" aria-label="届次"></label>${button('flow-load','读取流程','','quiet')}${button('flow-save',state.dirty?'保存更改':'保存流程','','primary','data-mutation')}</div>${w&&s?`<div class="ares-studio">${workflowCanvasMarkup(w,s,{button})}<section class="ares-editor"><header class="ares-editor-head"><h2>${e(w.title)}</h2><div class="portable-actions">${button('step-up','上移','','quiet')}${button('step-down','下移','','quiet')}${button('step-remove','删除步骤','','quiet')}</div></header><div class="ares-editor-body">${nodeDetails(s)}</div></section></div>`:'<div class="portable-empty">选择比赛和赛道，读取对应的实际流程。</div>'}</section>`;
}
function render(){
 destroyView();
 root.innerHTML=`<div class="ares-app ares-system ares-galaxy ares-portable" data-ares-ui="galaxy"><header class="portable-header"><div><strong class="portable-brand">ARES</strong><span>竞赛工作台</span></div><div class="portable-actions">${(state.caps?.roots||[]).length>1?`<select class="ares-input" data-root aria-label="已授权项目目录">${state.caps.roots.map(path=>`<option value="${e(path)}" ${path===state.root?'selected':''}>${e(path)}</option>`).join('')}</select>`:''}${button('refresh','刷新','','quiet')}${button('assistant','原生助手','','quiet')}</div></header><div data-feedback class="portable-feedback" role="status" hidden></div><main class="portable-main">${state.workspace==='composer'?composerHtml():state.project?.kind==='v2'?'<div class="portable-scene"></div>':`<div class="portable-empty"><p class="portable-eyebrow">PROJECT</p><h1>开始这场比赛</h1><p>${state.caps?.roots.length?'当前授权工作区尚未建立竞赛项目。':'请由宿主提供项目roots，或在MCP启动参数中配置 --root。'}</p><div>${button('new-project','创建竞赛项目','','primary',state.root?'':'disabled')}${button('workspace','先编排比赛流程','','quiet','data-id="composer"')}</div></div>`}</main><footer class="portable-footer"><nav aria-label="ARES 工作区">${button('workspace','流程编排','',state.workspace==='composer'?'active':'',`data-id="composer" aria-pressed="${state.workspace==='composer'}"`)}${button('workspace','项目推进','',state.workspace==='projects'?'active':'',`data-id="projects" aria-pressed="${state.workspace==='projects'}"`)}</nav><span>${e(state.workspace==='composer'?(state.dirty?'未保存的流程草稿':'比赛与赛道流程'):state.project?.name||'当前工作区')} · 宿主原生助手</span></footer><dialog class="portable-dialog" aria-label="详细内容"><header><strong data-dialog-title></strong>${button('close-dialog','关闭','','quiet')}</header><div data-dialog-body></div></dialog></div>`;
 if(state.workspace==='composer'&&state.flow){const key=JSON.stringify(state.scope);if(!views.has(key))views.set(key,{});canvas=createWorkflowCanvas(root.querySelector('.ares-flow-map'),{workflow:state.flow.workflow,selectedId:currentStep()?.id,view:views.get(key)});}
 if(state.workspace==='projects'&&state.project?.kind==='v2'&&sceneApi){const holder=root.querySelector('.portable-scene');holder.innerHTML=sceneApi.workshopScene(state.project,board());sceneElement=holder.querySelector('.ff-scene');sceneElement.querySelector('.work-header')?.remove();sceneElement.querySelector('.work-contextbar')?.remove();scene=sceneApi.observeWorkshopScene(sceneElement,{project:state.project,board:board(),preferences:{}});}
 setBusy(0);
}
function dialog(title,html){const node=root.querySelector('dialog');node.querySelector('[data-dialog-title]').textContent=title;node.querySelector('[data-dialog-body]').innerHTML=html;if(!node.open)node.showModal();}
async function readProject(){if(!state.root){state.project=null;return;}state.project=await call('ares_project',{action:'status',root:state.root});state.projectStepId=state.project.workflow?.steps.some(row=>row.id===state.projectStepId)?state.projectStepId:state.project.nextTask||state.project.workflow?.steps[0]?.id||null;}
async function loadFlow(requested){const at=++state.epoch,value=await call('ares_workflow',{action:'read',...requested});if(disposed||at!==state.epoch)return;state.scope=requested;state.flow=value;state.flowStepId=value.workflow.steps[0]?.id;state.dirty=false;}
async function saveFlow(){const f=state.flow;if(!f)throw Error('请先读取流程');state.flow=await call('ares_workflow',{action:'save',...state.scope,workflow:f.workflow,configuration:f.configuration,expectedRevision:f.expectedRevision,expectedWorkflowHash:f.workflowHash,expectedSkillHashes:f.skillHashes});state.dirty=false;render();message('比赛流程已保存；已有项目的固定流程保持。');}
function moveStep(id,before){const w=state.flow.workflow,from=w.steps.findIndex(row=>row.id===id),to=w.steps.findIndex(row=>row.id===before);if(from<0||to<0||from===to)return;const next=[...w.steps],[item]=next.splice(from,1);next.splice(to,0,item);const positions=new Map(next.map((row,index)=>[row.id,index]));if(next.some((row,index)=>row.dependsOn.some(key=>positions.get(key)>=index)))throw Error('移动会使依赖倒置，请先调整前置步骤。');w.steps=next;state.dirty=true;render();root.querySelector(`.ares-step[data-id="${CSS.escape(id)}"]`)?.focus();}
async function media(){
 const result=await app.readServerResource({uri:'ares://media/index'}),index=JSON.parse(result.contents.find(row=>typeof row.text==='string').text),values={};
 for(let i=0;i<index.files.length;i++){const file=index.files[i],parts=[];message(`准备本地动画资源 ${i+1}/${index.files.length}`);for(const uri of file.chunks){const response=await app.readServerResource({uri}),chunk=response.contents.find(row=>typeof row.blob==='string');if(!chunk)throw Error('本地动画资源返回不完整');parts.push(Uint8Array.from(atob(chunk.blob),c=>c.charCodeAt(0)));}const bytes=new Uint8Array(file.bytes);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}if(offset!==file.bytes)throw Error('本地动画资源长度不符');if(crypto.subtle){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');if(hash!==file.sha256)throw Error('本地动画资源校验失败');}const url=URL.createObjectURL(new Blob([bytes],{type:file.mimeType}));objectUrls.push(url);values[file.file]=url;}
 globalThis.__ARES_PORTABLE_MEDIA__=values;sceneApi=await import('../../client/workshop-scene.js');
}
async function showArtifact(id){
 artifact=await call('ares_artifact',{action:'read',root:state.root,id});state.artifactId=id;scene?.update(state.project,board());
 const parent=state.project.workflow.steps.find(row=>row.outputs.some(output=>output.id===id));if(parent){state.projectStepId=parent.id;state.focusId=parent.id;scene?.update(state.project,board());}
 const output=parent?.outputs.find(row=>row.id===id),text=typeof artifact.text==='string'?artifact.text:null,editable=!!artifact.editable&&text!==null&&!artifact.nextOffset;
 const html=`<div class="portable-preview"><header><strong>${e(output?.title||id)}</strong>${button('artifact-expand','放大编辑','','quiet')}</header>${text!==null?`<pre>${e(text)}</pre>`:`<p>${e(artifact.note||artifact.message||'此格式请在宿主文件工具中打开编辑。')}</p>`}<small>实际文件 · ${e(artifact.kind||artifact.type||'作品')} ${editable?'· 可编辑':''}</small></div>`;
 const panel=sceneElement?.querySelector('.ff-right');if(panel)panel.innerHTML=html;else dialog(output?.title||'作品',html);
}
async function assistant(){
 let context,prompt;
 if(state.workspace==='composer'&&state.flow){context={kind:'competition-workflow',scope:state.scope,workflow:state.flow.workflow,unsaved:state.dirty};prompt='请根据当前ARES比赛流程和我的目标，检查并完善这份流程，保留比赛与赛道归属。';}
 else if(state.project?.kind==='v2'){context=await call('ares_project',{action:'step',root:state.root,stepId:state.focusId||state.projectStepId});context={...context,root:state.root,...(state.artifactId&&artifact?{viewedArtifact:{id:state.artifactId,file:artifact.file||null,version:artifact.version||null,source:'actual-mcp-artifact-read'}}:{})};prompt='请依据当前ARES项目和步骤上下文，使用你自己的实际工具推进作品；检查真实结果并保留负责人验收。';}
 else throw Error('请先选择比赛流程或建立项目。');
 const caps=app.getHostCapabilities();if(!caps?.updateModelContext)throw Error('当前宿主未提供页面上下文接口，请在原生对话调用ARES工具。');
 await app.updateModelContext({content:[{type:'text',text:JSON.stringify(context)}],structuredContent:context});
 if(caps.message)await app.sendMessage({role:'user',content:[{type:'text',text:prompt}]});
 message(caps.message?'当前步骤已交给宿主原生对话。':'已加入下一轮对话上下文，请在原生输入框继续。');
}
async function handle(actionName,target){
 if(actionName==='close-dialog'){target.closest('dialog').close();return;}
 if(actionName==='workspace'){if(state.dirty&&target.dataset.id!==state.workspace)throw Error('请先保存当前流程草稿。');state.workspace=target.dataset.id;if(state.workspace==='composer'&&!state.flow)await loadFlow(scope());render();return;}
 if(actionName==='refresh'){if(state.dirty)throw Error('当前有未保存草稿，请先保存。');if(state.workspace==='projects')await readProject();else await loadFlow(state.scope||scope());render();return;}
 if(actionName==='assistant')return assistant();
 if(actionName==='flow-load'){if(state.dirty)throw Error('当前有未保存草稿，请先保存。');await loadFlow(scope());render();return;}
 if(actionName==='flow-save')return saveFlow();
 if(actionName==='step'){state.flowStepId=target.dataset.id;render();return;}
 if(actionName==='flow-zoom'){canvas?.zoomBy(Number(target.dataset.direction));return;}
 if(actionName==='flow-reset'){canvas?.fit();return;}
 if(actionName==='step-up'||actionName==='step-down'){const steps=state.flow.workflow.steps,index=steps.findIndex(row=>row.id===state.flowStepId),other=steps[index+(actionName==='step-up'?-1:1)];if(other)moveStep(state.flowStepId,other.id);return;}
 if(actionName==='step-remove'){const w=state.flow.workflow;if(w.steps.length===1)throw Error('流程至少保留一个步骤');if(w.steps.some(row=>row.dependsOn.includes(state.flowStepId)))throw Error('其他步骤仍依赖此步，请先调整前置步骤');w.steps=w.steps.filter(row=>row.id!==state.flowStepId);state.flowStepId=w.steps[0].id;state.dirty=true;render();return;}
 if(actionName==='step-add'){const id='step-'+crypto.randomUUID().slice(0,8),prior=currentStep(),node=copy(prior);Object.assign(node,{id,title:'新步骤',objective:'根据比赛目标说明本步骤的实际工作和交付要求。',dependsOn:[prior.id],outputs:[{id:id+'-output',title:'步骤成果',kind:'file',format:'md',path:id+'.md',requirement:'required'}]});state.flow.workflow.steps.splice(state.flow.workflow.steps.indexOf(prior)+1,0,node);state.flowStepId=id;state.dirty=true;render();return;}
 if(actionName==='new-project'){if(!state.root)throw Error('请先由宿主授权项目目录');if(!state.flow)await loadFlow(scope());dialog('创建竞赛项目',`${input('项目名称','newProjectName','')}<p>${e(state.flow.competition?.name)} · ${e(state.scope.track)}</p>${button('project-create','创建项目','','primary','data-mutation')}`);return;}
 if(actionName==='project-create'){const name=root.querySelector('[data-edit=newProjectName]').value.trim();if(!name)throw Error('请填写项目名称');const f=state.flow;state.project=await call('ares_project',{action:'init',root:state.root,name,...state.scope,flowMode:f.saved?'library':'competition',...(f.saved?{workflowId:f.workflow.id,expectedWorkflowHash:f.workflowHash,expectedConfigurationRevision:f.expectedRevision}:{})});await readProject();state.workspace='projects';state.focusId=null;render();return;}
 if(actionName==='project-step-select'||actionName==='workshop-step'){state.projectStepId=target.dataset.id;state.focusId=target.dataset.id;state.artifactId=null;scene?.update(state.project,board());return;}
 if(actionName==='neural-back'||actionName==='neural-overview'){if(actionName==='neural-overview'||!state.artifactId)state.focusId=null;state.artifactId=null;scene?.update(state.project,board());return;}
 if(actionName==='product-open'){const outputs=state.project.workflow.steps.flatMap(step=>step.outputs.map(output=>({...output,stepTitle:step.title})));dialog('总作品',outputs.map(output=>`<article class="ares-output"><strong>${e(output.title)}</strong><p>${e(output.stepTitle)} · ${e(output.path||output.heading)}</p>${button('artifact-open','读取实际作品','','quiet',`data-id="${e(output.id)}"`)}</article>`).join(''));return;}
 if(actionName==='nebula-node-open'){state.projectStepId=target.dataset.id||state.projectStepId;const step=state.project.workflow.steps.find(row=>row.id===state.projectStepId);dialog(step.title,nodeDetails(step));return;}
 if(actionName==='nebula-member-open'){const value=await call('ares_team',{action:'read',root:state.root});dialog('项目成员',`<pre>${e(JSON.stringify(value.team,null,2))}</pre>`);return;}
 if(actionName==='project-artifact-select'||actionName==='artifact-open')return showArtifact(target.dataset.id);
 if(actionName==='artifact-expand'){const editable=artifact.editable&&typeof artifact.text==='string'&&!artifact.nextOffset;dialog('实际作品',`${editable?`<textarea class="ares-input portable-document-editor" data-artifact-text aria-label="作品正文">${e(artifact.text)}</textarea>${button('artifact-save','保存当前作品','','primary','data-mutation')}`:`<pre>${e(artifact.text||artifact.note||'请使用宿主文件工具编辑。')}</pre>`}`);return;}
 if(actionName==='artifact-save'){await call('ares_artifact',{action:'save',root:state.root,id:state.artifactId,version:artifact.version,expectedRevision:state.project.revision,text:root.querySelector('[data-artifact-text]').value});await readProject();await showArtifact(state.artifactId);root.querySelector('dialog').close();message('作品已写入并保留原版本；负责人验收未自动改变。');return;}
 if(actionName==='check'){const result=await call('ares_project',{action:'check',root:state.root,stepId:state.projectStepId});dialog('实际作品检查',`<pre>${e(JSON.stringify(result,null,2))}</pre>`);return;}
 if(actionName==='capture'){const result=await call('ares_version',{action:'capture',root:state.root,expectedRevision:state.project.revision,stepId:state.projectStepId});await readProject();message('已记录实际工作版本，未代替负责人验收。');return result;}
}
root.addEventListener('click',event=>{const target=event.target.closest('[data-action]');if(target&&!target.disabled)action(()=>handle(target.dataset.action,target));});
root.addEventListener('input',event=>{
 const key=event.target.dataset.edit,s=currentStep();if(!s||!key||key==='newProjectName')return;
 if(key==='title'||key==='objective')s[key]=event.target.value;else if(key==='dependsOn'||key==='skills')s[key]=Array.from(event.target.selectedOptions,row=>row.value);else if(key.startsWith('output-')){const output=s.outputs[Number(key.slice(7))];output[output.kind==='section'?'heading':'path']=event.target.value;}
 state.dirty=true;const label=root.querySelector('[data-step-title="'+CSS.escape(s.id)+'"]');if(key==='title'&&label)label.textContent=s.title;message('流程草稿已修改，保存后用于新项目。');
});
root.addEventListener('change',event=>{if(event.target.matches('[data-competition]')){const competition=state.catalog.competitions.find(row=>row.id===Number(event.target.value)),track=root.querySelector('[data-track]');track.innerHTML=competition.tracks.map(row=>`<option>${e(row.track)}</option>`).join('');}if(event.target.matches('[data-root]'))action(async()=>{if(state.dirty)throw Error('请先保存当前流程草稿');state.root=event.target.value;await readProject();state.focusId=null;state.artifactId=null;render();});});
root.addEventListener('dragstart',event=>{const node=event.target.closest('.ares-flow-map .ares-step');if(node){dragId=node.dataset.id;event.dataTransfer.setData('text/plain',dragId);event.dataTransfer.effectAllowed='move';}});
root.addEventListener('dragover',event=>{if(dragId&&event.target.closest('.ares-flow-map .ares-step'))event.preventDefault();});
root.addEventListener('drop',event=>{const target=event.target.closest('.ares-flow-map .ares-step');if(dragId&&target){event.preventDefault();const id=dragId;dragId=null;action(()=>moveStep(id,target.dataset.id));}});
root.addEventListener('dragend',()=>{dragId=null;});
root.addEventListener('keydown',event=>{if(event.altKey&&['ArrowUp','ArrowDown'].includes(event.key)&&event.target.closest('.ares-flow-map .ares-step')){event.preventDefault();action(()=>handle(event.key==='ArrowUp'?'step-up':'step-down',event.target));}});
root.addEventListener('pointerdown',event=>{const viewport=event.target.closest('.ares-flow-viewport');if(viewport&&!event.target.closest('button,input,select,textarea')){pan={viewport,id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};viewport.setPointerCapture(event.pointerId);}});
root.addEventListener('pointermove',event=>{if(pan?.id===event.pointerId){pan.viewport.scrollLeft=pan.left+pan.x-event.clientX;pan.viewport.scrollTop=pan.top+pan.y-event.clientY;}});
root.addEventListener('pointerup',()=>{pan=null;});root.addEventListener('pointercancel',()=>{pan=null;});
app.ontoolinput=value=>{initial=value.arguments||{};};
app.ontoolresult=value=>{const next=value.structuredContent;if(next?.uiResource){initial=next;if(state.caps&&next.root&&next.root!==state.root)action(async()=>{state.root=next.root;await readProject();state.workspace=next.workspace||state.workspace;render();});}};
app.onhostcontextchanged=()=>{document.documentElement.lang=app.getHostContext()?.locale||'zh-CN';};
window.addEventListener('pagehide',()=>{disposed=true;destroyView();for(const url of objectUrls)URL.revokeObjectURL(url);app.close();},{once:true});
async function start(){try{
 root.innerHTML='<div class="portable-boot" role="status">连接 ARES 工作台…</div>';
 await app.connect();state.caps=await call('ares_capabilities',{});state.catalog=await call('ares_catalog',{action:'summary'});state.root=initial.root||state.caps.roots[0]||null;state.workspace=initial.workspace||'projects';state.scope={competitionId:state.catalog.competitions[0].id,track:state.catalog.competitions[0].tracks[0].track,edition:'',group:''};
 await readProject();if(state.workspace==='composer')await loadFlow(state.scope);render();
 await media();if(!disposed){render();message('');}
 }catch(error){if(!root.querySelector('[data-feedback]'))root.innerHTML='<div class="portable-boot"><h1>ARES 未连接</h1><p data-feedback role="alert"></p></div>';message(error.message,true);}}
start();
