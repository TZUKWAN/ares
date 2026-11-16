/** Read actual DSH Session identity across the inspect -> active Session API transition.
 * Never builds a header, creates log events, changes preset or weakens admission.
 */
import {AresError} from './storage.js';
export function nativeSessionAvailable(ctx){const controller=ctx.get?.('sessionController');return typeof controller?.inspect==='function'||typeof controller?.resolveAgent==='function'&&typeof ctx.get?.('agents')?.get==='function';}
export async function inspectNativeSession(ctx,sessionId){
 if(typeof sessionId!=='string'||!sessionId||sessionId.length>200)throw new AresError('原生会话标识无效');
 const controller=ctx.get?.('sessionController');if(typeof controller?.inspect==='function')return controller.inspect(sessionId);
 const agents=ctx.get?.('agents');let agent=agents?.get?.(sessionId);
 if(!agent&&typeof controller?.resolveAgent==='function'){const result=await controller.resolveAgent(sessionId);if(result?.error)throw result.error;agent=result?.agent||result;}
 if(!agent||agents?.get?.(sessionId)!==agent||agent.id!==sessionId||agent.session?.header?.id!==sessionId||typeof agent.session.snapshotEvents!=='function')throw new AresError('DSH实际会话身份尚未确认，未构造替代会话',409);
 const events=agent.session.snapshotEvents();if(!Array.isArray(events))throw new AresError('DSH原生会话记录不可读取',503);
 return {meta:{...agent.session.header},events};
}
