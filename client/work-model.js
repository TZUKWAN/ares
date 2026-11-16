/** Read-only, shared selection/operation/document projections for the work surface. */
export function canRunStep(m){const step=m.selected;return !!(step&&m.nodeAvailable&&!m.nativeRunning&&step.execution==='agent'&&step.status!=='done'&&(step.dependsOn||[]).every(id=>m.project.tasks[id]?.status==='done')&&!m.activeRun);}
export function workDetails(m,board={}){
 const step=m.selected,live=board.live||{},progress=m.progress.nodes.find(row=>row.id===step?.id),actor=board.selectedActorId,actorFilter=actor?.startsWith('agent:')?actor:null;
 let operations=(live.operations||[]).filter(row=>row.stepIds?.includes(step?.id)&&(!actorFilter||row.actorId===actorFilter));
 if(!live.available&&!actorFilter)operations=(m.currentRun?.calls||[]).map(row=>({...row,id:'run:'+row.callSeq+':'+row.resultSeq,action:'调用工具',paths:[],stepIds:[step?.id],note:row.status==='running'?'等待工具结果，审批状态请看原生对话':''}));
 const agents=new Map((live.agents||[]).map(row=>[row.id,row])),unassigned=(live.operations||[]).filter(row=>!row.stepIds?.length&&(!actorFilter||row.actorId===actorFilter)).slice(-3).reverse().map(row=>({...row,actorName:agents.get(row.actorId)?.name||'项目助手'})),current=operations.at(-1),run=m.currentRun,needs=(step?.dependsOn||[]).filter(id=>m.project.tasks[id]?.status!=='done'),person=m.progress.members.find(row=>row.id===actor)||m.progress.members.find(row=>row.id===progress?.assigneeId);
 return {step,progress,unassigned,operations:operations.slice(-12).reverse().map(row=>({...row,actorName:agents.get(row.actorId)?.name||'项目助手'})),current,person,waitingFor:needs.map(id=>m.steps.find(row=>row.id===id)?.title||id),reason:run?.error||(['failed','blocked','stale'].includes(step?.status)?m.project.tasks[step.id]?.reason:null),liveAvailable:live.available===true,liveReason:live.error||live.reason||null,observedAt:live.observedAt||null,allowed:canRunStep(m)};
}
export function observedDocumentChange(before,after){
 if(!after)return null;
 if(!before||before.id!==after.id||before.path!==after.path)return {kind:'initial',changed:false,version:after.version,rows:[],message:after.status==='missing'?'等待此步骤生成实际文件':'已读取当前工作稿'};
 if(before.version===after.version&&before.status===after.status)return null;
 if(typeof before.text!=='string'||typeof after.text!=='string')return {kind:'fingerprint',changed:true,version:after.version,rows:[],message:before.status==='missing'?'已发现新生成的实际文件':'实际文件内容已变化；版式与细节请放大查看'};
 const left=before.text.replaceAll('\r\n','\n').split('\n'),right=after.text.replaceAll('\r\n','\n').split('\n');let prefix=0,suffix=0;while(prefix<left.length&&prefix<right.length&&left[prefix]===right[prefix])prefix++;while(suffix<left.length-prefix&&suffix<right.length-prefix&&left.at(-1-suffix)===right.at(-1-suffix))suffix++;
 const a=left.slice(prefix,left.length-suffix),b=right.slice(prefix,right.length-suffix),rows=[];let added=0,removed=0,truncated=false;
 if((a.length+1)*(b.length+1)<=40000){const lengths=Array.from({length:a.length+1},()=>new Uint16Array(b.length+1));for(let i=a.length-1;i>=0;i--)for(let j=b.length-1;j>=0;j--)lengths[i][j]=a[i]===b[j]?lengths[i+1][j+1]+1:Math.max(lengths[i+1][j],lengths[i][j+1]);let i=0,j=0;while(i<a.length||j<b.length){if(i<a.length&&j<b.length&&a[i]===b[j]){i++;j++;}else if(i<a.length&&(j===b.length||lengths[i+1][j]>=lengths[i][j+1])){removed++;if(rows.length<8)rows.push({type:'remove',line:prefix+i+1,text:a[i].slice(0,250)});i++;}else{added++;if(rows.length<8)rows.push({type:'add',line:prefix+j+1,text:b[j].slice(0,250)});j++;}}truncated=added+removed>8;}
 else{truncated=true;added=null;removed=null;rows.push(...a.slice(0,3).map((text,i)=>({type:'remove',line:prefix+i+1,text:text.slice(0,250)})),...b.slice(0,3).map((text,i)=>({type:'add',line:prefix+i+1,text:text.slice(0,250)})));}
 return {kind:'text',changed:true,version:after.version,added,removed,rows,truncated,message:added===null?'已观察到较大内容变化，以下为变化区域节选':`新增 ${added} 行 · 删除 ${removed} 行${truncated?' · 以下为节选':''}`};
}
