import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inlineBrowserSnapshot } from '../src/browser-output.mjs';
const name='page-2026-09-09T14-12-12-001Z.yml';
const source=filename=>({content:[{type:'text',text:`### Snapshot\n- [Snapshot](browser-output/${filename})`},{type:'image',mimeType:'image/png',data:'unchanged'}]});

test('browser output inlines references, bounds text, preserves images and rejects traversal',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fecimus-output-'));
 try {
  await fs.writeFile(path.join(dir,name),'- button "Example" [ref=e12]\n');
  const result=await inlineBrowserSnapshot('browser_navigate',source(name),dir);
  assert(result.content[0].text.includes('[ref=e12]'));
  assert.equal(result.content[1].data,'unchanged');
  await fs.writeFile(path.join(dir,name),'- entry [ref=e1]\n'.repeat(1000));
  assert((await inlineBrowserSnapshot('browser_click',source(name),dir,1000)).content[0].text.includes('Snapshot truncated'));
  assert.deepEqual(await inlineBrowserSnapshot('browser_snapshot',source('../secrets.txt'),dir),source('../secrets.txt'));
  assert.deepEqual(await inlineBrowserSnapshot('shell_run',source(name),dir),source(name));
 }finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('browser output refuses symlinks to an actual file outside the output directory',async t=>{
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'fecimus-output-link-'));
 const dir=path.join(temporary,'output'), outside=path.join(temporary,'private.txt');
 try {
  await fs.mkdir(dir);
  await fs.writeFile(outside,'Private fixture must not be included in the snapshot.');
  try {await fs.symlink(outside,path.join(dir,name),'file');}
  catch(error){
   if(process.platform==='win32'&&error.code==='EPERM'){
    t.skip('This Windows runner lacks permission to create symbolic links. Linux always exercises this case.');
    return;
   }
   throw error;
  }
  assert.deepEqual(await inlineBrowserSnapshot('browser_navigate',source(name),dir),source(name));
 }finally {await fs.rm(temporary,{recursive:true,force:true});}
});
