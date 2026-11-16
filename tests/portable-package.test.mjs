/** Real ZIP bytes, independently checked by Python zipfile, and real official
 * MCP SDK clients starting the extracted manifest commands. No npm install,
 * model prompt, cloud write, user DSH state or user's window is involved. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,realpathSync} from 'node:fs';
import {join,resolve,basename,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {Client} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/index.mjs';
import {StdioClientTransport} from '../platforms/shared/node_modules/@modelcontextprotocol/client/dist/stdio.mjs';

const output=process.env.ARES_PACKAGE_OUTPUT||'C:/Users/lauze/Documents/Codex/2026-11-02/c/outputs/ARES-跨平台插件-20261113';
const evidence=mkdtempSync(join(process.env.ARES_TEST_ROOT||tmpdir(),'ares-包重定位 验证-'));
const sha=value=>createHash('sha256').update(value).digest('hex'),canonical=path=>resolve(path).toLowerCase();
const readJson=path=>JSON.parse(readFileSync(path,'utf8'));

// Independent standard-library ZIP validation, before creating any extracted
// file. No archive member may escape the owned directory or alias another name.
const extractScript=String.raw`
import json, os, pathlib, stat, sys, zipfile
archive, target = sys.argv[1:]
base = pathlib.Path(target).resolve()
forbidden = {'node_modules', '.git', '.claude', '.dsh', '.codex', '.ssh', '__pycache__'}
secret_names = {'.env', '.env.local', '.env.production', '.npmrc', '.netrc', 'id_rsa', 'id_ed25519', 'credentials.json', 'auth.json', 'token.json'}
with zipfile.ZipFile(archive) as z:
    entries = z.infolist()
    assert 0 < len(entries) <= 2000, 'Unexpected archive entry count'
    assert sum(i.file_size for i in entries) <= 128 * 1024 * 1024, 'Unbounded extracted archive'
    seen = set()
    for i in entries:
        n = i.filename
        assert not i.is_dir() and n.startswith('ares/'), 'Unexpected archive root'
        parts = n.split('/')
        assert chr(92) not in n and chr(0) not in n and all(p and p not in ('.', '..') for p in parts), 'Unsafe archive path'
        assert all(not p.endswith((' ', '.')) and not any(c in p for c in ':<>"|?*') for p in parts), 'Ambiguous Windows archive path'
        assert n.casefold() not in seen, 'Case-insensitive archive alias'
        seen.add(n.casefold())
        assert not (set(p.casefold() for p in parts) & forbidden), 'Sensitive or dependency directory in archive'
        assert parts[-1].casefold() not in secret_names, 'Credential/config file in archive'
        assert not (i.flag_bits & 1), 'Encrypted archive entry'
        assert stat.S_IFMT(i.external_attr >> 16) != stat.S_IFLNK, 'Archive symlink'
        pathlib.Path(base, *parts).resolve().relative_to(base)
    bad = z.testzip()
    assert bad is None, 'CRC validation failed: ' + str(bad)
    z.extractall(base)
    print(json.dumps({'crcChecked':len(entries), 'entries':[{'name':i.filename,'bytes':i.file_size,'crc32':format(i.CRC,'08x')} for i in entries]}, ensure_ascii=True))
`;

function extracted(record,host){
 const archive=join(output,basename(record.zip)),bytes=readFileSync(archive);
 assert.equal(sha(bytes),record.zipSha256);assert.equal(bytes.length,record.zipBytes);
 const directory=join(evidence,host+' 已解压 插件');mkdirSync(directory);
 const audit=JSON.parse(execFileSync('python',['-c',extractScript,archive,directory],{encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,env:{...process.env,PYTHONIOENCODING:'utf-8'}}));
 const root=realpathSync(join(directory,'ares')),files=readJson(join(root,'PACKAGE_FILES.json'));
 assert.equal(files.host,host);assert.ok(Object.keys(files.files).length>100);
 assert.deepEqual(audit.entries.map(row=>row.name.slice('ares/'.length)).sort(),[...Object.keys(files.files),'PACKAGE_FILES.json'].sort());
 for(const [name,digest]of Object.entries(files.files)){
  assert.match(digest,/^[a-f0-9]{64}$/);const path=resolve(root,name);assert.ok(canonical(path).startsWith(canonical(root)+sep));
  assert.equal(sha(readFileSync(path)),digest,'Extracted PACKAGE_FILES mismatch: '+name);
 }
 assert.equal(existsSync(join(root,'node_modules')),false);assert.equal(existsSync(join(root,'platforms/shared/node_modules')),false);assert.equal(existsSync(join(root,'platforms/ui-tools/node_modules')),false);
 return {root,files,audit,zip:{path:archive,bytes:bytes.length,sha256:sha(bytes)}};
}

function manifestLaunch(packageRoot,host,projectRoot,dataHome){
 const manifest=readJson(join(packageRoot,'.'+host+'-plugin','plugin.json'));
 const servers=typeof manifest.mcpServers==='string'?readJson(resolve(packageRoot,manifest.mcpServers)).mcpServers:manifest.mcpServers;
 assert.ok(servers?.ares);const config=servers.ares;
 const variables={PLUGIN_ROOT:packageRoot,ZCODE_PLUGIN_ROOT:packageRoot,ZCODE_PROJECT_DIR:projectRoot,ZCODE_PLUGIN_DATA:dataHome};
 function expand(value){assert.equal(typeof value,'string');const result=value.replace(/\$\{([^}]+)\}/g,(_match,key)=>{assert.ok(Object.hasOwn(variables,key),'Unknown manifest placeholder '+key);return variables[key];});assert.equal(/\$\{/.test(result),false);return result;}
 const launch={command:expand(config.command),args:config.args.map(expand),cwd:expand(config.cwd),env:Object.fromEntries(Object.entries(config.env||{}).map(([key,value])=>[key,expand(value)]))};
 assert.equal(canonical(launch.args[0]),canonical(join(packageRoot,'scripts/ares-mcp.mjs')));
 assert.equal(canonical(launch.cwd),canonical(host==='codex'?packageRoot:projectRoot));
 return {manifest,launch};
}

async function runtime(packageRoot,host,projectRoot,dataHome,auditRoot){
 const {manifest,launch}=manifestLaunch(packageRoot,host,projectRoot,dataHome);
 const checkerLog=join(auditRoot,'checker-invocations.jsonl');
 // Record the real Python script path without changing its input, stdout,
 // return value, files or acceptance behavior. The package remains untouched.
 writeFileSync(join(auditRoot,'sitecustomize.py'),"import json, os, sys\nif sys.argv and os.path.basename(sys.argv[0]) == 'inspect_artifact.py':\n    with open(os.environ['ARES_CHECKER_AUDIT'], 'a', encoding='utf-8') as stream:\n        stream.write(json.dumps({'script':os.path.realpath(sys.argv[0])}, ensure_ascii=True)+'\\n')\n");
 const env={...process.env,...launch.env,ARES_HOME:dataHome,PYTHONPATH:auditRoot,ARES_CHECKER_AUDIT:checkerLog,PYTHONIOENCODING:'utf-8'};
 delete env.DSH_HOME;delete env.ARES_ALLOWED_ROOTS;delete env.NODE_PATH;delete env.NODE_OPTIONS;
 let rootsRequests=0,stderr='';
 const client=new Client({name:'ares-extracted-package-protocol-test',version:'1.0.0'},{capabilities:host==='codex'?{roots:{listChanged:true}}:{}});
 if(host==='codex')client.setRequestHandler('roots/list',async()=>{rootsRequests++;return {roots:[{uri:pathToFileURL(projectRoot).href,name:'自有中文 空格项目'}]};});
 const transport=new StdioClientTransport({...launch,env,stderr:'pipe'});transport.stderr?.on('data',chunk=>stderr+=chunk);
 await client.connect(transport);
 return {client,manifest,launch,checkerLog,get rootsRequests(){return rootsRequests;},get stderr(){return stderr;},async call(name,args){
  const response=await client.callTool({name,arguments:args}),value=response.structuredContent??JSON.parse(response.content.filter(row=>row.type==='text').map(row=>row.text).join('\n'));
  assert.notEqual(response.isError,true,JSON.stringify(value));return value;
 }};
}

test('both final ZIPs run from their actual relocated manifests without node_modules and use the extracted checker and UI resources',{timeout:120000},async()=>{
 const metadata=readJson(join(output,'packages.json')),receipts=[];
 try{
  for(const host of ['codex','zcode']){
   const record=metadata.packages.find(row=>row.host===host);assert.ok(record);
   const pkg=extracted(record,host),projectRoot=join(evidence,host+' 真实 项目'),dataHome=join(evidence,host+' 临时 数据'),auditRoot=join(evidence,host+' checker audit');
   mkdirSync(projectRoot);mkdirSync(dataHome);mkdirSync(auditRoot);
   const s=await runtime(pkg.root,host,projectRoot,dataHome,auditRoot);
   try{
    const tools=await s.client.listTools();for(const name of ['ares_catalog','ares_workflow','ares_project','ares_workbench'])assert.ok(tools.tools.some(row=>row.name===name));
    assert.equal(s.client.getServerVersion().version,pkg.files.version);
    const caps=await s.call('ares_capabilities',{});assert.equal(canonical(caps.home),canonical(dataHome));assert.deepEqual(caps.roots.map(canonical),[canonical(projectRoot)]);if(host==='codex')assert.ok(s.rootsRequests>0);
    const catalog=await s.call('ares_catalog',{action:'summary'});assert.equal(catalog.competitions.length,132);
    const competition=catalog.competitions.find(row=>row.id===5),scope={competitionId:competition.id,track:competition.tracks.find(row=>!row.legacy).track,edition:'2026',group:''};
    const opened=await s.call('ares_workflow',{action:'read',...scope}),workflow=structuredClone(opened.workflow);workflow.steps[0].title='解压包实际检查器验证 · '+host;
    const saved=await s.call('ares_workflow',{action:'save',...scope,workflow,configuration:opened.configuration,expectedRevision:opened.expectedRevision,expectedWorkflowHash:opened.workflowHash,expectedSkillHashes:opened.skillHashes});assert.equal(saved.saved,true);
    const project=await s.call('ares_project',{action:'init',root:projectRoot,name:'解压包重定位 软件验证 '+host,...scope,flowMode:'library',workflowId:saved.workflow.id,expectedWorkflowHash:saved.workflowHash,expectedConfigurationRevision:saved.expectedRevision});
    assert.equal(project.workflow.steps[0].title,workflow.steps[0].title);
    const step=project.workflow.steps[0],outputFile=step.outputs.find(row=>row.kind==='file'&&row.format==='md');assert.ok(outputFile);
    const artifactPath=join(projectRoot,project.outputDir,outputFile.path);mkdirSync(dirname(artifactPath),{recursive:true});
    const body='# 解压包真实软件检查\n\n此文件由本次本地软件验收写入，仅确认原检查器在中文与空格路径正常执行。\n\n不是调查样本、赛事结论、模型执行或人工验收记录。\n';writeFileSync(artifactPath,body);
    const checked=await s.call('ares_project',{action:'check',root:projectRoot,stepId:step.id});assert.equal(checked.passed,true,JSON.stringify(checked));assert.equal(checked.checks.find(row=>row.id===outputFile.id).sha256,sha(body));
    assert.ok(existsSync(s.checkerLog),'The real native Python inspector must have run');const checkerCalls=readFileSync(s.checkerLog,'utf8').trim().split(/\r?\n/).map(JSON.parse);
    assert.ok(checkerCalls.length>0);assert.ok(checkerCalls.every(row=>canonical(row.script)===canonical(join(pkg.root,'scripts/inspect_artifact.py'))),'Checker ROOT comes from the extracted package, not the development checkout');
    const current=await s.call('ares_project',{action:'status',root:projectRoot});assert.equal(current.progress.done,0);
    const html=await s.client.readResource({uri:'ui://ares/workbench.html'}),page=html.contents.find(row=>typeof row.text==='string');assert.equal(page.mimeType,'text/html;profile=mcp-app');assert.equal(sha(page.text),pkg.files.files['platforms/ui/workbench.html']);
    const indexResponse=await s.client.readResource({uri:'ares://media/index'}),index=JSON.parse(indexResponse.contents[0].text);assert.equal(index.files.length,4);
    const media=index.files[0],chunk=await s.client.readResource({uri:media.chunks[0]}),part=Buffer.from(chunk.contents[0].blob,'base64');assert.ok(part.length>0&&part.length<=512*1024);assert.equal(sha(part),sha(readFileSync(join(pkg.root,'assets/neural-reference',media.file)).subarray(0,part.length)));
    assert.equal(s.stderr,'');
    receipts.push({host,manifestVersion:s.manifest.version,zip:pkg.zip,extractedRoot:pkg.root,manifestLaunch:s.launch,home:caps.home,roots:caps.roots,rootsRequests:s.rootsRequests,zipEntryCrcs:pkg.audit.entries,packageFilesVerified:Object.keys(pkg.files.files).length,nodeModulesPresent:false,competitionCount:catalog.competitions.length,workflowId:saved.workflow.id,projectId:project.id,artifactPath,checks:checked,checkerCalls,html:{sha256:sha(page.text),bytes:Buffer.byteLength(page.text)},media:{file:media.file,chunkBytes:part.length,sha256:sha(part)},stderr:s.stderr});
   }finally{await s.client.close();}
   for(const [name,digest]of Object.entries(pkg.files.files))assert.equal(sha(readFileSync(join(pkg.root,name))),digest,'Runtime modified a packaged source file: '+name);
   receipts.at(-1).packageFilesUnchangedAfterRuntime=true;
  }
  writeFileSync(join(evidence,'portable-package-receipt.json'),JSON.stringify({mode:'Real final archive extraction, standard-library CRC, PACKAGE_FILES SHA, actual manifests and official MCP stdio clients. No dependency install, model/cloud call or desktop control.',packages:receipts},null,2));console.log('PORTABLE_PACKAGE_EVIDENCE',evidence);
 }catch(error){writeFileSync(join(evidence,'failure.json'),JSON.stringify({message:error.message,completed:receipts},null,2));console.log('PORTABLE_PACKAGE_FAILURE',evidence);throw error;}
});
