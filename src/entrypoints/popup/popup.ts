// src/popup/popup.ts

import { getNoiseStrength } from '../../core/storage';
import type { NoiseClassification, NoiseProfile } from '../../core/calibration/noise-profile';

const toggleSwitch = document.getElementById('toggleSwitch') as HTMLInputElement;
const toggleLabel = document.getElementById('toggleLabel') as HTMLElement;
const statusDot = document.getElementById('statusDot') as HTMLElement;
const strengthSlider = document.getElementById('strengthSlider') as HTMLInputElement;
const strengthValue = document.getElementById('strengthValue') as HTMLElement;
const monitorSwitch = document.getElementById('monitorSwitch') as HTMLInputElement;
const errorBox = document.getElementById('errorBox') as HTMLElement;
const bypassRow = document.getElementById('bypassRow') as HTMLElement;
const bypassSwitch = document.getElementById('bypassSwitch') as HTMLInputElement;
const engineBadge = document.getElementById('engineBadge') as HTMLElement;
const canvas = document.getElementById('visualizer') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;

const calibrateBtn = document.getElementById('calibrateBtn') as HTMLButtonElement;
const calibrationStatus = document.getElementById('calibrationStatus') as HTMLElement;
const calibrationResult = document.getElementById('calibrationResult') as HTMLElement;
const calibrationSummary = document.getElementById('calibrationSummary') as HTMLElement;
const calibrationAudio = document.getElementById('calibrationAudio') as HTMLAudioElement;
const discardCalibrationBtn = document.getElementById('discardCalibrationBtn') as HTMLButtonElement;
const confirmCalibrationBtn = document.getElementById('confirmCalibrationBtn') as HTMLButtonElement;
const resetCalibrationBtn = document.getElementById('resetCalibrationBtn') as HTMLButtonElement;

let pollTimer: ReturnType<typeof setInterval> | null = null;

function showError(message: string): void {
  errorBox.textContent = message;
  errorBox.style.display = 'block';
}

function clearError(): void {
  errorBox.style.display = 'none';
  errorBox.textContent = '';
}

function setEngineBadge(engine: 'rnnoise' | 'gate' | null): void {
  if (!engine) {
    engineBadge.style.display = 'none';
    return;
  }
  engineBadge.style.display = 'inline-block';
  if (engine === 'rnnoise') {
    engineBadge.textContent = 'RNNoise (ML)';
    engineBadge.className = 'badge badge-rnnoise';
  } else {
    engineBadge.textContent = 'JS fallback';
    engineBadge.className = 'badge badge-gate';
  }
}

function setUIRunning(running: boolean): void {
  toggleSwitch.checked = running;
  toggleLabel.textContent = running ? 'Noise reduction is on' : 'Noise reduction is off';
  statusDot.classList.toggle('on', running);

  // Show the bypass toggle only while the pipeline is active.
  bypassRow.classList.toggle('visible', running);
  if (!running) {
    // Reset bypass state so the next session starts clean.
    bypassSwitch.checked = false;
  }

  if (running) {
    startVisualizerPolling();
  } else {
    stopVisualizerPolling();
    drawIdleWaveform();
    setEngineBadge(null);
  }
}

