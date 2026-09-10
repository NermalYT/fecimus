#!/usr/bin/env node
// Measure real MCP calls using disposable integration fixtures, not model tokens.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {VERSION} from '../src/version.mjs';
const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const opts={trials:3,output:path.join(project,'dist/performance.json'),server:path.join(project,'src/server.mjs')};
for(let i=2;i<process.argv.length;i++){
  const key=process.argv[i],value=process.argv[++i];
  if(!value||!['--trials','--output','--server','--baseline'].includes(key))throw Error('Usage: node scripts/benchmark.mjs [--trials 3] [--output FILE] [--server SERVER.mjs] [--baseline PREVIOUS.json]');
  opts[key.slice(2)]=key==='--trials'?Number(value):path.resolve(value);
}
if(!Number.isInteger(opts.trials)||opts.trials<1||opts.trials>10)throw Error('trials must be between1 and10.');
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'fecimus-benchmark-'));
const rows=[];
const localXvfb=path.join(os.homedir(),'.local/share/fecimus/runtime/usr/bin/Xvfb');
const median=values=>{const s=[...values].sort((a,b)=>a-b);const mid=Math.floor(s.length/2);return s.length%2?s[mid]:(s[mid-1]+s[mid])/2;};
const summarize=trials=>{
  const groups={startup_ms:trials.map(row=>row.startup_ms)};
  for(const row of trials)for(const tool of row.tools)(groups[tool.tool]??=[]).push(tool.ms);
  return Object.fromEntries(Object.entries(groups).map(([name,values])=>[name,{median_ms:median(values),min_ms:Math.min(...values),max_ms:Math.max(...values),samples:values.length}]));
};
try{
 for(let i=0;i<opts.trials;i++){
  const env={...process.env,FECIMUS_DATA_DIR:path.join(temporary,String(i)),FECIMUS_SERVER_MODULE:opts.server,FECIMUS_BENCHMARK_CORE_ONLY:'1'};
  if(!env.FECIMUS_XVFB)await fs.access(localXvfb).then(()=>{env.FECIMUS_XVFB=localXvfb;}).catch(()=>{});
  const result=await new Promise((resolve,reject)=>{
    const c=spawn(process.execPath,[path.join(project,'test/integration-test.mjs')],{cwd:project,env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';c.stdout.on('data',b=>{stdout=(stdout+b).slice(-2000000);});c.stderr.on('data',b=>{stderr=(stderr+b).slice(-10000);});
    c.on('error',reject);c.on('close',code=>{
      if(code!==0){reject(Error('Fixture failed: '+stderr+'\n'+stdout.slice(-5000)));return;}
      try { const parsed=JSON.parse(stdout); if(!parsed.passed)throw Error('Fixture did not pass.'); resolve(parsed); }
      catch(error){reject(Error('Invalid fixture report: '+error.message+'\n'+stdout.slice(-2000)));}
    });
  });
  rows.push({startup_ms:result.checks.find(row=>'startup_ms'in row).startup_ms,tools:result.checks.filter(row=>row.passed&&row.tool).map(({tool,ms})=>({tool,ms}))});
  console.log(`Trial ${i+1}/${opts.trials}: startup ${rows.at(-1).startup_ms} ms`);
 }
 const report={version:VERSION,date:new Date().toISOString(),method:'Sequential disposable MCP integration fixtures; excludes model inference and application rendering performance.',trials:rows,summary:summarize(rows)};
 if(opts.baseline){
  const baseline=JSON.parse(await fs.readFile(opts.baseline,'utf8'));const before=baseline.summary||summarize(baseline.trials);
  report.baseline_version=baseline.version;
  report.comparison=Object.fromEntries(Object.entries(report.summary).filter(([key])=>before[key]).map(([key,current])=>[key,{before_median_ms:before[key].median_ms,after_median_ms:current.median_ms,change_percent:before[key].median_ms?Math.round((current.median_ms/before[key].median_ms-1)*1000)/10:null}]));
 }
 await fs.mkdir(path.dirname(opts.output),{recursive:true});await fs.writeFile(opts.output,JSON.stringify(report,null,2)+'\n');
 console.log('Wrote '+opts.output);
}finally{await fs.rm(temporary,{recursive:true,force:true});}
