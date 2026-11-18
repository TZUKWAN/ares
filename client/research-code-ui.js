import {html,button,option,field,input,area,select,empty,heading} from './research-ui.js';

const newCode=()=>({id:'c'+crypto.randomUUID().replaceAll('-','').slice(0,12),name:'',memo:'',parent:'',archived:false});
const ck=(name,id,checked=false,attrs='')=>'<input type="checkbox" name="'+name+'" value="'+html(id)+'" '+(checked?'checked ':'')+attrs+'>';
export function createCodeWorkspace(ctx) {
  let entry,rows=[],title='',snapshot,query='',filter='',synthetic=false;
  const chosen=new Set();
  async function open(id){
    entry=await ctx.entry(id);
    title=entry.item.title;rows=structuredClone(entry.data.codes);snapshot=null;chosen.clear();ctx.draw();
  }
  function render(){
    const form='<form class="research-form" data-research-form="codebook-save">'+heading('编码本','维护一级主题与二级编码')+
      field('名称',input('name',title,'required maxlength="150" data-coding-title data-focus="coding-title"'))+
      rows.map((code,index)=>'<div class="research-rule-card"><div class="research-form-grid">'+
        field('选中',ck('selection',code.id,chosen.has(code.id),'data-bulk'))+
        field('名称',input('name',code.name,'required maxlength="80" data-code-edit="name" data-index="'+index+'" data-focus="code-'+index+'"'))+
        field('上级编码',select('parent',option('','一级主题')+rows.filter(row=>row.id!==code.id&&!row.parent).map(row=>option(row.id,row.name,row.id===code.parent)).join(''),'data-code-edit="parent" data-index="'+index+'"'))+
        field('归档',ck('archive',code.id,code.archived,'data-code-edit="archived" data-index="'+index+'"'))+'</div>'+
        field('编码说明',area('memo',code.memo,'data-code-edit="memo" data-index="'+index+'" data-focus="code-memo-'+index+'" maxlength="2500"'))+
        (entry?.data.codes.some(item=>item.id===code.id)?'':button('code-remove','删除未保存编码',{data:{id:index}}))+'</div>').join('')+
      '<div class="research-actions">'+button('code-add','新增编码')+button('code-archive','归档所选')+button('code-restore','恢复所选')+
      button('codebook-save','保存编码本',{type:'submit',primary:true,disabled:ctx.busy})+'</div></form>'+
      (entry?'<form class="research-inline research-setting" data-research-form="code-analysis">'+
        field('范围',select('source',option('field','已登记材料')+option('synthetic','模拟材料')))+
        button('code-analysis','生成跨访谈主题矩阵',{type:'submit',disabled:ctx.busy})+'</form>':'');
    const aside='<aside class="research-properties">'+heading('检索编码证据')+
      (entry?'<form class="research-form" data-research-form="code-search">'+
      field('文本或匿名编号',input('query',query,'type="search" maxlength="400" data-focus="evidence-query"'))+
      field('编码',select('codeId',option('','全部编码')+entry.data.codes.map(code=>option(code.id,code.name,code.id===filter)).join('')))+
      field('仅检索模拟材料',ck('synthetic','yes',synthetic))+
      button('code-search','检索',{type:'submit',disabled:ctx.busy})+'</form>':'')+
      (snapshot?.length?snapshot.map(row=>'<div class="research-option"><p>'+html(row.quote)+'</p><small>'+html(row.participant||row.title)+'</small>'+
        button('record-open','查看证据',{data:{id:row.itemId,version:row.versionId,segment:row.segmentId}})+'</div>').join('') : empty(snapshot?'没有匹配片段。':'保存编码本后可以检索。'))+'</aside>';
    return {form,aside};
  }
  const keys=()=>({bookId:entry.item.id,bookVersion:entry.version.id});
  return {
    get selected(){return entry;},open,render,
    reset(){entry=snapshot=null;rows=[];title=query=filter='';synthetic=false;chosen.clear();},
    click(action,target){
      if(action==='code-add')rows.push(newCode());
      if(action==='code-remove')rows.splice(Number(target.dataset.id),1);
      if(action==='code-archive'||action==='code-restore')for(const row of rows)if(chosen.has(row.id))row.archived=action==='code-archive';
      ctx.draw();
    },
    input(event){
      const target=event.target;
      if(target.hasAttribute('data-coding-title'))title=target.value;
      if(target.hasAttribute('data-bulk')){if(target.checked)chosen.add(target.value);else chosen.delete(target.value);}
      if(target.dataset.codeEdit)rows[target.dataset.index][target.dataset.codeEdit]=target.type==='checkbox'?target.checked:target.value;
    },
    async submit(action,values){
      if(action==='codebook-save'){
        const result=await ctx.mutate('interview/codebook',{title,codes:rows,...(entry?{id:entry.item.id,baseVersion:entry.version.id}:{})});
        await open(result.item.id);ctx.report('编码本版本已保存。');return;
      }
      if(action==='code-analysis'){
        const result=await ctx.mutate('interview/analyze',{...keys(),synthetic:values.source==='synthetic'});
        await ctx.showArtifact(result.item.id);ctx.report('主题频次、跨访谈矩阵和来源证据已保存。');return;
      }
      if(action==='code-search'){
        query=values.query;filter=values.codeId;synthetic=values.synthetic==='yes';
        snapshot=(await ctx.call('interview/search',{...keys(),query,codeId:filter,synthetic})).matches;
      }
    }
  };
}
