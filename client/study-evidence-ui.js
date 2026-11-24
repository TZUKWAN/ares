import {html,button,heading,field,input,area,select,option,empty,badge} from './research-ui.js';

const blank=()=>({key:'',title:'',value:'',unit:'',sourceKind:'file',sourcePath:'',researchSource:'',quote:'',locator:''});
const states={current:'引用有效','source-updated':'证据已更新','fact-updated':'事实已更新','target-edited':'作品已编辑',unavailable:'引用需检查'};
export function createEvidenceWorkspace(ctx) {
  let projectRoot=null,loaded=false,loading=false,opening=false,facts=[],uses=[],draft=blank(),current=null,preview=null;
  async function load(){const root=ctx.root;loading=true;try{const data=await ctx.get('study/evidence');if(root!==ctx.root)return;facts=data.facts;uses=data.uses;loaded=true;ctx.draw();}finally{loading=false;}}
  function render(){
    if(projectRoot!==ctx.root){projectRoot=ctx.root;loaded=false;facts=[];uses=[];current=null;draft=blank();preview=null;}
    const outputs=ctx.index.steps.flatMap(s=>s.outputs.map(o=>({...o,stepTitle:s.title})));
    const sources=ctx.index.items.filter(row=>!['pretest','fact','collection'].includes(row.kind));
    const listing='<aside class="study-sidebar"><h4>项目事实</h4>'+button('fact-new','新增事实')+facts.map(row=>button('fact-open',row.title,{data:{id:row.id}})+(row.sourceStale?badge('来源待核对'):'')).join('')+'</aside>';
    if(opening)return '<div class="study-layout">'+listing+'<section class="study-main">'+empty('正在读取事实版本…')+'</section></div>';
    return '<div class="study-layout">'+listing+'<section class="study-main">'+heading('事实与证据','保存来源，再关联报告或演示文稿中的实际内容。',button('fact-refresh','刷新引用'))+
      '<form data-research-form="fact-save" class="study-form">'+
      '<div class="research-pair">'+field('事实名称',input('title',draft.title,'data-fact-field="title" data-focus="fact-title" required'))+
      field('事实标识',input('key',draft.key,'data-fact-field="key" placeholder="sample_count" required'))+
      field('事实值',input('value',draft.value,'data-fact-field="value" required'))+field('单位',input('unit',draft.unit,'data-fact-field="unit"'))+'</div>'+
      field('证据来源',select('sourceKind',option('file','项目内文件',draft.sourceKind==='file')+option('research','已有研究版本',draft.sourceKind==='research'),'data-fact-field="sourceKind"'))+
      (draft.sourceKind==='file'?field('项目内证据文件',input('sourcePath',draft.sourcePath,'data-fact-field="sourcePath" required')):
        field('研究证据版本',select('researchSource',option('','选择已保存版本',!draft.researchSource)+sources.map(row=>option(row.id+'|'+row.head,row.title,draft.researchSource===row.id+'|'+row.head)).join(''),'data-fact-field="researchSource" required')))+
      field('证据逐字摘录',area('quote',draft.quote,'data-fact-field="quote" rows="4" required'))+
      field('来源位置',input('locator',draft.locator,'data-fact-field="locator" placeholder="例如，第3页表2或访谈时间段"'))+
      field('已核对事实值与原始证据','<input name="confirm" type="checkbox" required>')+
      '<div class="research-actions">'+button('fact-save',current?'保存新的事实版本':'保存事实与来源',{type:'submit',primary:true,disabled:ctx.busy})+'</div></form>'+
      (current?'<form class="research-section study-form" data-research-form="fact-cite"><h4>关联作品中的引用</h4>'+field('作品',select('artifactId',outputs.map(row=>option(row.id,row.stepTitle+' · '+row.title)).join('')))+
        field('作品中包含该事实值的原句',area('quote','','required rows="3"'))+field('章节或幻灯片位置',input('location'))+
        button('fact-cite','关联实际引用',{type:'submit',disabled:ctx.busy})+'</form>':'')+
      '<section class="research-section"><h4>作品引用与变化</h4>'+(uses.length?uses.map(row=>'<article class="study-requirement"><div>'+badge(states[row.state])+' <strong>'+html(row.factTitle||'待核对事实')+'</strong></div><p>'+html(row.artifactTitle||row.path)+' · '+html(row.location)+'</p><blockquote>'+html(row.quote)+'</blockquote><div class="research-actions">'+
        button('fact-compare','查看变化',{data:{id:row.id},disabled:row.sourceStale||ctx.busy})+'</div></article>').join(''):empty(loaded?'尚未关联作品引用。':'正在读取引用…'))+'</section>'+
      (preview?'<section class="research-section study-requirement" aria-label="事实引用更新预览"><h4>'+html(preview.path)+'</h4><label>当前引用</label><pre>'+html(preview.before)+'</pre><label>更新建议</label><pre>'+html(preview.after)+'</pre><p>'+html(preview.note)+'</p>'+
        (preview.canApply?button('fact-apply','确认更新这处引用',{primary:true,disabled:ctx.busy}):'')+'</section>':'')+'</section></div>';
  }
  return {render,afterRender(){if(!loaded&&!loading)void load().catch(ctx.fail);},
    input(event){const field=event.target.dataset.factField;if(field)draft[field]=event.target.value;},
    change(event){const field=event.target.dataset.factField;if(field){draft[field]=event.target.value;if(field==='sourceKind')ctx.draw();}},
    async click(action,target){
      if(action==='fact-new'){current=null;draft=blank();preview=null;ctx.draw();}
      if(action==='fact-open')await ctx.task(async()=>{
        opening=true;ctx.draw();
        try{
        const entry=await ctx.entry(target.dataset.id);if(entry.item.kind!=='fact')throw new Error('请选择事实记录');
        current=entry;const data=entry.data,source=data.sources[0];draft={key:data.key,title:entry.item.title,value:String(data.value),unit:data.unit,
          sourceKind:source.kind,sourcePath:source.snapshot?.sourcePath||'',researchSource:source.kind==='research'?source.itemId+'|'+source.versionId:'',quote:source.quote,locator:source.locator};ctx.draw();
        }finally{opening=false;ctx.draw();}
      });
      if(action==='fact-refresh')await ctx.task(load);
      if(action==='fact-compare')await ctx.task(async()=>{preview=await ctx.call('study/reference/preview',{referenceId:target.dataset.id,expectedRevision:ctx.index.revision});});
      if(action==='fact-apply')await ctx.task(async()=>{await ctx.mutate('study/reference/apply',{referenceId:preview.referenceId,token:preview.token,confirmUpdate:true});preview=null;await load();});
    },
    async submit(type,values){
      if(type==='fact-save'){
        const source=draft.sourceKind==='file'?{kind:'file',path:draft.sourcePath,quote:draft.quote,locator:draft.locator}:
          {kind:'research',itemId:draft.researchSource.split('|')[0],versionId:draft.researchSource.split('|')[1],quote:draft.quote,locator:draft.locator};
        const value=draft.value.trim(),saved=await ctx.mutate('study/fact',{
          ...(current?{id:current.item.id,baseVersion:current.version.id}:{}),key:draft.key,title:draft.title,
          value:/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))?Number(value):value,
          unit:draft.unit,sources:[source],confirmEvidence:values.confirm==='on'});
        current=await ctx.entry(saved.item.id);await load();
      }
      if(type==='fact-cite'){await ctx.mutate('study/reference',{factId:current.item.id,factVersion:current.version.id,artifactId:values.artifactId,quote:values.quote,location:values.location});await load();}
    }
  };
}
