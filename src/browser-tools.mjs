// Fixed Playwright programs: no shell, OS pointer, foregrounding, or user-supplied code.
const limits = {
  max_chars: { type: 'integer', minimum: 200, maximum: 20000, default: 6000, description: 'Maximum extracted text characters per page. Reports when truncated.' },
  max_links: { type: 'integer', minimum: 0, maximum: 80, default: 20, description: 'Maximum distinct HTTP(S) links per page; 0 omits links.' },
  content: { type: 'string', enum: ['main', 'body'], default: 'main', description: 'Prefer main/article content, falling back to body; choose body for the whole document.' }
};

export const extraTools = [
  {
    name: 'browser_read_tabs',
    description: 'Read loaded text and links from Fecimus browser tabs without selecting or foregrounding them. Works in Fecimus’s hidden browser while the user works elsewhere. Reads beyond the viewport; unloaded lazy content still requires scrolling. Current, all (first 16), or zero-based tab indices. Reports errors and omitted indices individually. Does not access tabs in a separate personal browser.',
    inputSchema: {
      type: 'object',
      properties: {
        tabs: { anyOf: [{ type: 'string', enum: ['current', 'all'] }, { type: 'array', items: { type: 'integer', minimum: 0 }, minItems: 1, maxItems: 16, uniqueItems: true }], default: 'current', description: 'Tab selection. Indices match browser_tabs; all returns at most 16 tabs.' },
        ...limits
      },
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  },
  {
    name: 'browser_scrape',
    description: 'Read 1–8 HTTP(S) URLs in temporary Fecimus background tabs, up to 3 at once. Returns compact page text, title, links, HTTP status and individual failures. Uses Fecimus browser cookies. Closes only its temporary tabs, preserves existing tabs, and never moves the user’s OS cursor. Waits for DOMContentLoaded; pages requiring later rendering or scrolling may need normal browser tools.',
    inputSchema: {
      type: 'object',
      properties: {
        urls: { type: 'array', minItems: 1, maxItems: 8, items: { type: 'string', minLength: 1, maxLength: 8192, pattern: '^https?://' }, description: 'Absolute HTTP(S) URLs to read in supplied order.' },
        ...limits,
        timeout_ms: { type: 'integer', minimum: 1000, maximum: 20000, default: 10000, description: 'Navigation timeout per URL in milliseconds.' }
      },
      required: ['urls'],
      additionalProperties: false
    },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }
];

function fail(message) {
  return { isError: true, content: [{ type: 'text', text: message }] };
}

function integer(args, name, fallback, min, max) {
  const value = args[name] ?? fallback;
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}.`);
  return value;
}

function options(name, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('Arguments must be a JSON object.');
  const allowed = new Set(['max_chars', 'max_links', 'content', name === 'browser_scrape' ? 'urls' : 'tabs', ...(name === 'browser_scrape' ? ['timeout_ms'] : [])]);
  for (const key of Object.keys(args)) if (!allowed.has(key)) throw new Error(`Unknown argument: ${key}.`);
  const result = {
    max_chars: integer(args, 'max_chars', 6000, 200, 20000),
    max_links: integer(args, 'max_links', 20, 0, 80),
    content: args.content ?? 'main'
  };
  if (!['main', 'body'].includes(result.content)) throw new Error('content must be main or body.');
  if (name === 'browser_read_tabs') {
    const tabs = args.tabs ?? 'current';
    if (tabs !== 'current' && tabs !== 'all' && !(Array.isArray(tabs) && tabs.length >= 1 && tabs.length <= 16 && tabs.every(n => Number.isInteger(n) && n >= 0) && new Set(tabs).size === tabs.length)) {
      throw new Error('tabs must be current, all, or 1–16 distinct nonnegative tab indices.');
    }
    result.tabs = tabs;
  } else {
    if (!Array.isArray(args.urls) || args.urls.length < 1 || args.urls.length > 8) throw new Error('urls must contain 1–8 absolute HTTP(S) URLs.');
    result.urls = args.urls.map((value, index) => {
      if (typeof value !== 'string' || value.length > 8192 || !/^https?:\/\//.test(value)) throw new Error(`urls[${index}] must be an absolute HTTP(S) URL.`);
      let url;
      try { url = new URL(value); } catch { throw new Error(`urls[${index}] is not a valid URL.`); }
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error(`urls[${index}] must be an absolute HTTP(S) URL.`);
      if (url.username || url.password) throw new Error(`urls[${index}] must not contain embedded credentials.`);
      return url.href;
    });
    result.timeout_ms = integer(args, 'timeout_ms', 10000, 1000, 20000);
  }
  return result;
}

// Executed in the browser renderer; deliberately self-contained.
function extractDocument(opts) {
  const root = (opts.content === 'main' && document.querySelector('main, [role="main"], article')) || document.body || document.documentElement;
  const raw = root ? (root.innerText ?? root.textContent ?? '') : '';
  const text = raw.replace(/\r/g, '').replace(/[\t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const links = [];
  const seen = new Set();
  let linksTruncated = false;
  if (opts.max_links > 0 && root) {
    for (const anchor of root.querySelectorAll('a[href]')) {
      const href = anchor.href;
      if (!/^https?:\/\//i.test(href) || seen.has(href)) continue;
      seen.add(href);
      if (links.length === opts.max_links) { linksTruncated = true; break; }
      links.push({ text: (anchor.innerText || anchor.getAttribute('aria-label') || anchor.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200), url: href.slice(0, 8192) });
    }
  }
  return {
    url: location.href,
    title: document.title.slice(0, 1000),
    text: text.slice(0, opts.max_chars),
    truncated: text.length > opts.max_chars,
    text_chars: text.length,
    links,
    links_truncated: linksTruncated,
    document_height: document.documentElement?.scrollHeight ?? 0,
    viewport_height: window.innerHeight
  };
}

function buildCode(name, opts) {
  const prelude = `const opts = ${JSON.stringify(opts)}; const extract = ${extractDocument.toString()}; const errorText = e => String(e?.message || e).slice(0, 1000);`;
  if (name === 'browser_read_tabs') return `async (page) => {
    ${prelude}
    const tabs = page.context().pages();
    const indices = opts.tabs === 'current' ? [tabs.indexOf(page)] : opts.tabs === 'all' ? tabs.map((_, i) => i).slice(0, 16) : opts.tabs;
    const pages = new Array(indices.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, indices.length) }, async () => {
      while (next < indices.length) {
        const position = next++; const index = indices[position]; const target = tabs[index];
        try {
          if (!target || target.isClosed()) throw new Error('Tab does not exist or is closed. Refresh browser_tabs.');
          pages[position] = { index, ok: true, ...await target.evaluate(extract, opts) };
        } catch (error) { pages[position] = { index, ok: false, error: errorText(error) }; }
      }
    }));
    return { fecimus_browser_result: 1, tool: 'browser_read_tabs', total_tabs: tabs.length, omitted_indices: opts.tabs === 'all' ? tabs.map((_, i) => i).slice(16) : [], pages };
  }`;
  return `async (page) => {
    ${prelude}
    const context = page.context(); const pages = new Array(opts.urls.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, opts.urls.length) }, async () => {
      while (next < opts.urls.length) {
        const index = next++; const requested_url = opts.urls[index]; let target;
        try {
          target = await context.newPage();
          const response = await target.goto(requested_url, { waitUntil: 'domcontentloaded', timeout: opts.timeout_ms });
          const status = response ? response.status() : null;
          pages[index] = { requested_url, ok: status === null || status < 400, status, ...await target.evaluate(extract, opts), ...(status !== null && status >= 400 ? { error: 'HTTP ' + status } : {}) };
        } catch (error) { pages[index] = { requested_url, ok: false, error: errorText(error) }; }
        finally {
          if (target) {
            try { await target.close({ runBeforeUnload: false }); }
            catch (error) { if (!target.isClosed()) pages[index].cleanup_error = errorText(error); }
          }
        }
      }
    }));
    return { fecimus_browser_result: 1, tool: 'browser_scrape', pages };
  }`;
}

function unpack(result, name) {
  if (result?.isError) return result;
  const candidates = [];
  if (result?.structuredContent) candidates.push(result.structuredContent);
  for (const item of result?.content ?? []) {
    if (item.type !== 'text') continue;
    const raw = item.text.trim();
    candidates.push(raw);
    const section = raw.match(/(?:^|\n)### Result\n([\s\S]*?)(?=\n### |$)/);
    if (section) candidates.push(section[1].trim());
  }
  for (let candidate of candidates) {
    try {
      if (typeof candidate === 'string') candidate = JSON.parse(candidate);
      if (candidate?.result !== undefined) candidate = typeof candidate.result === 'string' ? JSON.parse(candidate.result) : candidate.result;
      if (candidate?.fecimus_browser_result !== 1 || candidate.tool !== name || !Array.isArray(candidate.pages)) continue;
      const { fecimus_browser_result, ...payload } = candidate;
      payload.succeeded = payload.pages.filter(p => p.ok).length;
      payload.failed = payload.pages.length - payload.succeeded;
      payload.partial = payload.succeeded > 0 && payload.failed > 0;
      return { ...(payload.failed && !payload.succeeded ? { isError: true } : {}), content: [{ type: 'text', text: JSON.stringify(payload) }], structuredContent: payload };
    } catch { /* The backend may have returned a status section before its result. */ }
  }
  return fail(`Fecimus could not decode ${name}'s browser result. The browser operation may have run; check existing tabs before retrying. ${result?.content?.filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 1500) || 'No text returned.'}`);
}

export async function callExtraTool(name, args = {}, invoke, signal) {
  if (!extraTools.some(tool => tool.name === name)) return fail(`Unknown Fecimus browser helper: ${name}.`);
  try {
    if (signal?.aborted) throw new Error('Request cancelled before browser execution.');
    const opts = options(name, args);
    const result = await invoke('browser_run_code_unsafe', { code: buildCode(name, opts) }, signal);
    return unpack(result, name);
  } catch (error) {
    return fail(`${name}: ${String(error?.message || error).slice(0, 1500)}`);
  }
}
