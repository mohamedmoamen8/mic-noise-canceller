import { describe, expect, it } from 'vitest';
import createRNNWasmModuleSync from '@jitsi/rnnoise-wasm/dist/rnnoise-sync';
import { RNNoiseEngine, type RNNoiseWasmModule } from '../../src/core/dsp/rnnoise-engine';

function loadModule(): RNNoiseWasmModule {
  return createRNNWasmModuleSync() as RNNoiseWasmModule;
}

function whiteNoise(length: number, amplitude = 0.05): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * (Math.random() * 2 - 1);
  }
  return out;
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (const s of frame) sum += s * s;
  return Math.sqrt(sum / frame.length);
}

describe('RNNoiseEngine (real WASM)', () => {
  it('instantiates the actual RNNoise WASM module without throwing', () => {
    const module = loadModule();
    expect(typeof module._rnnoise_create).toBe('function');
    const engine = new RNNoiseEngine(module);
    engine.dispose();
  });

  it('processes 128-sample worklet frames and always returns 128 samples back', () => {
    const engine = new RNNoiseEngine(loadModule());
    for (let i = 0; i < 20; i++) {
      const out = engine.process(whiteNoise(128), 0.85);
      expect(out.length).toBe(128);
    }
    engine.dispose();
  });

  it('reduces RMS energy of pure white noise once primed (strength=1)', () => {
    const engine = new RNNoiseEngine(loadModule());

    // Feed enough frames to get past the priming latency (>480 samples)
    // and let RNNoise's internal state adapt to "this is all noise".
    let lastOut: Float32Array = new Float32Array(128);
    for (let i = 0; i < 200; i++) {
      lastOut = engine.process(whiteNoise(128, 0.05), 1);
    }

    // RNNoise should have suppressed most of the steady-state noise energy
    // by now; the output RMS should be meaningfully below the input RMS.
    expect(rms(lastOut)).toBeLessThan(0.05 * 0.7);
    engine.dispose();
  });

  it('strength=0 yields output close to the original dry signal', () => {
    const engine = new RNNoiseEngine(loadModule());
    const input = whiteNoise(128, 0.1);

    let out: Float32Array = new Float32Array(128);
    // Push the same frame repeatedly so we can compare final dry passthrough
    // once the ring buffers are past their initial priming silence.
    for (let i = 0; i < 10; i++) {
      out = engine.process(input, 0);
    }

    // At strength 0 the mix is 100% dry, so once primed, output should
    // exactly equal a delayed copy of some earlier input frame - since we
    // feed the identical frame every call here, it should match exactly.
    expect(Array.from(out)).toEqual(Array.from(input));
    engine.dispose();
  });

  it('never emits NaN/Infinity even under silence', () => {
    const engine = new RNNoiseEngine(loadModule());
    for (let i = 0; i < 15; i++) {
      const out = engine.process(new Float32Array(128), 0.85);
      for (const sample of out) {
        expect(Number.isFinite(sample)).toBe(true);
      }
    }
    engine.dispose();
  });

  it('dispose() is idempotent and safe to call multiple times', () => {
    const engine = new RNNoiseEngine(loadModule());
    engine.dispose();
    expect(() => engine.dispose()).not.toThrow();
  });
});