function setControlsBusy(busy: boolean): void {
  toggleSwitch.disabled = busy;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function sendToBackground<T = any>(message: Record<string, unknown>): Promise<T> {
  return chrome.runtime.sendMessage(message);
}

toggleSwitch.addEventListener('change', async () => {
  const wantOn = toggleSwitch.checked;
  clearError();
  setControlsBusy(true);

  try {
    const response = wantOn
      ? await sendToBackground<{ ok: boolean; error?: string }>({ type: 'START_NOISE_CANCEL' })
      : await sendToBackground<{ ok: boolean; error?: string }>({ type: 'STOP_NOISE_CANCEL' });

    if (response?.ok) {
      setUIRunning(wantOn);
    } else {
      toggleSwitch.checked = !wantOn;
      showError(response?.error || 'Something went wrong. Please try again.');
      setUIRunning(!wantOn);
    }
  } catch (err) {
    toggleSwitch.checked = !wantOn;
    showError(err instanceof Error ? err.message : 'Could not reach the extension background service.');
    setUIRunning(!wantOn);
  } finally {
    setControlsBusy(false);
  }
});

strengthSlider.addEventListener('input', () => {
  strengthValue.textContent = `${strengthSlider.value}%`;
});

strengthSlider.addEventListener('change', async () => {
  const value = Number(strengthSlider.value) / 100;
  try {
    await chrome.runtime.sendMessage({ type: 'SET_STRENGTH', value });
  } catch {
    /* offscreen doc may not exist yet — background applies stored value on next start */
  }
});

monitorSwitch.addEventListener('change', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'SET_MONITOR_AUDIBLE', audible: monitorSwitch.checked });
  } catch {
    /* ignore */
  }
});

bypassSwitch.addEventListener('change', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'SET_BYPASS', value: bypassSwitch.checked });
  } catch {
    /* ignore — pipeline may have stopped between the UI event and this send */
  }
});

function startVisualizerPolling(): void {
  stopVisualizerPolling();
  pollTimer = setInterval(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: 'GET_VISUALIZER_LEVELS' });
      if (response?.ok && response.levels) {
        drawLevels(response.levels);
      }
    } catch {
      /* offscreen doc likely closed mid-poll */
    }
  }, 60);
}

function stopVisualizerPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function drawLevels(levels: number[]): void {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);

  const barCount = Math.min(levels.length, 48);
  const step = Math.floor(levels.length / barCount) || 1;
  const barWidth = width / barCount;

  for (let i = 0; i < barCount; i++) {
    const raw = levels[i * step] || 0;
    const barHeight = Math.max(2, (raw / 255) * height);
    const x = i * barWidth;
    const y = height - barHeight;

    const gradient = ctx.createLinearGradient(0, y, 0, height);
    gradient.addColorStop(0, '#5865f2');
    gradient.addColorStop(1, '#3ba55d');
    ctx.fillStyle = gradient;
    ctx.fillRect(x + 1, y, barWidth - 2, barHeight);
  }
}

function drawIdleWaveform(): void {
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#3a3d4a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();
}

// The offscreen document posts ENGINE_READY once the worklet reports which
// DSP engine actually initialized (RNNoise vs. JS fallback). Runtime
// messages sent from offscreen.js land here too since popup is also a
// runtime.onMessage listener context.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === 'ENGINE_READY') {
    setEngineBadge(message.engine);
  }
  if (message?.type === 'MIC_ENDED_UNEXPECTEDLY') {
    // The mic track was cut while noise reduction was active (device
    // unplugged, permission revoked, OS mute, etc.). Reset the UI to the
    // stopped state and surface a clear explanation to the user.
    setUIRunning(false);
    showError('Microphone disconnected unexpectedly. Noise reduction has been stopped.');
  }
});

// --- Microphone calibration --------------------------------------------
// Records ~3s of ambient noise, lets the user play it back to confirm it's
// really just background noise (not their voice), then either:
//  - CONFIRM: persists only the computed profile numbers to storage, and
//    clears the local data-URI reference to the clip immediately after —
//    the recording itself is never written anywhere.
//  - DISCARD: clears the local clip and nothing is stored at all.

let pendingProfile: NoiseProfile | null = null;

function clearCalibrationPlayback(): void {
  // Explicitly drop the reference to the recorded clip's data URI so it's
  // eligible for garbage collection — this is the "delete the recording"
  // step, done as soon as the user is finished testing it.
  calibrationAudio.pause();
  calibrationAudio.removeAttribute('src');
  calibrationAudio.load();
  pendingProfile = null;
}

function describeClassification(classification: NoiseClassification): string {
  switch (classification) {
    case 'quiet':
      return 'Quiet room — light suppression will do';
    case 'moderate':
      return 'Some background noise — moderate suppression recommended';
    case 'noisy':
      return 'Noisy environment — strong suppression recommended';
  }
}

