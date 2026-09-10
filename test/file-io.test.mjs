import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readPrefix} from '../src/file-io.mjs';
test('small prefix reads do not load an entire multi-gigabyte sparse file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fecimus-read-'));const filename=path.join(dir,'large');
 try {
  const fd=fs.openSync(filename,'w');try{fs.writeSync(fd,'bounded');fs.ftruncateSync(fd,3*1024*1024*1024);}finally{fs.closeSync(fd)}
  assert.equal(readPrefix(filename,7).toString(),'bounded');
  assert.equal(readPrefix(filename,0).length,0);
  assert.throws(()=>readPrefix(filename,3*1024*1024),/limit/);
  assert.throws(()=>readPrefix(path.join(dir,'missing'),1));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
