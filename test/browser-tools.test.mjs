import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { extraTools, callExtraTool } from '../src/browser-tools.mjs';

function invokeFor(page, format = 'markdown') {
  return async (name, { code }, signal) => {
    assert.equal(name, 'browser_run_code_unsafe');
    if (signal?.aborted) throw new Error('Cancelled');
    const payload = await vm.runInNewContext(`(${code})`)(page);
    const json = JSON.stringify(payload);
    return { content: [{ type: 'text', text: format === 'json' ? JSON.stringify({ result: json }) : format === 'raw' ? json : `### Result\n${json}\n### Ran Playwright code\n\`\`\`js\n${code}\n\`\`\`` }] };
  };
}

const readPage = (title, overrides = {}) => ({
  isClosed: () => false,
  evaluate: async (_extract, opts) => ({ title, text: 'content'.slice(0, opts.max_chars), url: `https://example.test/${title}`, links: [] }),
  ...overrides
});

test('tool definitions have concise bounded schemas and unique names', () => {
  assert.deepEqual(extraTools.map(t => t.name), ['browser_read_tabs', 'browser_scrape']);
  for (const tool of extraTools) assert.equal(tool.inputSchema.additionalProperties, false);
});

test('tab reader preserves requested order, handles a missing tab and never selects a tab', async () => {
  const pages = [readPage('zero'), readPage('one')];
  pages[0].context = () => ({ pages: () => pages });
  const result = await callExtraTool('browser_read_tabs', { tabs: [1, 8, 0] }, invokeFor(pages[0]));
  assert.equal(result.isError, undefined);
  assert.deepEqual(result.structuredContent.pages.map(p => p.index), [1, 8, 0]);
  assert.deepEqual(result.structuredContent.pages.map(p => p.ok), [true, false, true]);
  assert.equal(result.structuredContent.partial, true);
  assert.equal(result.structuredContent.succeeded, 2);
  assert.ok(!result.content[0].text.includes('Ran Playwright code'));
});

test('all tabs are bounded with omitted indices and default current reads only current', async () => {
  const pages = Array.from({ length: 18 }, (_, i) => readPage(String(i)));
  pages[3].context = () => ({ pages: () => pages });
  const all = await callExtraTool('browser_read_tabs', { tabs: 'all' }, invokeFor(pages[3], 'json'));
  assert.equal(all.structuredContent.pages.length, 16);
  assert.deepEqual(all.structuredContent.omitted_indices, [16, 17]);
  const current = await callExtraTool('browser_read_tabs', {}, invokeFor(pages[3], 'raw'));
  assert.equal(current.structuredContent.pages.length, 1);
  assert.equal(current.structuredContent.pages[0].index, 3);
});

test('scraping runs at most three pages concurrently and closes every owned tab after individual errors', async () => {
  let active = 0; let peak = 0; let created = 0; let closed = 0;
  const existing = readPage('existing', { close: () => assert.fail('Existing page must not close') });
  existing.context = () => ({ newPage: async () => {
    created++; active++; peak = Math.max(peak, active);
    let targetURL;
    return {
      goto: async url => {
        targetURL = url;
        await new Promise(resolve => setTimeout(resolve, 5));
        if (url.endsWith('/bad')) throw new Error('Navigation failed');
        return { status: () => url.endsWith('/404') ? 404 : 200 };
      },
      evaluate: async () => ({ title: targetURL, text: 'extracted', url: targetURL, links: [] }),
      close: async options => { assert.equal(options.runBeforeUnload, false); closed++; active--; },
      isClosed: () => false
    };
  } });
  const result = await callExtraTool('browser_scrape', { urls: ['a', 'bad', 'c', '404', 'e', 'f', 'g', 'h'].map(x => `https://example.test/${x}`) }, invokeFor(existing));
  assert.equal(peak, 3);
  assert.equal(created, 8);
  assert.equal(closed, 8);
  assert.equal(active, 0);
  assert.equal(result.structuredContent.failed, 2);
  assert.equal(result.structuredContent.pages[1].error, 'Navigation failed');
  assert.equal(result.structuredContent.pages[3].error, 'HTTP 404');
  assert.equal(result.structuredContent.pages[3].text, 'extracted');
});

