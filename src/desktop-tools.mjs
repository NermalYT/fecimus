const actions = ['mouse_move', 'mouse_move_relative', 'mouse_click', 'mouse_double_click', 'mouse_scroll', 'mouse_drag_to', 'mouse_release_all', 'keyboard_type_text', 'keyboard_paste_text', 'keyboard_press_key', 'keyboard_hotkey', 'keyboard_release_modifiers', 'window_focus', 'window_geometry', 'window_minimize', 'window_maximize', 'window_restore', 'window_close'];
export const desktopTools = [
  { name: 'fecimus_desktop_state', description: 'Observe Fecimus’s private desktop: windows, active window, screen/cursor metadata and optional screenshot in one call. Use before selecting coordinates. screenshot=false supports text-only models.',
    inputSchema: { type: 'object', properties: { screenshot: { type: 'boolean', default: true } }, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  { name: 'fecimus_desktop_actions', description: 'Run 1–12 already-planned private-desktop actions, then optionally screenshot. Uses existing tool argument schemas. Validates every argument schema first, holds desktop focus through the sequence, stops on the first failure and never replays actions. Observe state first; do not guess coordinates. screenshot=false for text-only models.',
    inputSchema: { type: 'object', properties: { steps: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', properties: { tool: { type: 'string', enum: actions }, arguments: { type: 'object', default: {} } }, required: ['tool'], additionalProperties: false } }, screenshot: { type: 'boolean', default: true } }, required: ['steps'], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true } }
];

export async function callDesktopTool(name, args, invokeBatch, signal, options) {
  const steps = name === 'fecimus_desktop_state'
    ? ['window_list', 'window_active', 'desktop_screen_info'].map(tool => ({ tool, arguments: {} }))
    : args.steps;
  if (!desktopTools.some(tool => tool.name === name)) throw new Error('Unknown desktop helper.');
  const planned = [...steps, ...(args.screenshot ? [{ tool: 'desktop_screenshot', arguments: {} }] : [])];
  const batch = await invokeBatch(planned, signal, options);
  const images = [];
  const results = batch.results.map(({ tool, result }) => {
    const text = (result.content || []).filter(part => part.type === 'text').map(part => part.text).join('\n');
    images.push(...(result.content || []).filter(part => part.type === 'image'));
    let value = text;
    if (text.length > 16000) value = { text: text.slice(0, 16000), truncated: true };
    else { try { value = JSON.parse(text); } catch {} }
    return { tool, ok: !result.isError, result: value };
  });
  return { ...(batch.stopped ? { isError: true } : {}), content: [
    { type: 'text', text: JSON.stringify({ completed: batch.completed, ...(batch.failed_step === undefined ? {} : { failed_step: batch.failed_step }), stopped: batch.stopped, ...(batch.error ? { error: batch.error } : {}), results }) }, ...images
  ] };
}
