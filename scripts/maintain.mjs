#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createServiceMaintenance } from '../src/service-maintenance.mjs';

const usage = 'Usage: node scripts/maintain.mjs status|backup|check|restore|prepare|apply [--label TEXT] [--backup-id ID] [--stage-id ID] [--version X.Y.Z] [--expected-revision SHA256] [--data-dir PATH]';
try {
  const args = process.argv.slice(2);
  if (args.includes('--help')) { console.log(usage); process.exit(0); }
  const input = { action: args.shift() || 'status' };
  let dataDir = process.env.FECIMUS_DATA_DIR || path.join(os.homedir(), '.local/share/fecimus');
  const seen = new Set();
  while (args.length) {
    const key = args.shift();
    if (!['--label', '--backup-id', '--stage-id', '--version', '--expected-revision', '--data-dir'].includes(key) || !args.length || seen.has(key)) throw new Error(usage);
    seen.add(key); const value = args.shift();
    if (key === '--data-dir') dataDir = path.resolve(value); else input[key.slice(2).replaceAll('-', '_')] = value;
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const result = await createServiceMaintenance({ root, dataDir: path.resolve(dataDir) }).run(input, controller.signal);
    console.log(JSON.stringify(result, null, 2));
    if (result.passed === false || result.applied === false) process.exitCode = 1;
  } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
} catch (error) { console.error(`Fecimus maintenance failed: ${error.message}`); process.exitCode = 1; }
