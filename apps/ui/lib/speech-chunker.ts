// Intelligent Speech Chunker for Conversational Speech
// Combines short adjacent sentences into natural-sized chunks (typically 200–400 characters).
// Never splits short replies like "Hello! How may I assist you today?" into tiny separate fragments.
// Eliminates artificial dead pauses at full stops while keeping latency low for long responses.

export interface SpeechChunkerOptions {
  minWords?: number;
  minChars?: number;
  maxChars?: number;
}

export class SpeechChunker {
  private buffer = '';
  private minWords: number;
  private minChars: number;
  private maxChars: number;

  constructor(options: SpeechChunkerOptions = {}) {
    // Requirements: Ordinarily around 200–400 characters depending on sentence boundaries.
    // Never split every full stop automatically. Combine adjacent short sentences.
    this.minWords = options.minWords ?? 20;
    this.minChars = options.minChars ?? 180;
    this.maxChars = options.maxChars ?? 380;
  }

  public push(delta: string): string[] {
    if (!delta) return [];
    this.buffer += delta;

    const chunks: string[] = [];
    while (true) {
      const words = this.buffer.trim().split(/\s+/).filter(Boolean);
      const isLongEnough = words.length >= this.minWords || this.buffer.length >= this.minChars;
      const isTooLong = this.buffer.length >= this.maxChars;

      // Do not split if the accumulated text is still short
      if (!isLongEnough && !isTooLong) {
        break;
      }

      // 1. Look for standard sentence boundary (. ! ? \n)
      const sentenceMatch = this.buffer.match(/^([\s\S]*?[.!?。！？\n]+)(?:\s+|$)([\s\S]*)$/);
      if (sentenceMatch) {
        const potentialChunk = sentenceMatch[1].trim();
        const chunkWords = potentialChunk.split(/\s+/).filter(Boolean);
        
        // If the chunk is below minChars / minWords and not oversized, keep accumulating
        if (potentialChunk.length < this.minChars && chunkWords.length < this.minWords && !isTooLong) {
          break;
        }

        chunks.push(potentialChunk);
        this.buffer = sentenceMatch[2];
        continue;
      }

      // 2. If buffer exceeds maxChars and no sentence end found, break at clause punctuation (, ; : —)
      if (isTooLong) {
        const clauseMatch = this.buffer.match(/^([\s\S]{80,}?[,;:—–-]+)(?:\s+|$)([\s\S]*)$/);
        if (clauseMatch) {
          chunks.push(clauseMatch[1].trim());
          this.buffer = clauseMatch[2];
          continue;
        }

        // 3. Fallback: split at last space before maxChars
        const lastSpace = this.buffer.lastIndexOf(' ', this.maxChars);
        if (lastSpace > 60) {
          chunks.push(this.buffer.slice(0, lastSpace).trim());
          this.buffer = this.buffer.slice(lastSpace + 1);
          continue;
        }
      }

      break;
    }

    return chunks;
  }

  public flush(): string[] {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? [remaining] : [];
  }

  public reset(): void {
    this.buffer = '';
  }

  public getBuffer(): string {
    return this.buffer;
  }
}
