// src/entrypoints/background-firefox/background-firefox.ts
// Firefox MV2 persistent background page.
//
// Combines what Chrome splits across background.ts (service worker) and
// offscreen.ts (offscreen document):
//
//   - Message orchestration (START/STOP/GET_STATE/calibration/strength/bypass/
//     per-site rules) — mirrors background.ts
//   - Audio pipeline (getUserMedia → AudioContext → AudioWorkletNode) —
//     mirrors offscreen.ts
//
// Because this runs in a real browser page context (not a service worker),
// Web Audio APIs are available directly — no offscreen document relay needed.
// All core/* modules are shared unchanged with the Chrome build.

import { recordAmbientNoise, cancelCalibration } from '../../core/calibration/calibration-recorder';
import type { NoiseProfile } from '../../core/calibration/noise-profile';
import {
  getRunningState,
  setRunningState,
  getStoredNoiseProfile,
  setStoredNoiseProfile,
  clearStoredNoiseProfile,
  getNoiseStrength,
  setNoiseStrength,
  getPreferredMicDeviceId,
  getAutoStart,
  getAllowlistedSites,
  addAllowlistedSite,
  removeAllowlistedSite,
} from '../../core/storage';

const SAMPLE_RATE = 48000;

// ---------------------------------------------------------------------------
// Audio pipeline state
// ---------------------------------------------------------------------------

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
  if (audioContext) return { ok: true }; // already running

  try {
    const preferredDeviceId = await getPreferredMicDeviceId();
    micStream = await navigator.mediaDevices.getUserMedia({
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
        initialNoiseFloor: storedProfile?.suggestedNoiseFloor,
      },
    });

    workletNode.port.onmessage = (event: MessageEvent) => {
      if (event.data?.type === 'ERROR') {
        console.warn('[noise-processor]', event.data.message);
      } else if (event.data?.type === 'ENGINE_READY') {
        // Broadcast to popup so it can update the engine badge.
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
      void setRunningState(false);
      autoStartedByRule = false;
      chrome.runtime.sendMessage({ type: 'MIC_ENDED_UNEXPECTEDLY' }).catch(() => {});
    });

    return { ok: true };
  } catch (err) {
    await stopPipeline();
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to initialize audio pipeline.' };
  }
}

async function stopPipeline(): Promise<void> {
  try { micStream?.getTracks().forEach((t) => t.stop()); } catch { /* ignore */ }
  try {
    if (monitorAudioEl) { monitorAudioEl.pause(); monitorAudioEl.srcObject = null; }
  } catch { /* ignore */ }
  try {
    workletNode?.port.postMessage({ type: 'STOP' });
    sourceNode?.disconnect();
    workletNode?.disconnect();
    analyserNode?.disconnect();
  } catch { /* ignore */ }
  try {
    if (audioContext && audioContext.state !== 'closed') await audioContext.close();
  } catch { /* ignore */ }

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
    strength = noiseStrength;
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

// ---------------------------------------------------------------------------
// Calibration (uses its own dedicated getUserMedia stream)
// ---------------------------------------------------------------------------

async function runCalibration(durationMs?: number) {
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
    calibrationStream.getTracks().forEach((t) => t.stop());
  }
}

// ---------------------------------------------------------------------------
// Per-site auto-enable
// ---------------------------------------------------------------------------

let autoStartedByRule = false;

function hostnameFromUrl(url: string): string | null {
  try { return new URL(url).hostname; } catch { return null; }
}

async function handleTabUrl(url: string | undefined): Promise<void> {
  if (!url) return;
  const sites = await getAllowlistedSites();
  if (sites.length === 0) return;

  const hostname = hostnameFromUrl(url);
  const isAllowlisted = hostname !== null && sites.some((s) => hostname === s || hostname.endsWith(`.${s}`));
  const running = await getRunningState();

  if (isAllowlisted && !running) {
    const result = await startPipeline();
    if (result.ok) { await setRunningState(true); autoStartedByRule = true; }
  } else if (!isAllowlisted && running && autoStartedByRule) {
    await stopPipeline();
    await setRunningState(false);
    autoStartedByRule = false;
  }
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url) {
    void handleTabUrl(tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    void handleTabUrl(tab.url);
  } catch { /* tab may have closed */ }
});

// ---------------------------------------------------------------------------
// Message router — handles messages from popup and options page
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {

        case 'START_NOISE_CANCEL': {
          const result = await startPipeline();
          if (result.ok) {
            await setRunningState(true);
            autoStartedByRule = false; // manual start — don't auto-stop on navigation
          }
          sendResponse(result);
          break;
        }

        case 'STOP_NOISE_CANCEL': {
          await stopPipeline();
          await setRunningState(false);
          autoStartedByRule = false;
          sendResponse({ ok: true });
          break;
        }

        case 'GET_STATE': {
          const running = await getRunningState();
          sendResponse({ ok: true, running });
          break;
        }

        case 'SET_STRENGTH': {
          await setNoiseStrength(message.value);
          await applyStrengthFromStorage();
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

        case 'SET_MONITOR_AUDIBLE': {
          if (monitorAudioEl) monitorAudioEl.muted = !message.audible;
          sendResponse({ ok: true });
          break;
        }

        case 'GET_VISUALIZER_LEVELS': {
          sendResponse({ ok: true, levels: getVisualizerLevels() });
          break;
        }

        case 'START_CALIBRATION': {
          sendResponse(await runCalibration(message.durationMs));
          break;
        }

        case 'CANCEL_CALIBRATION': {
          cancelCalibration();
          sendResponse({ ok: true });
          break;
        }

        case 'CONFIRM_CALIBRATION': {
          await setStoredNoiseProfile(message.profile);
          sendResponse({ ok: true });
          break;
        }

        case 'CLEAR_CALIBRATION': {
          await clearStoredNoiseProfile();
          sendResponse({ ok: true });
          break;
        }

        case 'GET_CALIBRATION': {
          const profile = await getStoredNoiseProfile();
          sendResponse({ ok: true, profile });
          break;
        }

        case 'GET_SITES': {
          const sites = await getAllowlistedSites();
          sendResponse({ ok: true, sites });
          break;
        }

        case 'ADD_SITE': {
          await addAllowlistedSite(message.hostname);
          sendResponse({ ok: true });
          break;
        }

        case 'REMOVE_SITE': {
          await removeAllowlistedSite(message.hostname);
          sendResponse({ ok: true });
          break;
        }

        default:
          break;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true; // keep channel open for async response
});

// ---------------------------------------------------------------------------
// Startup / install hooks
// ---------------------------------------------------------------------------

chrome.runtime.onStartup?.addListener(async () => {
  await setRunningState(false);
});

chrome.runtime.onInstalled.addListener(async () => {
  await setRunningState(false);
  if (await getAutoStart()) {
    const result = await startPipeline();
    if (result.ok) await setRunningState(true);
  }
});
