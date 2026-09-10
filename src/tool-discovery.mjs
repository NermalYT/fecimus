export const discoveryTools = [
  { name: 'fecimus_tools', description: 'Search all Fecimus capabilities and retrieve exact input schemas before calling them. Empty query lists tool names. Works in compact and full modes.',
    inputSchema: { type: 'object', properties: { query: { type: 'string', maxLength: 200, default: '' }, names: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', maxLength: 100 } }, limit: { type: 'integer', minimum: 1, maximum: 20, default: 8 } }, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fecimus_call', description: 'Call one Fecimus tool by its exact name and arguments from fecimus_tools. Applies the original schema, cancellation and serialization. Does not retry. Read image results if your model supports vision.',
    inputSchema: { type: 'object', properties: { tool: { type: 'string', minLength: 1, maxLength: 100 }, arguments: { type: 'object', default: {} } }, required: ['tool'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }
];

export function searchTools(tools, { query = '', names, limit = 8 } = {}) {
  const inventory = tools.filter(tool => !discoveryTools.some(item => item.name === tool.name));
  if (names) {
    const found = names.map(name => inventory.find(tool => tool.name === name));
    if (found.some(tool => !tool)) throw new Error('Unknown tool name. Search the current catalog first.');
    return { tools: found, total: inventory.length };
  }
  const terms = query.toLowerCase().split(/[\s_-]+/).filter(Boolean);
  if (!terms.length) return { total: inventory.length, names: inventory.map(tool => tool.name), hint: 'Pass names to retrieve exact schemas, or query to search.' };
  const ranked = inventory.map(tool => ({ tool, score: terms.reduce((score, term) => score + (tool.name.toLowerCase().includes(term) ? 4 : 0) + ((tool.description || '').toLowerCase().includes(term) ? 1 : 0), 0) }))
    .filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name));
  return { tools: ranked.slice(0, limit).map(row => row.tool), total: inventory.length, matched: ranked.length, truncated: ranked.length > limit };
}

export function advertisedTools(tools, mode) {
  if (mode === 'full') return tools;
  if (mode !== 'compact') throw new Error('tool_mode must be full or compact.');
  const initial = new Set(['fecimus_status', 'fecimus_tools', 'fecimus_call', 'fecimus_control_panel', 'fecimus_help']);
  return tools.filter(tool => initial.has(tool.name));
}
