import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import worker from '../src/index.js';

test('shared APP_TOKEN is never exposed in client Next.js bundles, HTML, or UI source', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, '../../..');
  const uiPage = fs.readFileSync(path.join(root, 'apps', 'ui', 'app', 'page.tsx'), 'utf8');
  assert.equal(uiPage.includes('NEXT_PUBLIC_APP_TOKEN'), false, 'page.tsx must never reference NEXT_PUBLIC_APP_TOKEN');
  assert.equal(uiPage.includes('process.env.APP_TOKEN'), false, 'page.tsx must never reference process.env.APP_TOKEN');
  assert.equal(Boolean(process.env.NEXT_PUBLIC_APP_TOKEN), false, 'NEXT_PUBLIC_APP_TOKEN must not be in process.env');

  const outDir = path.join(root, 'apps', 'ui', 'out');
  if (fs.existsSync(outDir)) {
    const checkDir = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) checkDir(full);
        else if (/\.(html|js|json)$/.test(entry.name)) {
          const content = fs.readFileSync(full, 'utf8');
          assert.equal(content.includes('NEXT_PUBLIC_APP_TOKEN'), false, `File ${entry.name} must not contain NEXT_PUBLIC_APP_TOKEN`);
        }
      }
    };
    checkDir(outDir);
  }
});

test('unauthenticated browser requests without valid Bearer token return 401 Unauthorized across protected endpoints', async () => {
  const env = {
    APP_TOKEN: 'test-secret-token-min-32-chars-long-abc-xyz',
    GEMINI_API_KEY: 'test-key',
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
  };
  const unauth = async (urlPath, method = 'GET') => {
    return worker.fetch(new Request('https://worker.test' + urlPath, {
      method,
      headers: { 'origin': 'http://localhost:3000' }
    }), env);
  };

  assert.equal((await unauth('/personas')).status, 401);
  assert.equal((await unauth('/tasks')).status, 401);
  assert.equal((await unauth('/memories')).status, 401);
  assert.equal((await unauth('/chat', 'POST')).status, 401);
  assert.equal((await unauth('/email/unread-summary')).status, 401);
  assert.equal((await unauth('/tools/plan', 'POST')).status, 401);
});

test('requests with invalid or forged Bearer token return 401 Unauthorized', async () => {
  const env = {
    APP_TOKEN: 'test-secret-token-min-32-chars-long-abc-xyz',
    GEMINI_API_KEY: 'test-key',
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
  };
  const badAuth = await worker.fetch(new Request('https://worker.test/personas', {
    headers: {
      'authorization': 'Bearer completely-invalid-token-12345',
      'origin': 'http://localhost:3000'
    }
  }), env);
  assert.equal(badAuth.status, 401);
});

test('valid owner Bearer token is accepted and does not leak token back in headers or response body', async () => {
  const env = {
    APP_TOKEN: 'test-secret-token-min-32-chars-long-abc-xyz',
    GEMINI_API_KEY: 'test-key',
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
  };
  const res = await worker.fetch(new Request('https://worker.test/personas', {
    headers: {
      'authorization': 'Bearer test-secret-token-min-32-chars-long-abc-xyz',
      'origin': 'http://localhost:3000'
    }
  }), env);
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.equal(text.includes('test-secret-token-min-32-chars-long-abc-xyz'), false);
  assert.equal(res.headers.get('authorization'), null);

  // Regression check: verify http://localhost:3001 and http://127.0.0.1:3001 are permitted origins
  const port3001Res = await worker.fetch(new Request('https://worker.test/personas', {
    headers: {
      'authorization': 'Bearer test-secret-token-min-32-chars-long-abc-xyz',
      'origin': 'http://localhost:3001'
    }
  }), env);
  assert.equal(port3001Res.status, 200);
  assert.equal(port3001Res.headers.get('access-control-allow-origin'), 'http://localhost:3001');
});
