import {html,button,option,field,input,area,select,empty,heading,dataLink,names} from './research-ui.js';
import {createGuideWorkspace} from './research-guide-ui.js';
import {createCodeWorkspace} from './research-code-ui.js';

const checkbox=(name,value=false,required=false,attrs='')=>'<input type="checkbox" name="'+name+'" '+(value?'checked ':'')+(required?'required ':'')+attrs+'>';
const clock=ms=>ms==null?'无时间戳':new Date(ms).toISOString().slice(11,23);
const formats=[['notes','实际笔记'],['text','逐字稿'],['srt','SRT 字幕'],['vtt','VTT 字幕'],['blank','空白记录']];
export function createInterviewWorkspace(ctx) {
  const guide=createGuideWorkspace(ctx),codes=createCodeWorkspace(ctx),pending=new Map();
  let mode='records',entry,book,selected,meta,edits={},term='',guideId='',asrForm=false;
  let jobs=[],asr,interval,active=false,generation=0,polling=false,player,playerKey,bins,waveError,waveRequest,uploading=false;
  const group=kind=>ctx.index.items.filter(row=>row.kind===kind);
  const keys=()=>({id:entry.item.id,versionId:entry.version.id});
  const base=()=>({id:entry.item.id,baseVersion:entry.version.id});
  const current=()=>entry?.data.transcript.find(row=>row.id===selected);
  const correction=row=>edits[row.id]??entry.data.edits[row.id]??{};
  const draftText=row=>correction(row).text??row.original;
  const dirty=()=>entry&&(Object.keys(edits).length>0||JSON.stringify(meta)!==JSON.stringify(entry.data.meta));
  function stash(){if(dirty())pending.set(entry.item.id,{edits,meta});}
  function selectEntry(value,segmentId){
    stash();entry=value;selected=segmentId??value.data.transcript[0]?.id;term='';asrForm=false;
    const scratch=pending.get(value.item.id);edits=scratch?.edits??{};meta=scratch?.meta??structuredClone(value.data.meta);
    if(playerKey!==value.data.media?.sha256){bins=null;waveError=null;}
  }
  async function open(id,version,segmentId){
    const item=ctx.index.items.find(row=>row.id===id);
    if(!item)throw new Error('请刷新项目后读取研究记录。');
    if(item.kind==='guide'){mode='guide';await guide.enter(id,version);}
    else if(item.kind==='codebook'){mode='coding';await codes.open(id);}
    else {mode='records';selectEntry(await ctx.entry(id,version),segmentId);}
    ctx.draw();
  }
  function playhead(){
    if(!player||!entry?.data.media)return;
    const time=player.currentTime*1000,playing=entry.data.transcript.find(row=>row.start!=null&&row.start<=time&&time<row.end);
    for(const row of ctx.element.querySelectorAll('[data-cue]'))row.classList.toggle('is-playing',playing?.id===row.dataset.cue);
    const bar=ctx.element.querySelector('[data-wave-bar]');
    if(bar)bar.style.transform='scaleX('+Math.min(1,time/1000/entry.data.media.duration)+')';
    const label=ctx.element.querySelector('[data-media-time]');
    if(label)label.textContent=clock(Math.round(time))+' / '+clock(Math.round(entry.data.media.duration*1000));
  }
  function mountPlayer(){
    const target=ctx.element.querySelector('[data-player-seat]'),media=entry?.data.media;
    if(!target||!media){player?.pause();return;}
    if(playerKey!==media.sha256){
      player?.pause();player?.remove();
      player=document.createElement(media.video?'video':'audio');
      player.preload='metadata';player.controls=true;player.playsInline=true;
      player.src=dataLink('interview/media',{root:ctx.root,...keys()});
      player.setAttribute('aria-label','访谈原始音视频');player.addEventListener('timeupdate',playhead);playerKey=media.sha256;
    }
    target.replaceChildren(player);playhead();
    if(bins||waveRequest||waveError)return;
    const id=entry.item.id,root=ctx.root;
    waveRequest=ctx.call('interview/waveform',keys()).then(result=>{
      if(ctx.root===root&&entry?.data.media?.sha256===result.sha256){bins=result.bins;if(active)ctx.draw();}
    }).catch(error=>{
      if(ctx.root===root&&entry?.item.id===id){waveError=error.message;if(active)ctx.draw();}
    }).finally(()=>{waveRequest=null;if(active&&ctx.root===root&&entry?.data.media&&entry.item.id!==id&&!bins)mountPlayer();});
  }
  function jobList(){
    return jobs.length?jobs.slice(0,15).map(job=>{
      const label={running:'处理中',completed:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'}[job.status];
      const percent=job.progress?.total?Math.min(100,Math.round(job.progress.done/job.progress.total*100)):null;
      return '<div class="research-job"><strong>'+html(label)+'</strong> <small>'+html(new Date(job.startedAt).toLocaleTimeString())+'</small>'+
        (job.status==='running'?'<progress aria-label="转写进度" max="100" '+(percent!==null?'value="'+percent+'"':'')+'></progress>':'')+
        (job.message?'<small>'+html(job.message)+'</small>':'')+
        (job.status==='running'?button('asr-cancel','取消',{data:{id:job.id}}):
          ['failed','cancelled','interrupted'].includes(job.status)?button('asr-retry','重试 / 续接',{data:{id:job.id}}):
          job.result?button('record-open','打开转写',{data:{id:job.result.itemId}}):'')+'</div>';
    }).join(''):empty('暂无转写任务。');
  }
  async function poll(){
    if(polling||!active||uploading)return;
    const token=generation;
    polling=true;
    try{
      const [result,engine]=await Promise.all([ctx.get('jobs'),asr?Promise.resolve({asr}):ctx.get('interview/asr')]);
      if(!active||token!==generation)return;
      const completed=result.jobs.some(job=>job.status==='completed'&&jobs.some(previous=>previous.id===job.id&&previous.status==='running'));
      jobs=result.jobs.filter(job=>job.kind==='transcription');asr=engine.asr;
      if(completed){
        await ctx.refresh({redraw:false});
        const list=ctx.element.querySelector('[data-interview-shelf]');
        if(active&&token===generation&&list)list.outerHTML=shelf();
      }
      if(!active||token!==generation)return;
      const list=ctx.element.querySelector('[data-interview-jobs]');
      if(list)list.innerHTML=jobList();
      const label=ctx.element.querySelector('[data-asr-status]');
      if(label)label.textContent=asr.modelConfigured?'本机模型已配置':'等待配置本机模型';
    }catch(error){
      if(active&&token===generation)ctx.element.querySelector('[data-interview-jobs]')?.replaceChildren(document.createTextNode(error.message));
    }finally {polling=false;}
  }
  function shelf(){
    const kind=mode==='guide'?'guide':mode==='coding'?'codebook':'interview';
    const id=(mode==='guide'?guide.selected:mode==='coding'?codes.selected:entry)?.item.id;
    const items=group(kind).filter(item=>kind!=='interview'||item.provenance!=='synthetic');
    const mock=kind==='interview'?group(kind).filter(item=>item.provenance==='synthetic'):[];
    const row=item=>'<button type="button" class="research-record" data-r="record-open" data-id="'+html(item.id)+'" aria-current="'+(id===item.id)+'"><span>'+html(item.title)+'</span><small>'+
      html(item.status==='proposal'?'助手建议 · 待采用':item.status==='media-ready'?'本地音视频':item.provenance==='synthetic'?'模拟资料':names[item.kind])+'</small></button>';
    return '<aside class="research-shelf" aria-label="访谈文件和任务" data-interview-shelf>'+heading(names[kind],'',button('interview-new','新建'))+
      (items.length?items.map(row).join(''):empty('暂无记录。'))+
      (mock.length?'<h4>模拟资料</h4>'+mock.map(row).join(''):'')+
      (kind==='interview'?'<h4>本地转写</h4><div data-interview-jobs>'+jobList()+'</div>':'')+'</aside>';
  }
  function importForm(){
    return '<form class="research-form" data-research-form="interview-import">'+heading('登记访谈材料','从实际笔记、逐字稿或本地音视频开始')+
      '<div class="research-form-grid">'+field('访谈名称',input('title','','required maxlength="150"'))+
      field('匿名编号',input('participant','','maxlength="80"'))+field('访谈主题',input('theme',guide.selected?.data.theme??'','maxlength="500"'))+
      field('访谈方式或地点',input('place','','maxlength="200"'))+
      field('关联提纲',select('guideId',option('','无')+group('guide').filter(item=>item.status!=='proposal').map(item=>option(item.id,item.title,item.id===guideId)).join('')))+
      field('文本类型',select('format',formats.map(([id,label])=>option(id,label)).join('')))+
      '</div>'+field('笔记或逐字稿',area('content','','maxlength="4194304"'))+
      field('选择文件（文字或音视频）',input('file','','type="file" accept=".txt,.srt,.vtt,.wav,.mp3,.flac,.ogg,.m4a,.mp4,.mov,.webm"'))+
      field('同意将所选音视频保存到当前本机项目',checkbox('local'))+
      field('这是需要单独保存的模拟文本',checkbox('synthetic'))+
      field('研究者备忘录',area('note','','maxlength="6000"'))+
      button('interview-import','保存材料',{type:'submit',primary:true,disabled:ctx.busy})+'</form>';
  }
  const download=(path,format,label)=>'<a class="research-button" download href="'+html(dataLink(path,{root:ctx.root,...keys(),...(format?{format}:{})}))+'">'+html(label)+'</a>';
  function transcript(){
    const filter=term.trim().toLowerCase();
    const rows=entry.data.transcript.filter(row=>{
      const choice=correction(row);
      return !filter||[draftText(row),choice.speaker??row.speaker,choice.memo??'',row.original].some(text=>text.toLowerCase().includes(filter));
    });
    return rows.length?rows.map(row=>{
      const edit=correction(row);
      return '<div class="research-segment'+(row.id===selected?' is-selected':'')+'" data-cue="'+html(row.id)+'"><button type="button" data-r="interview-segment" data-id="'+html(row.id)+'" aria-current="'+(row.id===selected)+'">'+
        '<span><time>'+html(clock(row.start))+'</time> <strong>'+html(edit.speaker??row.speaker)+'</strong>'+
        (edit.uncertain??row.uncertain?' <small>待复核</small>':'')+(edit.key?' <small>关键陈述</small>':'')+'</span><span>'+html(draftText(row))+'</span></button></div>';
    }).join(''):empty(entry.data.transcript.length?'没有匹配的发言。':'暂无实际转写文本。');
  }
  function record(){
    const {version,item,data}=entry,synthetic=data.dataKind==='synthetic';
    const exports=['json','md',...(synthetic?[]:['docx',...(data.transcript.some(row=>row.start!=null)?['srt']:[])])].map(format=>download('export',format,format.toUpperCase())).join('');
    return heading(version.payload.title,(data.meta.participant||'未填写匿名编号')+' · '+(synthetic?'模拟资料':data.media?.name??'文本资料'),exports)+
      '<div class="research-toolbar">'+field('记录版本',select('version',item.versions.slice().reverse().map((id,i)=>option(id,'第 '+(item.versions.length-i)+' 版',id===version.id)).join(''),'data-record-version'))+
      (data.source?download('interview/original',null,synthetic?'下载模拟原始文本':'下载原始文本'):'')+
      (data.media?button('asr-toggle','本地转写',{primary:!data.transcript.length})+'<small data-asr-status>'+html(asr?.modelConfigured?'本机模型已配置':asr?'等待配置本机模型':'')+'</small>':'')+'</div>'+
      (data.media?'<div class="research-player"><div data-player-seat></div><button type="button" class="research-wave" data-r="wave-seek" aria-label="在波形上定位">'+
        (bins?bins.map(peak=>'<i style="--peak:'+Math.max(.02,peak)+'"></i>').join(''):html(waveError||'正在解码波形…'))+
        '<span data-wave-bar></span></button><small data-media-time></small></div>':'')+
      (!synthetic&&entry.item.head===version.id&&group('interview').some(row=>row.status==='media-ready'&&row.id!==item.id)?
        '<details class="research-rule-details"><summary>关联已登记音视频</summary><form class="research-inline" data-research-form="link-media">'+
        field('本机原始音视频',select('mediaId',group('interview').filter(row=>row.status==='media-ready'&&row.id!==item.id).map(row=>option(row.id,row.title)).join('')))+
        button('link-media','关联到此逐字稿',{type:'submit',disabled:ctx.busy})+'</form></details>':'')+
      (asrForm?'<form class="research-form research-setting" data-research-form="asr-start"><div class="research-form-grid">'+
        field('语言代码（留空自动识别）',input('language','','maxlength="3" pattern="[a-z]{2,3}"'))+
        field('本机设备',select('device',option('cpu','CPU')+option('cuda','NVIDIA GPU')))+
        field('允许在本机处理此音视频',checkbox('local',false,true))+
        (asr?.alignmentConfigured?field('WhisperX 词级对齐',checkbox('align')):'')+
        (asr?.alignmentConfigured&&asr.diarizationConfigured?field('说话人分离（同时启用词级对齐）',checkbox('diarization')):'')+'</div>'+
        button('asr-start','启动转写',{type:'submit',primary:true,disabled:ctx.busy})+'</form>':'')+
      field('搜索发言、说话人或备忘',input('search',term,'type="search" data-cue-search data-focus="interview-search"'))+
      '<div class="research-transcript" data-r-scroll="transcript">'+transcript()+'</div>';
  }
  function properties(){
    const row=current(),value=row?correction(row):{},head=entry.item.head===entry.version.id;
    const edit=(name,label,value,kind='text')=>{
      const attrs='data-interview-edit="'+name+'" data-focus="interview-'+name+'"';
      return field(label,kind==='area'?area(name,value,attrs):kind==='bool'?checkbox(name,value,false,attrs):input(name,value,attrs));
    };
    const codeRows=book?.data.codes.filter(code=>!code.archived&&!book.data.codes.find(parent=>parent.id===code.parent)?.archived)??[];
    return '<aside class="research-properties" data-r-scroll="interview-properties">'+heading('访谈信息')+
      '<form class="research-form" data-research-form="interview-correct"><fieldset '+(head?'':'disabled')+'>'+
      field('匿名编号',input('participant',meta.participant,'data-interview-meta="participant" data-focus="participant"'))+
      field('主题',input('theme',meta.theme,'data-interview-meta="theme" data-focus="theme"'))+
      field('备忘录',area('note',meta.note,'data-interview-meta="note" data-focus="interview-memo"'))+
      (row?'<div class="research-rule-card"><h4>校订片段</h4><details><summary>原始内容</summary><p>'+html(row.original)+'</p></details>'+
        edit('speaker','说话人',value.speaker??row.speaker)+edit('text','校订稿与编码选区',draftText(row),'area')+
        edit('uncertain','需要复核',value.uncertain??row.uncertain,'bool')+edit('key','关键陈述',value.key,'bool')+edit('memo','片段备忘',value.memo,'area')+'</div>':'')+
      field('本稿已人工复核',checkbox('reviewed',entry.version.payload.status==='corrected'))+
      button('interview-correct','保存校订',{type:'submit',primary:true,disabled:ctx.busy})+'</fieldset></form>'+
      (row?'<div class="research-rule-card"><h4>编码片段</h4>'+field('编码本',select('book',option('','选择编码本')+
        group('codebook').map(item=>option(item.id,item.title,item.id===book?.item.id)).join(''),'data-record-book'))+
        (codeRows.length?'<form class="research-form" data-research-form="interview-code">'+codeRows.map(code=>field(code.name,
        '<input type="checkbox" name="code" value="'+html(code.id)+'">')).join('')+field('标注备忘',area('memo'))+
        '<div class="research-actions">'+button('code-span','标注选中文字',{type:'submit',disabled:!head||ctx.busy})+
        button('code-all','标注整段',{type:'submit',disabled:!head||ctx.busy})+button('code-ai','选段交给助手',{disabled:!head})+'</div></form>':'')+
        entry.data.assignments.filter(a=>a.segmentId===row.id).map(a=>'<div class="research-option"><p>'+html(a.quote)+'</p><small>'+
          html(a.codeIds.map(id=>book?.data.codes.find(c=>c.id===id)?.name??id).join(' · '))+'</small>'+
          button('code-unassign','移除',{data:{id:a.id,book:a.codebookId},disabled:!head})+'</div>').join('')+'</div>':'')+'</aside>';
  }
  function span(action,selection) {
    const row=current();if(!row)throw new Error('请打开访谈片段。');
    if(dirty())throw new Error('请先保存校订，以便将编码关联到实际版本。');
    const text=draftText(row),start=action==='code-all'?0:selection.start,end=action==='code-all'?text.length:selection.end;
    if(!Number.isInteger(start)||!Number.isInteger(end)||end<=start)throw new Error('请在校订稿中选择要标注的文字。');
    return {segmentId:row.id,start,end,quote:text.slice(start,end)};
  }
  const selection=()=>{const textarea=ctx.element.querySelector('textarea[data-interview-edit=text]');return {start:textarea?.selectionStart,end:textarea?.selectionEnd};};
  const bookKeys=()=>({bookId:book.item.id,bookVersion:book.version.id});
  async function saved(result,message){const id=selected;pending.delete(result.item.id);edits={};meta=null;entry=null;selectEntry(await ctx.entry(result.item.id),id);ctx.report(message);}
  return {
    render(){
      const codeView=mode==='coding'?codes.render():null;
      const side=mode==='records'&&entry?properties():codeView?.aside??'';
      return '<nav class="research-toolbar" aria-label="访谈工具">'+[['records','访谈材料'],['guide','访谈提纲'],['coding','主题编码']].map(([id,label])=>button('interview-mode',label,{data:{id},primary:mode===id})).join('')+
        button('interview-refresh','刷新')+'</nav><div class="research-workspace'+(side?'':' is-wide')+'">'+shelf()+'<section class="research-section">'+
        (mode==='guide'?guide.render():mode==='coding'?codeView.form:entry?record():importForm())+'</section>'+side+'</div>';
    },
    open,prepareSubmit:selection,
    afterRender(){if(!active){active=true;void poll();interval=setInterval(poll,1500);}mountPlayer();},
    pause(){active=false;generation++;clearInterval(interval);player?.pause();},
    reset(){this.pause();mode='records';entry=book=meta=playerKey=waveError=null;bins=null;player?.remove();player=null;jobs=[];asr=null;pending.clear();guide.reset();codes.reset();},
    async click(action,target,event) {
      const {id,version,segment,book:assignmentBook}=target.dataset;
      if(action==='record-open')return ctx.task(()=>open(id,version,segment));
      if(action==='interview-refresh')return ctx.task(async()=>{await ctx.refresh();await poll();});
      if(action==='interview-mode'){mode=id;ctx.draw();return;}
      if(action==='interview-new'){if(mode==='guide')guide.new();else if(mode==='coding')codes.reset();else{stash();entry=null;}ctx.draw();return;}
      if(action==='guide-record'){mode='records';guideId=id;stash();entry=null;ctx.draw();return;}
      if(mode==='guide')return guide.click(action,target);
      if(mode==='coding')return codes.click(action,target);
      if(action==='interview-segment'){selected=id;const row=current();if(player?.readyState>0&&row.start!=null)player.currentTime=row.start/1000;}
      if(action==='wave-seek'&&player&&Number.isFinite(player.duration)){
        const bounds=target.getBoundingClientRect(),fraction=event.detail?(event.clientX-bounds.left)/bounds.width:0;
        player.currentTime=Math.max(0,Math.min(1,fraction))*player.duration;playhead();return;
      }
      if(action==='asr-toggle')asrForm=!asrForm;
      if(action==='asr-cancel')return ctx.task(async()=>{await ctx.call('job/cancel',{id});await poll();});
      if(action==='asr-retry'){
        if(!window.confirm('允许使用原始本机文件重新转写？'))return;
        return ctx.task(async()=>{await ctx.mutate('interview/transcribe',{retryId:id,confirmLocal:true});await poll();});
      }
      if(action==='code-ai'){
        const evidence=span('code-span',selection());
        ctx.prompt('请依据我选择的文字提供编码建议。先调用 ares_workbench research 获取修订号，再用 research-proposal（proposalKind=codes）提交建议，引用原句、范围和编码 ID。\n'+JSON.stringify({
          itemId:entry.item.id,versionId:entry.version.id,...bookKeys(),evidence,codes:book.data.codes.filter(code=>!code.archived)
        }));ctx.report('选中文字已放入右侧助手草稿。由你决定是否发送。');return;
      }
      if(action==='code-unassign')return ctx.task(async()=>{
        const result=await ctx.mutate('interview/codes',{...base(),bookId:assignmentBook,removeIds:[id]});await saved(result,'已移除当前标注。');
      });
      ctx.draw();
    },
    async submit(action,values,form,submitter,selection){
      if(mode==='guide')return guide.submit(action,values,form,submitter);
      if(mode==='coding')return codes.submit(action,values);
      if(action==='interview-import'){
        const {file,local,synthetic,...fields}=values;
        if(file?.size&&/\.(wav|mp3|flac|ogg|m4a|mp4|mov|webm)$/i.test(file.name)){
          if(!local||synthetic)throw new Error('请确认本地音视频导入。模拟材料可通过文字单独登记。');
          uploading=true;
          try{const {content,format,...meta}=fields;const result=await ctx.upload('interview/upload',file,{...meta,name:file.name,bytes:file.size,confirmLocal:true});await open(result.item.id);}
          finally{uploading=false;}
          ctx.report('本机音视频已保存。');return;
        }
        if(file?.size>4*1024*1024)throw new Error('访谈文本最多4MiB。');
        const format=file?.size?(/\.(srt|vtt)$/i.test(file.name)?file.name.split('.').at(-1).toLowerCase():'text'):fields.format;
        const result=await ctx.mutate('interview/import',{...fields,format,content:file?.size?await file.text():fields.content,synthetic:synthetic==='on',confirmSynthetic:synthetic==='on'});
        await open(result.item.id);ctx.report('已保存访谈及原始资料。');return;
      }
      if(action==='link-media'){
        if(dirty())throw new Error('请先保存校订。');
        const result=await ctx.mutate('interview/link-media',{...base(),mediaId:values.mediaId});
        await saved(result,'已关联本机音视频。带时间戳的发言可以点击定位。');return;
      }
      if(action==='asr-start'){
        await ctx.mutate('interview/transcribe',{...keys(),confirmLocal:values.local==='on',language:values.language,device:values.device,
          align:values.align==='on',diarization:values.diarization==='on'});
        asrForm=false;await poll();ctx.report('已启动本地转写。');return;
      }
      if(action==='interview-correct'){
        const result=await ctx.mutate('interview/correct',{...base(),meta,edits:Object.entries(edits).map(([segmentId,value])=>({segmentId,...value})),reviewed:values.reviewed==='on'});
        await saved(result,'校订版本已保存，原始稿可独立下载。');return;
      }
      if(action==='interview-code'){
        const evidence=span(submitter?.dataset.r,selection);
        const codes=new FormData(form).getAll('code');
        if(!codes.length)throw new Error('请先选择编码。');
        const result=await ctx.mutate('interview/codes',{...base(),...bookKeys(),assignments:[{...evidence,codeIds:codes,memo:values.memo}]});
        await saved(result,'编码已关联到原文片段。');
      }
    },
    input(event){
      if(mode==='guide')return guide.input(event);
      if(mode==='coding')return codes.input(event);
      const t=event.target;
      if(t.hasAttribute('data-cue-search')){term=t.value;ctx.element.querySelector('.research-transcript').innerHTML=transcript();playhead();}
      if(t.dataset.interviewMeta)meta[t.dataset.interviewMeta]=t.value;
      if(t.dataset.interviewEdit){edits[selected]??={...entry.data.edits[selected]};edits[selected][t.dataset.interviewEdit]=t.type==='checkbox'?t.checked:t.value;}
    },
    async change(event){
      if(mode==='guide')return guide.change(event);
      const t=event.target;
      if(t.hasAttribute('data-record-version'))return ctx.task(()=>open(entry.item.id,t.value));
      if(t.hasAttribute('data-record-book')){const id=entry.item.id,next=t.value?await ctx.entry(t.value):null;if(entry?.item.id===id){book=next;ctx.draw();}}
    }
  };
}
