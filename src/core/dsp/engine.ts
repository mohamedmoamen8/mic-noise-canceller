// src/dsp/engine.ts
// Both the RNNoise (WASM/ML) engine and the fallback JS gate implement this
// same shape, so noise-processor.ts (the AudioWorkletProcessor) never needs
// to know which one it's driving. This is the seam mentioned in the README
// that made the RNNoise upgrade a swap rather than a rewrite.

export interface NoiseSuppressionEngine {
  /**
   * Consume one 128-sample render-quantum frame of mono PCM in [-1, 1] and
   * return an equal-length frame with noise suppression applied.
   * Implementations that require larger internal frames (e.g. RNNoise's
   * 480-sample/10ms requirement) must buffer internally and may return
   * partially-silent output for the first few calls while priming.
   */
  process(frame: Float32Array, strength: number): Float32Array;

  /** Release any WASM memory / native resources. Safe to call multiple times. */
  dispose(): void;
}
