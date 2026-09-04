// src/entrypoints/options/options.ts
// Options page controller. Runs in a full extension page (not popup), so it
// has access to DOM APIs and can call mediaDevices.enumerateDevices() to list
// available audio inputs.

import {
  getNoiseStrength,
  setNoiseStrength,
  getPreferredMicDeviceId,
  setPreferredMicDeviceId,
  clearPreferredMicDeviceId,
  getAutoStart,
  setAutoStart,
} from '../../core/storage';

// Site allowlist message helpers — go through background so the tab watcher
// picks up changes immediately without a service-worker restart.
async function fetchSites(): Promise<string[]> {
  const response = await chrome.runtime.sendMessage({ type: 'GET_SITES' });
  return (response?.sites as string[] | undefined) ?? [];
}

async function addSiteMsg(hostname: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'ADD_SITE', hostname });
}

async function removeSiteMsg(hostname: string): Promise<void> {
  await chrome.runtime.sendMessage({ type: 'REMOVE_SITE', hostname });
}

const micSelect = document.getElementById('micSelect') as HTMLSelectElement;
const micPermissionHint = document.getElementById('micPermissionHint') as HTMLElement;
const strengthSlider = document.getElementById('strengthSlider') as HTMLInputElement;
const strengthValue = document.getElementById('strengthValue') as HTMLElement;
const autoStartSwitch = document.getElementById('autoStartSwitch') as HTMLInputElement;
const statusBanner = document.getElementById('statusBanner') as HTMLElement;

// ---------------------------------------------------------------------------
// Status banner
// ---------------------------------------------------------------------------

function showStatus(message: string, kind: 'ok' | 'error'): void {
  statusBanner.textContent = message;
  statusBanner.className = kind;
  clearTimeout((showStatus as unknown as { _timer: ReturnType<typeof setTimeout> })._timer);
  (showStatus as unknown as { _timer: ReturnType<typeof setTimeout> })._timer = setTimeout(() => {
    statusBanner.className = '';
    statusBanner.textContent = '';
    statusBanner.style.display = 'none';
  }, 3000);
}

// ---------------------------------------------------------------------------
// Microphone device picker
// ---------------------------------------------------------------------------

async function populateMicList(): Promise<void> {
  let devices: MediaDeviceInfo[];
  try {
    devices = await navigator.mediaDevices.enumerateDevices();
  } catch {
    micPermissionHint.style.display = 'block';
    return;
  }

  const audioInputs = devices.filter((d) => d.kind === 'audioinput');

  // If labels are empty the permission hasn't been granted yet — show hint.
  const hasLabels = audioInputs.some((d) => d.label !== '');
  if (!hasLabels) {
    micPermissionHint.style.display = 'block';
    return;
  }

  micPermissionHint.style.display = 'none';

  // Remove all options except the first "System default" placeholder.
  while (micSelect.options.length > 1) {
    micSelect.remove(1);
  }

  for (const device of audioInputs) {
    const option = document.createElement('option');
    option.value = device.deviceId;
    option.textContent = device.label || `Microphone (${device.deviceId.slice(0, 8)}…)`;
    micSelect.appendChild(option);
  }

  // Restore saved selection.
  const saved = await getPreferredMicDeviceId();
  if (saved) {
    // Only select it if the device is still present.
    const stillPresent = audioInputs.some((d) => d.deviceId === saved);
    if (stillPresent) {
      micSelect.value = saved;
    } else {
      // Device no longer available — clear the stale preference.
      await clearPreferredMicDeviceId();
    }
  }
}

micSelect.addEventListener('change', async () => {
  try {
    if (micSelect.value === '') {
      await clearPreferredMicDeviceId();
    } else {
      await setPreferredMicDeviceId(micSelect.value);
    }
    showStatus('Microphone preference saved.', 'ok');
  } catch {
    showStatus('Failed to save microphone preference.', 'error');
  }
});

