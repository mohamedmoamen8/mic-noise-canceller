// src/dsp/ring-buffer.ts
// Minimal fixed-capacity circular buffer of Float32 samples. Used to adapt
// between Web Audio's fixed 128-sample render quantum and RNNoise's fixed
// 480-sample (10ms @ 48kHz) frame requirement, which don't divide evenly.

export class RingBuffer {
  private readonly data: Float32Array;
  private writeIndex = 0;
  private readIndex = 0;
  private storedLength = 0;

  constructor(private readonly capacity: number) {
    this.data = new Float32Array(capacity);
  }

  get available(): number {
    return this.storedLength;
  }

  get freeSpace(): number {
    return this.capacity - this.storedLength;
  }

  push(samples: Float32Array): void {
    if (samples.length > this.freeSpace) {
      throw new RangeError('RingBuffer overflow: not enough free space for push()');
    }
    for (let i = 0; i < samples.length; i++) {
      this.data[this.writeIndex] = samples[i] ?? 0;
      this.writeIndex = (this.writeIndex + 1) % this.capacity;
    }
    this.storedLength += samples.length;
  }

  /** Reads `count` samples without removing them (used to keep a dry copy aligned). */
  peek(count: number): Float32Array {
    if (count > this.storedLength) {
      throw new RangeError('RingBuffer underflow: not enough data for peek()');
    }
    const out = new Float32Array(count);
    let idx = this.readIndex;
    for (let i = 0; i < count; i++) {
      out[i] = this.data[idx] ?? 0;
      idx = (idx + 1) % this.capacity;
    }
    return out;
  }

  /** Removes `count` samples from the front, returning them. */
  shift(count: number): Float32Array {
    const out = this.peek(count);
    this.readIndex = (this.readIndex + count) % this.capacity;
    this.storedLength -= count;
    return out;
  }
}
