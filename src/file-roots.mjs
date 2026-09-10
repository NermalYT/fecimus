import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const inside=(file,root)=>{
  const relative=path.relative(root,file);
  return relative===''||(!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep));
};
export function translateWindowsPath(input,platform=process.platform){
  return platform!=='win32'&&/^[a-zA-Z]:[\\/]/.test(input)
    ? '/mnt/'+input[0].toLowerCase()+'/'+input.slice(3).replaceAll('\\','/') : input;
}
export function createPathGuard({home=os.homedir(),roots=process.env.FECIMUS_FILE_ROOTS}={}) {
  const configured=typeof roots==='string'?JSON.parse(roots):roots;
  if(configured!==undefined&&(!Array.isArray(configured)||configured.length>16||configured.some(r=>typeof r!=='string'||!path.isAbsolute(r))))throw new Error('FECIMUS_FILE_ROOTS must be a JSON array of at most 16 absolute directories.');
  const allowed=[...new Set([home,...(configured||[])].map(root=>{
    const resolved=fs.realpathSync(root);
    if(!fs.statSync(resolved).isDirectory())throw new Error('File root must be a directory.');
    return resolved;
  }))];
  return {
    roots:allowed,
    resolve(input){
      if(typeof input!=='string'||!input.trim())throw new Error('Path cannot be empty.');
      let expanded=input.trim();
      if(expanded==='~')expanded=home;
      else if(expanded.startsWith('~/'))expanded=path.join(home,expanded.slice(2));
      else expanded=translateWindowsPath(expanded);
      const resolved=path.resolve(home,expanded);
      let current=resolved;const rest=[];
      for(;;){
        try{fs.lstatSync(current);break;}catch(error){
          if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;
          const parent=path.dirname(current);if(parent===current)throw error;
          rest.unshift(path.basename(current));current=parent;
        }
      }
      // A dangling symlink is denied, not mistaken for a nonexistent file.
      const real=path.resolve(fs.realpathSync(current),...rest);
      if(!allowed.some(root=>inside(real,root)))throw new Error('Access denied outside configured file roots.');
      return resolved;
    },
    display(filename){return inside(filename,home)?(filename===home?'~':'~/'+path.relative(home,filename)):filename;}
  };
}
