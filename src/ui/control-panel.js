const incomingToken = location.hash.slice(1);
if (incomingToken) sessionStorage.setItem('fecimus-panel-token', incomingToken);
const token = incomingToken || sessionStorage.getItem('fecimus-panel-token');
history.replaceState(null, '', location.pathname);
const $ = id => document.getElementById(id);
let busy = false, capturing = false;
const reportError = message => { $('error').hidden = !message; $('error').textContent = message || ''; };
async function api(route, body) {
  const result = await fetch('/api/' + route, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error || 'Fecimus request failed.');
  return data;
}
function rows(id, items, render) {
  const target = $(id); target.replaceChildren();
  if (!items.length) { const p = document.createElement('p'); p.textContent = 'None'; target.append(p); }
  for (const item of items) { const row = document.createElement('div'); row.className = 'entry'; render(row, item); target.append(row); }
}
function label(row, title, detail, ok) {
  const text = document.createElement('span'); text.textContent = title;
  const meta = document.createElement('small'); meta.textContent = detail; if (ok !== undefined) meta.className = ok ? 'ok' : 'bad';
  row.append(text, meta);
}
async function refresh() {
  if (busy || document.hidden) return;
  busy = true;
  try {
    const data = await api('status');
    $('connection').textContent = data.control.paused ? 'Paused' : 'Connected';
    $('session-title').textContent = 'Fecimus ' + (data.version || '');
    $('summary').textContent = `${data.tools || 0} tools · ${data.tool_mode || 'full'} mode · ${data.runtime?.healthy ? 'private desktop ready' : 'check desktop health'}`;
    $('pause').disabled = data.control.paused; $('resume').disabled = !data.control.paused;
    rows('active', data.control.active, (row, item) => label(row, item.tool, item.elapsed_ms + ' ms'));
    rows('history', data.control.history.slice(0, 30), (row, item) => label(row, item.tool, `${item.ok ? 'OK' : 'Error'} · ${item.ms} ms`, item.ok));
    rows('jobs', data.jobs.jobs || [], (row, item) => {
      label(row, item.label || item.command || item.job_id, item.state);
      if (['starting', 'running', 'cancelling'].includes(item.state)) {
        const button = document.createElement('button'); button.textContent = 'Cancel';
        button.onclick = async () => { button.disabled = true; try { await api('job/cancel', { job_id: item.job_id }); await refresh(); } catch (error) { reportError(error.message); } };
        row.append(button);
      }
    });
    rows('agents', data.agents?.agents || [], (row, item) => {
      label(row, item.model, `${item.state} · ${item.turns} turns`);
      if (item.state === 'running') {
        const button = document.createElement('button'); button.textContent = 'Cancel';
        button.onclick = async () => { button.disabled = true; try { await api('agent/cancel', { agent_id: item.agent_id }); await refresh(); } catch (error) { reportError(error.message); } };
        row.append(button);
      }
    });
    $('diagnostics').textContent = JSON.stringify({ runtime: data.runtime, backends: data.backends, studio: data.studio }, null, 2);
    reportError('');
  } catch (error) { $('connection').textContent = 'Disconnected'; reportError(error.message); }
  finally { busy = false; }
}
async function capture() {
  if (capturing || document.hidden) return;
  capturing = true; $('capture').disabled = true;
  try {
    const data = await api('screenshot');
    if (!data.image) throw new Error(data.error || 'No screenshot available.');
    $('screen').src = `data:${data.image.mimeType};base64,${data.image.data}`;
    $('screen').hidden = false; $('empty-screen').hidden = true;
    $('image-meta').textContent = 'Captured ' + new Date().toLocaleTimeString() + ' · read-only private desktop';
  } catch (error) { reportError(error.message); }
  finally { capturing = false; $('capture').disabled = false; }
}
for (const action of ['pause', 'resume', 'stop']) $(action).onclick = async () => {
  try { await api('control', { action }); await refresh(); } catch (error) { reportError(error.message); }
};
$('capture').onclick = capture;
$('live').onchange = () => { if ($('live').checked) capture(); };
if (!token) reportError('Open the current private control link returned by fecimus_control_panel.');
else { refresh(); setInterval(() => { refresh(); if ($('live').checked) capture(); }, 2000); }
