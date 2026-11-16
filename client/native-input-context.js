/** Decorate only the retained native input transport. DSH still owns command
 * adjudication, reference/quote expansion, attachments, acceptance and queueing.
 * The selection is captured at beginAttempt, before any asynchronous expansion. */
const bridges = new WeakMap();
const outside = Object.freeze({outside:true});
const abortIfNeeded = signal => {
  if (typeof signal?.throwIfAborted === 'function') signal.throwIfAborted();
  else if (signal?.aborted) {const error=new Error('原生输入已取消');error.name='AbortError';throw error;}
};

export function attachNativeInputContext(conversation,binding,manager,{request,isActive=()=>true}={}) {
  if (!binding?.ctx||!binding.session||typeof binding.sessionId!=='string'||
      typeof binding.session.beginSubmission!=='function'||typeof binding.session.prompt!=='function'||
      typeof conversation?.input?.for!=='function'||typeof conversation.sendSession!=='function') {
    throw new Error('DSH原生输入接口尚未支持ARES上下文绑定，请重新加载后重连');
  }
  if (manager?.kind==='project') {
    if(typeof manager.getMessageContext!=='function'||typeof request!=='function')throw new Error('ARES项目消息上下文接口尚未就绪');
  } else if(manager?.kind==='editor') {
    if(typeof manager.prepareMessageContext!=='function')throw new Error('ARES流程编辑上下文接口尚未就绪');
  } else throw new Error('ARES原生输入缺少明确的项目或编排对象');
  const shell=conversation.input.for(binding.ctx);
  const method=typeof shell?.core?.beginAttempt==='function'?'beginAttempt':
    typeof shell?.core?.mintAttempt==='function'?'mintAttempt':null;
  if(!method||typeof shell?.deps?.defaultSink!=='function')throw new Error('DSH原生输入版本不支持精确消息绑定，未降级为无上下文发送');
  let bridge=bridges.get(shell);
  if(bridge&&(bridge.binding!==binding||bridge.kind!==manager.kind))throw new Error('此原生输入已绑定另一个ARES对象');
  if(!bridge){
    const mint=shell.core[method],sink=shell.deps.defaultSink,own=Object.getOwnPropertyDescriptor(shell.core,method);
    const attempts=new WeakMap(),pending=new Set(),abortListeners=new Map();
    bridge={binding,kind:manager.kind,owners:[],disposed:false};bridges.set(shell,bridge);
    const currentOwner=()=>bridge.owners.at(-1);
    const restore=()=>{
      if(shell.core[method]===focusedAttempt){if(own)Object.defineProperty(shell.core,method,own);else delete shell.core[method];}
      if(shell.deps.defaultSink===focusedSink)shell.deps.defaultSink=sink;
      if(bridges.get(shell)===bridge)bridges.delete(shell);
    };
    const maybeRestore=()=>{if(!bridge.owners.length&&!pending.size)restore();};
    const forget=signal=>{
      pending.delete(signal);const listener=abortListeners.get(signal);if(listener)signal.removeEventListener('abort',listener);
      abortListeners.delete(signal);maybeRestore();
    };
    function capture(){
      const owner=currentOwner();if(!owner||bridge.disposed||!owner.isActive())return outside;
      try{
        if(owner.manager.kind==='project'){
          const snapshot=JSON.parse(JSON.stringify(owner.manager.getMessageContext()));
          if(!snapshot||snapshot.sessionId!==binding.sessionId)throw new Error('查看对象与此原生输入会话不同，未发送');
          return {kind:'project',snapshot,request:owner.request};
        }
        const snapshot=owner.manager.prepareMessageContext();
        if(snapshot?.sessionId!==binding.sessionId||typeof snapshot.beforeSend!=='function')throw new Error('编排草稿与此原生输入会话不同，未发送');
        return {kind:'editor',beforeSend:snapshot.beforeSend.bind(snapshot)};
      }catch(error){return {error};}
    }
    function focusedAttempt(...args){
      const flight=mint.apply(this,args),attempt=flight?.attempt||flight;
      if(!attempt?.signal||typeof attempt.signal!=='object')throw new Error('DSH原生输入没有提供可绑定的发送尝试');
      attempts.set(attempt.signal,capture());pending.add(attempt.signal);
      const listener=()=>{attempts.delete(attempt.signal);forget(attempt.signal);};
      attempt.signal.addEventListener('abort',listener,{once:true});abortListeners.set(attempt.signal,listener);
      return flight;
    }
    function focusedSink(text,attachmentIds,mode,signal,accept){
      let focus;
      if(signal&&attempts.has(signal)){focus=attempts.get(signal);attempts.delete(signal);forget(signal);}
      // Native attachment-only gestures can enter this sink without beginAttempt.
      else if(text===''&&Array.isArray(attachmentIds)&&attachmentIds.length)focus=capture();
      else if(!currentOwner()||bridge.disposed||!currentOwner().isActive())focus=outside;
      else return Promise.reject(new Error('原生消息未记录发送时的编辑对象，请重新发送；草稿保留'));
      if(focus.outside)return sink.call(this,text,attachmentIds,mode,signal,accept);
      if(focus.error)return Promise.reject(focus.error);
      let submission;
      return conversation.sendSession({sessionId:binding.sessionId,
        beginSubmission(input){submission=binding.session.beginSubmission(input);return submission;},
        async prompt(content,deliveryMode,abort,requestId){
          try{
            abortIfNeeded(abort);
            if(focus.kind==='project'){
              const expected=focus.snapshot;
              const result=await focus.request('project/assistant/message-context',{...expected,requestId},{signal:abort});
              const context=result?.context;
              if(context?.projectId!==expected.projectId||context.definitionId!==expected.definitionId||
                  context.sessionId!==binding.sessionId||context.requestId!==requestId)throw new Error('原生消息的查看对象未获项目服务确认，未发送');
            }else await focus.beforeSend();
            abortIfNeeded(abort);
          }catch(error){submission?.abandon();throw error;}
          // Return the native transport outcome unchanged. Its acceptance and
          // attachment receipt lifecycle must remain owned by sendSession.
          return binding.session.prompt(content,deliveryMode,abort,requestId);
        }
      },text,attachmentIds,mode,signal,accept);
    }
    shell.core[method]=focusedAttempt;shell.deps.defaultSink=focusedSink;
    bridge.detach=owner=>{bridge.owners=bridge.owners.filter(value=>value!==owner);maybeRestore();};
    if(typeof binding.ctx.effect==='function')binding.ctx.effect(()=>()=>{
      bridge.disposed=true;bridge.owners=[];restore();
      for(const [signal,listener]of abortListeners)signal.removeEventListener('abort',listener);
      pending.clear();abortListeners.clear();
    },'ares: release native input context');
  }
  const owner={manager,request,isActive};bridge.owners.push(owner);
  let detached=false;
  return()=>{if(detached)return;detached=true;bridge.detach(owner);};
}
