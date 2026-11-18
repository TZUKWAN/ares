import {html,button,option,field,input,area,select,heading,dataLink} from './research-ui.js';

const methods={semi:'半结构式',depth:'深度访谈',focus:'焦点小组'};
const makeId=prefix=>prefix+crypto.randomUUID().replaceAll('-','').slice(0,10);
const question=()=>({id:makeId('q'),text:'请讲述一个相关的实际经历。',followups:[]});
const regular=(name,text,value='',type='text')=>field(text,type==='area'?area(name,value):input(name,value,'type="'+type+'"'));
export function createGuideWorkspace(ctx) {
  let draft,entry;
  const edits=new Map();
  function move(rows,from,to){
    if(from<0||to<0||from>=rows.length||to>=rows.length)return;
    const [row]=rows.splice(from,1);rows.splice(to,0,row);
  }
  function keep(){if(entry&&draft)edits.set(entry.version.id,structuredClone(draft));}
  async function enter(id,version){
    keep();entry=await ctx.entry(id,version);
    draft=edits.get(entry.version.id)??structuredClone(entry.data);ctx.draw();
  }
  function form() {
    return '<form class="research-form" data-research-form="guide-create">'+heading('新建访谈提纲','设计访谈问题、追问与时间安排')+
      '<div class="research-form-grid">'+field('研究主题',input('theme','','required maxlength="150"'))+
      regular('participants','访谈对象')+regular('goal','研究目标')+regular('question','核心研究问题')+
      field('访谈类型',select('method',Object.entries(methods).map(([id,label])=>option(id,label)).join('')))+
      field('预计分钟数',input('minutes','40','type="number" min="5" max="360" required'))+'</div>'+
      regular('priorities','访谈重点','','area')+regular('background','背景资料','','area')+
      '<div class="research-actions">'+button('guide-ai','请项目助手拟提纲',{type:'submit',primary:true,disabled:ctx.busy})+
      button('guide-template','本地模板',{type:'submit',disabled:ctx.busy})+'</div></form>';
  }
  function editor() {
    const proposal=entry.version.payload.status==='proposal';
    const edit=(name,label,type='text')=>{
      const id='guide-'+name,value=name.split('.').reduce((row,key)=>row[key],draft);
      const attrs='data-guide="'+html(name)+'" data-focus="'+html(id)+'"';
      return field(label,type==='area'?area(name,Array.isArray(value)?value.join('\n'):value,attrs):input(name,value,'type="'+type+'" '+attrs));
    };
    const links=['md','docx','json'].map(format=>'<a class="research-button" download href="'+
      html(dataLink('export',{root:ctx.root,id:entry.item.id,versionId:entry.version.id,format}))+'">'+format.toUpperCase()+'</a>').join('');
    const version=field('提纲版本',select('guide-version',entry.item.versions.slice().reverse().map((v,i)=>option(v,'第 '+(entry.item.versions.length-i)+' 版',v===entry.version.id)).join(''),'data-guide-history'));
    return heading(draft.theme,methods[draft.method]+' · '+draft.minutes+' 分钟',links)+
      '<div class="research-toolbar">'+(proposal?button('guide-adopt','采用提纲',{primary:true}):
        button('guide-save',entry.item.head===entry.version.id?'保存提纲版本':'另存提纲版本',{primary:true,disabled:ctx.busy})+
        button('guide-add-module','新增主题')+button('guide-record','按此提纲登记访谈',{data:{id:entry.item.id}}))+version+'</div>'+
      '<fieldset '+(proposal?'disabled':'')+'><div class="research-form-grid">'+edit('theme','研究主题')+edit('participants','访谈对象')+edit('minutes','预计时长','number')+
      edit('goal','研究目标')+edit('question','核心研究问题')+edit('priorities','访谈重点')+edit('background','背景资料','area')+'</div>'+
      '<div class="research-rule-card"><div class="research-inline">'+edit('minutesOpening','开场分钟数','number')+'</div>'+
      edit('intro','开场说明','area')+edit('consent','知情同意','area')+'</div>'+
      draft.modules.map((module,i)=>{
        const path='modules.'+i;
        return '<div class="research-rule-card"><div class="research-form-grid">'+edit(path+'.title','主题')+edit(path+'.minutes','分钟','number')+'</div>'+
        '<div class="research-actions">'+button('guide-module-up','前移主题',{data:{module:i},disabled:i===0})+
        button('guide-module-down','后移主题',{data:{module:i},disabled:i>=draft.modules.length-1})+
        button('guide-add-q','加问题',{data:{module:i}})+button('guide-remove-module','删除主题',{data:{module:i},disabled:draft.modules.length<=1})+'</div>'+
        module.questions.map((q,index)=>'<div class="research-option">'+edit(path+'.questions.'+index+'.text','核心问题 '+(index+1),'area')+
          edit(path+'.questions.'+index+'.followups','追问（一行一条）','area')+'<div class="research-actions">'+
          button('guide-q-up','上移',{data:{module:i,index},disabled:index===0})+
          button('guide-q-down','下移',{data:{module:i,index},disabled:index>=module.questions.length-1})+
          button('guide-remove-q','删除',{data:{module:i,index},disabled:module.questions.length<=1})+
          (draft.modules.length>1?field('移动到主题',select('destination',option('','选择主题')+draft.modules.map((row,j)=>j===i?'':option(j,row.title)).join(''),
             'data-guide-move data-module="'+i+'" data-index="'+index+'" '+(module.questions.length<=1?'disabled':''))):'')+'</div></div>'
        ).join('')+'</div>';
      }).join('')+'<div class="research-rule-card">'+edit('minutesClosing','结尾分钟数','number')+edit('closing','结束语','area')+'</div></fieldset>';
  }

  return {
    render:()=>draft?editor():form(),get selected(){return entry;},enter,
    reset(){draft=entry=null;edits.clear();},new(){keep();draft=entry=null;ctx.draw();},
    input(event){
      const target=event.target,path=target.dataset.guide;
      if(!path||!draft)return;
      const parts=path.split('.'),key=parts.pop(),row=parts.reduce((value,name)=>value[name],draft);
      row[key]=key==='followups'?target.value.split('\n').map(text=>text.trim()).filter(Boolean):target.type==='number'?target.valueAsNumber:target.value;
    },
    change(event){
      const target=event.target;
      if(target.hasAttribute('data-guide-history'))return ctx.task(()=>enter(entry.item.id,target.value));
      if(target.hasAttribute('data-guide-move')&&target.value!==''){
        const source=draft.modules[Number(target.dataset.module)],destination=draft.modules[Number(target.value)];
        const [q]=source.questions.splice(Number(target.dataset.index),1);destination.questions.push(q);ctx.draw();
      }
    },
    async submit(action,values,_form,submitter) {
      if(action!=='guide-create')return;
      const templateInput={...values,minutes:Number(values.minutes)};
      if(submitter?.dataset.r==='guide-ai'){
        ctx.prompt('请基于以下研究要求拟定访谈提纲。先调用 ares_workbench research，使用其中 guide 结构，然后调用 research-proposal 把建议交给研究者审阅。保留知情同意、时间分配及真实材料边界。\n\n'+JSON.stringify(templateInput));
        ctx.report('已放入右侧项目助手，请发送。完成后刷新列表可看到提纲建议。');return;
      }
      const saved=await ctx.mutate('interview/guide',{templateInput});await enter(saved.item.id);ctx.report('已保存可编辑提纲。');
    },
    click(action,target){
      if(action==='guide-save'||action==='guide-adopt')return ctx.task(async()=>{
        const old=entry,update=action==='guide-save'&&old.item.head===old.version.id;
        const saved=await ctx.mutate('interview/guide',{design:draft,...(update?{id:old.item.id,baseVersion:old.version.id}:{sourceId:old.item.id,sourceVersion:old.version.id})});
        edits.delete(old.version.id);entry=null;await enter(saved.item.id);ctx.report('已保存提纲版本。');
      });
      const {module,index}=target.dataset,m=Number(module),i=Number(index);
      const rows=draft?.modules,qs=rows?.[m]?.questions;
      if(action==='guide-add-module')rows.push({id:makeId('m'),title:'新主题',minutes:1,questions:[question()]});
      if(action==='guide-module-up'||action==='guide-module-down')move(rows,m,m+(action==='guide-module-up'?-1:1));
      if(action==='guide-remove-module'&&rows.length>1)rows.splice(m,1);
      if(action==='guide-add-q')qs.push(question());
      if(action==='guide-remove-q'&&qs.length>1)qs.splice(i,1);
      if(action==='guide-q-up'||action==='guide-q-down')move(qs,i,i+(action==='guide-q-up'?-1:1));
      ctx.draw();
    }
  };
}
