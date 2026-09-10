import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPathGuard,translateWindowsPath} from '../src/file-roots.mjs';
test('Windows drive paths stay native on Windows and map to mounts only in Linux',()=>{
 const windows='C:\\Users\\Test User\\Documents\\file.txt';
 assert.equal(translateWindowsPath(windows,'win32'),windows);
 assert.equal(translateWindowsPath('C:/Users/Test User/file.txt','win32'),'C:/Users/Test User/file.txt');
 assert.equal(translateWindowsPath(windows,'linux'),'/mnt/c/Users/Test User/Documents/file.txt');
 assert.equal(translateWindowsPath('/home/user/file.txt','linux'),'/home/user/file.txt');
});
test('file root guard allows intended roots and denies traversal, symlink escape and dangling links',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'fecimus-roots-'));const home=path.join(tmp,'home'),extra=path.join(tmp,'documents'),outside=path.join(tmp,'outside');
 for(const p of [home,extra,outside])fs.mkdirSync(p);
 try{
  const guard=createPathGuard({home,roots:[extra]});
  assert.equal(guard.resolve('~/new/nested.txt'),path.join(home,'new/nested.txt'));
  assert.equal(guard.resolve(path.join(extra,'file.txt')),path.join(extra,'file.txt'));
  assert.throws(()=>guard.resolve('../outside/file'),/denied/);
  assert.throws(()=>guard.resolve(path.join(tmp,'home-sibling','file')),/denied/);
  if(process.platform!=='win32'){
   fs.symlinkSync(outside,path.join(home,'escape'));
   fs.symlinkSync(path.join(outside,'nonexistent'),path.join(home,'dangling'));
   assert.throws(()=>guard.resolve('escape/new.txt'),/denied/);
   assert.throws(()=>guard.resolve('dangling'));
   fs.symlinkSync(extra,path.join(home,'allowed'));
   assert.equal(guard.resolve('allowed/new.txt'),path.join(home,'allowed/new.txt'));
  }
  assert.equal(guard.display(path.join(extra,'a')),path.join(extra,'a'));
  assert.throws(()=>createPathGuard({home,roots:['relative']}),/absolute/);
  assert.throws(()=>createPathGuard({home,roots:'{}'}),/array/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
