import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = result => JSON.parse(result.content.find(part => part.type === 'text').text);
test('installed addon survives restart and runs through the single compact MCP dispatcher', { skip: process.platform !== 'linux', timeout: 30000 }, async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'fecimus-extensions-protocol-'));
  const data = path.join(temporary, 'data'), backends = path.join(temporary, 'backends.json');
  await fs.mkdir(data); await fs.writeFile(backends, '{}');
  async function session(work) {
    const client = new Client({name:'extension-protocol',version:'1.0.0'});
    const transport = new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/server.mjs')],env:{...process.env,FECIMUS_DATA_DIR:data,FECIMUS_BACKENDS:backends,FECIMUS_SKIP_RUNTIME:'1',FECIMUS_TOOL_MODE:'compact',FECIMUS_CONTROL:'0'},stderr:'pipe'});
    let log=''; transport.stderr.on('data',chunk=>{log=(log+chunk).slice(-4000)});
    const call=async(tool,args={})=>{const result=await client.callTool({name:'fecimus_call',arguments:{tool,arguments:args}},undefined,{timeout:15000}); assert(!result.isError,result.content?.[0]?.text+'\n'+log); return result;};
    try { await client.connect(transport,{timeout:15000}); await work(client,call); }
    finally { await client.close().catch(()=>{}); await transport.close().catch(()=>{}); }
  }
  try {
    await session(async(client,call)=>{
      assert.equal((await client.listTools()).tools.length,5);
      const service=value(await call('fecimus_service',{action:'status'}));
      assert(JSON.stringify(service).includes(root),'maintenance identifies the actual installed source');
      await call('fecimus_addons',{action:'install',path:path.join(root,'examples/hello-addon'),trust:true});
      const inventory=value(await call('fecimus_tools'));
      assert(!inventory.names.includes('hello__greet'),'new addons load after restart');
    });
    await session(async(client,call)=>{
      assert.equal((await client.listTools()).tools.length,5);
      const inventory=value(await call('fecimus_tools')); assert(inventory.names.includes('hello__greet'));
      const result=await call('hello__greet',{name:'Fecimus fixture'});
      assert(result.content.some(part=>part.type==='text'&&part.text.includes('Fecimus fixture')));
      await call('fecimus_addons',{action:'disable',id:'hello'});
    });
    await session(async(client,call)=>{
      const inventory=value(await call('fecimus_tools')); assert(!inventory.names.includes('hello__greet'));
    });
  } finally { await fs.rm(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:50}); }
});
