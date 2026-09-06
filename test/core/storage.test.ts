import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';
import {
  getRunningState,
  setRunningState,
  getStoredNoiseProfile,
  setStoredNoiseProfile,
  clearStoredNoiseProfile,
  getNoiseStrength,
  setNoiseStrength,
  getPreferredMicDeviceId,
  setPreferredMicDeviceId,
  clearPreferredMicDeviceId,
  getAutoStart,
  setAutoStart,
  getAllowlistedSites,
  setAllowlistedSites,
  addAllowlistedSite,
  removeAllowlistedSite,
} from '../../src/core/storage';

function buildStorageMock(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('storage', () => {
  beforeEach(() => {
    (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome = {
      storage: {
        local: buildStorageMock(),
      },
    };
  });

  // ---------------------------------------------------------------------------
  // Running state
  // ---------------------------------------------------------------------------

  describe('getRunningState', () => {
    it('returns false when storage has no running key', async () => {
      const response = await getRunningState();
      expect(response).toBe(false);
    });

    it('returns true when storage has noiseCancelRunning=true', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ noiseCancelRunning: true });

      const response = await getRunningState();
      expect(response).toBe(true);
    });

    it('returns false when storage has noiseCancelRunning=false', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ noiseCancelRunning: false });

      const response = await getRunningState();
      expect(response).toBe(false);
    });

    it('returns false when chrome is undefined', async () => {
      const chrome = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
      delete (globalThis as unknown as { chrome?: Record<string, unknown> }).chrome;

      const response = await getRunningState();
      expect(response).toBe(false);

      (globalThis as unknown as { chrome: Record<string, unknown> }).chrome = chrome;
    });
  });

  describe('setRunningState', () => {
    it('persists the boolean value', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      await setRunningState(true);
      expect(storage.set).toHaveBeenCalledWith({ noiseCancelRunning: true });
    });

    it('returns early when chrome is undefined', async () => {
      const chrome = (globalThis as unknown as { chrome: Record<string, unknown> }).chrome;
      delete (globalThis as unknown as { chrome?: Record<string, unknown> }).chrome;

      await setRunningState(true);

      (globalThis as unknown as { chrome: Record<string, unknown> }).chrome = chrome;
    });
  });

  // ---------------------------------------------------------------------------
  // Noise profile
  // ---------------------------------------------------------------------------

  describe('getStoredNoiseProfile / setStoredNoiseProfile / clearStoredNoiseProfile', () => {
    it('returns null when nothing is stored', async () => {
      const response = await getStoredNoiseProfile();
      expect(response).toBeNull();
    });

    it('returns the stored profile', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      const fakeProfile = {
        meanAbsLevel: 0.01,
        rmsLevel: 0.01,
        peakLevel: 0.02,
        classification: 'quiet' as const,
        suggestedNoiseFloor: 0.01,
        suggestedStrength: 0.6,
        durationMs: 3000,
        sampleCount: 144000,
      };
      (storage.get as Mock).mockResolvedValue({ noiseProfile: fakeProfile });

      const response = await getStoredNoiseProfile();
      expect(response).toEqual(fakeProfile);
    });

    it('persists a profile', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      const fakeProfile = {
        meanAbsLevel: 0.01,
        rmsLevel: 0.01,
        peakLevel: 0.02,
        classification: 'quiet' as const,
        suggestedNoiseFloor: 0.01,
        suggestedStrength: 0.6,
        durationMs: 3000,
        sampleCount: 144000,
      };

      await setStoredNoiseProfile(fakeProfile as never);
      expect(storage.set).toHaveBeenCalledWith({ noiseProfile: fakeProfile });
    });

    it('removes the stored profile', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      await clearStoredNoiseProfile();
      expect(storage.remove).toHaveBeenCalledWith('noiseProfile');
    });
  });

  // ---------------------------------------------------------------------------
  // Strength
  // ---------------------------------------------------------------------------

  describe('getNoiseStrength / setNoiseStrength', () => {
    it('returns undefined when nothing is stored', async () => {
      const response = await getNoiseStrength();
      expect(response).toBeUndefined();
    });

    it('returns the stored strength', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ noiseStrength: 0.75 });

      const response = await getNoiseStrength();
      expect(response).toBe(0.75);
    });

    it('persists a strength value', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      await setNoiseStrength(0.5);
      expect(storage.set).toHaveBeenCalledWith({ noiseStrength: 0.5 });
    });
  });

  // ---------------------------------------------------------------------------
  // Preferred mic device
  // ---------------------------------------------------------------------------

  describe('getPreferredMicDeviceId / setPreferredMicDeviceId / clearPreferredMicDeviceId', () => {
    it('returns undefined when nothing is stored', async () => {
      const response = await getPreferredMicDeviceId();
      expect(response).toBeUndefined();
    });

    it('returns the stored device id', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ preferredMicDeviceId: 'abc-123' });

      const response = await getPreferredMicDeviceId();
      expect(response).toBe('abc-123');
    });

    it('persists a device id', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      await setPreferredMicDeviceId('xyz-789');
      expect(storage.set).toHaveBeenCalledWith({ preferredMicDeviceId: 'xyz-789' });
    });

    it('removes the stored device id', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      await clearPreferredMicDeviceId();
      expect(storage.remove).toHaveBeenCalledWith('preferredMicDeviceId');
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-start
  // ---------------------------------------------------------------------------

  describe('getAutoStart / setAutoStart', () => {
    it('returns false when nothing is stored', async () => {
      const response = await getAutoStart();
      expect(response).toBe(false);
    });

    it('returns true when autoStart is stored as true', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ autoStart: true });

      const response = await getAutoStart();
      expect(response).toBe(true);
    });

    it('persists the auto-start value', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      await setAutoStart(true);
      expect(storage.set).toHaveBeenCalledWith({ autoStart: true });
    });
  });

  // ---------------------------------------------------------------------------
  // Allowlisted sites
  // ---------------------------------------------------------------------------

  describe('getAllowlistedSites / setAllowlistedSites / addAllowlistedSite / removeAllowlistedSite', () => {
    it('returns an empty array when nothing is stored', async () => {
      const response = await getAllowlistedSites();
      expect(response).toEqual([]);
    });

    it('returns the stored sites', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ allowlistedSites: ['a.com', 'b.com'] });

      const response = await getAllowlistedSites();
      expect(response).toEqual(['a.com', 'b.com']);
    });

    it('persists an array of sites', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      await setAllowlistedSites(['x.com', 'y.com']);
      expect(storage.set).toHaveBeenCalledWith({ allowlistedSites: ['x.com', 'y.com'] });
    });

    it('adds a site without duplicating', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ allowlistedSites: ['a.com'] });

      await addAllowlistedSite('b.com');
      expect(storage.set).toHaveBeenCalledWith({ allowlistedSites: ['a.com', 'b.com'] });
    });

    it('does not duplicate an existing site', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ allowlistedSites: ['a.com', 'b.com'] });

      await addAllowlistedSite('a.com');
      expect(storage.set).not.toHaveBeenCalled();
    });

    it('removes a site', async () => {
      const storage = (globalThis as unknown as { chrome: { storage: { local: Record<string, unknown> } } }).chrome.storage.local;
      (storage.get as Mock).mockResolvedValue({ allowlistedSites: ['a.com', 'b.com'] });

      await removeAllowlistedSite('a.com');
      expect(storage.set).toHaveBeenCalledWith({ allowlistedSites: ['b.com'] });
    });
  });
});
