import test from 'node:test';
import assert from 'node:assert/strict';
import {FalEngine, handleVideo} from '../src/video.js';
import {VIDEO_MODELS} from '../src/video-models.js';

test('FalEngine throws explicit configuration error when FAL_KEY is missing', () => {
  assert.throws(() => new FalEngine({}), /FAL_KEY not configured/i);
  assert.throws(() => new FalEngine({FAL_KEY: ''}), /FAL_KEY not configured/i);
});

test('FalEngine submits text-to-video job using mocked client without live paid API call', async () => {
  const mockClient = {
    queue: {
      submit: async (model, {input}) => {
        assert.equal(model, 'wan/v2.6/text-to-video');
        assert.equal(input.prompt, 'Cinematic drone shot of sunset');
        assert.equal(input.aspect_ratio, '16:9');
        return {request_id: 'mock_req_12345'};
      },
      status: async (model, {requestId}) => {
        assert.equal(requestId, 'mock_req_12345');
        return {status: 'IN_PROGRESS', progress: 50, logs: ['Processing frame 120/240']};
      },
      result: async (model, {requestId}) => {
        assert.equal(requestId, 'mock_req_12345');
        return {video: {url: 'https://fal.media/files/mock-video.mp4'}};
      }
    }
  };

  const engine = new FalEngine({FAL_KEY: 'mock_test_key'}, mockClient);
  assert.equal(engine.name, 'fal');

  // Submit
  const submitRes = await engine.submit('wan/v2.6/text-to-video', {
    prompt: 'Cinematic drone shot of sunset',
    aspect_ratio: '16:9'
  });
  assert.equal(submitRes.request_id, 'mock_req_12345');

  // Status
  const statusRes = await engine.status('wan/v2.6/text-to-video', 'mock_req_12345');
  assert.equal(statusRes.status, 'IN_PROGRESS');
  assert.equal(statusRes.progress, 50);

  // Result
  const resultRes = await engine.result('wan/v2.6/text-to-video', 'mock_req_12345');
  assert.equal(resultRes.video.url, 'https://fal.media/files/mock-video.mp4');
  assert.match(resultRes.video.url, /^https:\/\//);
});

test('FalEngine propagates provider errors, timeouts, and rate limits gracefully', async () => {
  const mockFailingClient = {
    queue: {
      submit: async () => {
        throw new Error('Fal API error: 429 Too Many Requests (Rate limit exceeded)');
      },
      status: async () => {
        throw new Error('Fal API error: 504 Gateway Timeout');
      },
      result: async () => {
        throw new Error('Fal API error: 404 Request expired');
      }
    }
  };

  const engine = new FalEngine({FAL_KEY: 'mock_key'}, mockFailingClient);

  await assert.rejects(
    () => engine.submit('wan/v2.6/text-to-video', {prompt: 'test'}),
    /Rate limit exceeded/
  );
  await assert.rejects(
    () => engine.status('wan/v2.6/text-to-video', 'req_fail'),
    /Gateway Timeout/
  );
  await assert.rejects(
    () => engine.result('wan/v2.6/text-to-video', 'req_fail'),
    /Request expired/
  );
});

test('/video/diagnostics endpoint reports configuration status truthfully without network calls', async () => {
  const unconfiguredEnv = {};
  const resUnconfigured = await handleVideo(
    new Request('https://example.com/video/diagnostics'),
    unconfiguredEnv,
    '/video/diagnostics'
  );
  assert.equal(resUnconfigured.status, 200);
  const dataUnconfigured = await resUnconfigured.json();
  assert.equal(dataUnconfigured.configured, false);
  assert.equal(dataUnconfigured.providerRequestMade, false);
  assert.equal(dataUnconfigured.paidGenerationSubmitted, false);

  const configuredEnv = {FAL_KEY: 'mock_key_present', FAL_DAILY_LIMIT_USD: '15'};
  const resConfigured = await handleVideo(
    new Request('https://example.com/video/diagnostics'),
    configuredEnv,
    '/video/diagnostics'
  );
  const dataConfigured = await resConfigured.json();
  assert.equal(dataConfigured.configured, true);
  assert.equal(dataConfigured.dailyLimitUsd, 15);
  assert.equal(dataConfigured.providerRequestMade, false);
});
