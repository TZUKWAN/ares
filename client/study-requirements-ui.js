import {html,button,heading,field,input,area,select,option,empty,dataLink,badge} from './research-ui.js';

export function createRequirementsWorkspace(ctx) {
  let current=null,rows=[],root=null,sequence=0;
  const entries=()=>ctx.index.items.filter(row=>row.kind==='requirements');
  function render() {
    if(root!==ctx.root){root=ctx.root;current=null;rows=[];}
    const listing='<aside class="study-sidebar"><h4>原文与版本</h4>'+button('requirements-new','导入比赛原文')+
      entries().map(row=>button('requirements-open',row.title,{data:{id:row.id}})+badge(row.status)).join('')+'</aside>';
    if(!current)return '<div class="study-layout">'+listing+'<section class="study-main">'+heading('比赛要求','导入原文，再核对条款与对应作品。')+
      '<form data-research-form="requirements-import" class="study-form">'+field('原文文件','<input type="file" name="file" accept=".pdf,.docx,.txt,.md,.html">')+
      field('或粘贴原文',area('text','','rows="8"'))+
      '<details><summary>从项目文件或公开网页读取</summary>'+field('项目内原文路径',input('sourcePath'))+
      field('公开原文网址',input('url','','type="url"'))+field('授权本次读取该公开网页','<input type="checkbox" name="approveNetwork">')+'</details>'+
      button('requirements-import','提取条款草稿',{type:'submit',primary:true,disabled:ctx.busy})+'</form></section></div>';
    const {item,version,data}=current,steps=ctx.index.steps;
    return '<div class="study-layout">'+listing+'<section class="study-main">'+heading(item.title,
      [data.scope.edition||'届次待核对',data.scope.track,data.scope.group||'组别待核对'].join(' · '),
      '<a class="research-button" download href="'+html(dataLink('study/source',{root:ctx.root,id:item.id,versionId:version.id}))+'">下载原文快照</a>')+
      '<p class="research-note">请逐项核对原文。采用后的要求进入本项目规则清单，正式提交仍需原文基线和负责人复核。</p>'+
      (!rows.length?empty('原文已保存，尚无条款。可手动添加原句，或请项目助手整理。'):'')+
      '<form data-research-form="requirements-save"><div class="study-requirements">'+rows.map((row,index)=>{
        const step=steps.find(s=>s.id===row.stepId);
        return '<article class="study-requirement" data-rule-index="'+index+'"><header>'+badge(row.kind==='mandatory'?'必须满足':'建议')+
          button('requirements-remove','删除',{data:{index}})+'</header>'+field('要求说明',area('label',row.label,'data-rule-field="label" data-index="'+index+'" data-focus="requirement-'+index+'"'))+
          '<details><summary>原文摘录</summary>'+field('对应原句',area('quote',row.quote,'data-rule-field="quote" data-index="'+index+'"'))+'</details>'+
          '<div class="research-pair">'+field('要求性质',select('kind',option('mandatory','必须满足',row.kind==='mandatory')+option('advisory','建议',row.kind==='advisory'),'data-rule-field="kind" data-index="'+index+'"'))+
          field('对应步骤',select('stepId',option('','尚未安排',!row.stepId)+steps.map(s=>option(s.id,s.title,s.id===row.stepId)).join(''),'data-rule-field="stepId" data-index="'+index+'"'))+
          field('对应作品',select('artifactId',option('','按整个步骤核对',!row.artifactId)+(step?.outputs||[]).map(o=>option(o.id,o.title,o.id===row.artifactId)).join(''),'data-rule-field="artifactId" data-index="'+index+'"'))+'</div></article>';
      }).join('')+'</div><div class="research-actions">'+button('requirements-save','保存条款与映射',{type:'submit',primary:true,disabled:ctx.busy})+
      button('requirements-add','添加原文条款',{disabled:ctx.busy||rows.length>=100})+
      button('requirements-assistant','请项目助手整理映射',{disabled:ctx.busy})+'</div></form>'+
      '<form data-research-form="requirements-adopt" class="research-section">'+field('已核对原文、当前比赛范围和步骤映射','<input type="checkbox" name="confirm" required>')+
      button('requirements-adopt','采用到本项目要求',{type:'submit',disabled:ctx.busy||!rows.length})+'</form></section></div>';
  }
  async function open(id){current=await ctx.entry(id);rows=structuredClone(current.data.rows);ctx.draw();}
  return {render,open,
    input(event){const target=event.target;if(target.dataset.ruleField)rows[Number(target.dataset.index)][target.dataset.ruleField]=target.value;},
    change(event){const target=event.target;if(!target.dataset.ruleField)return;rows[Number(target.dataset.index)][target.dataset.ruleField]=target.value;
      if(target.dataset.ruleField==='stepId'){rows[Number(target.dataset.index)].artifactId='';ctx.draw();}},
    async click(action,target){
      if(action==='requirements-new'){current=null;rows=[];ctx.draw();}
      if(action==='requirements-open')await ctx.task(()=>open(target.dataset.id));
      if(action==='requirements-remove'){rows.splice(Number(target.dataset.index),1);ctx.draw();}
      if(action==='requirements-add'){rows.push({id:'manual-'+Date.now().toString(36)+'-'+(++sequence),label:'',quote:'',kind:'mandatory',stepId:'',artifactId:''});ctx.draw();}
      if(action==='requirements-assistant')ctx.prompt('请读取本项目 research 规范，核对比赛要求 '+current.item.id+' 的 '+current.version.id+' 版本。依据已保存原句整理 requirements 建议并映射现有步骤及作品。保存独立建议版本，保留来源和待人工核对状态。');
    },
    async submit(type,values,form){
      if(type==='requirements-import'){
        const file=form.elements.file.files[0],body={text:values.text,sourcePath:values.sourcePath||undefined,url:values.url||undefined,approveNetwork:values.approveNetwork==='on'};
        if(file){if(file.size>4*1024*1024)throw new Error('原文文件最多4MiB');const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let index=0;index<bytes.length;index+=8192)binary+=String.fromCharCode(...bytes.subarray(index,index+8192));body.fileName=file.name;body.contentBase64=btoa(binary);delete body.text;}
        const saved=await ctx.mutate('study/requirements/import',body);await open(saved.item.id);
      }
      if(type==='requirements-save'){
        const saved=await ctx.mutate('study/requirements/save',{id:current.item.id,baseVersion:current.version.id,rows});await open(saved.item.id);
      }
      if(type==='requirements-adopt'){
        const saved=await ctx.mutate('study/requirements/adopt',{id:current.item.id,versionId:current.version.id,confirmOriginal:values.confirm==='on'});await open(saved.item.id);
      }
    }
  };
}
