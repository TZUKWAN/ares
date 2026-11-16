import {AresError} from './storage.js';

export function admitOwner(ctx,request,{standalone=false}={}){
 if(standalone){
  const address=request.socket?.remoteAddress;
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(address))throw new AresError('独立开发预览仅接受本机连接',403);
  return {kind:'standalone-local-preview'};
 }
 const connection=ctx.get?.('connection');
 if(typeof connection?.admit!=='function')throw new AresError('DSH原生认证服务尚未就绪',503);
 const admission=connection.admit(request);
 if(!admission||'rejection' in admission)throw new AresError('需要DSH身份认证',admission?.rejection||401);
 if(admission.peer?.principal?.kind!=='owner')throw new AresError('ARES配置和项目操作仅限DSH所有者',403);
 return admission.peer;
}
