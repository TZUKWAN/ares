import {createHash} from 'node:crypto';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
export const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const version='1'.repeat(40),small=Buffer.from('kind,value\nentry,1\nsave,\n'),large=Buffer.alloc(11*1024*1024,0x42);
export const largeHash=digest(large);

export async function datasetFixture(t) {
  const requests=[];
  const server=createServer(async(req,res)=>{
    const pathname=decodeURIComponent(req.url.split('?')[0]);
    let body='';
    for await(const chunk of req)body+=chunk;
    requests.push({pathname,body:body?JSON.parse(body):undefined});
    const respond=value=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
    if(pathname==='/api/datasets')return respond([{id:'research/qa',tags:['license:cc0-1.0']}]);
    if(pathname==='/api/datasets/research/qa')return respond({id:'research/qa',sha:version,cardData:{license:'cc0-1.0'}});
    if(pathname.includes('/tree/'))return respond([
      {type:'file',path:'dataset.csv',size:small.length,oid:createHash('sha1').update('blob '+small.length+'\0').update(small).digest('hex')},
      {type:'file',path:'large.bin',size:large.length,lfs:{oid:largeHash}},
      {type:'file',path:'slow.bin',size:large.length,lfs:{oid:largeHash}},
      {type:'file',path:'bad.bin',size:large.length,lfs:{oid:'2'.repeat(64)}},
      {type:'file',path:'../secrets',size:10}
    ]);
    if(pathname.endsWith('/ListDatasets'))return respond({datasets:[{ref:'research/qa',licenseName:'CC0-1.0',title:'Protocol software test'}]});
    if(pathname.endsWith('/GetDataset'))return respond({ref:'research/qa',currentVersionNumber:3,licenseName:'CC0-1.0'});
    if(pathname.endsWith('/ListDatasetFiles'))return respond({datasetFiles:[{name:'dataset.csv',totalBytes:String(small.length)}]});
    if(pathname.endsWith('/DownloadDatasetRaw')){
      res.writeHead(200,{'content-length':small.length,'x-goog-hash':'crc32c=aaaa,md5='+createHash('md5').update(small).digest('base64')});
      res.end(small);return;
    }
    if(pathname.endsWith('/dataset.csv')){
      res.writeHead(200,{'content-length':small.length});res.end(small);return;
    }
    if(pathname.endsWith('/slow.bin')){
      res.writeHead(200,{'content-length':large.length});
      const increment=setInterval(()=>res.write(large.subarray(0,4096)),70);
      res.once('close',()=>clearInterval(increment));return;
    }
    if(pathname.endsWith('.bin')){
      res.writeHead(200,{'content-length':large.length});res.end(large);return;
    }
    res.writeHead(404);res.end();
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const transport=(_provider,url,{data,signal}={})=>new Promise((resolve,reject)=>{
    const path=new URL(url),out=request({hostname:'127.0.0.1',port:server.address().port,path:path.pathname+path.search,
      method:data===undefined?'GET':'POST',signal},res=>resolve({body:res,headers:res.headers}));
    out.on('error',reject);out.end(data===undefined?undefined:JSON.stringify(data));
  });
  return {transport,requests};
}
