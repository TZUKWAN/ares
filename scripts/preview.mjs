/** Local verification server, using the actual production route implementation. */
import {createServer} from 'node:http';
import {createRoutes} from '../host/routes.js';

if(!process.env.ARES_HOME)throw new Error('验证服务必须指定独立 ARES_HOME，避免写入用户配置');
const api=createRoutes(undefined,undefined,undefined,{standalone:true}),server=createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store'});res.end('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARES 工作台 · 独立验证环境</title><link rel="stylesheet" href="/ares/api/v2/style.css"><style>html,body,#root{margin:0;height:100%;width:100%;}</style></head><body><div id="root"></div><script type="module">import{mountAres}from"/ares/api/v2/app.js";window.ares=mountAres(document.getElementById("root"));</script></body></html>');return;}
 const route=api.routes.find(r=>r.path===path);if(route)await route.handler(req,res);else{res.writeHead(404);res.end('Not found');}
});
server.listen(Number(process.env.ARES_PORT||0),'127.0.0.1',()=>console.log('ARES_PREVIEW_URL=http://127.0.0.1:'+server.address().port));
process.on('SIGTERM',()=>{api.dispose();server.close();});process.on('SIGINT',()=>{api.dispose();server.close();});
