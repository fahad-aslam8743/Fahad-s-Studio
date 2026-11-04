import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

test('/tts/stream rejects invalid or oversized text', async () => {
  const env = {
    APP_TOKEN: 'test-token-min-32-chars-long-secure-key',
    GEMINI_API_KEY: 'test-key',
    SUPABASE_URL: 'https://fake.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
  };
  const headers = {
    'authorization': 'Bearer test-token-min-32-chars-long-secure-key',
    'content-type': 'application/json',
    'origin': 'http://localhost:3000'
  };

  const empty = await worker.fetch(new Request('https://worker.test/tts/stream', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: '' })
  }), env);
  assert.equal(empty.status, 400);

  const tooLong = await worker.fetch(new Request('https://worker.test/tts/stream', {
    method: 'POST',
    headers,
    body: JSON.stringify({ text: 'a'.repeat(3000) })
  }), env);
  assert.equal(tooLong.status, 400);
});

test('/tts/stream streams audio chunks from Gemini Interactions API', async () => {
  const oldFetch = globalThis.fetch;
  let requestedBody;
  
  const mockPcmChunk = Buffer.from([0, 1, 2, 3]).toString('base64');
  const upstreamSse = [
    `data: {"event_type":"step.delta","delta":{"type":"audio","data":"${mockPcmChunk}"}}\n\n`,
    `data: {"event_type":"step.completed"}\n\n`,
    `data: [DONE]\n\n`
  ].join('');

  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('jarvis_daily_ai_check')) {
      return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('generativelanguage.googleapis.com/v1beta/interactions')) {
      requestedBody = JSON.parse(opts.body);
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(upstreamSse));
          controller.close();
        }
      }), {
        status: 200,
        headers: { 'content-type': 'text/event-stream' }
      });
    }
    return oldFetch(url, opts);
  };

  try {
    const env = {
      APP_TOKEN: 'test-token-min-32-chars-long-secure-key',
      GEMINI_API_KEY: 'test-key',
      SUPABASE_URL: 'https://fake.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key',
      GEMINI_TTS_MODEL: 'gemini-3.8-flash-tts'
    };
    const res = await worker.fetch(new Request('https://worker.test/tts/stream', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer test-token-min-32-chars-long-secure-key',
        'content-type': 'application/json',
        'origin': 'http://localhost:3000'
      },
      body: JSON.stringify({
        text: 'Good morning, sir. Systems are online.',
        voice: 'Puck'
      })
    }), env);

    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type')?.includes('text/event-stream'), true);
    assert.equal(requestedBody.stream, true);
    assert.equal(requestedBody.model, 'gemini-3.8-flash-tts');
    assert.equal(requestedBody.input, 'Good morning, sir. Systems are online.');

    const bodyText = await res.text();
    assert.equal(bodyText.includes('event: meta'), true);
    assert.equal(bodyText.includes('"format":"audio/l16"'), true);
    assert.equal(bodyText.includes('event: chunk'), true);
    assert.equal(bodyText.includes(mockPcmChunk), true);
    assert.equal(bodyText.includes('event: done'), true);
  } finally {
    globalThis.fetch = oldFetch;
  }
});

test('unary /tts remains compatible as fallback', async () => {
  const oldFetch = globalThis.fetch;
  const mockPcm = Buffer.from([10, 20, 30, 40]).toString('base64');
  
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes('jarvis_daily_ai_check')) {
      return new Response('true', { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.includes('generativelanguage.googleapis.com/v1beta/interactions')) {
      return new Response(JSON.stringify({
        output_audio: { data: mockPcm }
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
    return oldFetch(url, opts);
  };

  try {
    const env = {
      APP_TOKEN: 'test-token-min-32-chars-long-secure-key',
      GEMINI_API_KEY: 'test-key',
      SUPABASE_URL: 'https://fake.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-key'
    };
    const res = await worker.fetch(new Request('https://worker.test/tts', {
      method: 'POST',
      headers: {
        'authorization': 'Bearer test-token-min-32-chars-long-secure-key',
        'content-type': 'application/json',
        'origin': 'http://localhost:3000'
      },
      body: JSON.stringify({
        text: 'Fallback test',
        voice: 'Kore'
      })
    }), env);

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.pcm, mockPcm);
    assert.equal(data.sampleRate, 24000);
    assert.equal(data.channels, 1);
  } finally {
    globalThis.fetch = oldFetch;
  }
});
