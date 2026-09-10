import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { compactTool } from '../src/catalog.mjs';
import { extraTools } from '../src/browser-tools.mjs';

const cache = JSON.parse(fs.readFileSync(new URL('./catalog-fixture.json', import.meta.url), 'utf8'));
const backendTools = Object.values(cache.backends).flat();
const tools = [...backendTools, ...extraTools];
const compact = tools.map(compactTool);
const byName = name => compact.find(tool => tool.name === name);

// Projection applies only to schema nodes, never instance data (defaults, const, enum).
function semantics(schema) {
  if (typeof schema === 'boolean' || schema === null || typeof schema !== 'object') return schema;
  const result = structuredClone(schema);
  delete result.description;
  delete result.title;
  for (const key of ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']) {
    if (result[key]) result[key] = Object.fromEntries(Object.entries(result[key]).map(([name, child]) => [name, Array.isArray(child) ? child : semantics(child)]));
  }
  for (const key of ['allOf', 'anyOf', 'oneOf', 'prefixItems']) if (Array.isArray(result[key])) result[key] = result[key].map(semantics);
  for (const key of ['items', 'additionalItems', 'additionalProperties', 'contains', 'contentSchema', 'else', 'if', 'not', 'propertyNames', 'then', 'unevaluatedItems', 'unevaluatedProperties']) {
    if (Object.hasOwn(result, key)) result[key] = Array.isArray(result[key]) ? result[key].map(semantics) : semantics(result[key]);
  }
  return result;
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

test('all 78 advertised functions retain names, full validation semantics and other metadata', () => {
  assert.equal(backendTools.length, 76);
  assert.equal(tools.length, 78);
  for (let i = 0; i < tools.length; i++) {
    const before = tools[i], after = compact[i];
    assert.equal(after.name, before.name);
    assert.deepEqual(semantics(after.inputSchema), semantics(before.inputSchema), before.name);
    const { description: _beforeDescription, inputSchema: _beforeSchema, ...beforeRest } = before;
    const { description: _afterDescription, inputSchema: _afterSchema, ...afterRest } = after;
    assert.deepEqual(afterRest, beforeRest, `${before.name}: output schema, annotations and extensions`);
  }
});

test('compaction is pure, deeply detached and idempotent', () => {
  for (const tool of tools) {
    const original = structuredClone(tool);
    const result = compactTool(deepFreeze(tool));
    assert.deepEqual(tool, original);
    assert.notEqual(result.inputSchema, tool.inputSchema);
    assert.deepEqual(compactTool(result), result);
  }
});

test('schema title removal never removes property names or rewrites instance data', () => {
  const text = 'Exact target element reference from the page snapshot, or a unique element selector';
  const payload = { title: 'Data title', description: text };
  const schema = { title: 'Display title', description: text, type: 'object',
    properties: {
      title: { title: 'Property display title', type: 'string', const: 'required title' },
      description: { type: 'string', default: text },
      data: { default: payload, const: payload, enum: [payload], examples: [payload] }
    },
    required: ['title', 'description'],
    additionalProperties: false,
    $defs: { record: { title: 'Record', type: 'string', pattern: '^abc$', minLength: 3 } },
    allOf: [{ properties: { nested: { title: 'Nested', type: 'integer', minimum: 1, maximum: 9, multipleOf: 2 } } }],
    if: { required: ['data'] }, then: { required: ['title'] }, else: false,
    dependentRequired: { data: ['description'] }, dependencies: { title: ['description'], data: { title: 'Dependency', required: ['title'] } },
    'x-extension': payload
  };
  const tool = { name: 'fixture', title: 'Tool title', inputSchema: schema, outputSchema: schema, annotations: { title: 'Annotation title', readOnlyHint: true }, _meta: payload };
  const result = compactTool(tool);
  assert.deepEqual(semantics(result.inputSchema), semantics(schema));
  assert.equal(result.inputSchema.title, undefined);
  assert.ok(Object.hasOwn(result.inputSchema.properties, 'title'));
  assert.ok(Object.hasOwn(result.inputSchema.properties, 'description'));
  assert.equal(result.inputSchema.properties.title.title, undefined);
  assert.deepEqual(result.inputSchema.properties.data, schema.properties.data);
  assert.equal(result.inputSchema.properties.description.default, text);
  assert.deepEqual(result.inputSchema['x-extension'], payload);
  assert.deepEqual(result.outputSchema, schema);
  assert.deepEqual(result.annotations, tool.annotations);
  assert.deepEqual(result._meta, payload);
  assert.equal(result.title, 'Tool title');
});

test('schema traversal supports boolean schemas, tuples and modern nested schemas', () => {
  const child = { title: 'Display', type: 'number', exclusiveMinimum: 1 };
  const schema = { type: 'object', properties: { a: false }, additionalProperties: true,
    patternProperties: { '^item': child }, dependentSchemas: { a: child },
    items: [child, false], prefixItems: [child, true], anyOf: [child, false], oneOf: [child],
    additionalItems: false, unevaluatedItems: false, unevaluatedProperties: child,
    contains: child, contentSchema: child, propertyNames: { title: 'Keys', maxLength: 8 }, not: child,
    definitions: { legacy: child }
  };
  const result = compactTool({ name: 'fixture', inputSchema: schema });
  assert.deepEqual(semantics(result.inputSchema), semantics(schema));
  assert.equal(result.inputSchema.prefixItems[0].title, undefined);
  assert.equal(result.inputSchema.unevaluatedProperties.title, undefined);
  assert.equal(result.inputSchema.properties.a, false);
});

test('unknown descriptions, including future long constraints, are preserved verbatim', () => {
  const description = 'A future backend constraint and unit. '.repeat(30);
  const tool = { name: 'future_tool', description, inputSchema: { type: 'object', description, properties: { value: { type: 'number', description } } } };
  assert.deepEqual(compactTool(tool), tool);
  assert.deepEqual(compactTool({ name: 'minimal', inputSchema: { type: 'object' } }), { name: 'minimal', inputSchema: { type: 'object' } });
});

test('reviewed long descriptions are shortened without sentence truncation', () => {
  const inspect = (before, after, path) => {
    if (typeof before !== 'object' || before === null) return;
    for (const [key, value] of Object.entries(before)) {
      if (key === 'description' && typeof value === 'string' && value.length >= 180) {
        assert.ok(after[key].length < value.length, `${path}.${key} needs a reviewed shorter description`);
        assert.ok(/[.!?]$/.test(after[key]), `${path}.${key} must retain complete prose`);
      } else if (key !== 'annotations' && key !== 'outputSchema') inspect(value, after?.[key], `${path}.${key}`);
    }
  };
  for (let i = 0; i < tools.length; i++) inspect(tools[i], compact[i], tools[i].name);
});

test('critical guidance retains signs, units, defaults, preconditions and desktop isolation', () => {
  for (const [backend, definitions] of Object.entries(cache.backends)) if (backend.startsWith('desktop-')) {
    for (const tool of definitions) {
      assert.match(byName(tool.name).description, /^AI desktop\./, tool.name);
      assert.doesNotMatch(byName(tool.name).description, /physical|real desktop|user's XFCE/i);
    }
  }
  assert.match(byName('browser_click').inputSchema.properties.target.description, /Snapshot ref only.*e12.*unique selector.*do not copy the full labeled snapshot line/);
  assert.match(byName('browser_find').inputSchema.properties.regex.description, /case-sensitive by default.*\/error\/i.*text or regex, not both/);
  assert.match(byName('browser_find').inputSchema.properties.text.description, /Case-insensitive.*text or regex, not both/);
  assert.match(byName('browser_take_screenshot').inputSchema.properties.scale.description, /CSS pixels \(default\).*device pixels.*device pixel ratio/);
  assert.match(byName('browser_take_screenshot').inputSchema.properties.fullPage.description, /Incompatible with element screenshots/);
  assert.match(byName('browser_take_screenshot').description, /do not act from this screenshot/);
  assert.match(byName('browser_run_code_unsafe').inputSchema.properties.filename.description, /overrides code/);
  assert.match(byName('browser_run_code_unsafe').description, /server process.*RCE-equivalent/);
  assert.match(byName('browser_drop').description, /paths, data, or both/);
  assert.match(byName('browser_mouse_click_xy').inputSchema.properties.delay.description, /milliseconds.*default: 0/);
  assert.match(byName('browser_wait_for').inputSchema.properties.time.description, /seconds/);
  assert.match(byName('mouse_move_relative').inputSchema.properties.dx.description, /pixels: positive right, negative left/);
  assert.match(byName('mouse_scroll').description, /positive clicks down, negative up/);
  assert.match(byName('keyboard_key_down').description, /always release with keyboard_key_up/);
  assert.match(byName('shell_run').description, /non-root.*must remain under HOME/);
  assert.match(byName('browser_read_tabs').description, /Personal browser tabs excluded.*Lazy content needs scrolling.*zero-based.*errors and omitted indices/);
  assert.match(byName('browser_scrape').description, /1–8 HTTP\(S\).*3 at once.*cookies.*per-URL errors.*Close only temporary tabs.*DOMContentLoaded/);
});

test('catalog achieves material character savings with every tool still present', t => {
  // Baseline reproduces the gateway's previous AI desktop prefix/rewrite.
  const advertised = [...Object.entries(cache.backends).flatMap(([backend, definitions]) => definitions.map(tool => ({
    ...tool,
    description: backend.startsWith('desktop-') ? `AI desktop. ${(tool.description || '').replace(/(?:physical|real|human(?:'s)?) desktop/gi, 'AI desktop')}` : tool.description
  }))), ...extraTools];
  const before = JSON.stringify(advertised).length;
  const after = JSON.stringify(compact).length;
  t.diagnostic(`78 tools: ${before} → ${after} JSON characters; saved ${before - after} (${((1 - after / before) * 100).toFixed(1)}%).`);
  assert.ok(after <= before * 0.90, `Expected at least 10% reduction, got ${before} → ${after}`);
});
