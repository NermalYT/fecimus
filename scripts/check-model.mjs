#!/usr/bin/env node
// Protocol reference: https://lmstudio.ai/docs/developer/openai-compat/tools
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TOOL = 'fecimus_echo';
const SCOPE = 'Basic text tool calling only; vision, real MCP actions, and long task sequences are not tested.';
const HELP = `Usage: node scripts/check-model.mjs --model MODEL [options]

Checks a harmless synthetic echo tool through an OpenAI-compatible API.
Load your chosen model and start LM Studio's server first. No model is guessed.

  --model MODEL        Exact model identifier (required)
  --url URL            API base URL (default http://localhost:1234/v1)
  --max-tokens N       Response token budget, 128–8192 (default 1024)
  --timeout-seconds N  Timeout per request, 1–600 (default 120)
  --continue          Also check one synthetic tool-result continuation
  --allow-remote      Explicitly permit a non-loopback endpoint
  --help              Show this help without making requests

Optional authentication: LM_STUDIO_API_TOKEN environment variable.
Default: one inference request, no retries, no real MCP tool execution.
Reasoning models may need a larger token budget. A failure is diagnostic,
not proof that a model can never work. ${SCOPE}
`;

export function endpointURL(value, allowRemote = false) {
  let url;
  try { url = new URL(value); } catch { throw new Error('The API URL must be an absolute HTTP(S) URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('Use an HTTP(S) API URL without embedded credentials, query, or fragment.');
  }
  const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (!allowRemote && !loopback) throw new Error('Non-loopback URL rejected. Use --allow-remote only for an endpoint you intend to contact.');
  const base = url.pathname.replace(/\/+$/, '');
  if (!base) url.pathname = '/v1/chat/completions';
  else if (base.endsWith('/v1')) url.pathname = `${base}/chat/completions`;
  else if (base.endsWith('/v1/chat/completions')) url.pathname = base;
  else throw new Error('The API URL must end in /v1 or /v1/chat/completions, or be the server root.');
  return url;
}

export function parseArgs(argv) {
  const result = { model: null, url: 'http://localhost:1234/v1', maxTokens: 1024, timeoutSeconds: 120, continuation: false, allowRemote: false };
  const values = { '--model': 'model', '--url': 'url', '--max-tokens': 'maxTokens', '--timeout-seconds': 'timeoutSeconds' };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--help' || flag === '-h') return { help: true };
    if (flag === '--continue') result.continuation = true;
    else if (flag === '--allow-remote') result.allowRemote = true;
    else if (Object.hasOwn(values, flag)) {
      const value = argv[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}.`);
      result[values[flag]] = value;
    } else throw new Error('Unknown option. Use --help for accepted arguments.');
  }
  if (!result.model?.trim()) throw new Error('--model is required. Supply the exact identifier of your chosen model.');
  for (const [key, flag, min, max] of [['maxTokens', '--max-tokens', 128, 8192], ['timeoutSeconds', '--timeout-seconds', 1, 600]]) {
    result[key] = Number(result[key]);
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error(`${flag} must be an integer from ${min} to ${max}.`);
  }
  endpointURL(result.url, result.allowRemote);
  return result;
}

export function judgeToolCall(response, nonce) {
  const fail = reason => ({ pass: false, reason });
  if (typeof nonce !== 'string' || !nonce) return fail('The expected nonce must be a nonempty string.');
  const choice = response?.choices?.[0];
  const message = choice?.message;
  if (message?.refusal) return fail('The model returned a refusal.');
  if (choice?.finish_reason === 'length') return fail('The response hit its token limit; increase --max-tokens if needed.');
  if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls) || message.tool_calls.length !== 1) {
    return fail('Expected exactly one parsed tool_calls entry; text resembling a tool call does not pass.');
  }
  const call = message.tool_calls[0];
  if (call?.type !== 'function' || call.function?.name !== TOOL) return fail('The returned tool name or type was incorrect.');
  if (typeof call.id !== 'string' || !call.id.trim()) return fail('The tool call has no usable ID for a tool-result message.');
  if (typeof call.function.arguments !== 'string') return fail('Tool arguments must be a JSON string.');
  let args;
  try { args = JSON.parse(call.function.arguments); } catch { return fail('The tool arguments are malformed JSON.'); }
  if (!args || Array.isArray(args) || typeof args !== 'object' || Object.keys(args).length !== 1 || args.nonce !== nonce) {
    return fail('Tool arguments did not match the required nonce-only schema.');
  }
  return { pass: true, reason: 'Received the expected parsed tool call with valid JSON and the exact nonce.' };
}

export function judgeContinuation(response, receipt) {
  const choice = response?.choices?.[0];
  const message = choice?.message;
  const pass = choice?.finish_reason !== 'length' && message?.role === 'assistant' && !message.refusal &&
    !message.tool_calls?.length && typeof message.content === 'string' && message.content.trim() === receipt;
  return { pass, reason: pass ? 'The final answer matched the synthetic tool receipt.' : 'The final answer did not match the synthetic tool receipt exactly.' };
}

async function completion(endpoint, body, options, fetchImpl, token) {
  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(options.timeoutSeconds * 1000),
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' || error?.name === 'AbortError') throw new Error('Inference timed out; no retry was sent. Increase --timeout-seconds if needed.');
    throw new Error('Could not reach the API, or it attempted a redirect. Check the server address and availability. No retry was sent.');
  }
  // Avoid printing a server error body that could echo authorization or private data.
  if (!response.ok) throw new Error(`The API returned HTTP ${response.status}. Check the model, server, and authentication locally.`);
  try { return await response.json(); } catch { throw new Error('The API did not return a complete valid JSON response.'); }
}

export async function runCheck(options, { fetchImpl = fetch, token = process.env.LM_STUDIO_API_TOKEN } = {}) {
  if (typeof options.model !== 'string' || !options.model.trim()) throw new Error('An explicit model identifier is required.');
  const endpoint = endpointURL(options.url, options.allowRemote);
  const nonce = randomUUID();
  const receipt = randomUUID();
  const messages = [
    { role: 'system', content: 'This is a harmless tool-calling compatibility check. Call the supplied echo tool exactly as requested. After receiving its result, reply only with the receipt field from that result.' },
    { role: 'user', content: `Call ${TOOL} exactly once with nonce ${nonce}.` }
  ];
  const base = { model: options.model, max_tokens: options.maxTokens, temperature: 0, stream: false };
  const tool = { type: 'function', function: {
    name: TOOL, description: 'Synthetic echo for this check. Has no browser, filesystem, shell, or MCP access.',
    parameters: { type: 'object', properties: { nonce: { type: 'string' } }, required: ['nonce'], additionalProperties: false }
  } };
  const started = Date.now();
  const response = await completion(endpoint, { ...base, messages, tools: [tool], tool_choice: 'auto' }, options, fetchImpl, token);
  const first = judgeToolCall(response, nonce);
  const report = { result: first.pass ? 'PASS' : 'FAIL', model: options.model, endpoint: endpoint.href, tool_call: first, scope: SCOPE };
  if (first.pass && options.continuation) {
    const call = response.choices[0].message.tool_calls[0];
    const followup = await completion(endpoint, { ...base, messages: [
      ...messages, { role: 'assistant', content: null, tool_calls: [call] },
      { role: 'tool', tool_call_id: call.id, content: JSON.stringify({ nonce, receipt }) }
    ] }, options, fetchImpl, token);
    report.continuation = judgeContinuation(followup, receipt);
    if (!report.continuation.pass) report.result = 'FAIL';
  }
  report.elapsed_ms = Date.now() - started;
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(HELP);
    else {
      const report = await runCheck(options);
      console.log(JSON.stringify(report, null, 2));
      if (report.result !== 'PASS') process.exitCode = 1;
    }
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 2;
  }
}
