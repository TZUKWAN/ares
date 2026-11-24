import {html,button,heading,field,input,area,select,option,empty,badge} from './research-ui.js';

export function createExperimentsWorkspace(ctx) {
  let root=null,draft={},columns=null,script=null,selected=new Set(),comparison=null,jobs=[],timer=null,loading=false,visible=false;
  const defaults=()=>({engine:'regression',dataPath:'',dataSource:'',features:[],target:'',ridge:'0',clusters:'3',seed:'42',testFraction:'0.2',title:'',scriptPath:'',parameters:'{}'});
  const control=(name,attrs='')=>'data-experiment-field="'+name+'" data-focus="experiment-'+name+'" '+attrs;
  const dataArgs=()=>draft.dataSource?{dataItemId:draft.dataSource.split('|')[0],dataVersionId:draft.dataSource.split('|')[1]}:{dataPath:draft.dataPath};
  const entries=()=>ctx.index.items.filter(row=>row.kind==='experiment');
  function jobRows(){return jobs.map(job=>'<div class="research-option">'+badge(job.status)+' <strong>'+html(job.title)+'</strong><p>'+html(job.message||job.progress?.phase||'')+'</p>'+
    (job.status==='running'?button('experiment-cancel','取消本次分析',{data:{id:job.id}}):'')+'</div>').join('');}
  async function poll(){
    if(loading||!visible)return;const captured=ctx.root;loading=true;
    try{
      const response=await ctx.get('jobs');if(ctx.root!==captured)return;
      const previous=jobs.some(row=>row.status==='running');jobs=response.jobs.filter(row=>row.kind==='analysis');
      if(previous&&!jobs.some(row=>row.status==='running')){await ctx.refresh({redraw:false});ctx.draw();}
      else{const region=ctx.element.querySelector('[data-study-analysis-jobs]');if(region)region.innerHTML=jobRows();}
    }catch(error){ctx.fail(error);}finally{
      loading=false;clearTimeout(timer);if(visible&&jobs.some(row=>row.status==='running'))timer=setTimeout(poll,1200);
    }
  }
  function render(){
    if(root!==ctx.root){root=ctx.root;draft=defaults();columns=null;script=null;selected=new Set();comparison=null;jobs=[];}
    visible=true;
    const records=ctx.index.items.filter(row=>['responses','dataset'].includes(row.kind));
    const variables=columns?.columns||[];
    return '<section class="study-main">'+heading('模型实验','固定数据、参数与执行代码，比较实际输出。')+
      '<form data-research-form="experiment-run" class="study-form"><div class="research-pair">'+field('实验名称',input('title',draft.title,control('title','placeholder="例如，线性模型基线"')))+
      field('分析方法',select('engine',option('regression','线性／岭回归',draft.engine==='regression')+option('clustering','K-means 聚类',draft.engine==='clustering')+option('native','自定义 Python／R',draft.engine==='native'),control('engine')))+'</div>'+
      field('已有研究数据',select('dataSource',option('','使用项目数据文件',!draft.dataSource)+records.map(row=>option(row.id+'|'+row.head,row.title,draft.dataSource===row.id+'|'+row.head)).join(''),control('dataSource')))+
      (!draft.dataSource?field('项目数据文件',input('dataPath',draft.dataPath,control('dataPath','placeholder="data/observations.csv"'))):'')+
      button('experiment-columns','读取数据字段',{disabled:ctx.busy})+
      (columns?'<p class="research-note">'+columns.rows+' 条记录 · '+(columns.synthetic?'模拟数据分析':'所选来源数据')+'</p>':'')+
      (draft.engine!=='native'?'<div class="research-option"><h4>自变量</h4>'+variables.map(row=>'<label class="study-variable"><input type="checkbox" data-analysis-feature="'+html(row.name)+'" '+(draft.features.includes(row.name)?'checked':'')+'>'+html(row.name)+'<small> 数值记录 '+row.numeric+'</small></label>').join('')+'</div>'+
        '<div class="research-pair">'+(draft.engine==='regression'?field('目标变量',select('target',option('','选择目标',!draft.target)+variables.map(row=>option(row.name,row.name,draft.target===row.name)).join(''),control('target')))+
        field('岭回归参数',input('ridge',draft.ridge,control('ridge','type="number" min="0" step="any"')))+field('测试集比例',input('testFraction',draft.testFraction,control('testFraction','type="number" min="0.1" max="0.5" step="0.05"'))):
        field('聚类数量',input('clusters',draft.clusters,control('clusters','type="number" min="2" max="12"'))))+
        field('随机种子',input('seed',draft.seed,control('seed','type="number" min="0"')) )+'</div>':
        field('项目分析脚本',input('scriptPath',draft.scriptPath,control('scriptPath','placeholder="analysis/model.py"')))+button('experiment-script-preview','审阅脚本',{disabled:ctx.busy})+
        (script?'<details open><summary>脚本快照 · '+html(script.sha256.slice(0,16))+'</summary><pre class="study-code">'+html(script.text)+'</pre></details>':'')+
        field('脚本参数 JSON',area('parameters',draft.parameters,control('parameters','rows="4"')))+
        '<p class="research-note">脚本接收 --input、--params、--output，输出含 metrics 的 JSON。执行沿用宿主原生工具审批。</p>')+
      field(draft.engine==='native'?'已审阅此脚本，并批准通过宿主原生工具运行':'确认本次本机分析','<input name="approve" type="checkbox" required>')+
      button('experiment-run',draft.engine==='native'?'固定脚本实验计划':'运行本次实验',{type:'submit',primary:true,disabled:ctx.busy})+'</form>'+
      '<section class="research-section" data-study-analysis-jobs>'+jobRows()+'</section>'+
      '<section class="research-section"><h4>实验版本</h4>'+entries().map(row=>'<article class="research-option"><div class="research-actions">'+
        (row.status==='completed'?'<label><input type="checkbox" data-analysis-compare="'+html(row.id)+'" '+(selected.has(row.id)?'checked':'')+'>比较</label>':'')+
        '<strong>'+html(row.title)+'</strong>'+badge(row.status)+button('experiment-detail','查看实际结果',{data:{id:row.id}})+
        (row.status==='completed'?button('experiment-repeat','用原数据与参数重跑',{data:{id:row.id}}):button('experiment-native','请项目助手执行',{data:{id:row.id}}))+'</div></article>').join('')+
      button('experiment-compare','比较所选方案',{disabled:ctx.busy||selected.size<2})+'</section>'+
      (comparison?'<section class="research-section"><h4>方案对比</h4><p>'+html(comparison.note)+' '+(comparison.sameData?'同一数据版本。':'数据版本不同。')+'</p><div class="research-table"><table><thead><tr><th>方案</th>'+[...new Set(comparison.rows.flatMap(row=>Object.keys(row.metrics)))].map(name=>'<th>'+html(name)+'</th>').join('')+'</tr></thead><tbody>'+comparison.rows.map(row=>'<tr><th>'+html(row.title)+'</th>'+[...new Set(comparison.rows.flatMap(item=>Object.keys(item.metrics)))].map(name=>'<td>'+html(row.metrics[name]??'—')+'</td>').join('')+'</tr>').join('')+'</tbody></table></div></section>':'')+'</section>';
  }
  return {render,afterRender(){if(!loading&&!timer&&visible)void poll();},pause(){visible=false;clearTimeout(timer);timer=null;},
    input(event){const key=event.target.dataset.experimentField;if(key)draft[key]=event.target.value;},
    change(event){const target=event.target;if(target.dataset.analysisFeature){draft.features=target.checked?[...new Set([...draft.features,target.dataset.analysisFeature])]:draft.features.filter(name=>name!==target.dataset.analysisFeature);}
      const id=target.dataset.analysisCompare;if(id){target.checked?selected.add(id):selected.delete(id);ctx.draw();}
      const key=target.dataset.experimentField;if(key){draft[key]=target.value;if(['engine','dataSource'].includes(key))ctx.draw();}},
    async click(action,target){
      if(action==='experiment-columns')await ctx.task(async()=>{columns=await ctx.call('study/experiment/data',dataArgs());});
      if(action==='experiment-cancel')await ctx.task(async()=>{await ctx.call('job/cancel',{id:target.dataset.id});await poll();});
      if(action==='experiment-detail')await ctx.showArtifact(target.dataset.id);
      if(action==='experiment-compare')await ctx.task(async()=>{comparison=await ctx.call('study/experiment/compare',{ids:[...selected]});});
      if(action==='experiment-script-preview')await ctx.task(async()=>{script=await ctx.call('study/experiment/script/preview',{scriptPath:draft.scriptPath});});
      if(action==='experiment-native')ctx.prompt('请读取本项目 research 记录 '+target.dataset.id+'，核对已批准的 native-script 计划，然后用 ares_workbench(action="research-experiment",researchId="'+target.dataset.id+'",expectedRevision=最新修订)运行。后台任务须跟踪原 ares_extension 的实际回执，成功后用同一 action 和 extensionRunId 归档原结果。不得绕过原生审批或重跑未知任务。');
      if(action==='experiment-repeat')await ctx.task(async()=>{
        const previous=await ctx.entry(target.dataset.id);if(previous.data.engine==='native-script')throw new Error('自定义脚本请重新固定一次计划后运行');
        const started=await ctx.mutate('study/experiment/run',{repeatExperimentId:previous.item.id,spec:previous.data.spec,title:previous.item.title+' · 重跑',approveCompute:true});
        jobs.unshift(started.job);clearTimeout(timer);timer=setTimeout(poll,300);
      });
    },
    async submit(type,values){if(type!=='experiment-run')return;
      if(draft.engine==='native'){
        if(!script)throw new Error('请先查看实际脚本');
        let parameters;try{parameters=JSON.parse(draft.parameters);}catch{throw new Error('脚本参数需要有效JSON');}
        await ctx.mutate('study/experiment/script/prepare',{...dataArgs(),title:draft.title,scriptPath:draft.scriptPath,scriptSha256:script.sha256,parameters,approveScript:values.approve==='on'});
      }else{
        const started=await ctx.mutate('study/experiment/run',{...dataArgs(),title:draft.title,approveCompute:values.approve==='on',spec:{engine:draft.engine,features:draft.features,target:draft.target,ridge:Number(draft.ridge),seed:Number(draft.seed),clusters:Number(draft.clusters),testFraction:Number(draft.testFraction)}});
        jobs.unshift(started.job);clearTimeout(timer);timer=setTimeout(poll,300);
      }
    }
  };
}
