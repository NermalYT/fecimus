import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {createServiceMaintenance,callServiceTool} from '../src/service-maintenance.mjs';
const exec=promisify(execFile), repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const packageFiles=version=>({'package.json':JSON.stringify({name:'fecimus-fixture',version,type:'module',dependencies:{}}),'package-lock.json':JSON.stringify({name:'fecimus-fixture',version,lockfileVersion:3,packages:{'':{name:'fecimus-fixture',version,dependencies:{}}}})});
async function fixture(t){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'fecimus-maintenance-test-')), root=path.join(temporary,'source'),dataDir=path.join(temporary,'data');
 const files={...packageFiles('3.0.0'),'README.md':'original readme\n','LICENSE':'fixture','src/server.mjs':'export const fixture = 1;\n','src/custom.mjs':'export const custom = 1;\n','scripts/install.sh':'#!/bin/sh\n','scripts/install.ps1':'# fixture\n','scripts/package-release.py':await fs.readFile(path.join(repo,'scripts/package-release.py'),'utf8'),'platform/Linux/README.md':'Linux\n','platform/Linux/INSTALL_FECIMUS.sh':'#!/bin/sh\n','platform/Windows/README.md':'Windows\n','platform/Windows/INSTALL_FECIMUS.cmd':'@echo off\n','addons/README.md':'Public addon index\n'};
 for(const [name,content] of Object.entries(files)){const target=path.join(root,name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,content,{mode:0o644});}
 const baseline={format:1,project:'fecimus',version:'3.0.0',files:Object.entries(files).map(([name,content])=>({path:name,size:Buffer.byteLength(content),sha256:hash(content),mode:0o644}))};
 await fs.writeFile(path.join(root,'SOURCE_MANIFEST.json'),JSON.stringify(baseline));
 t.after(()=>fs.rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:50}));
 const make=options=>createServiceMaintenance({root,dataDir,...options});
 return {temporary,root,dataDir,files,make,manager:make()};
}
async function archive(f,changes={},platform='linux'){
 const files={...f.files,...packageFiles('3.0.1'),...changes};
 const input=path.join(f.temporary,'archive-input.json'),output=path.join(f.temporary,'release.tar.gz');
 await fs.writeFile(input,JSON.stringify(files));
 const program="import importlib.util,pathlib,json,sys\nspec=importlib.util.spec_from_file_location('v',sys.argv[1]);v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)\nf={k:(s.encode(),420) for k,s in json.loads(pathlib.Path(sys.argv[2]).read_text()).items()}\np=sys.argv[4];label=v.PLATFORMS[p][0];kind=v.PLATFORMS[p][3];r=v.release_files(f,p,'3.0.1');pathlib.Path(sys.argv[3]).write_bytes(v.pack(r,'Fecimus-3.0.1-'+label,kind))";
 await exec('python3',['-I','-c',program,path.join(repo,'scripts/package-release.py'),input,output,platform],{timeout:10000});
 return fs.readFile(output);
}
function releaseFetch(bytes,requests=[]){return async(url,options)=>{requests.push({url,options});return url.endsWith('/SHA256SUMS')?new Response(hash(bytes)+'  Fecimus-3.0.1-Linux-Ubuntu-LTS.tar.gz\n'):new Response(bytes);};}

