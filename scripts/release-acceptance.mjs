import { appendFile, writeFile } from 'node:fs/promises';

const baseUrl = (process.env.JARVIS_BASE_URL || 'https://fahad-s-studio.notxfahad.workers.dev').replace(/\/+$/, '');
const ownerToken = process.env.JARVIS_APP_TOKEN;
const checks = [];
let failures = 0;

function record(name, status, detail) {
  checks.push({ name, status, detail });
  console.log('[' + status + '] ' + name + ': ' + detail);
  if (status === 'FAIL') failures += 1;
}
if (!ownerToken || ownerToken.length < 32) {
  console.error('JARVIS_APP_TOKEN is missing or too short. Add it as a GitHub Actions secret, not in source or logs.');
  process.exit(2);
}
if (!/^https:\/\//i.test(baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(baseUrl)) {
  console.error('JARVIS_BASE_URL must use HTTPS (HTTP is allowed only for localhost).');
  process.exit(2);
}
async function request(path, options = {}) {
  const headers = { accept: 'application/json' };
  const token = Object.prototype.hasOwnProperty.call(options, 'token') ? options.token : ownerToken;
  if (token) headers.authorization = 'Bearer ' + token;
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(baseUrl + path, {
    method: options.method || 'GET', headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(20000)
  });
  const raw = await response.text();
  let value = null;
  try { value = JSON.parse(raw); } catch {}
  return { response, raw, value };
}
function statusText(r) { return 'HTTP ' + r.status; }

try {
  const r = await request('/health', { token: null });
  record('Worker health', r.response.status === 200 && r.value?.ok === true ? 'PASS' : 'FAIL',
    r.response.status === 200 && r.value?.ok === true ? 'Health endpoint returned HTTP 200.' : 'Unexpected health response (' + statusText(r.response) + ').');
} catch { record('Worker health', 'FAIL', 'Health endpoint could not be reached.'); }

try {
  const r = await request('/personas', { token: null });
  record('Authentication enforcement', r.response.status === 401 ? 'PASS' : 'FAIL',
    r.response.status === 401 ? 'Unauthenticated request rejected with HTTP 401.' : 'Expected HTTP 401; received ' + statusText(r.response) + '.');
} catch { record('Authentication enforcement', 'FAIL', 'Could not check protected-route authentication.'); }

try {
  const r = await request('/personas');
  const ok = r.response.status === 200 && Array.isArray(r.value) && ['calm', 'energetic', 'romantic'].every(x => r.value.includes(x));
  record('Owner authentication', ok ? 'PASS' : 'FAIL', ok ? 'Owner token returned expected personas.' : 'Owner token check failed (' + statusText(r.response) + ').');
} catch { record('Owner authentication', 'FAIL', 'Could not authenticate the owner token.'); }

// Probe the non-streaming Gemini endpoint separately. This distinguishes a
// general provider/key/network problem from a streaming-endpoint-specific issue.
try {
  const started = Date.now();
  const r = await request('/tools/plan', {
    method: 'POST',
    body: {
      message: 'This is a release connectivity probe. No tools are available, so return action none.',
      tools: []
    }
  });
  const elapsedMs = Date.now() - started;
  const ok = r.response.status === 200 && typeof r.value?.action === 'string';
  let detail = 'Gemini generateContent responded in ' + elapsedMs + ' ms.';
  if (!ok) {
    const providerDetail = typeof r.value?.error === 'string'
      ? r.value.error.replace(/[\r\n|]/g, ' ').slice(0, 160)
      : '';
    detail = 'Non-stream Gemini probe returned ' + statusText(r.response) +
      ' after ' + elapsedMs + ' ms' + (providerDetail ? ': ' + providerDetail : '. No safe provider detail was returned.');
  }
  record('Gemini non-stream API probe', ok ? 'PASS' : 'FAIL', detail);
} catch (error) {
  const reason = String(error?.message || error || 'unknown request error').replace(/[\r\n|]/g, ' ').slice(0, 160);
  record('Gemini non-stream API probe', 'FAIL', 'Probe request failed: ' + reason);
}

