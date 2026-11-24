/** Observe only the native review stream for this genuine diagnostic turn.
 * No model is requested here, no decision is replaced, and all chunks pass unchanged. */
export function observeNativeAutoReviews(ctx,agent,requestId){
 const reviews=[];
 const stop=ctx.on('llm/stream',(options,next)=>{
  if(options?.purpose!=='auto-review'||options.sessionId!==agent.id)return next();
  const events=agent.session.snapshotEvents(),start=events.filter(row=>row.type==='turn/start').at(-1);
  if(!start||!events.some(row=>row.seq>start.seq&&row.type==='user/message'&&row.data?.source?.rpcId===requestId))return next();
  let pending;try{pending=JSON.parse(options.messages?.at(-1)?.content?.filter(x=>x.type==='text').map(x=>x.text).join(''));}catch{}
  const normalize=value=>{try{return typeof value==='string'?JSON.parse(value):value;}catch{return value;}};
  const calls=events.filter(row=>row.seq>start.seq&&['tool/call','tool/ptc-dispatch-start'].includes(row.type)&&row.data?.name===pending?.name&&JSON.stringify(normalize(row.data.arguments))===JSON.stringify(normalize(pending.arguments)));
  const call=calls.at(-1),record={callId:call?.data.callId||call?.data.subCallId,callSeq:call?.seq,name:pending?.name,provider:options.provider,model:options.model,turn:start.data.turn,startedAt:new Date().toISOString(),status:'running'};
  reviews.push(record);let stream;try{stream=next();}catch(error){record.status='failed';throw error;}
  return (async function*(){let text='',finish;try{for await(const chunk of stream){if(chunk.type==='text-delta'&&text.length<4096)text+=chunk.text;if(chunk.type==='finish')finish=chunk.reason?.kind;yield chunk;}
   record.finish=finish;let decision;try{decision=JSON.parse(text);}catch{}
   if(decision&&['low','medium','high'].includes(decision.risk)&&['allow','deny'].includes(decision.decision)&&!(decision.risk==='high'&&decision.decision==='allow')){record.risk=decision.risk;record.decision=decision.decision;}
   record.status=finish==='stop'&&record.decision?'completed':'failed';
  }catch(error){record.status='failed';throw error;}finally{record.finishedAt=new Date().toISOString();if(record.status==='running')record.status='incomplete';}})();
 });
 return {reviews,stop};
}
export function actualAutoReviewsPassed(calls,reviews,presentation){
 const required=calls.filter(row=>row.name!=='run_code'||presentation!=='ptc');
 return required.length>0&&required.every(call=>reviews.some(review=>review.callId===call.callId&&review.callSeq===call.callSeq&&review.name===call.name&&review.status==='completed'&&review.finish==='stop'&&review.decision==='allow'&&review.provider&&review.model));
}
