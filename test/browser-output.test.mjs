import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { inlineBrowserSnapshot } from '../src/browser-output.mjs';
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'fecimus-output-'));
const source=name=>({content:[{type:'text',text:`### Snapshot\n- [Snapshot](browser-output/${name})`},{type:'image',mimeType:'image/png',data:'unchanged'}]});
try {
 const name='page-2026-09-09T14-12-12-001Z.yml';
 await fs.writeFile(path.join(dir,name),'- button "Example" [ref=e12]\n');
 const result=await inlineBrowserSnapshot('browser_navigate',source(name),dir);
 assert(result.content[0].text.includes('[ref=e12]'));
 assert.equal(result.content[1].data,'unchanged');
 await fs.writeFile(path.join(dir,name),'- entry [ref=e1]\n'.repeat(1000));
 assert((await inlineBrowserSnapshot('browser_click',source(name),dir,1000)).content[0].text.includes('Snapshot truncated'));
 await fs.rm(path.join(dir,name)); await fs.symlink('/etc/passwd',path.join(dir,name));
 assert.deepEqual(await inlineBrowserSnapshot('browser_navigate',source(name),dir),source(name));
 assert.deepEqual(await inlineBrowserSnapshot('browser_snapshot',source('../secrets.txt'),dir),source('../secrets.txt'));
 assert.deepEqual(await inlineBrowserSnapshot('shell_run',source(name),dir),source(name));
 console.log('Browser output: inline refs, bounds, image preservation, symlink protection passed.');
}finally {await fs.rm(dir,{recursive:true,force:true});}