try {
  const r = await request('/chat', { method: 'POST', body: { message: 'For this release check, reply with exactly JARVIS_RELEASE_OK and nothing else.', persona: 'calm', history: [], diagnostic: true } });
  const blocks = r.raw.split(/\r?\n\r?\n/);
  function eventPayload(name) {
    const block = blocks.find(x => new RegExp('^event: ' + name + '(?:\\r?\\n|$)').test(x));
    const line = block && block.split(/\r?\n/).find(x => x.startsWith('data:'));
    try { return line ? JSON.parse(line.slice(5).trim()) : null; } catch { return null; }
  }
  const donePayload = eventPayload('done');
  const errorPayload = eventPayload('error');
  const ok = r.response.status === 200 && donePayload?.text?.includes('JARVIS_RELEASE_OK') && !errorPayload;
  let detail = 'Authenticated Gemini streaming completed.';
  if (!ok) {
    if (typeof errorPayload?.message === 'string' && errorPayload.message.trim()) {
      detail = 'Worker stream error: ' + errorPayload.message.replace(/[\r\n|]/g, ' ').slice(0, 180);
    } else if (r.response.status !== 200) {
      const providerDetail = typeof r.value?.error === 'string'
        ? r.value.error.replace(/[\r\n|]/g, ' ').slice(0, 160)
        : '';
      detail = 'Gemini chat returned ' + statusText(r.response) +
        (providerDetail ? ': ' + providerDetail : '. Response content was not logged.');
    } else if (!donePayload) {
      detail = 'HTTP 200, but the stream did not include a done event. Response content was not logged.';
    } else {
      detail = 'Stream completed without the expected diagnostic marker. Response content was not logged.';
    }
  }
  record('Gemini streaming chat', ok ? 'PASS' : 'FAIL', detail);
} catch (error) {
  const reason = String(error?.message || error || 'unknown request error').replace(/[\r\n|]/g, ' ').slice(0, 160);
  record('Gemini streaming chat', 'FAIL', 'Smoke request failed: ' + reason);
}

let deviceId = null;
let deviceToken = null;
try {
  const p = await request('/devices/pair', { method: 'POST', body: {} });
  if (p.response.status !== 200 || typeof p.value?.code !== 'string') {
    record('Device pairing flow', 'FAIL', 'Could not create one-time pairing code (' + statusText(p.response) + ').');
  } else {
    const redeemed = await request('/devices/redeem', { method: 'POST', token: null, body: { code: p.value.code, label: 'release-acceptance-automated-test' } });
    if (redeemed.response.status !== 200 || typeof redeemed.value?.deviceId !== 'string' || typeof redeemed.value?.token !== 'string') {
      record('Device pairing flow', 'FAIL', 'Could not redeem one-time code (' + statusText(redeemed.response) + ').');
    } else {
      deviceId = redeemed.value.deviceId;
      deviceToken = redeemed.value.token;
      const replay = await request('/devices/redeem', { method: 'POST', token: null, body: { code: p.value.code, label: 'release-acceptance-replay-test' } });
      record('One-time code replay protection', replay.response.status === 409 ? 'PASS' : 'FAIL', replay.response.status === 409 ? 'A redeemed one-time code was rejected on reuse.' : 'Expected HTTP 409 on code reuse; received ' + statusText(replay.response) + '.');
      const session = await request('/devices', { token: deviceToken });
      const ok = session.response.status === 200 && session.value?.paired === true && session.value?.platform === 'android';
      record('Device pairing flow', ok ? 'PASS' : 'FAIL', ok ? 'One-time code redeemed and device token authenticated.' : 'Device token did not authenticate (' + statusText(session.response) + ').');
    }
  }
} catch { record('Device pairing flow', 'FAIL', 'Pairing and redemption flow failed.'); }
finally {
  if (deviceId) {
    try {
      const r = await request('/devices/revoke', { method: 'POST', body: { id: deviceId } });
      const ok = r.response.status === 200 && r.value?.revoked === true;
      record('Device test cleanup', ok ? 'PASS' : 'FAIL', ok ? 'Temporary device was revoked.' : 'Revocation was not confirmed (' + statusText(r.response) + ').');
      try {
        const after = await request('/devices', { token: deviceToken });
        record('Revoked device token rejection', after.response.status === 401 ? 'PASS' : 'FAIL', after.response.status === 401 ? 'Revoked token was rejected with HTTP 401.' : 'Expected HTTP 401 after revocation; received ' + statusText(after.response) + '.');
      } catch { record('Revoked device token rejection', 'FAIL', 'Could not verify the token was rejected after revocation.'); }
    } catch { record('Device test cleanup', 'FAIL', 'Could not confirm revocation of the temporary device.'); }
  }
}

