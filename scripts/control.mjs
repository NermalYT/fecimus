import fs from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '../src/config.mjs';

try {
  const descriptor = JSON.parse(await fs.readFile(path.join(dataDir, 'control.json'), 'utf8'));
  const url = new URL(descriptor.url);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^[a-f0-9]{64}$/.test(url.hash.slice(1))) throw new Error('Invalid control descriptor.');
  const token = url.hash.slice(1); url.hash = ''; url.pathname = '/api/status';
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(3000) });
  if (!response.ok) throw new Error('Saved session is no longer available.');
  console.log('Open this private session link in your browser:');
  console.log(descriptor.url);
} catch (error) { console.error('Start Fecimus in LM Studio first. ' + error.message); process.exitCode = 1; }
