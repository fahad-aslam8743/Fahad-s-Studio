import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeechChunker} from '../../../apps/ui/lib/speech-chunker.ts';

test('short greeting "Hello. How may I assist you today?" is NOT split into two tiny sequential TTS requests', () => {
  const chunker = new SpeechChunker({minWords: 6, minChars: 40});
  
  // Simulate incremental streaming deltas from LLM
  const deltas = ['Hello.', ' How', ' may', ' I', ' assist', ' you', ' today?'];
  const emittedChunks = [];

  for (const delta of deltas) {
    const ready = chunker.push(delta);
    emittedChunks.push(...ready);
  }

  // During streaming, "Hello." alone must NOT be emitted as a chunk
  assert.equal(emittedChunks.length, 0, 'Must not emit "Hello." prematurely as a tiny fragment');

  // When stream finishes and flush() is called
  const finalChunks = chunker.flush();
  emittedChunks.push(...finalChunks);

  assert.equal(emittedChunks.length, 1, 'Must combine into exactly ONE natural spoken chunk');
  assert.equal(emittedChunks[0], 'Hello. How may I assist you today?');
});

test('longer multi-sentence responses stream naturally without artificial delay', () => {
  const chunker = new SpeechChunker({minWords: 6, minChars: 40});
  const text1 = 'Photosynthesis is the process by which green plants create food from sunlight and carbon dioxide. ';
  const text2 = 'This biological process releases essential oxygen into the Earth atmosphere.';

  const chunk1 = chunker.push(text1);
  assert.equal(chunk1.length, 1);
  assert.match(chunk1[0], /Photosynthesis is the process/);

  const chunk2 = chunker.push(text2);
  const finalChunk = chunker.flush();
  const allSecond = [...chunk2, ...finalChunk];
  assert.equal(allSecond.length, 1);
  assert.match(allSecond[0], /releases essential oxygen/);
});

test('chunker reset() flushes buffer immediately on user interruption', () => {
  const chunker = new SpeechChunker();
  chunker.push('Wait, I was saying something...');
  assert.ok(chunker.getBuffer().length > 0);
  chunker.reset();
  assert.equal(chunker.getBuffer().length, 0);
  assert.equal(chunker.flush().length, 0);
});
