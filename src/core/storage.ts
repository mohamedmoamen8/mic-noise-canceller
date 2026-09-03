import type { NoiseProfile } from './calibration/noise-profile';

const STORAGE_KEY = 'noiseCancelRunning';
const CALIBRATION_STORAGE_KEY = 'noiseProfile';
const STRENGTH_STORAGE_KEY = 'noiseStrength';

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
