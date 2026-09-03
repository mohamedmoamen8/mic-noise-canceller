// src/core/calibration/calibration-recorder.ts
// Runs inside the offscreen document (the only context with MediaRecorder /
// AudioContext.decodeAudioData). Records a short ambient-noise clip on the
// *existing* mic stream, analyzes it, and returns the analysis plus a
// base64 copy of the clip so the popup can let the user listen back and
// confirm "yes, that's just background noise" before committing to it.
//
// Nothing here ever writes raw audio to chrome.storage or disk. The base64
// clip lives only in a single runtime message and, on the popup side, only
// in memory as a `data:` URI — the caller is expected to discard both once
// the user confirms or discards the calibration (see discardCalibration()
// and the popup's own cleanup on CONFIRM/DISCARD).

import { computeNoiseProfile, type NoiseProfile } from './noise-profile';

export interface CalibrationResult {
  profile: NoiseProfile;
  audioBase64: string;
  mimeType: string;
}

const DEFAULT_DURATION_MS = 3000;

let activeRecorder: MediaRecorder | null = null;

export function isCalibrationRunning(): boolean {
  return activeRecorder !== null;
}

/**
 * Records `durationMs` of audio from `stream` (the same mic stream used for
 * live noise cancellation — no separate permission prompt), decodes it, and
 * returns both the computed NoiseProfile and a base64 copy for playback.
 * The recorder's internal chunk buffer is cleared as soon as the blob is
 * assembled; nothing is retained here after this promise resolves.
 */
export async function recordAmbientNoise(
  stream: MediaStream,
  durationMs: number = DEFAULT_DURATION_MS
): Promise<CalibrationResult> {
  if (activeRecorder) {
    throw new Error('A calibration recording is already in progress.');
  }

  const mimeType = pickSupportedMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  activeRecorder = recorder;

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (event: BlobEvent) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  try {
    const blob = await new Promise<Blob>((resolve, reject) => {
      recorder.onerror = (event) => reject(new Error(`MediaRecorder error: ${String(event)}`));
      recorder.onstop = () => {
        resolve(new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' }));
      };
      recorder.start();
      setTimeout(() => {
        if (recorder.state !== 'inactive') recorder.stop();
      }, durationMs);
    });

    chunks.length = 0; // discard the raw chunk references immediately after assembling the blob

    const profile = await analyzeBlob(blob);
    const audioBase64 = await blobToBase64(blob);

    return { profile, audioBase64, mimeType: blob.type };
  } finally {
    activeRecorder = null;
  }
}

async function analyzeBlob(blob: Blob): Promise<NoiseProfile> {
  const arrayBuffer = await blob.arrayBuffer();
  // A short-lived AudioContext used only for decoding, separate from the
  // live pipeline's AudioContext — closed immediately after use.
  const decodeCtx = new AudioContext();
  try {
    const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
    const samples = decoded.getChannelData(0);
    return computeNoiseProfile(samples, decoded.sampleRate);
  } finally {
    await decodeCtx.close();
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result);
      const commaIndex = result.indexOf(',');
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read calibration blob.'));
    reader.readAsDataURL(blob);
  });
}

function pickSupportedMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

/** Force-stops any in-progress calibration recording (e.g. user navigated away). */
export function cancelCalibration(): void {
  if (activeRecorder && activeRecorder.state !== 'inactive') {
    activeRecorder.stop();
  }
  activeRecorder = null;
}
