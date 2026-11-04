const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { diagnoseFfmpegEnvironment, videoEditSchema, LocalEngine } = require('../dist/video-engine.js');

test('diagnoseFfmpegEnvironment returns truthful status and guidance', async () => {
  const diag = await diagnoseFfmpegEnvironment();
  assert.equal(typeof diag.ffmpegInstalled, 'boolean');
  assert.equal(typeof diag.ffprobeInstalled, 'boolean');
  assert.equal(typeof diag.codecs, 'object');
  if (!diag.ffmpegInstalled || !diag.ffprobeInstalled) {
    assert.ok(typeof diag.installationGuidance === 'string');
    assert.ok(diag.installationGuidance.includes('FFmpeg and FFprobe are required'));
    assert.ok(diag.installationGuidance.includes('https://www.gyan.dev/ffmpeg/builds/'));
  }
});

test('videoEditSchema validates step types and rejects invalid aspect ratio or durations', () => {
  assert.throws(() => {
    videoEditSchema.parse({
      input: 'C:/test.mp4',
      output: 'C:/out.mp4',
      steps: [{ type: 'aspect', ratio: 'invalid' }]
    });
  });

  assert.throws(() => {
    videoEditSchema.parse({
      input: 'C:/test.mp4',
      output: 'C:/out.mp4',
      steps: [{ type: 'speed', factor: 10 }] // max is 4
    });
  });

  const valid = videoEditSchema.parse({
    input: 'C:/test.mp4',
    output: 'C:/out.mp4',
    steps: [
      { type: 'aspect', ratio: '16:9' },
      { type: 'filter', preset: 'cinematic' },
      { type: 'speed', factor: 1.5 },
      { type: 'export', preset: 'youtube' }
    ]
  });

  assert.equal(valid.steps[0].ratio, '16:9');
  assert.equal(valid.steps[1].preset, 'cinematic');
  assert.equal(valid.steps[2].factor, 1.5);
  assert.equal(valid.steps[3].preset, 'youtube');
});

test('LocalEngine rejects render with clear actionable message when FFmpeg is not installed', async () => {
  const diag = await diagnoseFfmpegEnvironment();
  if (!diag.ffmpegInstalled) {
    // Create temporary dummy files for input and output directory
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-ve-test-'));
    const inputPath = path.join(tmpDir, 'dummy_input.mp4');
    const outputPath = path.join(tmpDir, 'dummy_output.mp4');
    await fs.writeFile(inputPath, 'dummy data');

    try {
      const engine = new LocalEngine();
      await assert.rejects(
        () => engine.render({
          input: inputPath,
          output: outputPath,
          steps: [{ type: 'aspect', ratio: '16:9' }]
        }),
        (err) => {
          assert.ok(err.message.includes('FFmpeg binary not found'));
          assert.ok(err.message.includes('Installation Guide'));
          return true;
        }
      );
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
});
