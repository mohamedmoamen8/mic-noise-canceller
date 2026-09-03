// src/dsp/rnnoise-engine.ts
// Wraps the real RNNoise WASM build (xiph/rnnoise, compiled by the Jitsi
// project: @jitsi/rnnoise-wasm) behind the same NoiseSuppressionEngine
// interface as the JS fallback gate.
//
// RNNoise's C API operates on fixed 480-sample (10ms @ 48kHz) frames of
// float32 PCM scaled to roughly int16 range, i.e. [-32768, 32767] rather
// than [-1, 1]. Web Audio delivers fixed 128-sample callbacks, and 480 is
// not a multiple of 128, so we bridge the two with RingBuffers: incoming
// 128-sample chunks accumulate until 480 samples are available, get run
// through rnnoise_process_frame, and the result is queued back out in
// 128-sample chunks. This adds a small (<10ms), constant amount of
// algorithmic latency, which is imperceptible for voice chat use cases.

import type { NoiseSuppressionEngine } from './engine';
import { RingBuffer } from './ring-buffer';

const RNNOISE_FRAME_SIZE = 480;
const PCM_SCALE = 32768;
// Buffer capacity: generous headroom above one RNNoise frame so we never
// block on push() even if a few worklet callbacks arrive before we drain.
const BUFFER_CAPACITY = RNNOISE_FRAME_SIZE * 4;

/** The subset of the Emscripten Module surface this engine depends on. */
export interface RNNoiseWasmModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _rnnoise_create(model: number): number;
  _rnnoise_destroy(state: number): void;
  _rnnoise_process_frame(state: number, outPtr: number, inPtr: number): number;
  HEAPF32: Float32Array;
}

export class RNNoiseEngine implements NoiseSuppressionEngine {
  private readonly state: number;
  private readonly inPtr: number;
  private readonly outPtr: number;

  private readonly wetInput = new RingBuffer(BUFFER_CAPACITY);
  private readonly dryInput = new RingBuffer(BUFFER_CAPACITY);
  private readonly output = new RingBuffer(BUFFER_CAPACITY);

  private disposed = false;

  constructor(private readonly module: RNNoiseWasmModule) {
    this.state = module._rnnoise_create(0);
    if (!this.state) {
      throw new Error('rnnoise_create() returned a null pointer.');
    }
    this.inPtr = module._malloc(RNNOISE_FRAME_SIZE * Float32Array.BYTES_PER_ELEMENT);
    this.outPtr = module._malloc(RNNOISE_FRAME_SIZE * Float32Array.BYTES_PER_ELEMENT);
    if (!this.inPtr || !this.outPtr) {
      this.dispose();
      throw new Error('Failed to allocate RNNoise WASM frame buffers.');
    }
  }

  process(frame: Float32Array, strength: number): Float32Array {
    if (this.disposed) {
      throw new Error('RNNoiseEngine.process() called after dispose().');
    }

    this.wetInput.push(frame);
    this.dryInput.push(frame);

    while (this.wetInput.available >= RNNOISE_FRAME_SIZE) {
      const chunk = this.wetInput.shift(RNNOISE_FRAME_SIZE);
      const dryChunk = this.dryInput.shift(RNNOISE_FRAME_SIZE);
      const denoised = this.runRnnoiseFrame(chunk);
      const mixed = this.mix(dryChunk, denoised, strength);
      this.output.push(mixed);
    }

    if (this.output.available < frame.length) {
      // Still priming the pipeline (first ~3-4 callbacks): emit silence
      // rather than underflowing. This lasts under 10ms at startup only.
      return new Float32Array(frame.length);
    }

    return this.output.shift(frame.length);
  }

  private runRnnoiseFrame(chunk: Float32Array): Float32Array {
    const { module, inPtr, outPtr, state } = this;
    const heapOffsetIn = inPtr / Float32Array.BYTES_PER_ELEMENT;
    const heapOffsetOut = outPtr / Float32Array.BYTES_PER_ELEMENT;

    // RNNoise expects PCM scaled to int16 range, not [-1, 1].
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      module.HEAPF32[heapOffsetIn + i] = (chunk[i] ?? 0) * PCM_SCALE;
    }

    module._rnnoise_process_frame(state, outPtr, inPtr);

    const denoised = new Float32Array(RNNOISE_FRAME_SIZE);
    for (let i = 0; i < RNNOISE_FRAME_SIZE; i++) {
      denoised[i] = (module.HEAPF32[heapOffsetOut + i] ?? 0) / PCM_SCALE;
    }
    return denoised;
  }

  private mix(dry: Float32Array, wet: Float32Array, strength: number): Float32Array {
    const out = new Float32Array(dry.length);
    const clampedStrength = Math.max(0, Math.min(1, strength));
    for (let i = 0; i < dry.length; i++) {
      out[i] = clampedStrength * (wet[i] ?? 0) + (1 - clampedStrength) * (dry[i] ?? 0);
    }
    return out;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      if (this.state) this.module._rnnoise_destroy(this.state);
      if (this.inPtr) this.module._free(this.inPtr);
      if (this.outPtr) this.module._free(this.outPtr);
    } catch {
      // Best-effort cleanup; nothing further we can do if free/destroy fail.
    }
  }
}