try {
  const r = await request('/email/diagnostics');
  if (r.response.status === 503) record('Gmail API readiness', 'BLOCKED', 'Google OAuth runtime settings or Gmail connection are missing.');
  else if (r.response.status !== 200) record('Gmail API readiness', 'FAIL', 'Gmail diagnostic returned ' + statusText(r.response) + '.');
  else if (!r.value?.connected) record('Gmail API readiness', 'BLOCKED', 'OAuth settings exist, but the owner must connect a Gmail account.');
  else if (r.value?.gmailApi === 'ok') record('Gmail API readiness', 'PASS', 'Gmail token refresh and one-message list succeeded; no mail content was returned.');
  else record('Gmail API readiness', 'FAIL', 'Gmail is connected but the read-only API probe failed.');
} catch { record('Gmail API readiness', 'BLOCKED', 'Gmail diagnostics could not run.'); }

try {
  const r = await request('/video/diagnostics');
  if (r.response.status !== 200) record('Paid video configuration', 'BLOCKED', 'Video diagnostic returned ' + statusText(r.response) + '.');
  else if (!r.value?.configured) record('Paid video configuration', 'BLOCKED', 'FAL_KEY is missing. No paid provider call was made.');
  else if (!r.value?.dailyBudgetValid) record('Paid video configuration', 'FAIL', 'FAL_DAILY_LIMIT_USD is invalid.');
  else record('Paid video configuration', 'READY', 'FAL configuration exists. No provider call or paid job was started.');
} catch { record('Paid video configuration', 'BLOCKED', 'Video configuration could not be checked.'); }

const manual = [
  '- [ ] Wake word: verify on a physical Windows/Android microphone, then disable it and confirm the mic indicator stops.',
  '- [ ] Paid video: separately approve one small generation after reviewing its price and budget. This script does not submit a paid job.',
  '- [ ] Signed installers: use only the Windows/Android release artifacts whose signatures have been verified.',
  '- [ ] Physical devices: verify app launch, microphone/speaker, secure credential storage, update, restart, and network-recovery behavior.'
];
const report = [
  '# Jarvis live backend smoke report', '',
  'Generated: ' + new Date().toISOString(),
  'Target: ' + baseUrl, '',
  '## Automated checks', '',
  '| Check | Result | Detail |', '|---|---|---|',
  ...checks.map(x => '| ' + x.name + ' | **' + x.status + '** | ' + x.detail.replace(/\|/g, '\\|') + ' |'),
  '', '## Manual release requirements', '', ...manual, '',
  '## Overall', '',
  failures ? '**AUTOMATED SMOKE FAILED** — fix failures before acceptance.' :
    '**Automated smoke completed without hard failures.** Any BLOCKED items and manual checks still need resolution before production release.',
  ''
].join('\n');
await writeFile('release-acceptance-report.md', report, 'utf8');
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, report + '\n', 'utf8');
console.log(failures ? 'Backend smoke failed; see release-acceptance-report.md.' : 'Backend smoke finished; review BLOCKED and manual requirements.');
if (failures) process.exitCode = 1;