test('private backups persist, preserve edits on stale restore and recover the exact source',async t=>{
 const f=await fixture(t);await fs.writeFile(path.join(f.root,'.env'),'private');await fs.mkdir(path.join(f.root,'node_modules'));await fs.writeFile(path.join(f.root,'node_modules','secret.json'),'private');
 const original=f.manager.status(),backup=await f.manager.run({action:'backup',label:'before customization'});
 assert.equal(f.make().status().backups[0],backup.backup_id);
 const record=JSON.parse(await fs.readFile(path.join(backup.path,'record.json'),'utf8'));
 assert(record.files.some(file=>file.path==='addons/README.md'));assert(!record.files.some(file=>file.path.includes('secret')||file.path==='.env'));
 await fs.writeFile(path.join(f.root,'src/custom.mjs'),'export const custom = 42;');
 await assert.rejects(f.manager.run({action:'restore',backup_id:backup.backup_id,expected_revision:original.source_revision}),/revision conflict/);
 const changed=f.manager.status();assert(changed.modifications.modified.includes('src/custom.mjs'));
 const restored=await f.manager.run({action:'restore',backup_id:backup.backup_id,expected_revision:changed.source_revision});
 assert(restored.restart_required);assert(restored.safety_backup);assert.equal(restored.dependency_review_required,false);
 assert.equal(await fs.readFile(path.join(f.root,'src/custom.mjs'),'utf8'),f.files['src/custom.mjs']);
 assert.equal(await fs.readFile(path.join(f.root,'.env'),'utf8'),'private');
 if(process.platform!=='win32')assert.equal((await fs.stat(path.join(backup.path,'record.json'))).mode&0o777,0o600);
});
test('check parses source without executing it and reports syntax/package failures',async t=>{
 const f=await fixture(t),marker=path.join(f.temporary,'must-not-run');
 await fs.writeFile(path.join(f.root,'src/server.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'ran');`);
 assert((await f.manager.run({action:'check'})).passed);await assert.rejects(fs.access(marker),{code:'ENOENT'});
 await fs.writeFile(path.join(f.root,'src/server.mjs'),'export const = ;');
 const result=await callServiceTool('fecimus_service',{action:'check'},f.manager);assert(result.isError);
 const report=JSON.parse(result.content[0].text);assert(report.failures.some(item=>item.path==='src/server.mjs'));
});
test('cancelled operations and stale writer locks cannot mutate source',async t=>{
 const f=await fixture(t),controller=new AbortController();controller.abort();
 await assert.rejects(f.manager.run({action:'backup'},controller.signal),/cancelled/);
 await fs.mkdir(path.join(f.dataDir,'maintenance'),{recursive:true});await fs.writeFile(path.join(f.dataDir,'maintenance','writer.lock'),'fixture lock');
 await assert.rejects(f.manager.run({action:'backup'}),/writer lock/);assert.equal(f.manager.status().backups.length,0);
 await assert.rejects(f.manager.run({action:'restore',backup_id:'../../escape',expected_revision:'0'.repeat(64)}),/Invalid/);
});
test('source symlinks and tampered backup contents are rejected',async t=>{
 const f=await fixture(t),backup=await f.manager.run({action:'backup'});
 await fs.writeFile(path.join(backup.path,'source','src/server.mjs'),'tampered');
 await assert.rejects(f.manager.run({action:'restore',backup_id:backup.backup_id,expected_revision:f.manager.status().source_revision}),/checksum/);
 if(process.platform!=='win32'){
  const outside=path.join(f.temporary,'outside.mjs');await fs.writeFile(outside,'outside');await fs.symlink(outside,path.join(f.root,'src/link.mjs'));
  assert.throws(()=>f.manager.status(),/symbolic/);
 }
});
test('official prepare verifies the real archive format and apply preserves unchanged-upstream customization',{skip:process.platform!=='linux'},async t=>{
 const f=await fixture(t),bytes=await archive(f,{'README.md':'new official readme\n'}),requests=[];
 const manager=f.make({fetchImpl:releaseFetch(bytes,requests)});
 await fs.writeFile(path.join(f.root,'src/custom.mjs'),'export const custom = 42;\n');
 const stage=await manager.run({action:'prepare',version:'3.0.1'});assert(stage.verified);assert.equal(manager.status().version,'3.0.0');
 assert.equal(requests.length,2);assert(requests.every(r=>r.url.startsWith('https://github.com/NermalYT/fecimus/releases/download/v3.0.1/')&&r.options.redirect==='manual'&&!r.options.headers.Authorization));
 const applied=await manager.run({action:'apply',stage_id:stage.stage_id,expected_revision:manager.status().source_revision});
 assert(applied.applied);assert(applied.preserved_local_changes.includes('src/custom.mjs'));assert(applied.safety_backup);
 assert.equal(manager.status().version,'3.0.1');assert.equal(await fs.readFile(path.join(f.root,'README.md'),'utf8'),'new official readme\n');
 assert.equal(await fs.readFile(path.join(f.root,'src/custom.mjs'),'utf8'),'export const custom = 42;\n');
 assert(manager.status().modifications.modified.includes('src/custom.mjs'));
});
test('upstream/local conflicts, dependency changes and tampered stages never overwrite current files',{skip:process.platform!=='linux'},async t=>{
 const f=await fixture(t);let bytes=await archive(f,{'README.md':'upstream edit'});const manager=f.make({fetchImpl:async(url,options)=>releaseFetch(bytes)(url,options)});
 await fs.writeFile(path.join(f.root,'README.md'),'local edit');
 const stage=await manager.run({action:'prepare',version:'3.0.1'}),before=manager.status().source_revision;
 const result=await manager.run({action:'apply',stage_id:stage.stage_id,expected_revision:before});assert.equal(result.applied,false);assert(result.conflicts.includes('README.md'));assert.equal(manager.status().source_revision,before);
 await fs.writeFile(path.join(stage.path,'src/server.mjs'),'tampered');
 await assert.rejects(manager.run({action:'apply',stage_id:stage.stage_id,expected_revision:before}),/checksum/);
 bytes=await archive(f,{'package.json':JSON.stringify({name:'fecimus-fixture',version:'3.0.1',type:'module',dependencies:{newPackage:'1.0.0'}})});
 const changed=await manager.run({action:'prepare',version:'3.0.1'});
 await assert.rejects(manager.run({action:'apply',stage_id:changed.stage_id,expected_revision:before}),/dependencies/);
 assert.equal(await fs.readFile(path.join(f.root,'README.md'),'utf8'),'local edit');
});
test('downloads refuse checksum mismatch, remote redirects and absent trusted baselines',async t=>{
 const f=await fixture(t);let manager=f.make({fetchImpl:async url=>new Response(url.endsWith('SHA256SUMS')?'0'.repeat(64)+'  Fecimus-3.0.1-Linux-Ubuntu-LTS.tar.gz\n':'bad')});
 await assert.rejects(manager.run({action:'prepare',version:'3.0.1'}),/SHA-256 mismatch/);
 manager=f.make({fetchImpl:async()=>new Response(null,{status:302,headers:{location:'https://untrusted.invalid/archive'}})});
 await assert.rejects(manager.run({action:'prepare',version:'3.0.1'}),/approved HTTPS hosts/);
 await fs.rm(path.join(f.root,'SOURCE_MANIFEST.json'));
 await assert.rejects(manager.run({action:'prepare',version:'3.0.1'}),/baseline manifest/);
});

test('Windows release upgrades retain the Windows starter and ZIP selection', {skip:process.platform!=='linux'},async t=>{
 const f=await fixture(t),baselinePath=path.join(f.root,'SOURCE_MANIFEST.json');const baseline=JSON.parse(await fs.readFile(baselinePath,'utf8'));baseline.platform='windows';await fs.writeFile(baselinePath,JSON.stringify(baseline));
 const bytes=await archive(f,{},'windows'),requests=[];const manager=f.make({fetchImpl:async(url)=>{requests.push(url);return new Response(url.endsWith('SHA256SUMS')?hash(bytes)+'  Fecimus-3.0.1-Windows-11-Pro-WSL2.zip\n':bytes)}});
 const stage=await manager.run({action:'prepare',version:'3.0.1'});const result=await manager.run({action:'apply',stage_id:stage.stage_id,expected_revision:manager.status().source_revision});assert(result.applied);assert(requests.some(url=>url.endsWith('.zip')));assert.equal(await fs.readFile(path.join(f.root,'START_HERE.md'),'utf8'),'Windows\n');assert.equal(JSON.parse(await fs.readFile(baselinePath,'utf8')).platform,'windows');
});
