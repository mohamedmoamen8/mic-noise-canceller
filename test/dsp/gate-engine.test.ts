import { describe, expect, it } from 'vitest';
import { GateEngine } from '../../src/core/dsp/gate-engine';

function silence(length: number): Float32Array {
  return new Float32Array(length);
}

function tone(length: number, amplitude: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * 440 * i) / 48000);
  }
  return out;
}

describe('GateEngine', () => {
  it('returns a frame of the same length it was given', () => {
    const engine = new GateEngine();
    const out = engine.process(tone(128, 0.5), 0.85);
    expect(out.length).toBe(128);
  });

  it('attenuates low-level noise more than a loud tone, at full strength', () => {
    const engine = new GateEngine();

    // Prime the noise-floor estimate with several frames of quiet noise.
    let lastQuietOut = silence(128);
    for (let i = 0; i < 40; i++) {
      lastQuietOut = engine.process(tone(128, 0.001), 1);
    }
    const quietRms = rms(lastQuietOut);

    const loudOut = engine.process(tone(128, 0.8), 1);
    const loudRms = rms(loudOut);

    // A voice-level tone should pass through with far more energy than the
    // suppressed noise floor once the gate has adapted.
    expect(loudRms).toBeGreaterThan(quietRms * 5);
  });

  it('strength=0 passes audio through close to unmodified (aside from smoothing)', () => {
    const engine = new GateEngine();
    const input = tone(128, 0.5);
    const out = engine.process(input, 0);

    // With strength 0 the gain formula always resolves to ~1, so output RMS
    // should be very close to input RMS (small delta from the 4-tap smoother).
    expect(Math.abs(rms(out) - rms(input))).toBeLessThan(0.05);
  });

  it('never produces NaN or Infinity regardless of input', () => {
    const engine = new GateEngine();
    const weird = new Float32Array([0, -1, 1, Number.EPSILON, -0.999999]);
    const out = engine.process(weird, 0.85);
    for (const sample of out) {
      expect(Number.isFinite(sample)).toBe(true);
    }
  });

  it('accepts a seeded initial noise floor from calibration', () => {
    // A calibrated seed tells the engine "this amplitude level IS the room's
    // ambient noise", so it should suppress a tone at that level more than
    // an unseeded engine would — which instead starts from a very low
    // default floor and so wrongly treats the same tone as voice-level
    // signal, passing it through almost unattenuated.
    const seeded = new GateEngine(0.05);
    const unseeded = new GateEngine();

    const ambientLevelNoise = tone(128, 0.05);
    const seededOut = seeded.process(ambientLevelNoise, 1);
    const unseededOut = unseeded.process(ambientLevelNoise, 1);

    expect(rms(seededOut)).toBeLessThan(rms(unseededOut));
  });

  it('falls back to the default seed for a zero or negative seed value', () => {
    const zeroSeeded = new GateEngine(0);
    const negativeSeeded = new GateEngine(-1);
    const defaultEngine = new GateEngine();

    const input = tone(128, 0.01);
    expect(Array.from(zeroSeeded.process(input, 1))).toEqual(Array.from(defaultEngine.process(input, 1)));
    // Reset for a clean second comparison, since engines carry adapted state.
    const defaultEngine2 = new GateEngine();
    expect(Array.from(negativeSeeded.process(input, 1))).toEqual(Array.from(defaultEngine2.process(input, 1)));
  });
});

function rms(frame: Float32Array): number {
  let sumSquares = 0;
  for (const s of frame) sumSquares += s * s;
  return Math.sqrt(sumSquares / frame.length);
}