function renderCalibrationStatus(profile: NoiseProfile | null): void {
  if (!profile) {
    calibrationStatus.textContent = 'Not calibrated';
    calibrationStatus.classList.remove('calibrated');
    resetCalibrationBtn.style.display = 'none';
    return;
  }
  calibrationStatus.textContent = `Calibrated: ${profile.classification}`;
  calibrationStatus.classList.add('calibrated');
  resetCalibrationBtn.style.display = 'inline';
}

calibrateBtn.addEventListener('click', async () => {
  clearError();
  clearCalibrationPlayback();
  calibrationResult.style.display = 'none';
  calibrateBtn.disabled = true;

  const originalLabel = calibrateBtn.textContent;
  let secondsLeft = 3;
  calibrateBtn.textContent = `Recording... ${secondsLeft}s (stay quiet)`;
  const countdown = setInterval(() => {
    secondsLeft -= 1;
    if (secondsLeft > 0) {
      calibrateBtn.textContent = `Recording... ${secondsLeft}s (stay quiet)`;
    }
  }, 1000);

  try {
    const response = await sendToBackground<{
      ok: boolean;
      error?: string;
      profile?: NoiseProfile;
      audioBase64?: string;
      mimeType?: string;
    }>({ type: 'START_CALIBRATION', durationMs: 3000 });

    clearInterval(countdown);
    calibrateBtn.textContent = originalLabel;

    if (response?.ok && response.profile && response.audioBase64 && response.mimeType) {
      pendingProfile = response.profile;
      calibrationAudio.src = `data:${response.mimeType};base64,${response.audioBase64}`;
      calibrationSummary.innerHTML = `<span class="level-${response.profile.classification}">${describeClassification(
        response.profile.classification
      )}</span>`;
      calibrationResult.style.display = 'block';
    } else {
      showError(response?.error || 'Calibration failed. Please try again.');
    }
  } catch (err) {
    clearInterval(countdown);
    calibrateBtn.textContent = originalLabel;
    showError(err instanceof Error ? err.message : 'Could not start calibration.');
  } finally {
    calibrateBtn.disabled = false;
  }
});

discardCalibrationBtn.addEventListener('click', () => {
  clearCalibrationPlayback();
  calibrationResult.style.display = 'none';
});

confirmCalibrationBtn.addEventListener('click', async () => {
  if (!pendingProfile) return;
  try {
    await chrome.runtime.sendMessage({ type: 'CONFIRM_CALIBRATION', profile: pendingProfile });
    renderCalibrationStatus(pendingProfile);
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Could not save calibration.');
  } finally {
    // The clip has done its job (letting the user confirm it's just noise);
    // delete it now regardless of whether the save above succeeded.
    clearCalibrationPlayback();
    calibrationResult.style.display = 'none';
  }
});

resetCalibrationBtn.addEventListener('click', async () => {
  try {
    await chrome.runtime.sendMessage({ type: 'CLEAR_CALIBRATION' });
  } catch {
    /* ignore */
  }
  renderCalibrationStatus(null);
});

async function init(): Promise<void> {
  drawIdleWaveform();

  try {
    const noiseStrength = await getNoiseStrength();
    if (typeof noiseStrength === 'number') {
      strengthSlider.value = String(Math.round(noiseStrength * 100));
      strengthValue.textContent = `${strengthSlider.value}%`;
    }
  } catch {
    /* ignore */
  }

  try {
    const response = await sendToBackground<{ ok: boolean; running: boolean }>({ type: 'GET_STATE' });
    setUIRunning(Boolean(response?.running));
  } catch {
    showError('Could not connect to the extension background service.');
  }

  try {
    const calibrationResponse = await sendToBackground<{ ok: boolean; profile: NoiseProfile | null }>({
      type: 'GET_CALIBRATION'
    });
    renderCalibrationStatus(calibrationResponse?.profile ?? null);
  } catch {
    /* non-critical — leave status at its default "Not calibrated" */
  }
}

void init();
