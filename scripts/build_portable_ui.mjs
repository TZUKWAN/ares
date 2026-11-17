/** Self-contained MCP Apps HTML; original media travels in bounded MCP resources. */
import {build} from '../platforms/ui-tools/node_modules/esbuild/lib/main.js';
import {readFileSync,writeFileSync,existsSync,mkdirSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join,dirname,resolve,relative,basename} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),check=process.argv.includes('--check');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const readText=path=>readFileSync(path,'utf8').replace(/\r\n?/g,'\n');
const files=['orb.mp4','orb.jpg','jellyfish.mp4','jellyfish.jpg'],source=readFileSync(join(root,'client/workshop-scene.js'),'utf8');
let sceneSource=source;
for(const file of files){
 const bytes=readFileSync(join(root,'assets/neural-reference',file)),url='data:'+(file.endsWith('.mp4')?'video/mp4':'image/jpeg')+';base64,'+bytes.toString('base64');let found=0;
 for(const quote of ["'",'"']){const needle=quote+url+quote;if(sceneSource.includes(needle)){sceneSource=sceneSource.replaceAll(needle,'globalThis.__ARES_PORTABLE_MEDIA__['+JSON.stringify(file)+']');found++;}}
 if(found!==1)throw Error('Expected exactly one pinned media reference: '+file);
}
const result=await build({absWorkingDir:root,entryPoints:[join(root,'platforms/ui/client.mjs')],bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',legalComments:'inline',minify:false,metafile:true,
 alias:{'@modelcontextprotocol/ext-apps':join(root,'platforms/ui-tools/node_modules/@modelcontextprotocol/ext-apps/dist/src/app.js')},
 plugins:[{name:'ares-local-media',setup(api){api.onLoad({filter:/[\\/]client[\\/]workshop-scene\.js$/},()=>({contents:sceneSource,loader:'js',resolveDir:join(root,'client')}));}}],
});
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)){
 if(!input.replaceAll('\\','/').includes('node_modules/'))continue;
 let directory=dirname(resolve(root,input));
 while(directory.includes('node_modules')){
  const config=join(directory,'package.json');
  if(existsSync(config)){const metadata=JSON.parse(readFileSync(config,'utf8'));if(metadata.name&&metadata.version){packages.set(metadata.name+'@'+metadata.version,{directory,metadata});break;}}
  const parent=dirname(directory);if(parent===directory)break;directory=parent;
 }
}
const licenses=[];
for(const [key,{directory,metadata}]of [...packages].sort(([a],[b])=>a.localeCompare(b))){
 const sources=readdirSync(directory).filter(name=>/^(LICENSE|LICENCE|COPYING)(\.|$)/i.test(name));
 if(!sources.length)throw Error('Missing bundled dependency license: '+key);
 for(const name of sources){const bytes=readFileSync(join(directory,name)),target=join(root,'platforms/ui/licenses',key.replace(/[^a-z0-9._-]/gi,'_')+'-'+basename(name));if(check){if(!existsSync(target)||sha(readFileSync(target))!==sha(bytes))throw Error('Stale bundled license: '+key);}else{mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);}licenses.push({name:metadata.name,version:metadata.version,license:metadata.license||null,path:relative(root,target).replaceAll('\\','/'),sha256:sha(bytes)});}
}
const licenseManifest=JSON.stringify(licenses,null,2)+'\n',licenseTarget=join(root,'platforms/ui/THIRD_PARTY.json');
if(check){if(readFileSync(licenseTarget,'utf8')!==licenseManifest)throw Error('Stale page license manifest');}else writeFileSync(licenseTarget,licenseManifest);
const css=readText(join(root,'client/style.css'))+'\n'+readText(join(root,'client/workshop.css'))+'\n'+readText(join(root,'platforms/ui/portable.css'));
const script=result.outputFiles[0].text.replaceAll('</script','<\\/script');
const html='<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ARES</title><style>'+css.replaceAll('</style','<\\/style')+'</style></head><body><div id="app"></div><script>'+script+'</script></body></html>\n';
const target=join(root,'platforms/ui/workbench.html');
if(check){if(readFileSync(target,'utf8')!==html)throw Error('Stale portable UI; run node scripts/build_portable_ui.mjs');}else writeFileSync(target,html);
const receipt={mode:check?'verified':'built',htmlBytes:Buffer.byteLength(html),htmlSha256:sha(html),sceneInputSha256:sha(source),mediaAreSeparateBoundedResources:true,media:files.map(file=>{const bytes=readFileSync(join(root,'assets/neural-reference',file));return{file,bytes:bytes.length,sha256:sha(bytes)};}),pageSdk:'@modelcontextprotocol/ext-apps@2.0.0',compiler:'esbuild@0.28.2'};
const receiptText=JSON.stringify({...receipt,mode:'built'},null,2)+'\n',receiptPath=join(root,'platforms/ui/build-receipt.json');
if(check){if(readFileSync(receiptPath,'utf8')!==receiptText)throw Error('Stale portable build receipt; rebuild the page and receipt together');}
else writeFileSync(receiptPath,receiptText);
console.log(JSON.stringify(receipt));
