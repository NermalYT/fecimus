import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const assets = new Map([
  ['/', ['control-panel.html', 'text/html; charset=utf-8']],
  ['/panel.js', ['control-panel.js', 'text/javascript; charset=utf-8']],
  ['/panel.css', ['control-panel.css', 'text/css; charset=utf-8']]
]);
const assetRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), 'ui');
const secureEqual = (a, b) => { const x = Buffer.from(a || ''), y = Buffer.from(b); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export async function startControlPanel({ dataDir, getStatus, getScreenshot, control, getJobs, cancelJob, cancelAgent, port = 0 }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('control.port must be an integer from0 to65535.');
  const token = crypto.randomBytes(32).toString('hex');
  let origin;
  const pending = new Set();
  let screenshotPromise, lastScreenshot, screenshotTime = 0;
  const serve = async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
    if (req.headers.host !== new URL(origin).host) return json(403, { error: 'Unexpected Host header.' });
    const url = new URL(req.url, origin);
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const [file, type] = assets.get(url.pathname);
      res.writeHead(200, { 'Content-Type': type }); res.end(await fs.readFile(path.join(assetRoot, file))); return;
    }
    if (!url.pathname.startsWith('/api/')) return json(404, { error: 'Not found.' });
    if (!secureEqual(req.headers.authorization, `Bearer ${token}`)) return json(401, { error: 'Open the current private panel link from Fecimus.' });
    if (req.headers.origin && req.headers.origin !== origin) return json(403, { error: 'Unexpected Origin header.' });
    if (req.method === 'GET' && url.pathname === '/api/status') return json(200, { ...await getStatus(), control: control.snapshot(), jobs: await getJobs() });
    if (req.method === 'GET' && url.pathname === '/api/screenshot') {
      // Multiple browser viewers share one capture; no continuous captures while closed.
      if (!lastScreenshot || Date.now() - screenshotTime > 1000) {
        screenshotPromise ??= Promise.resolve().then(getScreenshot).then(value => { lastScreenshot = value; screenshotTime = Date.now(); return value; }).finally(() => { screenshotPromise = null; });
        await screenshotPromise;
      }
      return json(200, lastScreenshot);
    }
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed.' });
    if (req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') return json(403, { error: 'Same-origin JSON requests required.' });
    let body = '';
    for await (const chunk of req) { body += chunk; if (body.length > 4096) return json(413, { error: 'Request too large.' }); }
    const args = JSON.parse(body || '{}');
    if (!args || typeof args !== 'object' || Array.isArray(args)) return json(400, { error: 'Expected a JSON object.' });
    if (url.pathname === '/api/control' && Object.keys(args).length === 1 && ['pause', 'resume', 'stop'].includes(args.action)) return json(200, await control[args.action]());
    if (url.pathname === '/api/job/cancel' && Object.keys(args).length === 1 && typeof args.job_id === 'string' && args.job_id.length <= 100) return json(200, await cancelJob(args.job_id));
    if (url.pathname === '/api/agent/cancel' && cancelAgent && Object.keys(args).length === 1 && typeof args.agent_id === 'string' && args.agent_id.length <= 100) return json(200, await cancelAgent(args.agent_id));
    return json(400, { error: 'Unknown request.' });
  };
  const server = http.createServer((req, res) => {
    const task = serve(req, res).catch(error => {
      if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      if (!res.writableEnded) res.end(JSON.stringify({ error: String(error.message).slice(0, 1000) }));
    }).finally(() => pending.delete(task));
    pending.add(task);
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const url = `${origin}/#${token}`;
  const filename = path.join(dataDir, 'control.json');
  const descriptor = { version: 1, pid: process.pid, url, created_at: new Date().toISOString() };
  try {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    const stat = await fs.lstat(filename).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (stat?.isSymbolicLink()) throw new Error('Refusing symlinked control descriptor.');
    const temporary = filename + '.' + crypto.randomUUID() + '.tmp';
    try { await fs.writeFile(temporary, JSON.stringify(descriptor) + '\n', { flag: 'wx', mode: 0o600 }); await fs.rename(temporary, filename); }
    finally { await fs.rm(temporary, { force: true }); }
  } catch (error) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); throw error; }
  return {
    url,
    async close() {
      server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
      // control.json is the last-known session pointer. Never unlink this shared
      // file during close: a newer session may publish between a read and unlink.
      // Its old URL loses access with this listener; `npm run control` validates
      // the live status before opening a saved link, so stale pointers are safe.
    }
  };
}
