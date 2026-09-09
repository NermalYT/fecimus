import fs from 'node:fs/promises';
import path from 'node:path';

// New Playwright versions save automatic snapshots as files. Inline bounded
// snapshots so the local model gets usable element refs without another turn.
export async function inlineBrowserSnapshot(name, result, outputDir, maxChars = 16000) {
  if (!name.startsWith('browser_') || result.isError || !Array.isArray(result.content)) return result;
  const limit = Number.isInteger(maxChars) && maxChars >= 1000 && maxChars <= 64000 ? maxChars : 16000;
  const content = await Promise.all(result.content.map(async block => {
    if (block.type !== 'text') return block;
    const match = block.text.match(/(?:^|\n)### Snapshot\n- \[Snapshot\]\(([^)\n]+)\)/);
    if (!match) return block;
    const filename = match[1].split('browser-output/').at(-1);
    if (!/^(?:\d+\/)?page-[\dTZ:.-]+\.yml$/.test(filename)) return block;
    try {
      const root = await fs.realpath(outputDir);
      const file = await fs.realpath(path.join(root, filename));
      if (!file.startsWith(root + path.sep) || (await fs.stat(file)).size > 4 * 1024 * 1024) return block;
      const text = await fs.readFile(file, 'utf8');
      const bounded = text.length > limit ? text.slice(0, limit).replace(/\n[^\n]*$/, '') : text;
      const note = text.length > limit ? '\nSnapshot truncated. Use browser_find or browser_snapshot with a target for the rest.' : '';
      const section = `${match[0]}\n\n${bounded}${note}`;
      return { ...block, text: block.text.replace(match[0], section) };
    } catch { return block; }
  }));
  return { ...result, content };
}
