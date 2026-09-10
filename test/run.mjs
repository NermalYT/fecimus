import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=path.join(root,'.test-output');
const state=await fs.mkdtemp(path.join(os.tmpdir(),'fecimus-test-state-'));
await fs.mkdir(output,{recursive:true});
const env={...process.env,FECIMUS_DATA_DIR:state};
// A locally extracted Xvfb can be used without installing system packages.
const localXvfb=path.join(os.homedir(),'.local/share/fecimus/runtime/usr/bin/Xvfb');
if(!env.FECIMUS_XVFB) await fs.access(localXvfb).then(()=>{env.FECIMUS_XVFB=localXvfb}).catch(()=>{});
const suites=['gateway.test.mjs','browser-tools.test.mjs','catalog.test.mjs','browser-output.test.mjs','platform.test.mjs','file-roots.test.mjs','file-io.test.mjs','application-paths.test.mjs','check-model.test.mjs','integration-test.mjs','lifecycle-test.mjs'];
const results=[];let log='';
try {
 for(const suite of suites){
  const start=Date.now();
  const result=await new Promise(resolve=>{
   const c=spawn(process.execPath,[path.join(root,'test',suite)],{cwd:root,env,stdio:['ignore','pipe','pipe']});
   let text='';const collect=b=>{text=(text+b).slice(-2000000)};
   c.stdout.on('data',collect);c.stderr.on('data',collect);
   c.on('error',e=>resolve({code:1,text:e.message}));c.on('exit',code=>resolve({code,text}));
  });
  results.push({suite,passed:result.code===0,ms:Date.now()-start});log+=`\n${suite}\n${result.text}\n`;
  console.log(`${result.code===0?'PASS':'FAIL'} ${suite} (${Date.now()-start} ms)`);
  if(result.code!==0){console.error(result.text.slice(-8000));break;}
 }
 const passed=results.length===suites.length&&results.every(r=>r.passed);
 await fs.writeFile(path.join(output,'verification.json'),JSON.stringify({date:new Date().toISOString(),passed,suites:results},null,2)+'\n');
 await fs.writeFile(path.join(output,'verification.log'),log);
 if(!passed)process.exitCode=1;
}finally{await fs.rm(state,{recursive:true,force:true});}
