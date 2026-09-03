// src/core/calibration/noise-profile.ts
// Pure analysis of a short ambient-noise recording. No DOM/Web Audio
// dependency here on purpose — this is the part that actually decides
// "is this quiet or noisy", so it needs to be trivially unit-testable
// with synthetic Float32Array data, independent of MediaRecorder/AudioContext.

export type NoiseClassification = 'quiet' | 'moderate' | 'noisy';

export interface NoiseProfile {
  /** Mean absolute sample amplitude — matches GateEngine's envelope units directly. */
  meanAbsLevel: number;
  /** Root-mean-square level, the more standard "loudness" figure for display. */
  rmsLevel: number;
  /** Peak absolute sample seen during calibration. */
  peakLevel: number;
  classification: NoiseClassification;
  /** Seed value for GateEngine's initial noise-floor estimate. */
  suggestedNoiseFloor: number;
  /** Suggested default suppression strength (0..1) for this ambient level. */
  suggestedStrength: number;
  durationMs: number;
  sampleCount: number;
}

const QUIET_RMS_THRESHOLD = 0.004;
const MODERATE_RMS_THRESHOLD = 0.015;
const MIN_NOISE_FLOOR = 0.0005; // never seed a floor of literally zero

function classify(rmsLevel: number): NoiseClassification {
  if (rmsLevel < QUIET_RMS_THRESHOLD) return 'quiet';
  if (rmsLevel < MODERATE_RMS_THRESHOLD) return 'moderate';
  return 'noisy';
}

function suggestStrength(classification: NoiseClassification): number {
  switch (classification) {
    case 'quiet':
      return 0.6;
    case 'moderate':
      return 0.85;
    case 'noisy':
      return 0.95;
  }
}

/**
 * Analyze a short PCM recording (expected to contain only ambient noise,
 * i.e. the user staying silent while it records) into a NoiseProfile.
 * Never mutates or retains a reference to `samples` — callers are free to
 * discard the buffer immediately after this returns.
 */
export function computeNoiseProfile(samples: Float32Array, sampleRate: number): NoiseProfile {
  const sampleCount = samples.length;

  if (sampleCount === 0) {
    return {
      meanAbsLevel: 0,
      rmsLevel: 0,
      peakLevel: 0,
      classification: 'quiet',
      suggestedNoiseFloor: MIN_NOISE_FLOOR,
      suggestedStrength: suggestStrength('quiet'),
      durationMs: 0,
      sampleCount: 0
    };
  }

  let sumAbs = 0;
  let sumSquares = 0;
  let peak = 0;

  for (let i = 0; i < sampleCount; i++) {
    const sample = samples[i] ?? 0;
    const abs = Math.abs(sample);
    sumAbs += abs;
    sumSquares += sample * sample;
    if (abs > peak) peak = abs;
  }

  const meanAbsLevel = sumAbs / sampleCount;
  const rmsLevel = Math.sqrt(sumSquares / sampleCount);
  const classification = classify(rmsLevel);

  return {
    meanAbsLevel,
    rmsLevel,
    peakLevel: peak,
    classification,
    suggestedNoiseFloor: Math.max(meanAbsLevel, MIN_NOISE_FLOOR),
    suggestedStrength: suggestStrength(classification),
    durationMs: (sampleCount / sampleRate) * 1000,
    sampleCount
  };
}
