import type { NoiseProfile } from './calibration/noise-profile';

const STORAGE_KEY = 'noiseCancelRunning';
const CALIBRATION_STORAGE_KEY = 'noiseProfile';
const STRENGTH_STORAGE_KEY = 'noiseStrength';
const MIC_DEVICE_ID_KEY = 'preferredMicDeviceId';
const AUTO_START_KEY = 'autoStart';

function getStorage(): typeof chrome.storage.local | null {
  if (typeof chrome === 'undefined') {
    console.warn('[storage] chrome namespace is undefined — extension APIs are not available in this context.');
    return null;
  }
  if (!chrome.storage || !chrome.storage.local) {
    console.warn('[storage] chrome.storage.local is unavailable. Ensure the extension is loaded from dist/ with the "storage" permission declared in manifest.json.');
    return null;
  }
  return chrome.storage.local;
}

export async function getRunningState(): Promise<boolean> {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const data = await storage.get(STORAGE_KEY);
    return Boolean(data[STORAGE_KEY]);
  } catch (err) {
    console.warn('[storage] getRunningState failed:', err);
    return false;
  }
}

export async function setRunningState(isRunning: boolean): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.set({ [STORAGE_KEY]: isRunning });
  } catch (err) {
    console.warn('[storage] setRunningState failed:', err);
  }
}

export async function getStoredNoiseProfile(): Promise<NoiseProfile | null> {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const data = await storage.get(CALIBRATION_STORAGE_KEY);
    return (data[CALIBRATION_STORAGE_KEY] as NoiseProfile | undefined) ?? null;
  } catch (err) {
    console.warn('[storage] getStoredNoiseProfile failed:', err);
    return null;
  }
}

export async function setStoredNoiseProfile(profile: NoiseProfile): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.set({ [CALIBRATION_STORAGE_KEY]: profile });
  } catch (err) {
    console.warn('[storage] setStoredNoiseProfile failed:', err);
  }
}

export async function clearStoredNoiseProfile(): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.remove(CALIBRATION_STORAGE_KEY);
  } catch (err) {
    console.warn('[storage] clearStoredNoiseProfile failed:', err);
  }
}

export async function getNoiseStrength(): Promise<number | undefined> {
  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const data = await storage.get(STRENGTH_STORAGE_KEY);
    return data[STRENGTH_STORAGE_KEY] as number | undefined;
  } catch (err) {
    console.warn('[storage] getNoiseStrength failed:', err);
    return undefined;
  }
}

export async function setNoiseStrength(value: number): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.set({ [STRENGTH_STORAGE_KEY]: value });
  } catch (err) {
    console.warn('[storage] setNoiseStrength failed:', err);
  }
}


export async function getPreferredMicDeviceId(): Promise<string | undefined> {
  const storage = getStorage();
  if (!storage) return undefined;
  try {
    const data = await storage.get(MIC_DEVICE_ID_KEY);
    return data[MIC_DEVICE_ID_KEY] as string | undefined;
  } catch (err) {
    console.warn('[storage] getPreferredMicDeviceId failed:', err);
    return undefined;
  }
}

export async function setPreferredMicDeviceId(deviceId: string): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.set({ [MIC_DEVICE_ID_KEY]: deviceId });
  } catch (err) {
    console.warn('[storage] setPreferredMicDeviceId failed:', err);
  }
}

export async function clearPreferredMicDeviceId(): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.remove(MIC_DEVICE_ID_KEY);
  } catch (err) {
    console.warn('[storage] clearPreferredMicDeviceId failed:', err);
  }
}

export async function getAutoStart(): Promise<boolean> {
  const storage = getStorage();
  if (!storage) return false;
  try {
    const data = await storage.get(AUTO_START_KEY);
    return Boolean(data[AUTO_START_KEY]);
  } catch (err) {
    console.warn('[storage] getAutoStart failed:', err);
    return false;
  }
}

export async function setAutoStart(value: boolean): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.set({ [AUTO_START_KEY]: value });
  } catch (err) {
    console.warn('[storage] setAutoStart failed:', err);
  }
}


const ALLOWLISTED_SITES_KEY = 'allowlistedSites';

export async function getAllowlistedSites(): Promise<string[]> {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const data = await storage.get(ALLOWLISTED_SITES_KEY);
    return (data[ALLOWLISTED_SITES_KEY] as string[] | undefined) ?? [];
  } catch (err) {
    console.warn('[storage] getAllowlistedSites failed:', err);
    return [];
  }
}

export async function setAllowlistedSites(sites: string[]): Promise<void> {
  const storage = getStorage();
  if (!storage) return;
  try {
    await storage.set({ [ALLOWLISTED_SITES_KEY]: sites });
  } catch (err) {
    console.warn('[storage] setAllowlistedSites failed:', err);
  }
}

export async function addAllowlistedSite(hostname: string): Promise<void> {
  const sites = await getAllowlistedSites();
  if (!sites.includes(hostname)) {
    await setAllowlistedSites([...sites, hostname]);
  }
}

export async function removeAllowlistedSite(hostname: string): Promise<void> {
  const sites = await getAllowlistedSites();
  await setAllowlistedSites(sites.filter((s) => s !== hostname));
}
