// src/core/pipeline.ts
// Shared audio pipeline helpers used by both the Chrome offscreen document
// and the Firefox background page. Contains the getUserMedia / AudioContext
// lifecycle, calibration recorder wrapper, and visualizer helpers.
//
// This module intentionally depends on browser globals (AudioContext,
// MediaStream, etc.) and should only be imported from entrypoints that run
// in a DOM/browser context.

import { recordAmbientNoise } from './calibration/calibration-recorder';
import type { NoiseProfile } from './calibration/noise-profile';
import {
  getStoredNoiseProfile,
  getNoiseStrength,
  getPreferredMicDeviceId,
} from './storage';
import { SAMPLE_RATE } from './constants';

/**
 * Shared audio pipeline state held by the offscreen document or Firefox
 * background page.
 */
export interface PipelineState {
  /**
   * The AudioContext driving the Web Audio graph.
   */
  audioContext: AudioContext | null;
  /**
   * The active microphone MediaStream.
   */
  micStream: MediaStream | null;
  /**
   * Wraps `micStream` as a Web Audio source node.
   */
  sourceNode: MediaStreamAudioSourceNode | null;
  /**
   * The AudioWorklet node running noise suppression.
   */
  workletNode: AudioWorkletNode | null;
  /**
   * Analyser node feeding the visualizer bars.
   */
  analyserNode: AnalyserNode | null;
  /**
   * Destination node routing cleaned audio to the monitor element.
   */
  destinationNode: MediaStreamAudioDestinationNode | null;
  /**
   * Muted `<audio>` element used for local monitoring.
   */
  monitorAudioEl: HTMLAudioElement | null;
}

/**
 * Initial empty pipeline state. Clone this for each new session to avoid
 * shared mutable state between tests or restarts.
 */
export const initialPipelineState: PipelineState = {
  audioContext: null,
  micStream: null,
  sourceNode: null,
  workletNode: null,
  analyserNode: null,
  destinationNode: null,
  monitorAudioEl: null,
};

/**
 * Map a browser `DOMException` name to a human-readable error string for
 * the popup/options UI.
 */
export function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'Microphone permission was denied. Allow mic access for this extension and try again.';
    case 'NotFoundError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
      return 'The microphone is already in use by another application.';
    default:
      return err instanceof Error ? err.message : 'Unknown microphone error.';
  }
}

export async function applyStrengthFromStorage(
  state: PipelineState,
  preloadedProfile?: NoiseProfile | null
): Promise<void> {
  if (!state.workletNode || !state.audioContext) return;
  const noiseStrength = await getNoiseStrength();

  let strength: number;
  if (typeof noiseStrength === 'number') {
    strength = noiseStrength;
  } else {
    const profile = preloadedProfile !== undefined ? preloadedProfile : await getStoredNoiseProfile();
    strength = profile?.suggestedStrength ?? 0.85;
  }

  state.workletNode.parameters.get('strength')?.setValueAtTime(strength, state.audioContext.currentTime);
}

export function getVisualizerLevels(state: PipelineState): number[] | null {
  if (!state.analyserNode) return null;
  const data = new Uint8Array(state.analyserNode.frequencyBinCount);
  state.analyserNode.getByteFrequencyData(data);
  return Array.from(data);
}

export async function startPipeline(
  state: PipelineState,
  onEngineReady?: (engine: 'rnnoise' | 'gate') => void
): Promise<{ ok: boolean; error?: string }> {
  if (state.audioContext) {
    return { ok: true };
  }

  try {
    const preferredDeviceId = await getPreferredMicDeviceId();
    state.micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: true,
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
      },
    });
  } catch (err) {
    return { ok: false, error: describeMicError(err) };
  }

  try {
    state.audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (state.audioContext.state === 'suspended') {
      await state.audioContext.resume();
    }

    await state.audioContext.audioWorklet.addModule('noise-processor.js');

    state.sourceNode = state.audioContext.createMediaStreamSource(state.micStream);

    const storedProfile = await getStoredNoiseProfile();

    state.workletNode = new AudioWorkletNode(state.audioContext, 'noise-suppression-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: {
        initialNoiseFloor: storedProfile?.suggestedNoiseFloor,
      },
    });

    state.workletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'ERROR') {
        console.warn('[noise-processor]', event.data.message);
      } else if (event.data?.type === 'ENGINE_READY') {
        onEngineReady?.(event.data.engine);
      }
    };

    await applyStrengthFromStorage(state, storedProfile);

    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 256;
    state.analyserNode.smoothingTimeConstant = 0.75;

    state.destinationNode = state.audioContext.createMediaStreamDestination();

    state.sourceNode.connect(state.workletNode);
    state.workletNode.connect(state.analyserNode);
    state.analyserNode.connect(state.destinationNode);

    state.monitorAudioEl = new Audio();
    state.monitorAudioEl.srcObject = state.destinationNode.stream;
    state.monitorAudioEl.muted = true;
    await state.monitorAudioEl.play().catch(() => {});

    state.micStream.getAudioTracks()[0]?.addEventListener('ended', () => {
      void stopPipeline(state);
      onEngineReady?.(null as never); // signal mic ended to caller
    });

    return { ok: true };
  } catch (err) {
    await stopPipeline(state);
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to initialize audio pipeline.' };
  }
}

export async function stopPipeline(state: PipelineState): Promise<void> {
  try {
    state.micStream?.getTracks().forEach((track) => track.stop());
  } catch (err) {
    console.warn('[pipeline] Failed to stop mic tracks:', err);
  }

  try {
    if (state.monitorAudioEl) {
      state.monitorAudioEl.pause();
      state.monitorAudioEl.srcObject = null;
    }
  } catch (err) {
    console.warn('[pipeline] Failed to stop monitor audio:', err);
  }

  try {
    state.workletNode?.port.postMessage({ type: 'STOP' });
    state.sourceNode?.disconnect();
    state.workletNode?.disconnect();
    state.analyserNode?.disconnect();
  } catch (err) {
    console.warn('[pipeline] Failed to disconnect audio nodes:', err);
  }

  try {
    if (state.audioContext && state.audioContext.state !== 'closed') {
      await state.audioContext.close();
    }
  } catch (err) {
    console.warn('[pipeline] Failed to close AudioContext:', err);
  }

  state.audioContext = null;
  state.micStream = null;
  state.sourceNode = null;
  state.workletNode = null;
  state.analyserNode = null;
  state.destinationNode = null;
  state.monitorAudioEl = null;
}

export async function runCalibration(state: PipelineState, durationMs?: number) {
  let calibrationStream: MediaStream | null = null;

  try {
    calibrationStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: SAMPLE_RATE,
      },
    });
  } catch (err) {
    return { ok: false as const, error: describeMicError(err) };
  }

  try {
    const result = await recordAmbientNoise(calibrationStream, durationMs);
    return { ok: true as const, ...result };
  } catch (err) {
    return { ok: false as const, error: err instanceof Error ? err.message : 'Calibration recording failed.' };
  } finally {
    calibrationStream.getTracks().forEach((track) => track.stop());
  }
}
