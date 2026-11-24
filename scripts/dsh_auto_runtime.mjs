/** Load restored vendor methods into their existing host instances.
 * Invoked explicitly by an owner repair operation, never by ARES startup/MCP.
 * Native reviewer policy, snapshot builder, model dispatch and decisions stay vendor-owned.
 */
import {readFileSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha=value=>createHash('sha256').update(value).digest('hex');
const key=Symbol.for('ares.restored-native-auto');
const files=['@deepseek-ai/dsh-experimental-auto-review/lib/index.js','@deepseek-ai/dsh-tools/lib/pipeline.js','@deepseek-ai/dsh-user-approval/lib/index.js','@deepseek-ai/dsh-user-approval/lib/types/index.js'];

/** Borrow exactly the restored module's lifecycle closure without registering Auto twice.
 * Registration capture is not a tool, model, approval decision or Session adapter. */
export function captureNativeAutoLifecycle(native,ctx){
 const hooks=[],admissions=[],effects=[];
 const permissions=ctx.permissionPresets;
 const facade=new Proxy(permissions,{get(target,name){
  if(name==='registerAuto')return callback=>{admissions.push(callback);return ()=>{};};
  const value=Reflect.get(target,name,target);return typeof value==='function'?value.bind(target):value;
 }});
 const borrowed=new Proxy(ctx,{get(target,name){
  if(name==='permissionPresets')return facade;
  if(name==='on')return (event,callback,options)=>{hooks.push({event,callback,options});return ()=>{};};
  if(name==='effect')return factory=>{effects.push(factory);};
  return Reflect.get(target,name,target);
 }});
 native.apply(borrowed);
 if(effects.length!==1)throw Error('Unsupported native Auto effect layout');
 const iterator=effects[0]();if(typeof iterator?.next!=='function')throw Error('Native Auto lifecycle is not a generator');
 const values=[];for(let n=0;n<4;n++){const row=iterator.next();if(row.done)break;values.push(row.value);}
 if(values.length!==3||hooks.length!==1||admissions.length!==1||hooks[0].event!=='tools/pre-execute'||hooks[0].options?.prepend!==true||typeof values[2]!=='function')throw Error('Unsupported native Auto registrations');
 if(!hooks[0].callback.toString().includes('classifyRisk(')||hooks[0].callback.toString().includes('official auto-review soft intercept disabled'))throw Error('Native Auto callback is still bypassed or unknown');
 return {review:hooks[0].callback,close:values[2],admit:admissions[0]};
}

export function methodOwner(value,name){
 for(let target=value;target;target=Object.getPrototypeOf(target)){
  const descriptor=Object.getOwnPropertyDescriptor(target,name);
  if(descriptor){if(typeof descriptor.value!=='function')throw Error('Unsupported native '+name+' accessor');return {target,descriptor};}
 }
 throw Error('Missing native '+name+' method');
}

/** Only the known bypass may differ from the restored native method. */
export function knownLoadedMethod(source,native,name){
 source=source.replace(/\r\n/g,'\n');native=native.replace(/\r\n/g,'\n');
 if(source===native)return true;
 if(name==='serviceAsk')return source.replace(/(const approval = this\.ctx\.get\("approval"\);) if \(true\) return [^\n]+ \/\/ \[dsh-purge\] no approval service [^\n]+/,'$1')===native;
 if(name!=='decide')return false;
 if(source.includes('types never-policy')){
  const original=native.match(/^[ \t]*if \(this\.effectivePolicy\(session\) === 'never'\)\n[ \t]*return 'rejected';\n/m)?.[0];
  return !!original&&source.replace(/^[ \t]*return 'allowed-once'; \/\/ \[dsh-purge\] approval bypass: types never-policy no longer rejects\n/m,original)===native;
 }
 const original=native.match(/^[ \t]*if \(this\.effectivePolicy\(session\) === "never"\) return "rejected";\n[ \t]*const answer = [^\n]+\n/m)?.[0];
 return !!original&&source.replace(/^[ \t]*return "allowed-once";\n[ \t]*\/\/ \[dsh-purge\] approval bypass: every approval request is auto-granted\n[ \t]*\/\/ without prompting [^\n]*\n/m,original)===native;
}

export async function restoreNativeAutoRuntime(ctx,{nodeModulesRoot,receipt,nonce}){
 const root=realpathSync(nodeModulesRoot),host=realpathSync(join(root,'@deepseek-ai/dsh-desktop-host/lib/index.js'));
 if(host!==realpathSync(process.argv[1]))throw Error('Repair root does not belong to this running DSH host');
 if(receipt?.status!=='restored'||receipt.applied!==true||receipt.files?.length!==4)throw Error('Verified disk restoration receipt required');
 for(const relative of files){const row=receipt.files.find(r=>r.relative===relative);if(!row||sha(readFileSync(join(root,relative)))!==row.afterSha256)throw Error('Restored source fingerprint mismatch: '+relative);}
 const entries=[...ctx.get('loader').entries()],auto=entries.find(e=>String(e.options.name).endsWith('/dsh-experimental-auto-review'));
 if(auto?.fiber?.state!==2)throw Error('Existing native Auto integration is not active');
 if(globalThis[key]?.uid===auto.fiber.uid)return {...globalThis[key].receipt,alreadyRestored:true};
 const autoCtx=auto.fiber.ctx,permissions=ctx.get('permissionPresets'),agents=ctx.get('agents');
 const autoSessions=[...ctx.get('sessions').list()].filter(s=>permissions.current(s)==='auto');
 if(autoSessions.some(s=>{const a=agents.get(s.header.id);return a&&(a.status!=='idle'||a.inbox?.nextTurn?.length||a.inbox?.nextStep?.length);}))throw Error('A native Auto session is busy; no runtime replacement attempted');
 const defaults=()=>sha(JSON.stringify({model:ctx.get('agentDefaultModel').currentSelection(),permissions:permissions.catalog(),approval:ctx.get('approval').config}));
 const beforeDefaults=defaults(),beforePermissions=autoSessions.map(s=>({id:s.header.id,preset:permissions.current(s)}));
 const loaded=[...ctx.get('hmr').esmUrls()],fresh={};
 for(const relative of files)fresh[relative]=await import(pathToFileURL(join(root,relative)).href+'?ares-auto-restored='+encodeURIComponent(nonce));
 const nativeGate=captureNativeAutoLifecycle(fresh[files[0]],autoCtx);
 const nativePipeline=methodOwner(fresh[files[1]].ToolExecutionPipeline.prototype,'serviceAsk').descriptor.value;
 const nativeApproval=methodOwner(fresh[files[2]].ApprovalService.prototype,'decide').descriptor.value;
 const typesClass=fresh[files[3]].ApprovalService||fresh[files[3]].default;
 const nativeTypesApproval=methodOwner(typesClass.prototype,'decide').descriptor.value;
 const bindings=[],seen=new Set();
 function stage(value,name,replacement){
  const found=methodOwner(value,name);if(seen.has(found.target))return;seen.add(found.target);
  const old=found.descriptor.value,source=old.toString();
  if(source===replacement.toString())return;
  const known=name==='serviceAsk'?source.includes('[dsh-purge] no approval service')&&source.includes('if (true)'):source.includes('[dsh-purge] approval bypass:');
  if(!known||!knownLoadedMethod(source,replacement.toString(),name)||!found.descriptor.writable)throw Error('Unrecognized/read-only loaded native '+name+' method');
  bindings.push({...found,name,replacement,beforeSha256:sha(source),afterSha256:sha(replacement.toString())});
 }
 const targets=new Map(files.slice(1).map(relative=>[realpathSync(join(root,relative)).toLowerCase(),relative]));
 for(const url of loaded){if(!url.startsWith('file:'))continue;let relative;try{relative=targets.get(realpathSync(fileURLToPath(url)).toLowerCase());}catch{continue;}if(!relative)continue;
  const module=await import(url);
  if(relative===files[1])stage(module.ToolExecutionPipeline.prototype,'serviceAsk',nativePipeline);
  else{const Class=module.ApprovalService||module.default;if(Class?.prototype)stage(Class.prototype,'decide',relative===files[3]?nativeTypesApproval:nativeApproval);}
 }
 const approval=ctx.get('approval');const actual=methodOwner(approval,'decide').descriptor.value.toString();
 stage(approval,'decide',actual.includes('types never-policy')?nativeTypesApproval:nativeApproval);
 for(const a of agents.list()){let executor;try{executor=ctx.get('tools').selectExecutor(a);}catch{continue;}if(executor?.pipeline)stage(executor.pipeline,'serviceAsk',nativePipeline);}
 const ownHooks=autoCtx.events._hooks['tools/pre-execute']?.filter(h=>h.ctx.fiber.uid===auto.fiber.uid)||[];
 const oldAuto=auto.moduleNamespace.apply.toString().replace(/\r\n/g,'\n'),nativeAuto=fresh[files[0]].apply.toString().replace(/\r\n/g,'\n');
 if(ownHooks.length!==1||!oldAuto.includes('official auto-review soft intercept disabled')||oldAuto.replace('\t\t\treturn next(); // [dsh-purge] official auto-review soft intercept disabled\n','')!==nativeAuto)throw Error('Unexpected loaded Auto hook; no replacement performed');
 const nativeNever=JSON.parse(readFileSync(join(root,files[2]),'utf8').match(/^const NEVER_SENTENCE = ("[^\n]+");$/m)?.[1]||'null');
 if(typeof nativeNever!=='string'||!nativeNever.includes('rejected automatically'))throw Error('Native policy text not verified');
 let off,offPrompt,oldRemoved=false;const oldIndex=autoCtx.events._hooks['tools/pre-execute'].indexOf(ownHooks[0]);
 try{
  for(const b of bindings)Object.defineProperty(b.target,b.name,{...b.descriptor,value:b.replacement});
  off=autoCtx.on('tools/pre-execute',nativeGate.review,{prepend:true});
  offPrompt=autoCtx.on('system-prompt/assemble',async(_a,context,next)=>{const result=await next();if(!context.agent||approval.effectivePolicy(context.agent.session)!=='never')return result;
   return {...result,contexts:result.contexts?.map(row=>row.name==='approval:policy'&&/auto-granted.*approval bypass|actions run with full access/.test(row.text)?{...row,text:nativeNever}:row)};
  },{prepend:true});
  if(!autoCtx.events.unregister('tools/pre-execute',ownHooks[0].callback))throw Error('Old bypass listener was not removed');
  oldRemoved=true;
  autoCtx.effect(()=>()=>nativeGate.close(),'ARES: restored vendor Auto lifecycle');
 }catch(error){off?.();offPrompt?.();if(oldRemoved){const hooks=autoCtx.events._hooks['tools/pre-execute']??=[];if(!hooks.includes(ownHooks[0]))hooks.splice(Math.min(oldIndex,hooks.length),0,ownHooks[0]);}for(const b of bindings.reverse())if(Object.getOwnPropertyDescriptor(b.target,b.name)?.value===b.replacement)Object.defineProperty(b.target,b.name,b.descriptor);throw error;}
 const afterPermissions=autoSessions.map(s=>({id:s.header.id,preset:permissions.current(s)}));
 const result={pid:process.pid,autoUid:auto.fiber.uid,nativeGateSha256:sha(nativeGate.review.toString()),nativeModuleSha256:receipt.files[0].afterSha256,methods:bindings.map(b=>({name:b.name,beforeSha256:b.beforeSha256,afterSha256:b.afterSha256})),globalDefaultsUnchanged:defaults()===beforeDefaults,existingAutoSelectionsUnchanged:JSON.stringify(beforePermissions)===JSON.stringify(afterPermissions),autoSessionsRetained:autoSessions.length,autoHookCount:autoCtx.events._hooks['tools/pre-execute'].filter(h=>h.ctx.fiber.uid===auto.fiber.uid).length,approvalBypassRemaining:methodOwner(approval,'decide').descriptor.value.toString().includes('[dsh-purge]'),hostRestarted:false};
 if(!result.globalDefaultsUnchanged||!result.existingAutoSelectionsUnchanged||result.autoHookCount!==1||result.approvalBypassRemaining)throw Error('Native restoration invariant failed');
 globalThis[key]={uid:auto.fiber.uid,receipt:result};
 autoCtx.effect(()=>()=>{if(globalThis[key]?.uid===auto.fiber.uid)delete globalThis[key];},'ARES: native restore receipt lifetime');
 return result;
}
