import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryTools, searchTools, advertisedTools } from '../src/tool-discovery.mjs';
import { getPrompt, promptDefinitions, guides } from '../src/help.mjs';

const inventory = [
  { name: 'filesystem_read', description: 'Read a project file.', inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'browser_read_tabs', description: 'Read background tabs.', inputSchema: { type: 'object', properties: {} } },
  ...discoveryTools, ...['fecimus_status', 'fecimus_help', 'fecimus_control_panel'].map(name => ({ name }))
];
test('compact advertising retains full schema discovery and excludes recursive wrappers', () => {
  assert.equal(advertisedTools(inventory, 'compact').length, 5);
  assert.equal(advertisedTools(inventory, 'full').length, inventory.length);
  assert.throws(() => advertisedTools(inventory, 'typo'), /tool_mode/);
  assert.deepEqual(searchTools(inventory, { names: ['filesystem_read'] }).tools[0], inventory[0]);
  assert.equal(searchTools(inventory, { query: 'background tabs' }).tools[0].name, 'browser_read_tabs');
  assert(!searchTools(inventory, {}).names.includes('fecimus_call'));
  assert.throws(() => searchTools(inventory, { names: ['invented'] }), /Unknown/);
});
test('portable prompt and guide fallbacks preserve user objective as content', () => {
  assert.equal(Object.keys(guides).length, 7);
  for (const item of promptDefinitions) {
    const objective = 'Inspect literal $(example) project';
    const result = getPrompt(item.name, { objective });
    assert(result.messages[0].content.text.includes(objective));
    assert.equal(result.messages[0].role, 'user');
  }
  assert.throws(() => getPrompt('invalid', { objective: 'work' }), /Unknown/);
  assert.throws(() => getPrompt('fecimus_studio', { objective: '' }), /objective/);
});
