/** Resident DSH native project/configuration conversations inside ARES. */
window.__ModuleLoader__.load({id:'ares',factory(require){
 const React=require('react'),{createPortal}=require('react-dom'),{conversationPhase}=require('@deepseek-ai/dsh-client-ui-conversation'),h=React.createElement;
 return {inject:['slots'],apply(ctx){
  const services={},serviceListeners=new Set();
  for(const name of ['uiWorkspace','workspaces','sessions','conversation'])ctx.inject([name],scope=>{services[name]=scope[name];serviceListeners.forEach(fn=>fn());scope.effect(()=>()=>{services[name]=null;serviceListeners.forEach(fn=>fn());},'ares: '+name+' lifetime');});
  function NativeEditorBody({useSession,useConversation,renderFactorySlot,inputActions,manager,hint,layout,inputContextReady=true}){
   const session=useSession(value=>value),conversation=useConversation(value=>value),rootRef=React.useRef(null);
   const empty=!!session&&!!conversation&&conversationPhase(session,conversation)==='blank',isProject=manager.kind==='project';
   React.useEffect(()=>{if(hint?.id&&inputActions){inputActions.setDraft(hint.text);manager.consumeHint(hint.id);}},[hint?.id,inputActions,manager]);
   React.useEffect(()=>{manager.setRunning(session?.running);},[session?.running,manager]);
   React.useEffect(()=>{const root=rootRef.current;if(!root)return;let seat=null;const measure=()=>{if(root.clientHeight>0)root.style.setProperty('--ares-chat-height',root.clientHeight+'px');if(seat?.offsetHeight>0)root.style.setProperty('--ares-composer-height',seat.offsetHeight+'px');};const resize=new ResizeObserver(measure);const attach=()=>{const next=root.querySelector('[data-composer-seat]');if(next&&next!==seat){resize.disconnect();seat=next;resize.observe(root);resize.observe(seat);measure();}};resize.observe(root);attach();const mutations=seat?null:new MutationObserver(()=>{attach();if(seat)mutations.disconnect();});mutations?.observe(root,{childList:true,subtree:true});return()=>{resize.disconnect();mutations?.disconnect();};},[session?.openState]);
   React.useEffect(()=>{const root=rootRef.current;if(!root)return;const update=()=>{const seat=root.querySelector('[data-composer-seat]');if(seat){seat.inert=!inputContextReady;seat.setAttribute('aria-disabled',String(!inputContextReady));}};update();const observer=new MutationObserver(update);observer.observe(root,{childList:true,subtree:true});return()=>observer.disconnect();},[inputContextReady,session?.openState]);
   if(!session||session.openState!=='open')return h('div',{className:'ares-native-status',role:'status'},isProject?'正在连接项目原生会话…':'正在连接ARES原生编辑会话…');
   // Fixed editor session: never render the generic hero/workspace-picker path.
   return h('div',{className:'ares-native-layout',ref:rootRef},empty?h('section',{className:'ares-native-empty','aria-label':isProject?'开始制作作品':'开始编辑ARES'},h('div',{className:'ares-native-empty-inner'},h('div',{className:'ares-native-empty-code'},isProject?'PROJECT / CHAT':'ARES / CONFIG'),h('h3',null,isProject?'推进当前项目':'编辑 ARES 流程'),h('p',null,'选择一个操作，或直接输入目标。'),h('div',{className:'ares-native-empty-actions'},(isProject?[['梳理下一步','请先读取ares_project status，指出这个项目当前该做哪一步、缺什么材料。'],['检查当前作品','请读取当前项目和实际作品文件，检查内容与来源，列出具体修改建议，保留人工验收。'],['完善流程','请根据当前竞赛目标检查实际流程，提出最少且必要的调整。'],['准备金山共编','请读取当前项目的金山文档关联，说明哪份工作稿适合交给队员共同编辑，先核对版本。']]:[
    ['检查流程缺口','请读取当前ARES流程，检查目标、技能和交付要求的缺口，再提出具体修改。'],
    ['改写当前步骤','请读取选中步骤，和我一起调整执行目标、技能与复核要求。'],
    ['补充一个技能','请根据当前流程讨论缺少的能力，读取真实技能库后再提出新增或绑定建议。'],
    ['调整交付物','请读取当前步骤的产物契约，帮我调整必需、可选和文内章节要求。'],
   ]).map(([label,prompt],index)=>h('button',{type:'button',key:label,'data-ares-chat-shortcut':true,onClick:()=>manager.hint(prompt)},h('span',{className:'ares-native-shortcut-number'},String(index+1).padStart(2,'0')),h('span',null,label),h('span',{className:'ares-native-shortcut-arrow','aria-hidden':true},'↗')))))):null,renderFactorySlot('conversation.content',layout(session),{fallback:h('div',{role:'status'},'DSH原生对话组件尚未就绪。')}));
  }
  function NativeConversation({sessionId,nativeKit,manager,hint,layout,generation,inputAdapter,host,connectionRevision=0,slot='ares.editor.native'}){
   const [connection,setConnection]=React.useState(null),[error,setError]=React.useState(null),[retry,setRetry]=React.useState(0);
   // Retry a failed lease when the owner explicitly reconnects. A healthy
   // lease and its unsent native draft stay mounted across that same action.
   React.useEffect(()=>{if(error)setRetry(value=>value+1);},[connectionRevision]);
   React.useEffect(()=>{
    let active=true,lease,offInput;setConnection(null);setError(null);manager.setNativeConnection?.(sessionId,'connecting');
    const failed=cause=>{if(active){const message=cause?.message||String(cause);setError(message);manager.setNativeConnection?.(sessionId,'error',message);}};
    try{
     if(!services.sessions?.retain)throw new Error('DSH原生会话服务尚未就绪');
     lease=services.sessions.retain(sessionId,{source:slot==='ares.project.native'?'aresProject':'aresEditor'});
     Promise.resolve(lease.ready).then(binding=>{
      if(!active)return;
      let inputReady=false;
      try{
       if(typeof inputAdapter!=='function')throw new Error('原生输入上下文组件尚未加载');
       offInput=inputAdapter(services.conversation,binding,manager,{isActive:()=>!!host?.isConnected&&host.getClientRects().length>0&&!!host.closest('.galaxy-chat'),async request(path,data,{signal}={}){
        const response=await fetch('/ares/api/v2/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data),signal});
        const result=await response.json();if(!response.ok||result.ok===false)throw new Error(result.error||'原生消息的查看对象未绑定');return result;
       }});
       inputReady=true;
      }catch(cause){failed(cause);}
      if(inputReady)manager.setNativeConnection?.(sessionId,'connected');
      setConnection({sessionId,reference:lease,generation,retry,inputReady});
     },failed);
    }catch(cause){failed(cause);}
    return()=>{active=false;offInput?.();lease?.release();};
   },[sessionId,generation,retry,slot,inputAdapter,host,manager]);
   const warning=error?h('div',{className:'ares-native-status',role:'alert'},error,h('button',{type:'button',className:'ares-btn quiet',onClick:()=>setRetry(value=>value+1)},'重试连接')):null;
   if(!connection||connection.sessionId!==sessionId||connection.generation!==generation||connection.retry!==retry)return warning||h('div',{className:'ares-native-status',role:'status'},'正在连接DSH原生会话…');
   return h(React.Fragment,null,warning,h(nativeKit.SessionProvider,{session:connection.reference},nativeKit.renderSlot(slot,{manager,hint,layout,inputContextReady:connection.inputReady})));
  }
  function Panel(nativeKit){
   const ref=React.useRef(null),managerRef=React.useRef(null),projectManagerRef=React.useRef(null),[projectPortal,setProjectPortal]=React.useState(null),[projectState,setProjectState]=React.useState(null),[portal,setPortal]=React.useState(null),[editorState,setEditorState]=React.useState(null),[layout,setLayout]=React.useState(null),[inputAdapter,setInputAdapter]=React.useState(null),[generation,setGeneration]=React.useState(0);
   React.useEffect(()=>{const update=()=>{setGeneration(value=>value+1);managerRef.current?.reconnect();projectManagerRef.current?.reconnect();};serviceListeners.add(update);return()=>serviceListeners.delete(update);},[]);
   React.useEffect(()=>{let view,manager,projectManager,disposed=false;const element=ref.current;
    const request=async(path,data)=>{const response=await fetch('/ares/api/v2/'+path,data===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const value=await response.json();if(!response.ok||value.ok===false){const error=new Error(value.error||'ARES配置请求失败');error.status=response.status;throw error;}return value;};
    Promise.all([import('/ares/api/v2/app.js?v=2.3.0-verification3'),import('/ares/api/v2/editor-session.js?v=2.3.0-connection1'),import('/ares/api/v2/project-session.js?v=2.3.0-connection1'),import('/ares/api/v2/workshop-scene.js?v=2.3.0-connection1')]).then(([{mountAres},{createEditorSession,nativeConversationLayout},{createProjectSession},{attachNativeInputContext}])=>{if(disposed)return;setLayout(()=>nativeConversationLayout);setInputAdapter(()=>attachNativeInputContext);if(nativeKit.SessionProvider&&nativeKit.renderSlot)manager=createEditorSession({request,createSession:options=>{if(!services.sessions?.create)throw new Error('DSH原生会话服务尚未就绪');return services.sessions.create(options);},onState:setEditorState});managerRef.current=manager;if(nativeKit.SessionProvider&&nativeKit.renderSlot)projectManager=createProjectSession({request,onState:setProjectState});projectManagerRef.current=projectManager;
     view=mountAres(element,{browserWorkspaces:()=>services.workspaces,editorSession:manager,projectSession:projectManager,mountProject:node=>setProjectPortal(old=>old===node?old:node),mountEditor:node=>setPortal(old=>old===node?old:node),pickDirectory:()=>{if(!services.uiWorkspace?.pickDirectory)throw new Error('目录选择服务尚未就绪');return services.uiWorkspace.pickDirectory();},async openSession(root,preset){if(!services.workspaces?.create||!services.uiWorkspace)throw new Error('DSH工作区服务尚未就绪');const value=await services.workspaces.create({path:root}),id=value?.workspaceId??value?.id??value;if(typeof id!=='string')throw new Error('无法读取工作区ID');if(typeof services.uiWorkspace.openWorkspace==='function')await services.uiWorkspace.openWorkspace(id,undefined,{agentPreset:preset});else{const session=await services.uiWorkspace.connectWorkspace(id,{agentPreset:preset});await services.uiWorkspace.openSession(session);}}});
    }).catch(error=>{if(!disposed)element.textContent='ARES工作台加载失败：'+error.message;});
    return()=>{disposed=true;view?.destroy();manager?.dispose();projectManager?.dispose();managerRef.current=null;projectManagerRef.current=null;};
   },[]);
   const manager=managerRef.current,projectManager=projectManagerRef.current;
   const nativeContent=portal&&manager&&layout&&inputAdapter&&editorState?.sessionId?h(NativeConversation,{connectionRevision:editorState.connectionRevision||0,sessionId:editorState.sessionId,nativeKit,manager,hint:editorState.hint,layout,generation,inputAdapter,host:portal}):portal?h('div',{className:'ares-native-status',role:'status'},editorState?.error||'正在准备DSH原生编辑会话…'):null;
   const projectContent=projectPortal&&projectManager&&layout&&inputAdapter&&projectState?.sessionId?h(NativeConversation,{sessionId:projectState.sessionId,nativeKit,manager:projectManager,hint:projectState.hint,layout,generation,inputAdapter,host:projectPortal,slot:'ares.project.native'}):projectPortal?h('div',{className:'ares-native-status',role:projectState?.error?'alert':'status'},projectState?.error||'正在连接本项目的DSH原生助手…'):null;
   return h(React.Fragment,null,h('div',{style:{height:'100%',minHeight:420}},h('link',{rel:'stylesheet',href:'/ares/api/v2/style.css?v=2.3.0-connection1'}),h('div',{ref,style:{height:'100%'}})),portal&&nativeContent?createPortal(nativeContent,portal):null,projectPortal&&projectContent?createPortal(projectContent,projectPortal):null);
  }
  ctx.slots.inject('main',()=>{const off=ctx.slots.register({name:'main',key:'ares-workbench',children:{'ares.editor.native':{kind:'single',scope:'session'},'ares.project.native':{kind:'single',scope:'session'}}},props=>h(Panel,props));return()=>{const layout=ctx.get('layout');if(layout?.panelInfo?.getSnapshot?.().activePanelId==='ares-workbench')layout.selectPanel(null);off?.();};});
  ctx.slots.inject('ares.editor.native',()=>ctx.slots.register({name:'ares.editor.native'},NativeEditorBody));
  ctx.slots.inject('ares.project.native',()=>ctx.slots.register({name:'ares.project.native'},NativeEditorBody));
  ctx.slots.inject('sidebar.panellist',()=>ctx.slots.register({name:'sidebar.panellist',id:'ares-workbench',order:6,label:()=> 'ARES'},(owner={})=>h('span',{style:{fontFamily:'Georgia,serif',fontWeight:700,fontSize:owner.size||18},'aria-label':'ARES'},'A')));
 }};
}});
