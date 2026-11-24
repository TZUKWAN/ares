import {html,button,option,field,input,select,empty,heading,dataLink} from './research-ui.js';

const providerNames={hf:'Hugging Face',kaggle:'Kaggle'};
const size=bytes=>bytes==null?'大小未声明':bytes>=1024*1024?(bytes/1024/1024).toFixed(1)+' MiB':bytes>=1024?(bytes/1024).toFixed(1)+' KiB':bytes+' B';
const checkbox=(name,required=false)=>'<input type="checkbox" name="'+name+'" '+(required?'required':'')+'>';
export function createDatasetWorkspace(ctx) {
  let provider='hf',query='',matches,detail,jobs=[],entry,timer,active=false,polling=false,epoch=0;
  async function poll(){
    if(!active||polling)return;
    polling=true;
    const now=epoch;
    try{
      const data=await ctx.get('jobs');
      if(!active||now!==epoch)return;
      const next=data.jobs.filter(job=>job.kind==='dataset-download');
      const changed=next.some(job=>job.status==='completed'&&!ctx.index.items.some(row=>row.id===job.result?.itemId));
      jobs=next;
      if(changed){
        await ctx.refresh({redraw:false});
        const library=ctx.element.querySelector('[data-dataset-library]');
        if(active&&now===epoch&&library)library.innerHTML=localFiles();
      }
      if(active&&now===epoch){const seat=ctx.element.querySelector('[data-dataset-jobs]');if(seat)seat.innerHTML=jobList();}
    }catch(error){if(active&&now===epoch)ctx.element.querySelector('[data-dataset-jobs]')?.replaceChildren(document.createTextNode(error.message));}
    finally{polling=false;}
  }
  function jobList(){
    return jobs.length?jobs.slice(0,12).map(job=>{
      const label={running:'下载中',completed:'已登记',failed:'失败',cancelled:'已取消',interrupted:'已中断'}[job.status]??job.status;
      const progress=job.progress?.total?Math.min(100,Math.round(100*job.progress.done/job.progress.total)):null;
      return '<div class="research-job"><strong>'+html(label)+'</strong><small>'+html(job.settings.file)+'</small>'+
        (job.status==='running'?'<progress aria-label="下载进度" max="100" '+(progress!==null?'value="'+progress+'"':'')+'></progress><small>'+
          html(size(job.progress.done)+(job.progress.total?' / '+size(job.progress.total):''))+'</small>'+button('dataset-cancel','取消',{data:{id:job.id}}):
          job.result?button('dataset-open','查看已登记文件',{data:{id:job.result.itemId}}):
          button('dataset-retry','重试',{data:{id:job.id}}))+
        (job.message?'<p>'+html(job.message)+'</p>':'')+'</div>';
    }).join(''):empty('尚无下载任务。');
  }
  function chooser(){
    return '<form class="research-form" data-research-form="dataset-search">'+heading('搜索数据集','关键词会发送给所选数据提供方。')+
      '<div class="research-form-grid">'+field('提供方',select('provider',Object.entries(providerNames).map(([id,label])=>option(id,label,id===provider)).join('')))+
      field('关键词',input('query',query,'required maxlength="160" data-focus="dataset-query"'))+'</div>'+
      field('允许连接所选提供方执行本次搜索',checkbox('approve',true))+
      field('使用宿主配置的提供方凭据',checkbox('credentials'))+button('dataset-search','搜索数据集',{type:'submit',primary:true,disabled:ctx.busy})+'</form>';
  }
  function results(){
    return !matches?'':heading('搜索结果',matches.length+' 个')+(matches.length?
      '<div class="research-dataset-results">'+matches.map(row=>'<details class="research-option"><summary><strong>'+html(row.title)+'</strong>'+(row.title===row.id?'':' <small>'+html(row.id)+'</small>')+'</summary>'+
        '<p>'+html(row.description||'暂无简介')+'</p><p>'+html(row.license||'提供方未声明许可')+'</p>'+
        '<form class="research-form" data-research-form="dataset-detail"><input type="hidden" name="datasetId" value="'+html(row.id)+'">'+
        field('允许读取此数据集的元数据与文件清单',checkbox('approve',true))+
        field('使用宿主配置的提供方凭据',checkbox('credentials'))+
        button('dataset-details','查看版本与文件',{type:'submit',disabled:ctx.busy})+'</form></details>').join('')+'</div>':empty('没有匹配数据集。'));
  }
  function preview(){
    const row=detail;
    return !row?'':heading(row.title,providerNames[row.provider]+' · '+row.version,button('dataset-back','返回搜索'))+
      '<dl class="research-provenance"><dt>数据集</dt><dd>'+html(row.id)+'</dd><dt>使用许可</dt><dd>'+html(row.license||'提供方未声明，请在原站核对')+'</dd>'+
      '<dt>文件</dt><dd>'+row.files.length+(row.truncated?' 项 · 此清单已截取':' 项')+'</dd></dl>'+
      (row.description?'<p>'+html(row.description)+'</p>':'')+
      '<a class="research-source-link" href="'+html(row.url)+'" target="_blank" rel="noreferrer noopener">查看提供方页面</a>'+
      '<form class="research-form research-setting" data-research-form="dataset-download">'+
      field('下载文件',select('file',row.files.map(file=>option(file.path,file.path+' · '+size(file.bytes))).join(''),'required'))+
      field('已核对使用许可和访问条件',checkbox('license',true))+
      field('允许下载所选文件至当前项目',checkbox('approve',true))+
      field('使用宿主配置的提供方凭据',checkbox('credentials'))+
      button('dataset-download','下载并登记',{type:'submit',primary:true,disabled:ctx.busy})+'</form>';
  }
  function saved(){
    const data=entry.data;
    const href=dataLink('dataset/file',{root:ctx.root,id:entry.item.id,versionId:entry.version.id});
    return heading(entry.item.title,providerNames[data.provider]+' · '+data.version,button('dataset-back','返回搜索'))+
      '<dl class="research-provenance"><dt>文件</dt><dd>'+html(data.fileName)+'</dd><dt>大小</dt><dd>'+html(size(data.file.bytes))+'</dd>'+
      '<dt>来源</dt><dd><a href="'+html(data.sourceUrl)+'" target="_blank" rel="noopener noreferrer">'+html(data.datasetId)+'</a></dd>'+
      '<dt>许可</dt><dd>'+html(data.license||'提供方未声明')+'</dd>'+
      '<dt>校验</dt><dd><code>'+html(data.file.sha256)+'</code></dd>'+
      '<dt>登记时间</dt><dd>'+html(new Date(data.downloadedAt).toLocaleString())+'</dd></dl>'+
      '<div class="research-actions"><a class="research-button" download href="'+html(href)+'">取用本地文件</a>'+
      button('dataset-profile','分析字段与缺失',{disabled:ctx.busy||data.file.bytes>4*1024*1024||!/\.(csv|json)$/i.test(data.fileName)})+
      button('item','版本与流程绑定',{data:{id:entry.item.id}})+'</div>';
  }
  const rows=()=>ctx.index.items.filter(row=>row.kind==='dataset');
  function localFiles(){
    return rows().length?rows().map(row=>'<button type="button" class="research-record" data-r="dataset-open" data-id="'+html(row.id)+'" aria-current="'+(entry?.item.id===row.id)+'">'+html(row.title)+'</button>').join(''):empty('已登记文件会显示在这里。');
  }
  async function open(id){entry=await ctx.entry(id);detail=null;ctx.draw();}
  return {
    render(){
      return '<div class="research-two"><aside class="research-shelf" aria-label="已下载的数据与任务">'+heading('本地数据资源')+
        '<div data-dataset-library>'+localFiles()+'</div>'+
        '<h4>下载任务</h4><div data-dataset-jobs>'+jobList()+'</div></aside><section class="research-section">'+
        (entry?saved():detail?preview():chooser()+results())+'</section></div>';
    },
    open,
    afterRender(){if(!active){active=true;void poll();timer=setInterval(poll,1500);}},
    pause(){active=false;epoch++;clearInterval(timer);},
    reset(){this.pause();provider='hf';query='';matches=detail=entry=null;jobs=[];},
    click(action,target){
      const id=target.dataset.id;
      if(action==='dataset-back'){entry=detail=null;ctx.draw();return;}
      if(action==='dataset-open')return ctx.task(async()=>{await ctx.refresh();await open(id);});
      if(action==='dataset-cancel')return ctx.task(async()=>{await ctx.call('job/cancel',{id});await poll();});
      if(action==='dataset-retry'){
        const job=jobs.find(row=>row.id===id);
        if(!job||!window.confirm('确认已核对许可并重新请求 '+providerNames[job.settings.provider]+' 下载 '+job.settings.file+'？'))return;
        return ctx.task(async()=>{await ctx.mutate('dataset/download',{retryId:id,approveExternal:true,confirmLicense:true,useCredentials:job.settings.useCredentials});await poll();});
      }
      if(action==='dataset-profile')return ctx.task(async()=>{
        const result=await ctx.mutate('dataset/profile',{id:entry.item.id,versionId:entry.version.id});
        await ctx.showArtifact(result.item.id);ctx.report('已保存数据字段和缺失统计。');
      });
    },
    async submit(action,inputs){
      const access={approveExternal:inputs.approve==='on',useCredentials:inputs.credentials==='on'};
      if(action==='dataset-search'){provider=inputs.provider;query=inputs.query;}
      if(action==='dataset-search'){
        const result=await ctx.mutate('dataset/search',{provider,query,...access});matches=result.matches;return;
      }
      if(action==='dataset-detail'){detail=await ctx.mutate('dataset/details',{provider,datasetId:inputs.datasetId,...access});return;}
      if(action==='dataset-download'){
        await ctx.mutate('dataset/download',{snapshotId:detail.snapshotId,file:inputs.file,confirmLicense:inputs.license==='on',...access});
        await poll();ctx.report('已启动后台下载。完整校验后会显示在本地数据资源。');
      }
    }
  };
}
