import { describe, expect, it } from 'vitest';
import { computeNoiseProfile } from '../../src/core/calibration/noise-profile';

function silence(length: number): Float32Array {
  return new Float32Array(length);
}

function constantTone(length: number, amplitude: number): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    out[i] = i % 2 === 0 ? amplitude : -amplitude;
  }
  return out;
}

describe('computeNoiseProfile', () => {
  it('classifies true silence as quiet with a near-zero suggested floor', () => {
    const profile = computeNoiseProfile(silence(48000), 48000);
    expect(profile.classification).toBe('quiet');
    expect(profile.rmsLevel).toBe(0);
    expect(profile.suggestedNoiseFloor).toBeGreaterThan(0); // guarded minimum, never exactly 0
  });

  it('classifies a loud constant tone as noisy', () => {
    const profile = computeNoiseProfile(constantTone(48000, 0.05), 48000);
    expect(profile.classification).toBe('noisy');
    expect(profile.suggestedStrength).toBeGreaterThanOrEqual(0.9);
  });

  it('classifies a low-level hum as moderate', () => {
    const profile = computeNoiseProfile(constantTone(48000, 0.008), 48000);
    expect(profile.classification).toBe('moderate');
  });

  it('computes duration from sample count and sample rate', () => {
    const profile = computeNoiseProfile(silence(48000), 48000); // exactly 1 second
    expect(profile.durationMs).toBeCloseTo(1000, 0);
  });

  it('captures peak level correctly even with one outlier sample', () => {
    const samples = silence(1000);
    samples[500] = 0.9;
    const profile = computeNoiseProfile(samples, 48000);
    expect(profile.peakLevel).toBeCloseTo(0.9, 5);
  });

  it('handles an empty buffer without throwing or producing NaN', () => {
    const profile = computeNoiseProfile(new Float32Array(0), 48000);
    expect(profile.sampleCount).toBe(0);
    expect(Number.isFinite(profile.rmsLevel)).toBe(true);
    expect(Number.isFinite(profile.suggestedNoiseFloor)).toBe(true);
  });

  it('suggested noise floor tracks mean absolute level, not RMS', () => {
    const profile = computeNoiseProfile(constantTone(48000, 0.01), 48000);
    // For this signal meanAbs === rms === 0.01 (constant magnitude), so just
    // assert the floor seed is derived from amplitude, not squared energy.
    expect(profile.suggestedNoiseFloor).toBeCloseTo(profile.meanAbsLevel, 6);
  });

  it('never returns a suggestedNoiseFloor below the guarded minimum', () => {
    const profile = computeNoiseProfile(silence(1000), 48000);
    expect(profile.suggestedNoiseFloor).toBeGreaterThan(0);
  });
});
