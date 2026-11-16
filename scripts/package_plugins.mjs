/** Private, relocatable Codex/ZCode packages built from one running ARES source. */
import {readFileSync,writeFileSync,readdirSync,mkdirSync,existsSync,lstatSync} from 'node:fs';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createZip} from '../host/zip-archive.js';

const source=fileURLToPath(new URL('../',import.meta.url));
const args=process.argv.slice(2);if(args.length!==2||args[0]!=='--out')throw Error('Usage: node scripts/package_plugins.mjs --out ABSOLUTE_OUTPUT_DIRECTORY');
const output=resolve(args[1]);if(output===resolve(source)||output.startsWith(resolve(source)+sep))throw Error('Choose an artifact directory outside the running plugin');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const excluded=new Set(['node_modules','.git','.claude','__pycache__']);
function descendants(directory){const values=[];for(const row of readdirSync(directory,{withFileTypes:true})){if(excluded.has(row.name))continue;const path=join(directory,row.name);if(row.isSymbolicLink())throw Error('Refusing package symlink: '+path);if(row.isDirectory())values.push(...descendants(path));else if(row.isFile())values.push(path);}return values;}
const common=new Map();
for(const directory of ['host','client','assets','data','skills','scripts','platforms/shared','platforms/ui','platforms/ui-tools','platforms/packaging','platforms/skills'])for(const path of descendants(join(source,directory))){const name=relative(source,path).replaceAll('\\','/');if(name.endsWith('.test.mjs'))continue;common.set(name,readFileSync(path));}
for(const path of ['platforms/ui-server.mjs'])common.set(path,readFileSync(join(source,path)));
for(const path of ['LICENSE','LICENSE.md','LICENSE.txt'])if(existsSync(join(source,path)))common.set(path,readFileSync(join(source,path)));
common.set('skills/ares/SKILL.md',readFileSync(join(source,'platforms/skills/ares/SKILL.md')));
common.set('README.md',readFileSync(join(source,'platforms/packaging/README.md')));
common.set('package.json',Buffer.from(JSON.stringify({name:'ares-portable',version:'2.4.0',private:true,type:'module',engines:{node:'>=20'}},null,2)+'\n'));
const notices=`# ARES local package notices\n\nThis package reuses the running ARES business sources. Native model execution is provided by the current host.\n\nReference animations and media: assets/neural-reference/LICENSE and NOTICE.md (PolyForm Noncommercial and recorded legacy MIT exceptions). Do not describe the full package as unrestricted commercial MIT software. This build is for private local use; it was not submitted or publicly published.\n\nMCP server SDK and dependencies: platforms/shared/vendor/THIRD_PARTY.json and included license files. MCP Apps page SDK and bundled dependencies: platforms/ui/THIRD_PARTY.json and platforms/ui/licenses/. Build-only tools are pinned in platforms/ui-tools/package-lock.json.\n`;
common.set('PORTABLE_NOTICES.md',Buffer.from(notices));
const essential=['scripts/ares-mcp.mjs','platforms/shared/vendor/mcp-sdk.mjs','platforms/ui/workbench.html','platforms/ui/THIRD_PARTY.json','assets/portable/ares-icon.svg'];for(const path of essential)if(!common.has(path))throw Error('Missing built runtime: '+path);
mkdirSync(output,{recursive:true});
const packages=[];
function writePackage(host){
 const marketplace=join(output,host+'-marketplace'),target=join(marketplace,'ares'),files=new Map(common);
 const manifest=JSON.parse(readFileSync(join(source,'platforms/packaging/'+host+'-plugin.json'),'utf8'));
 const selfMarket={name:'ares-local-'+host,owner:{name:'TZUKWAN'},...(host==='codex'?{interface:{displayName:'ARES · Codex 本地插件'}}:{}),plugins:[host==='codex'?{name:'ares',source:{source:'local',path:'./'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}:{name:'ares',source:'./',version:manifest.version,description:manifest.description,category:'productivity'}]};
 files.set('.'+host+'-plugin/plugin.json',Buffer.from(JSON.stringify(manifest,null,2)+'\n'));
 files.set(host==='codex'?'.agents/plugins/marketplace.json':'.zcode-plugin/marketplace.json',Buffer.from(JSON.stringify(selfMarket,null,2)+'\n'));
 files.set('marketplace.json',Buffer.from(JSON.stringify(selfMarket,null,2)+'\n'));
 if(host==='codex')files.set('.mcp.json',readFileSync(join(source,'platforms/packaging/codex-mcp.json')));
 else files.set('commands/ares.md',readFileSync(join(source,'platforms/packaging/ares-command.md')));
 const names=[...files.keys()].sort();
 if(existsSync(join(target,'PACKAGE_FILES.json'))){const previous=JSON.parse(readFileSync(join(target,'PACKAGE_FILES.json'),'utf8'));for(const [name,digest]of Object.entries(previous.files)){const path=resolve(target,name);if(!path.startsWith(resolve(target)+sep))throw Error('Invalid previous package path');if(existsSync(path)&&sha(readFileSync(path))!==digest)throw Error('Generated package was edited; choose a new output directory: '+path);}const removed=Object.keys(previous.files).filter(name=>!files.has(name));if(removed.length)throw Error('Package sources removed; use a fresh output directory to avoid stale artifacts: '+removed.join(','));}
 else if(existsSync(target)&&readdirSync(target).length)throw Error('Refusing to overwrite an unrecognized output directory: '+target);
 for(const [name,bytes]of files){const path=resolve(target,name);if(!path.startsWith(resolve(target)+sep)||lstatSync(dirname(path),{throwIfNoEntry:false})?.isSymbolicLink())throw Error('Package destination escapes its root');mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
 const manifestFiles=Object.fromEntries(names.map(name=>[name,sha(files.get(name))]));
 const receipt={host,version:manifest.version,files:manifestFiles,server:'scripts/ares-mcp.mjs',sourceShared:true};
 writeFileSync(join(target,'PACKAGE_FILES.json'),JSON.stringify(receipt,null,2)+'\n');
 const zipEntries=names.map(name=>({name:'ares/'+name,bytes:files.get(name)}));zipEntries.push({name:'ares/PACKAGE_FILES.json',bytes:readFileSync(join(target,'PACKAGE_FILES.json'))});
 const archive=createZip(zipEntries),zip=join(output,'ARES-'+(host==='codex'?'Codex':'ZCode')+'-2.4.0.zip');writeFileSync(zip,archive);
 const market={name:'ares-local-'+host,owner:{name:'TZUKWAN'},...(host==='codex'?{interface:{displayName:'ARES · Codex 本地插件'}}:{}),plugins:[host==='codex'?{name:'ares',source:{source:'local',path:'./ares'},policy:{installation:'AVAILABLE',authentication:'ON_INSTALL'},category:'Productivity'}:{name:'ares',source:'./ares',version:manifest.version,description:manifest.description,category:'productivity'}]};
 const marketPath=host==='codex'?join(marketplace,'.agents/plugins/marketplace.json'):join(marketplace,'.zcode-plugin/marketplace.json');mkdirSync(dirname(marketPath),{recursive:true});writeFileSync(marketPath,JSON.stringify(market,null,2)+'\n');
 if(host==='zcode')writeFileSync(join(marketplace,'marketplace.json'),JSON.stringify(market,null,2)+'\n');
 for(const [name,digest]of Object.entries(manifestFiles))if(sha(readFileSync(join(target,name)))!==digest)throw Error('Package readback failed: '+name);
 packages.push({host,root:target,marketplace,marketplaceManifest:marketPath,zip,zipBytes:archive.length,zipSha256:sha(archive),files:names.length});
}
writePackage('codex');writePackage('zcode');
writeFileSync(join(output,'packages.json'),JSON.stringify({version:'2.4.0',packages},null,2)+'\n');
console.log(JSON.stringify({output,packages}));
