import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const files=(await fs.readdir(here)).filter(name=>name.endsWith('.test.mjs')).sort().map(name=>path.join(here,name));
const child=spawn(process.execPath,['--test',...files],{stdio:'inherit'});
child.on('error',e=>{console.error(e.message);process.exitCode=1});
child.on('exit',code=>{process.exitCode=code??1});
