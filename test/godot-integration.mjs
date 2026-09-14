import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
// Optional real-application test. No model or engine download is performed.
if (!process.env.FECIMUS_GODOT || !path.isAbsolute(process.env.FECIMUS_GODOT)) throw new Error('Set FECIMUS_GODOT to an installed Godot 4 executable absolute path.');
const root=process.cwd(), tmp=await fs.mkdtemp(path.join(os.homedir(),'.fecimus-godot-v3-'));
const project=path.join(tmp,'project'); await fs.mkdir(project);
const binary=process.env.FECIMUS_GODOT;
await fs.mkdir(path.join(root,'.test-output'),{recursive:true});
const client=new Client({name:'fecimus-real-godot-check',version:'3.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/server.mjs')],env:{...process.env,FECIMUS_TOOL_MODE:'compact',FECIMUS_DATA_DIR:path.join(tmp,'data'),FECIMUS_BROWSER_PROFILE:path.join(tmp,'browser')},stderr:'pipe'});
let stderr='';transport.stderr?.on('data',b=>{stderr=(stderr+b).slice(-6000)});
const report=[]; const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function call(tool,args={}) {const t=Date.now();const r=await client.callTool({name:'fecimus_call',arguments:{tool,arguments:args}},undefined,{timeout:60000});assert(!r.isError,JSON.stringify(r));report.push({tool,ms:Date.now()-t});return r.structuredContent??JSON.parse(r.content.filter(c=>c.type==='text').map(c=>c.text).join('\n'));}
async function job(args){const j=await call('fecimus_job_start',{command:binary,args,cwd:project,timeout_ms:45000});const deadline=Date.now()+50000;while(Date.now()<deadline){const s=await call('fecimus_job_status',{job_id:j.job_id,max_chars:20000});if(['succeeded','failed','cancelled','timed_out'].includes(s.state)){assert.equal(s.state,'succeeded',JSON.stringify(s));assert(!/SCRIPT ERROR|Parse Error/.test(s.output),s.output);return s;}await sleep(200);}throw Error('job did not finish');}
try {
 await client.connect(transport,{timeout:30000});
 const tools=await client.listTools();assert.equal(tools.tools.length,5);
 const files={
 'project.godot':'config_version=5\n[application]\nconfig/name="Fecimus v3 Godot validation"\nrun/main_scene="res://main.tscn"\n[rendering]\nrenderer/rendering_method="gl_compatibility"\n',
 'main.tscn':'[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://main.gd" id="1"]\n[node name="FecimusFixture" type="Node2D"]\nscript = ExtResource("1")\n',
 'main.gd':'extends Node2D\nfunc _ready():\n\tvar score = 20 + 22\n\tvar file = FileAccess.open("res://result.json", FileAccess.WRITE)\n\tfile.store_string(JSON.stringify({"score":score,"engine":Engine.get_version_info().string}))\n\tfile.close()\n\tprint("FECIMUS_GAME_OK:",score)\n\tget_tree().quit()\n'};
 for(const [name,text] of Object.entries(files))await call('fecimus_project_edit',{path:path.join(project,name),expected_sha256:'absent',new_text:text});
 await job(['--headless','--path',project,'--import']);
 let first=await job(['--headless','--path',project]);assert(first.output.includes('FECIMUS_GAME_OK:42'));
 assert.equal(JSON.parse(await fs.readFile(path.join(project,'result.json'),'utf8')).score,42);
 const read=await call('fecimus_project_read',{path:path.join(project,'main.gd')});
 await call('fecimus_project_edit',{path:path.join(project,'main.gd'),expected_sha256:read.sha256,old_text:'20 + 22',new_text:'40 + 44'});
 let second=await job(['--headless','--path',project]);assert(second.output.includes('FECIMUS_GAME_OK:84'));
 const artifact=JSON.parse(await fs.readFile(path.join(project,'result.json'),'utf8'));assert.equal(artifact.score,84);
 await fs.writeFile(path.join(root,'.test-output/godot-v3-verification.json'),JSON.stringify({date:new Date().toISOString(),passed:true,version:artifact.engine,scope:'Linux x86_64 headless import, run, hash-checked edit and rerun through compact MCP',initial_score:42,edited_score:84,calls:report},null,2)+'\n');
 console.log(JSON.stringify({passed:true,engine:artifact.engine,calls:report.length}));
} catch(e){console.error(stderr);throw e;} finally {await client.close();await transport.close();await fs.rm(tmp,{recursive:true,force:true});}
