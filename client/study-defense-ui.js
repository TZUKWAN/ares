import {html,button,heading,field,input,area,empty,badge} from './research-ui.js';

export function createDefenseWorkspace(ctx){
  let root=null,current=null,loaded=false,loading=false,works=[],followups=[],title='',selectedWorks=new Set(),draftAnswers={};
  async function load(){const selected=ctx.root;loading=true;try{const data=await ctx.get('study/defense');if(selected!==ctx.root)return;works=data.works;followups=data.followups;loaded=true;ctx.draw();}finally{loading=false;}}
  function citations(rows,data){return '<ul class="study-citations">'+rows.map(row=>{
    const source=data.sources.find(s=>s.id===row.sourceId);return '<li><span>'+html(source?.title)+' · '+html(row.location)+'</span><blockquote>'+html(row.quote)+'</blockquote></li>';
  }).join('')+'</ul>';}
  function render(){
    if(root!==ctx.root){root=ctx.root;current=null;loaded=false;works=[];followups=[];selectedWorks.clear();draftAnswers={};title='';}
    const data=current?.data,proposal=current?.item.status==='proposal';
    return '<div class="study-layout"><aside class="study-sidebar"><h4>答辩演练</h4>'+button('defense-new','选择作品开始演练')+ctx.index.items.filter(i=>i.kind==='defense').map(row=>button('defense-open',row.title+' · '+({proposal:'待采用',ready:'已备好材料',draft:'演练中'}[row.status]||row.status),{data:{id:row.id}})).join('')+'</aside><section class="study-main">'+
      heading('作品答辩演练','练习问题与反馈仅供准备答辩，依据来自所选固定版本。',button('defense-refresh','刷新'))+
      (!current?'<form class="study-form" data-research-form="defense-prepare">'+field('演练名称',input('title',title,'data-defense-title placeholder="本次答辩准备"'))+
        '<fieldset class="research-section"><legend>选择已固定作品</legend>'+(works.length?works.map(row=>field(row.title+' · '+row.format+' · '+row.id.slice(0,8),'<input type="checkbox" name="work" data-defense-work value="'+html(row.id)+'"'+(selectedWorks.has(row.id)?' checked':'')+(row.synthetic?' disabled':'')+'>')).join(''):empty(loaded?'先在项目中保存作品版本。':'正在读取作品版本…'))+'</fieldset>'+
        button('defense-prepare','准备演练材料',{type:'submit',primary:true,disabled:ctx.busy||!works.length})+'</form>':'')+
      (current?'<section class="research-section">'+heading(current.item.title,'已绑定 '+data.artifactVersionIds.length+' 份作品版本',badge(proposal?'待采用':'演练材料'))+
        '<details><summary>本次固定依据</summary>'+data.sources.map(s=>'<p>'+html(s.title)+' · '+html(s.location)+' <code>'+html((s.artifactVersionId||s.versionId||s.object?.sha256||'').slice(0,12))+'</code></p>').join('')+'</details>'+
        (!proposal?'<div class="research-actions">'+button('defense-questions','请助手设计演练问题')+(Object.values(data.answers).some(Boolean)?button('defense-feedback','请助手检查已保存回答'):'')+'</div>':'')+'</section>':'')+
      (data?.questions.length?'<form class="study-form" data-research-form="defense-answers">'+data.questions.map((q,i)=>'<article class="study-requirement"><h4>'+html((i+1)+'. '+q.question)+'</h4>'+citations(q.evidence,data)+
        field('回答 '+q.id,area(q.id,draftAnswers[q.id]??data.answers[q.id]??'','data-defense-answer="'+html(q.id)+'" rows="5" '+(proposal?'readonly':'')))+'</article>').join('')+(!proposal?button('defense-answers','保存本次回答',{type:'submit',primary:true,disabled:ctx.busy}):'')+'</form>':'')+
      (data?.feedback.length?'<section class="research-section"><h4>演练反馈</h4>'+data.feedback.map(f=>'<article class="study-requirement"><h4>'+html(f.observation)+'</h4><p>'+html(f.suggestion)+'</p>'+citations(f.evidence,data)+(!proposal?button('defense-followup','确认加入对应步骤待办',{data:{id:f.id},disabled:ctx.busy}):'')+'</article>').join('')+'</section>':'')+
      (proposal?'<form class="research-section study-form" data-research-form="defense-adopt">'+field('已核对演练问题与反馈的原文依据','<input name="confirm" type="checkbox" required>')+button('defense-adopt','采用此演练建议',{type:'submit',primary:true,disabled:ctx.busy})+'</form>':'')+
      (followups.length?'<section class="research-section"><h4>项目改进待办</h4>'+followups.map(row=>'<article class="study-requirement"><strong>'+html(row.title)+'</strong><p>'+html(row.stepTitle)+' · '+html(row.status==='done'?'已完成':'待处理')+'</p>'+button('defense-todo',row.status==='done'?'重新打开待办':'确认已完成',{data:{id:row.id,reopen:String(row.status==='done')},disabled:ctx.busy})+'</article>').join('')+'</section>':'')+'</section></div>';
  }
  return {render,afterRender(){if(!loaded&&!loading)void load().catch(ctx.fail);},
    input(event){if(event.target.hasAttribute('data-defense-title'))title=event.target.value;if(event.target.dataset.defenseAnswer)draftAnswers[event.target.dataset.defenseAnswer]=event.target.value;},
    change(event){if(event.target.hasAttribute('data-defense-work')){if(event.target.checked)selectedWorks.add(event.target.value);else selectedWorks.delete(event.target.value);}},
    async click(action,target){
      if(action==='defense-new'){current=null;draftAnswers={};ctx.draw();}
      if(action==='defense-open')await ctx.task(async()=>{current=await ctx.entry(target.dataset.id);draftAnswers={};});
      if(action==='defense-refresh')await ctx.task(async()=>{await ctx.refresh();if(current)current=await ctx.entry(current.item.id);await load();});
      if(action==='defense-questions'||action==='defense-feedback')await ctx.prompt?.('请用原生 ARES research 工具读取当前项目的答辩演练 '+current.item.id+' 固定版本 '+current.version.id+'，'+(action==='defense-questions'?'根据所选作品和规则设计有逐字依据的问题。':'仅根据已保存的实际回答提出有依据的反馈。')+'用 research-proposal、proposalKind=defense 保存建议，先读取设计规范，不要代我采用，不编造回答或真实评委评分。');
      if(action==='defense-followup')await ctx.task(async()=>{await ctx.mutate('study/defense/followup',{id:current.item.id,versionId:current.version.id,findingId:target.dataset.id,confirm:true});await load();});
      if(action==='defense-todo')await ctx.task(async()=>{await ctx.mutate('study/defense/followup/resolve',{followupId:target.dataset.id,reopen:target.dataset.reopen==='true',confirm:true});await load();});
    },
    async submit(type,values){
      if(type==='defense-prepare'){const result=await ctx.mutate('study/defense/prepare',{title:values.title||undefined,artifactVersionIds:[...selectedWorks]});current=await ctx.entry(result.item.id);draftAnswers={};}
      if(type==='defense-answers'){const result=await ctx.mutate('study/defense/answers',{id:current.item.id,versionId:current.version.id,answers:Object.fromEntries(current.data.questions.map(q=>[q.id,values[q.id]||'']))});current=await ctx.entry(result.item.id);}
      if(type==='defense-adopt'){const result=await ctx.mutate('study/defense/adopt',{id:current.item.id,versionId:current.version.id,confirm:values.confirm==='on'});current=await ctx.entry(result.item.id);}
    }
  };
}
