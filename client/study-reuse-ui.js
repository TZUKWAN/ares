import {html,button,heading,field,input,select,option,empty} from './research-ui.js';

export function createReuseWorkspace(ctx){
  let root=null,loaded=false,loading=false,competitions=[],works=[],targets=[],mapping={},draft={competitionId:'',track:'',edition:'',group:'',name:'',targetRoot:''},preview=null,result=null;
  function invalidate(){preview=null;result=null;}
  async function load(){const selected=ctx.root;loading=true;try{const data=await ctx.get('study/reuse/catalog');if(selected!==ctx.root)return;competitions=data.competitions;loaded=true;ctx.draw();}finally{loading=false;}}
  function render(){
    if(root!==ctx.root){root=ctx.root;loaded=false;competitions=[];works=[];targets=[];mapping={};preview=null;result=null;draft={competitionId:'',track:'',edition:'',group:'',name:'',targetRoot:''};}
    const competition=competitions.find(row=>String(row.id)===draft.competitionId);
    return '<section class="study-main">'+heading('跨比赛改编','选定原项目作品版本，为目标比赛建立独立项目。规则和验收重新核对。')+
      '<form class="study-form" data-research-form="reuse-targets"><div class="research-pair">'+
      field('目标比赛',select('competitionId',option('','选择比赛',!competition)+competitions.map(c=>option(c.id,c.name,String(c.id)===draft.competitionId)).join(''),'data-reuse-field="competitionId" required'))+
      field('目标赛道',select('track',option('','选择赛道',!draft.track)+(competition?.tracks||[]).map(t=>option(t.track,t.name,t.track===draft.track)).join(''),'data-reuse-field="track" required'))+
      field('目标届次',input('edition',draft.edition,'data-reuse-field="edition"'))+field('目标组别',input('group',draft.group,'data-reuse-field="group"'))+'</div>'+button('reuse-targets','读取目标比赛的交付要求',{type:'submit',disabled:ctx.busy||!loaded})+'</form>'+
      (targets.length?'<form class="study-form research-section" data-research-form="reuse-preview">'+heading('选择复用材料','只复制所选固定版本。当前正在编辑的源文件会保留。')+
        field('新项目名称',input('name',draft.name,'data-reuse-field="name" required'))+field('新项目空目录',input('targetRoot',draft.targetRoot,'data-reuse-field="targetRoot" placeholder="填写新项目的绝对路径" required'))+
        (works.length?works.map(work=>field(work.title+' · '+work.id.slice(0,8),select('map_'+work.id,option('','此次不复用',!mapping[work.id])+targets.filter(o=>o.kind===work.kind&&(work.kind==='directory'||o.format===work.format)).map(o=>option(o.id,o.stepTitle+' / '+o.title,mapping[work.id]===o.id)).join(''),'data-reuse-map="'+html(work.id)+'"'))).join(''):empty('当前项目尚无可复用的实际作品版本。'))+
        button('reuse-preview','预览改编项目',{type:'submit',primary:true,disabled:ctx.busy||!works.length})+'</form>':'')+
      (preview?'<section class="research-section study-requirement" aria-label="改编预览"><h4>'+html(preview.name)+'</h4><p>'+html(preview.targetRoot)+'</p><ul>'+preview.selected.map(row=>'<li>'+html(row.sourceTitle)+' → '+html(row.targetTitle)+'</li>').join('')+'</ul><h4>仍需补齐 '+preview.gaps.length+' 项交付要求</h4><ul>'+preview.gaps.map(gap=>'<li>'+html(gap.title)+'</li>').join('')+'</ul><p>新项目从未验收状态开始，目标比赛规则原文仍需核对。</p><form class="study-form" data-research-form="reuse-apply">'+field('确认创建新项目并复制所选固定作品','<input type="checkbox" name="confirm" required>')+button('reuse-apply','创建改编项目',{type:'submit',primary:true,disabled:ctx.busy})+'</form></section>':'')+
      (result?'<section class="research-section"><h4>改编项目已创建</h4><p>'+html(result.project.name)+' · '+html(result.project.root)+'</p><p>已固定复用工作稿，已验收步骤 0。</p><button type="button" class="research-button is-primary" data-action="project-select" data-root="'+html(result.project.root)+'">打开新项目</button></section>':'')+
      (ctx.index.items.some(i=>i.kind==='reuse'&&i.status==='needs-attention')?'<section class="research-section"><h4>未完成的改编</h4>'+ctx.index.items.filter(i=>i.kind==='reuse'&&i.status==='needs-attention').map(i=>'<p>'+html(i.title)+' '+button('reuse-resume','按原清单继续',{data:{id:i.id},disabled:ctx.busy})+'</p>').join('')+'</section>':'')+'</section>';
  }
  const payload=()=>({...draft,competitionId:Number(draft.competitionId),mapping:Object.entries(mapping).filter(([,value])=>value).map(([sourceVersionId,targetArtifactId])=>({sourceVersionId,targetArtifactId}))});
  return {render,afterRender(){if(!loaded&&!loading)void load().catch(ctx.fail);},
    input(event){const key=event.target.dataset.reuseField;if(key){draft[key]=event.target.value;invalidate();}},
    change(event){const key=event.target.dataset.reuseField;if(key){draft[key]=event.target.value;invalidate();if(key==='competitionId'){draft.track='';targets=[];ctx.draw();}}if(event.target.dataset.reuseMap){mapping[event.target.dataset.reuseMap]=event.target.value;invalidate();}},
    async click(action,target){if(action==='reuse-resume')await ctx.task(async()=>{result=await ctx.mutate('study/reuse/resume',{id:target.dataset.id,confirm:true});preview=null;});},
    async submit(type,values){
      if(type==='reuse-targets'){Object.assign(draft,{competitionId:values.competitionId,track:values.track,edition:values.edition,group:values.group});const data=await ctx.call('study/reuse/targets',payload());works=data.works;targets=data.targets;mapping={};invalidate();}
      if(type==='reuse-preview'){draft.name=values.name;draft.targetRoot=values.targetRoot;preview=await ctx.call('study/reuse/preview',payload());}
      if(type==='reuse-apply'){result=await ctx.mutate('study/reuse/apply',{...payload(),token:preview.token,confirm:values.confirm==='on'});preview=null;}
    }
  };
}
