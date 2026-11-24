import {html,button,heading,field,input,select,option,empty,badge} from './research-ui.js';

const flags={'duplicate-answers':'答案相同，需人工核对','straight-line':'连续相同作答，需人工核对'};
export function createCollectionWorkspace(ctx){
  let root=null,current=null,discovery=null,url='',survey='',sheetId='',mapping={},softwareTest=false,timer=null,job=null,loading=false,page=0,reviewDraft={};
  const collections=()=>ctx.index.items.filter(row=>row.kind==='collection');
  const surveys=()=>ctx.index.items.filter(row=>row.kind==='survey'&&row.status==='final');
  async function selectSurvey(value){survey=value;mapping={};if(value){const entry=await ctx.entry(value.split('|')[0],value.split('|')[1]);questions=entry.data.pages.flatMap(p=>p.questions);}else questions=[];}
  let questions=[];
  function pause(){clearTimeout(timer);timer=null;}
  function watch(){pause();if(!job||loading)return;timer=setTimeout(async()=>{loading=true;try{
    const active=await ctx.get('job',{id:job.id});job=active.job;
    const status=ctx.element.querySelector('[data-collection-job]');if(status)status.textContent=job.status==='running'?'正在回收 '+(job.progress.done||0)+' 份…':job.message||job.status;
    if(['running','cancelling'].includes(job.status)){loading=false;watch();return;}
    if(job.status==='completed'){await ctx.refresh({redraw:false});current=await ctx.entry(job.result.itemId,job.result.versionId);reviewDraft={};page=0;}
    else if(job.message)ctx.fail(new Error(job.message));job=null;ctx.draw();
  }catch(error){ctx.fail(error);}finally{loading=false;}},650);}
  function render(){
    if(root!==ctx.root){pause();root=ctx.root;current=null;discovery=null;url='';survey='';sheetId='';mapping={};questions=[];job=null;page=0;reviewDraft={};}
    const sheet=discovery?.sheets.find(s=>String(s.id)===String(sheetId));
    const data=current?.data;
    return '<div class="study-layout"><aside class="study-sidebar"><h4>金山答卷回收</h4>'+button('collection-new','绑定回收表')+collections().map(row=>button('collection-open',row.title,{data:{id:row.id}})).join('')+'</aside><section class="study-main">'+
      heading('正式问卷回收','在金山表单采集，用定稿问卷检查答卷，复核后进入项目。')+
      (!current?'<form class="study-form" data-research-form="collection-discover">'+field('已定稿问卷',select('survey',option('','选择定稿问卷',!survey)+surveys().map(row=>option(row.id+'|'+row.head,row.title,survey===row.id+'|'+row.head)).join(''),'data-collection-survey required'))+
        field('金山回收文档链接',input('url',url,'data-collection-url placeholder="https://www.kdocs.cn/l/…" required'))+
        field('允许读取此金山文档','<input type="checkbox" name="approve" required>')+button('collection-discover','读取表结构',{type:'submit',disabled:ctx.busy||!surveys().length})+'</form>':'')+
      (!current&&sheet?'<form class="study-form research-section" data-research-form="collection-connect">'+field('回收数据表',select('sheetId',discovery.sheets.map(s=>option(s.id,s.name,String(s.id)===String(sheetId))).join(''),'data-collection-sheet'))+
        '<h4>对应问卷题目</h4>'+questions.map(q=>field(q.title+(q.required?' · 必填':''),select('map_'+q.name,option('','不导入',!mapping[q.name])+sheet.fields.map(f=>option(f.name,f.name+' · '+f.type,mapping[q.name]===f.name)).join(''),'data-collection-map="'+html(q.name)+'"'))).join('')+
        field('此表仅用于软件验收，不计为实际样本','<input name="softwareTest" type="checkbox"'+(softwareTest?' checked':'')+'>')+
        button('collection-connect','保存问卷与回收表绑定',{type:'submit',primary:true,disabled:ctx.busy})+'</form>':'')+
      (current?'<section class="research-section">'+heading(current.item.title,data.sheetName+' · '+(data.pulledAt?new Date(data.pulledAt).toLocaleString():'尚未回收'),badge(current.item.status))+
        '<p><a target="_blank" rel="noreferrer" href="'+html(data.url)+'">打开金山采集文档 ↗</a></p>'+(data.softwareTest?'<p class="research-error">软件测试数据 · 实际样本数 0 · 不可登记为实际答卷</p>':'')+
        '<form class="research-inline" data-research-form="collection-pull">'+field('允许本次读取金山答卷','<input name="approve" type="checkbox" required>')+
        button('collection-pull','回收最新答卷',{type:'submit',primary:true,disabled:ctx.busy||!!job})+'</form><p data-collection-job role="status">'+(job?'正在回收…':'')+'</p></section>':'')+
      (current&&data.pulledAt?'<form class="study-form" data-research-form="collection-review"><h4>逐份复核 · '+data.rows.length+' 份</h4><p>待复核 '+data.rows.filter(r=>r.decision==='pending').length+' · 已采用 '+data.rows.filter(r=>r.decision==='approved').length+' · 已排除 '+data.rows.filter(r=>r.decision==='rejected').length+'</p><div class="research-actions">'+button('collection-approve-clean','采用全部无异常答卷',{disabled:ctx.busy||!data.rows.some(r=>r.decision==='pending'&&!Object.keys(r.errors).length&&!r.flags.length)})+button('collection-reject-invalid','排除全部结构无效答卷',{disabled:ctx.busy||!data.rows.some(r=>r.decision==='pending'&&Object.keys(r.errors).length)})+'</div>'+(data.rows.length?data.rows.slice(page*25,(page+1)*25).map(row=>'<article class="study-requirement"><div><strong>答卷 '+html(row.sourceId)+'</strong> '+badge(({pending:'待复核',approved:'已采用',rejected:'已排除'})[row.decision])+'</div><pre>'+html(JSON.stringify(row.answers,null,2))+'</pre>'+
        Object.entries(row.errors).map(([name,error])=>'<p class="research-error">'+html(name+'：'+error)+'</p>').join('')+row.flags.map(flag=>'<p>'+html(flags[flag]??flag)+'</p>').join('')+
        field('答卷 '+row.sourceId+' 复核决定',select('decision_'+row.sourceId,['pending','approved','rejected'].map(decision=>option(decision,({pending:'待复核',approved:'采用',rejected:'排除'})[decision],decision===(reviewDraft[row.sourceId]?.decision??row.decision))).join(''),'data-collection-decision="'+html(row.sourceId)+'"'))+
        field('答卷 '+row.sourceId+' 复核理由',input('reason_'+row.sourceId,reviewDraft[row.sourceId]?.reason??row.reason,'data-collection-reason="'+html(row.sourceId)+'"'))+'</article>').join(''):empty('此数据表尚无答卷。'))+
        (data.rows.length?'<div class="research-actions">'+button('collection-prev','上一页',{disabled:page===0})+'<span>第 '+(page+1)+' / '+Math.ceil(data.rows.length/25)+' 页</span>'+button('collection-next','下一页',{disabled:(page+1)*25>=data.rows.length})+button('collection-review','保存复核决定',{type:'submit',disabled:ctx.busy})+'</div>':'')+'</form>'+
        (!data.softwareTest&&!data.adoptedResponse?'<form class="research-section study-form" data-research-form="collection-adopt">'+field('确认已复核答卷来自实际采集','<input name="confirm" type="checkbox" required>')+button('collection-adopt','采用为项目实际答卷',{type:'submit',primary:true,disabled:ctx.busy})+'</form>':data.adoptedResponse?'<p class="research-success">已保存实际答卷及本次回收来源。</p>':''):'')+'</section></div>';
  }
  return {render,pause,afterRender(){if(job&&!loading&&!timer)watch();},
    input(event){if(event.target.hasAttribute('data-collection-url'))url=event.target.value;const id=event.target.dataset.collectionReason;if(id)reviewDraft[id]={...reviewDraft[id],reason:event.target.value};},
    async change(event){
      if(event.target.hasAttribute('data-collection-survey'))await ctx.task(async()=>{await selectSurvey(event.target.value);});
      if(event.target.hasAttribute('data-collection-sheet')){sheetId=event.target.value;mapping={};ctx.draw();}
      if(event.target.dataset.collectionMap)mapping[event.target.dataset.collectionMap]=event.target.value;
      const id=event.target.dataset.collectionDecision;if(id)reviewDraft[id]={...reviewDraft[id],decision:event.target.value};
    },
    async click(action,target){
      if(action==='collection-new'){current=null;ctx.draw();}
      if(action==='collection-open')await ctx.task(async()=>{pause();job=null;current=await ctx.entry(target.dataset.id);reviewDraft={};page=0;});
      if(action==='collection-prev'||action==='collection-next'){page+=action==='collection-prev'?-1:1;ctx.draw();}
      if(action==='collection-approve-clean'||action==='collection-reject-invalid')await ctx.task(async()=>{
        const approve=action==='collection-approve-clean',rows=current.data.rows.filter(r=>r.decision==='pending'&&(approve?!Object.keys(r.errors).length&&!r.flags.length:Object.keys(r.errors).length));
        const result=await ctx.mutate('study/collection/review',{id:current.item.id,versionId:current.version.id,decisions:rows.map(r=>({sourceId:r.sourceId,decision:approve?'approved':'rejected',reason:approve?'负责人批量确认结构有效且无质量异常':'负责人批量排除结构无效答卷'}))});current=await ctx.entry(result.item.id);reviewDraft={};
      });
    },
    async submit(type,values){
      if(type==='collection-discover'){url=values.url;await selectSurvey(values.survey);discovery=await ctx.call('study/collection/inspect',{url,approveRead:values.approve==='on'});sheetId=String(discovery.sheets[0].id);mapping={};}
      if(type==='collection-connect'){
        const sheet=discovery.sheets.find(s=>String(s.id)===String(sheetId));
        softwareTest=values.softwareTest==='on';
        const result=await ctx.mutate('study/collection/connect',{url,surveyId:survey.split('|')[0],surveyVersion:survey.split('|')[1],sheetId:sheet.id,schemaSha256:sheet.schemaSha256,mapping:Object.fromEntries(questions.flatMap(q=>values['map_'+q.name]?[[q.name,values['map_'+q.name]]]:[])),softwareTest,approveRead:true});
        current=await ctx.entry(result.item.id);
      }
      if(type==='collection-pull'){const result=await ctx.mutate('study/collection/pull',{id:current.item.id,versionId:current.version.id,approveRead:values.approve==='on'});job=result.job;watch();}
      if(type==='collection-review'){const result=await ctx.mutate('study/collection/review',{id:current.item.id,versionId:current.version.id,decisions:current.data.rows.map(row=>({sourceId:row.sourceId,decision:reviewDraft[row.sourceId]?.decision??row.decision,reason:reviewDraft[row.sourceId]?.reason??row.reason}))});current=await ctx.entry(result.item.id);reviewDraft={};}
      if(type==='collection-adopt'){await ctx.mutate('study/collection/adopt',{id:current.item.id,versionId:current.version.id,confirmActual:values.confirm==='on'});current=await ctx.entry(current.item.id);}
    }
  };
}