// ---------------------------------------------------------------------------
// Suppression strength
// ---------------------------------------------------------------------------

strengthSlider.addEventListener('input', () => {
  strengthValue.textContent = `${strengthSlider.value}%`;
});

strengthSlider.addEventListener('change', async () => {
  try {
    await setNoiseStrength(Number(strengthSlider.value) / 100);
    // Forward to live pipeline if running.
    await chrome.runtime.sendMessage({ type: 'SET_STRENGTH', value: Number(strengthSlider.value) / 100 }).catch(
      () => {}
    );
    showStatus('Strength preference saved.', 'ok');
  } catch {
    showStatus('Failed to save strength preference.', 'error');
  }
});

// ---------------------------------------------------------------------------
// Auto-start
// ---------------------------------------------------------------------------

autoStartSwitch.addEventListener('change', async () => {
  try {
    await setAutoStart(autoStartSwitch.checked);
    showStatus(
      autoStartSwitch.checked
        ? 'Auto-start enabled — noise reduction will start automatically on next install/update.'
        : 'Auto-start disabled.',
      'ok'
    );
  } catch {
    showStatus('Failed to save auto-start preference.', 'error');
  }
});

// ---------------------------------------------------------------------------
// Site allowlist
// ---------------------------------------------------------------------------

const siteList = document.getElementById('siteList') as HTMLUListElement;
const siteListEmpty = document.getElementById('siteListEmpty') as HTMLElement;
const siteInput = document.getElementById('siteInput') as HTMLInputElement;
const addSiteBtn = document.getElementById('addSiteBtn') as HTMLButtonElement;

function normaliseHostname(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  // Strip protocol and path if the user pastes a full URL.
  try {
    const url = new URL(trimmed.startsWith('http') ? trimmed : `https://${trimmed}`);
    return url.hostname;
  } catch {
    return trimmed;
  }
}

function renderSiteList(sites: string[]): void {
  siteList.innerHTML = '';
  if (sites.length === 0) {
    siteListEmpty.style.display = 'block';
    return;
  }
  siteListEmpty.style.display = 'none';
  for (const site of sites) {
    const li = document.createElement('li');
    li.textContent = site;
    const btn = document.createElement('button');
    btn.className = 'btn-remove';
    btn.textContent = 'Remove';
    btn.addEventListener('click', async () => {
      try {
        await removeSiteMsg(site);
        renderSiteList(await fetchSites());
        showStatus(`Removed ${site}.`, 'ok');
      } catch {
        showStatus('Failed to remove site.', 'error');
      }
    });
    li.appendChild(btn);
    siteList.appendChild(li);
  }
}

addSiteBtn.addEventListener('click', async () => {
  const hostname = normaliseHostname(siteInput.value);
  if (!hostname || hostname.includes(' ')) {
    showStatus('Enter a valid hostname (e.g. meet.google.com).', 'error');
    return;
  }
  try {
    addSiteBtn.disabled = true;
    await addSiteMsg(hostname);
    siteInput.value = '';
    renderSiteList(await fetchSites());
    showStatus(`Added ${hostname}.`, 'ok');
  } catch {
    showStatus('Failed to add site.', 'error');
  } finally {
    addSiteBtn.disabled = false;
  }
});

siteInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') addSiteBtn.click();
});

// ---------------------------------------------------------------------------
// Init — load all saved preferences on page open
// ---------------------------------------------------------------------------

async function init(): Promise<void> {
  // Load strength.
  const strength = await getNoiseStrength();
  if (typeof strength === 'number') {
    strengthSlider.value = String(Math.round(strength * 100));
    strengthValue.textContent = `${strengthSlider.value}%`;
  }

  // Load auto-start.
  autoStartSwitch.checked = await getAutoStart();

  // Populate mic list (requires permission — shows hint if not yet granted).
  await populateMicList();

  // Load site allowlist.
  renderSiteList(await fetchSites());
}

void init();
