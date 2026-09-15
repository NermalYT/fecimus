import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mergeConfig } from '../scripts/install.mjs';
test('pre-rename environment settings remain usable, with new settings taking precedence', () => {
  const env = { ...process.env, ASTRA_DATA_DIR: '/tmp/legacy-fecimus-test' };
  delete env.FECIMUS_DATA_DIR;
  const read = () => execFileSync(process.execPath, ['--input-type=module', '-e', "import {dataDir} from './src/config.mjs';console.log(dataDir)"], {env,encoding:'utf8'}).trim();
  assert.equal(read().replaceAll('\\','/').endsWith('/tmp/legacy-fecimus-test'),true);
  env.FECIMUS_DATA_DIR='/tmp/new-fecimus-test';
  assert.equal(read().replaceAll('\\','/').endsWith('/tmp/new-fecimus-test'),true);
});
test('rename replaces only the matching old host registration', () => {
  const entry={command:'node',args:['/same/src/server.mjs']};
  const merged=mergeConfig({mcpServers:{astra:entry,other:{command:'other'}}},entry);
  assert(!merged.mcpServers.astra); assert.deepEqual(merged.mcpServers.fecimus,entry); assert(merged.mcpServers.other);
  assert(mergeConfig({mcpServers:{astra:{args:['/unrelated']}}},entry).mcpServers.astra);
});
