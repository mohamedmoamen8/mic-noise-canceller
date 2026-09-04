// src/entrypoints/offscreen/offscreen.ts
// The only context in this extension that touches getUserMedia / AudioContext.

import { recordAmbientNoise, cancelCalibration } from '../../core/calibration/calibration-recorder';
import type { NoiseProfile } from '../../core/calibration/noise-profile';
import { getStoredNoiseProfile, getNoiseStrength, setNoiseStrength, getPreferredMicDeviceId } from '../../core/storage';

const SAMPLE_RATE = 48000;

let audioContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let workletNode: AudioWorkletNode | null = null;
let analyserNode: AnalyserNode | null = null;
let destinationNode: MediaStreamAudioDestinationNode | null = null;
let monitorAudioEl: HTMLAudioElement | null = null;

interface StartResult {
  ok: boolean;
  error?: string;
}

async function startPipeline(): Promise<StartResult> {
  if (audioContext) {
    return { ok: true };
  }

  try {
    const preferredDeviceId = await getPreferredMicDeviceId();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(preferredDeviceId ? { deviceId: { exact: preferredDeviceId } } : {}),
        echoCancellation: true,
        noiseSuppression: false, // handled by our own worklet
        autoGainControl: true,
        channelCount: 1,
        sampleRate: SAMPLE_RATE
      }
    });
  } catch (err) {
    return { ok: false, error: describeMicError(err) };
  }

  try {
    audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    await audioContext.audioWorklet.addModule('noise-processor.js');

    sourceNode = audioContext.createMediaStreamSource(micStream);

    const storedProfile = await getStoredNoiseProfile();

    workletNode = new AudioWorkletNode(audioContext, 'noise-suppression-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: {
        initialNoiseFloor: storedProfile?.suggestedNoiseFloor
      }
    });

    workletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'ERROR') {
        console.warn('[noise-processor]', event.data.message);
      } else if (event.data?.type === 'ENGINE_READY') {
        chrome.runtime.sendMessage({ type: 'ENGINE_READY', engine: event.data.engine }).catch(() => {});
      }
    };

    await applyStrengthFromStorage(storedProfile);

    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.75;

    destinationNode = audioContext.createMediaStreamDestination();

    sourceNode.connect(workletNode);
    workletNode.connect(analyserNode);
    analyserNode.connect(destinationNode);

    monitorAudioEl = new Audio();
    monitorAudioEl.srcObject = destinationNode.stream;
    monitorAudioEl.muted = true;
    await monitorAudioEl.play().catch(() => {});

    micStream.getAudioTracks()[0]?.addEventListener('ended', () => {
      void stopPipeline();
      chrome.runtime.sendMessage({ type: 'MIC_ENDED_UNEXPECTEDLY' }).catch(() => {});
    });

    console.log('[offscreen] Pipeline started successfully.', {
      contextState: audioContext.state,
      sampleRate: audioContext.sampleRate,
      inputTracks: micStream.getAudioTracks().length,
    });

    return { ok: true };
  } catch (err) {
    console.error('[offscreen] Failed to initialize pipeline:', err);
    await stopPipeline();
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to initialize audio pipeline.' };
  }
}

async function stopPipeline(): Promise<void> {
  try {
    micStream?.getTracks().forEach((track) => track.stop());
  } catch {
    /* ignore */
  }

  try {
    if (monitorAudioEl) {
      monitorAudioEl.pause();
      monitorAudioEl.srcObject = null;
    }
  } catch {
    /* ignore */
  }

  try {
    // Signal the worklet to free WASM memory before we disconnect it.
    // Must happen before disconnect() so the MessagePort is still alive.
    workletNode?.port.postMessage({ type: 'STOP' });
    sourceNode?.disconnect();
    workletNode?.disconnect();
    analyserNode?.disconnect();
  } catch {
    /* ignore */
  }

  try {
    if (audioContext && audioContext.state !== 'closed') {
      await audioContext.close();
    }
  } catch {
    /* ignore */
  }

  micStream = null;
  sourceNode = null;
  workletNode = null;
  analyserNode = null;
  destinationNode = null;
  monitorAudioEl = null;
  audioContext = null;
}

function describeMicError(err: unknown): string {
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

async function applyStrengthFromStorage(preloadedProfile?: NoiseProfile | null): Promise<void> {
  if (!workletNode || !audioContext) return;
  const noiseStrength = await getNoiseStrength();

  let strength: number;
  if (typeof noiseStrength === 'number') {
    strength = noiseStrength; // user has explicitly set one before — always wins
  } else {
    const profile = preloadedProfile !== undefined ? preloadedProfile : await getStoredNoiseProfile();
    strength = profile?.suggestedStrength ?? 0.85;
  }

  workletNode.parameters.get('strength')?.setValueAtTime(strength, audioContext.currentTime);
}

function getVisualizerLevels(): number[] | null {
  if (!analyserNode) return null;
  const data = new Uint8Array(analyserNode.frequencyBinCount);
  analyserNode.getByteFrequencyData(data);
  return Array.from(data);
}

// --- Calibration --------------------------------------------------------
// Uses its own dedicated getUserMedia call, independent of the main
// pipeline's `micStream`, and always releases that capture once the
// recording + analysis is done — whether it succeeded, failed, or was
// cancelled. The mic indicator should disappear right after a calibration
// test completes; a fresh stream opens later if the user actually starts
// real noise cancellation.
async function runCalibration(durationMs?: number) {
  let calibrationStream: MediaStream | null = null;

  try {
    calibrationStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false, // don't let the browser "help" during calibration
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
        sampleRate: SAMPLE_RATE
      }
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'OFFSCREEN_START': {
        sendResponse(await startPipeline());
        break;
      }
      case 'OFFSCREEN_STOP': {
        await stopPipeline();
        sendResponse({ ok: true });
        break;
      }
      case 'SET_STRENGTH': {
        await setNoiseStrength(message.value);
        await applyStrengthFromStorage();
        sendResponse({ ok: true });
        break;
      }
      case 'SET_MONITOR_AUDIBLE': {
        if (monitorAudioEl) monitorAudioEl.muted = !message.audible;
        sendResponse({ ok: true });
        break;
      }
      case 'SET_BYPASS': {
        if (workletNode) {
          workletNode.port.postMessage({ type: 'BYPASS', value: message.value });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'GET_VISUALIZER_LEVELS': {
        sendResponse({ ok: true, levels: getVisualizerLevels() });
        break;
      }
      case 'OFFSCREEN_START_CALIBRATION': {
        sendResponse(await runCalibration(message.durationMs));
        break;
      }
      case 'OFFSCREEN_CANCEL_CALIBRATION': {
        cancelCalibration();
        sendResponse({ ok: true });
        break;
      }
      default:
        break;
    }
  })();
  return true;
});