test('reject malformed arguments without invoking backend', async () => {
  const invoke = () => assert.fail('Invalid input must not invoke browser');
  for (const [name, args] of [
    ['browser_scrape', { urls: ['file:///etc/passwd'] }],
    ['browser_scrape', { urls: ['javascript:alert(1)'] }],
    ['browser_scrape', { urls: ['https://name:password@example.test'] }],
    ['browser_scrape', { urls: ['https://'] }],
    ['browser_scrape', { urls: [] }],
    ['browser_scrape', { urls: Array(9).fill('https://example.test') }],
    ['browser_scrape', { urls: ['https://example.test'], timeout_ms: 20001 }],
    ['browser_read_tabs', { tabs: [-1] }],
    ['browser_read_tabs', { tabs: [1, 1] }],
    ['browser_read_tabs', { tabs: 'other' }],
    ['browser_read_tabs', { max_chars: 1 }],
    ['browser_read_tabs', { max_links: 81 }],
    ['browser_read_tabs', { content: 'invalid' }],
    ['browser_read_tabs', { code: 'surprise' }]
  ]) assert.equal((await callExtraTool(name, args, invoke)).isError, true, JSON.stringify(args));
});

test('URL strings cannot inject code and cancellation is passed through', async () => {
  const controller = new AbortController();
  const urls = ['https://example.test/?q=";throw new Error(\'injected\');//'];
  let passedSignal;
  let passedCode;
  const result = await callExtraTool('browser_scrape', { urls }, async (_name, { code }, signal) => {
    passedSignal = signal; passedCode = code;
    return { isError: true, content: [{ type: 'text', text: 'backend unavailable' }] };
  }, controller.signal);
  assert.equal(result.isError, true);
  assert.equal(passedSignal, controller.signal);
  assert.doesNotThrow(() => vm.runInNewContext(`(${passedCode})`));
  controller.abort();
  const cancelled = await callExtraTool('browser_read_tabs', {}, () => assert.fail('Cancelled'), controller.signal);
  assert.equal(cancelled.isError, true);
});

test('all failed pages mark tool error and undecodable output fails honestly', async () => {
  const page = { context: () => ({ pages: () => [] }) };
  assert.equal((await callExtraTool('browser_read_tabs', {}, invokeFor(page))).isError, true);
  const result = await callExtraTool('browser_read_tabs', {}, async () => ({ content: [{ type: 'text', text: 'unexpected output' }] }));
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /may have run/);
});

test('document extraction includes offscreen text, normalizes and truncates content and links', async () => {
  let opts;
  const page = readPage('unused', { evaluate: async (extract, options) => {
    opts = options;
    const anchors = [
      { href: 'https://example.test/a', innerText: ' A\n link ' },
      { href: 'https://example.test/a', innerText: 'duplicate' },
      { href: 'javascript:bad()', innerText: 'skip' },
      { href: 'https://example.test/b', innerText: 'B' }
    ];
    const root = { innerText: `Header\n\n\n${'offscreen content '.repeat(30)}`, querySelectorAll: () => anchors };
    return vm.runInNewContext(`(${extract.toString()})(opts)`, {
      opts, document: { querySelector: () => root, body: root, documentElement: { scrollHeight: 8000 }, title: 'A title' },
      location: { href: 'https://example.test/page' }, window: { innerHeight: 720 }
    });
  } });
  page.context = () => ({ pages: () => [page] });
  const result = await callExtraTool('browser_read_tabs', { max_chars: 200, max_links: 1 }, invokeFor(page));
  const doc = result.structuredContent.pages[0];
  assert.equal(doc.text.length, 200);
  assert.equal(doc.truncated, true);
  assert.equal(doc.links.length, 1);
  assert.equal(doc.links[0].text, 'A link');
  assert.equal(doc.links_truncated, true);
  assert.equal(doc.document_height, 8000);
  assert.equal(doc.viewport_height, 720);
});
