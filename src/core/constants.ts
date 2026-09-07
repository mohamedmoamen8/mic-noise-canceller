// src/core/constants.ts
// Centralized constants used across the extension. Keeping these in one
// place makes tuning and testing easier and avoids magic numbers scattered
// across entrypoints and DSP modules.

export const SAMPLE_RATE = 48000;

export const RNNOISE_FRAME_SIZE = 480;
export const PCM_SCALE = 32768;
export const BUFFER_CAPACITY = RNNOISE_FRAME_SIZE * 4;

export const QUIET_RMS_THRESHOLD = 0.004;
export const MODERATE_RMS_THRESHOLD = 0.015;
export const MIN_NOISE_FLOOR = 0.0005;

export const DEFAULT_DURATION_MS = 3000;
export const WORKLET_FFT_SIZE = 256;
export const WORKLET_SMOOTHING = 0.75;
