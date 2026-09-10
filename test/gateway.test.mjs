import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Gateway, SerialQueue } from '../src/gateway-core.mjs';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-gateway-test-'));
const fixture = path.join(temp, 'fixture.mjs');
const sdkServer = import.meta.resolve('@modelcontextprotocol/sdk/server/index.js');
const sdkTransport = import.meta.resolve('@modelcontextprotocol/sdk/server/stdio.js');
const sdkTypes = import.meta.resolve('@modelcontextprotocol/sdk/types.js');
await fs.writeFile(fixture, `
import fs from 'node:fs';
import { Server } from ${JSON.stringify(sdkServer)};
import { StdioServerTransport } from ${JSON.stringify(sdkTransport)};
import { ListToolsRequestSchema, CallToolRequestSchema } from ${JSON.stringify(sdkTypes)};
if (process.env.FAIL_FILE && fs.existsSync(process.env.FAIL_FILE)) process.exit(2);
if (process.env.DELAY) await new Promise(r => setTimeout(r, Number(process.env.DELAY)));
const definitions = [
 {name:'echo',description:'fixture',inputSchema:{type:'object',properties:{n:{type:'number',default:7},label:{type:'string',default:'x'},delay:{type:'integer',default:0}},additionalProperties:false}},
 {name:'crash',inputSchema:{type:'object',properties:{},additionalProperties:false}},
 {name:'hang',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
const server = new Server({name:'fixture',version:'1'}, {capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema, async request => process.env.PAGES
 ? request.params?.cursor ? {tools:definitions.slice(1)} : {tools:definitions.slice(0,1),nextCursor:'p2'}
 : {tools:definitions});
server.setRequestHandler(CallToolRequestSchema, async request => {
 const {name, arguments:args} = request.params;
 if (process.env.LOG) fs.appendFileSync(process.env.LOG, 'start '+process.env.ID+' '+name+' '+(args.label||'')+'\\n');
 if (name==='crash') process.exit(3);
 if (name==='hang') await new Promise(() => {});
 if (args.delay) await new Promise(r=>setTimeout(r,args.delay));
 if (process.env.LOG) fs.appendFileSync(process.env.LOG, 'end '+process.env.ID+' '+name+' '+(args.label||'')+'\\n');
 return {content:[{type:'text',text:JSON.stringify(args)}]};
});
await server.connect(new StdioServerTransport());
`);
const entry = env => ({command:process.execPath,args:[fixture],env});
const gateways = [];
const reports = [];
const make = (config, options = {}) => {
  const g = new Gateway(config, {log:()=>{},settings:{startup_timeout_ms:1500,call_timeout_ms:1000},...options});
  gateways.push(g); return g;
};
const contents = result => JSON.parse(result.content[0].text);
const pause = ms => new Promise(r=>setTimeout(r,ms));
try {
  const g = make({fixture:entry({PAGES:'1'})});
  await g.start();
  assert.equal(g.listTools().length,3);
  assert.equal(contents(await g.invoke('echo')).n,7);
  const invalid = await g.invoke('echo',{n:'bad'});
  assert(invalid.isError);
  assert.equal(g.status().backends[0].calls,1,'invalid input was not dispatched');
  assert((await g.invoke('missing')).isError);
  reports.push('paged discovery, schema defaults, invalid-input no-dispatch, unknown tools');

  const fifoLog = path.join(temp,'fifo.log');
  const mutex = make({'desktop-mouse':entry({LOG:fifoLog,ID:'mouse'}),'desktop-keyboard':entry({LOG:fifoLog,ID:'keyboard'})});
  await mutex.start();
  const [first,second] = await Promise.all([mutex.invoke('echo',{label:'first',delay:80}),mutex.invoke('desktop_keyboard_echo',{label:'second'})]);
  assert(!first.isError && !second.isError);
  assert.deepEqual((await fs.readFile(fifoLog,'utf8')).trim().split('\n'),['start mouse echo first','end mouse echo first','start keyboard echo second','end keyboard echo second']);
  const abort = new AbortController();
  const running = mutex.invoke('echo',{delay:100,label:'running'});
  const queued = mutex.invoke('desktop_keyboard_echo',{label:'cancelled'},abort.signal);
  abort.abort();
  assert((await queued).isError);
  await running;
  assert(!(await fs.readFile(fifoLog,'utf8')).includes('cancelled'));
  reports.push('shared desktop FIFO and cancelled queued action never dispatched');

  const failFile = path.join(temp,'fail');
  const cachePath = path.join(temp,'cache.json');
  const cachedConfig = {fixture:entry({FAIL_FILE:failFile})};
  const before = make(cachedConfig,{cachePath});
  await before.start(); await before.close();
  await fs.writeFile(failFile,'fail');
  const cached = make(cachedConfig,{cachePath});
  await cached.start();
  assert.equal(cached.listTools().length,3);
  assert(!cached.status().backends[0].connected);
  await fs.rm(failFile);
  assert.equal(contents(await cached.invoke('echo')).n,7);
  assert(cached.status().backends[0].connected);
  const wrongConfig = make({different:entry({})},{cachePath});
  assert.equal(wrongConfig.listTools().length,0);
  await fs.writeFile(cachePath,'not json');
  assert.equal(make(cachedConfig,{cachePath}).listTools().length,0);
  reports.push('cached discovery during outage, on-demand reconnect, config mismatch/corrupt cache rejected');

  const crashLog = path.join(temp,'crash.log');
  const crash = make({fixture:entry({LOG:crashLog,ID:'one'})});
  await crash.start();
  const failed = await crash.invoke('crash');
  assert(failed.isError && failed.content[0].text.includes('did not replay'));
  assert.equal(contents(await crash.invoke('echo')).n,7);
  assert.equal((await fs.readFile(crashLog,'utf8')).split('start one crash').length-1,1);
  assert.equal(crash.status().backends[0].connections,2);
  reports.push('crashed action never replayed; next independent call reconnects');

  const timed = make({fixture:entry({})},{settings:{startup_timeout_ms:1000,call_timeout_ms:100}});
  await timed.start();
  const timedOut = await timed.invoke('hang');
  assert(timedOut.isError);
  assert.equal(contents(await timed.invoke('echo')).n,7);
  reports.push('dispatched timeout stops uncertain transport and recovers for a new call');

  const partial = make({good:entry({}),bad:entry({DELAY:'2000'})},{settings:{startup_timeout_ms:300,call_timeout_ms:1000}});
  const started = Date.now();
  await partial.start();
  assert(Date.now()-started<1700,'partial startup was bounded');
  assert.equal(contents(await partial.invoke('echo')).n,7);
  assert(!partial.status().backends.find(p=>p.name==='bad').connected);
  reports.push('bounded partial startup preserves working backend');

  const health = make({'desktop-mouse':entry({})},{runtimeStatus:()=>({healthy:false})});
  await health.start();
  assert((await health.invoke('echo')).isError);
  assert.equal(health.status().backends[0].calls,0);
  reports.push('unhealthy isolated display blocks native dispatch');

  const queue = new SerialQueue(1);
  const hold = queue.run(()=>pause(80));
  const pending = queue.run(()=>1);
  await assert.rejects(queue.run(()=>2),/full/);
  await Promise.all([hold,pending]);
  reports.push('bounded queue rejects overflow');
  console.log(JSON.stringify({passed:reports.length,checks:reports},null,2));
} finally {
  await Promise.allSettled(gateways.map(g=>g.close()));
  await fs.rm(temp,{recursive:true,force:true});
}
