// src/dsp/gate-engine.ts
// Lightweight adaptive noise-gate suppressor, ported from the original
// pure-JS prototype. Kept as a dependency-free fallback: it runs even if
// the RNNoise WASM module fails to load or instantiate (e.g. a corrupted
// download, an unsupported browser, or CSP blocking 'wasm-unsafe-eval').

import type { NoiseSuppressionEngine } from './engine';

export class GateEngine implements NoiseSuppressionEngine {
  private noiseFloor: number;
  private envelope = 0;
  private readonly attack = 0.35;
  private readonly release = 0.02;
  private readonly noiseAdapt = 0.995;
  private readonly history = new Float32Array(4);

  /**
   * @param seedNoiseFloor Optional initial noise-floor estimate, typically
   * from a prior calibration recording (see core/calibration). Falls back
   * to a conservative guess if omitted, which then adapts over the first
   * second or so of live audio regardless.
   */
  constructor(seedNoiseFloor?: number) {
    this.noiseFloor = seedNoiseFloor && seedNoiseFloor > 0 ? seedNoiseFloor : 0.002;
  }

  process(frame: Float32Array, strength: number): Float32Array {
    const out = new Float32Array(frame.length);

    for (let i = 0; i < frame.length; i++) {
      const sample = frame[i] ?? 0;
      const rectified = Math.abs(sample);

      const coeff = rectified > this.envelope ? this.attack : this.release;
      this.envelope += coeff * (rectified - this.envelope);

      if (this.envelope < this.noiseFloor * 1.5) {
        this.noiseFloor = this.noiseAdapt * this.noiseFloor + (1 - this.noiseAdapt) * this.envelope;
      }

      const threshold = this.noiseFloor * 3;
      let gain = 1;
      if (this.envelope < threshold) {
        const ratio = threshold > 0 ? this.envelope / threshold : 1;
        gain = 1 - strength * (1 - ratio);
        gain = Math.max(0, Math.min(1, gain));
      }

      const gated = sample * gain;
      this.history[3] = this.history[2] ?? 0;
      this.history[2] = this.history[1] ?? 0;
      this.history[1] = this.history[0] ?? 0;
      this.history[0] = gated;
      out[i] = ((this.history[0] ?? 0) + (this.history[1] ?? 0) + (this.history[2] ?? 0) + (this.history[3] ?? 0)) / 4;
    }

    return out;
  }

  dispose(): void {
    // No native resources to release.
  }
}
