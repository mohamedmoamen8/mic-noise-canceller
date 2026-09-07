// src/core/message-handlers.ts
// Shared message handler helpers for background-style entrypoints.
// These wrap storage operations and return typed responses so both the
// Chrome service worker and the Firefox background page can reuse them.

import type { NoiseProfile } from './calibration/noise-profile';
import {
  getRunningState,
  getStoredNoiseProfile,
  setStoredNoiseProfile,
  clearStoredNoiseProfile,
  setNoiseStrength,
  getAutoStart,
  setAutoStart,
  getAllowlistedSites,
  addAllowlistedSite,
  removeAllowlistedSite,
} from './storage';

export async function handleGetState(): Promise<{ ok: true; running: boolean }> {
  const running = await getRunningState();
  return { ok: true, running };
}

export async function handleSetStrength(value: number): Promise<{ ok: true }> {
  await setNoiseStrength(value);
  return { ok: true };
}

export async function handleConfirmCalibration(profile: NoiseProfile): Promise<{ ok: true }> {
  await setStoredNoiseProfile(profile);
  return { ok: true };
}

export async function handleClearCalibration(): Promise<{ ok: true }> {
  await clearStoredNoiseProfile();
  return { ok: true };
}

export async function handleGetCalibration(): Promise<{ ok: true; profile: NoiseProfile | null }> {
  const profile = await getStoredNoiseProfile();
  return { ok: true, profile };
}

export async function handleGetSites(): Promise<{ ok: true; sites: string[] }> {
  const sites = await getAllowlistedSites();
  return { ok: true, sites };
}

export async function handleAddSite(hostname: string): Promise<{ ok: true }> {
  await addAllowlistedSite(hostname);
  return { ok: true };
}

export async function handleRemoveSite(hostname: string): Promise<{ ok: true }> {
  await removeAllowlistedSite(hostname);
  return { ok: true };
}

export async function handleGetAutoStart(): Promise<{ ok: true; autoStart: boolean }> {
  const autoStart = await getAutoStart();
  return { ok: true, autoStart };
}

export async function handleSetAutoStart(value: boolean): Promise<{ ok: true }> {
  await setAutoStart(value);
  return { ok: true };
}
