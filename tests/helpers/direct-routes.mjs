import {Readable,Writable} from 'node:stream';
import {createRoutes} from '../../host/routes.js';

/** Real production handlers on owned streams, no DSH host or HTTP listener. */
export function directRoutes(ctx,native,editor){
 const api=createRoutes(ctx,native,editor,{standalone:true});
 return {dispose:api.dispose,async request(path,data,{raw=false,host='127.0.0.1',headers={}}={}){
  const url='/ares/api/v2/'+path,route=api.routes.find(r=>r.path===url.split('?')[0]);if(!route)throw new Error('No production route: '+url);
  const request=Readable.from(data===undefined?[]:[Buffer.from(JSON.stringify(data))]);request.method=data===undefined?'GET':'POST';request.url=url;request.headers={...headers,host,'content-type':'application/json'};request.socket={remoteAddress:'127.0.0.1'};
  const parts=[];let status=200,outputHeaders={},done;const completion=new Promise(resolve=>done=resolve);const response=new Writable({write(chunk,_encoding,callback){parts.push(Buffer.from(chunk));callback();},final(callback){callback();done();}});response.headersSent=false;response.writeHead=(code,values={})=>{status=code;outputHeaders=values;response.headersSent=true;};
  await route.handler(request,response);await completion;const bytes=Buffer.concat(parts);return {status,headers:outputHeaders,body:raw?bytes:JSON.parse(bytes.toString())};
 }};
}
