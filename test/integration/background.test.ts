// test/integration/background.test.ts
// Integration tests for background.ts message handlers.
// The chrome global is mocked before each test; background.ts is re-imported
// via a dynamic import inside each describe block so the mock is in place
// when the module's top-level chrome.runtime.onMessage.addListener() runs.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChromeMock, captureMessageHandler, dispatchMessage } from '../helpers/chrome-mock';
import type { ChromeMock } from '../helpers/chrome-mock';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Import (or re-import) background.ts with the current globalThis.chrome mock in place. */
async function loadBackground(): Promise<void> {
  // Vitest caches modules between tests. We need a fresh registration of the
  // onMessage listener each time, so we reset the module registry before
  // each import. The vi.resetModules() call in beforeEach handles this.
  await import('../../src/entrypoints/background/background');
}

// ---------------------------------------------------------------------------
// GET_STATE
// ---------------------------------------------------------------------------

describe('GET_STATE handler', () => {
  let chrome: ChromeMock;

  beforeEach(async () => {
    vi.resetModules();
    chrome = buildChromeMock();
    await loadBackground();
  });

  it('returns ok:true and running:false when storage has no running key', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, { type: 'GET_STATE' });
    expect(response).toMatchObject({ ok: true, running: false });
  });

  it('returns running:true when storage has noiseCancelRunning=true', async () => {
    chrome.storage.local.get.mockResolvedValue({ noiseCancelRunning: true });
    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, { type: 'GET_STATE' });
    expect(response).toMatchObject({ ok: true, running: true });
  });
});

// ---------------------------------------------------------------------------
// START_NOISE_CANCEL
// ---------------------------------------------------------------------------

describe('START_NOISE_CANCEL handler', () => {
  let chrome: ChromeMock;

  beforeEach(async () => {
    vi.resetModules();
    chrome = buildChromeMock();
    await loadBackground();
  });

  it('creates the offscreen document, forwards OFFSCREEN_START, persists running state', async () => {
    // getContexts returns empty → no existing offscreen doc
    chrome.runtime.getContexts!.mockResolvedValue([]);
    // OFFSCREEN_START succeeds
    chrome.runtime.sendMessage.mockResolvedValue({ ok: true });

    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, { type: 'START_NOISE_CANCEL' });

    expect(chrome.offscreen.createDocument).toHaveBeenCalledOnce();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'OFFSCREEN_START' });
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ noiseCancelRunning: true });
    expect(response).toMatchObject({ ok: true });
  });

  it('returns ok:false and resets state when OFFSCREEN_START fails', async () => {
    // Simulate: no doc at first → createDocument succeeds → doc now exists →
    // OFFSCREEN_START fails → closeDocument is called to clean up.
    let docExists = false;
    chrome.runtime.getContexts!.mockImplementation(async () =>
      docExists ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []
    );
    chrome.offscreen.createDocument.mockImplementation(async () => {
      docExists = true;
    });
    chrome.runtime.sendMessage.mockResolvedValue({ ok: false, error: 'mic denied' });

    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage<{ ok: boolean; error?: string }>(handler, {
      type: 'START_NOISE_CANCEL',
    });

    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ noiseCancelRunning: false });
    expect(response).toMatchObject({ ok: false, error: 'mic denied' });
  });

  it('skips createDocument when offscreen doc already exists', async () => {
    // Simulate an existing offscreen context
    chrome.runtime.getContexts!.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
    chrome.runtime.sendMessage.mockResolvedValue({ ok: true });

    const handler = captureMessageHandler(chrome);
    await dispatchMessage(handler, { type: 'START_NOISE_CANCEL' });

    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// STOP_NOISE_CANCEL
// ---------------------------------------------------------------------------

describe('STOP_NOISE_CANCEL handler', () => {
  let chrome: ChromeMock;

  beforeEach(async () => {
    vi.resetModules();
    chrome = buildChromeMock();
    await loadBackground();
  });

  it('stops and closes the offscreen doc, resets running state', async () => {
    chrome.runtime.getContexts!.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);

    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, { type: 'STOP_NOISE_CANCEL' });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'OFFSCREEN_STOP' });
    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
    expect(chrome.storage.local.set).toHaveBeenCalledWith({ noiseCancelRunning: false });
    expect(response).toMatchObject({ ok: true });
  });

  it('skips OFFSCREEN_STOP when no offscreen doc exists', async () => {
    chrome.runtime.getContexts!.mockResolvedValue([]);

    const handler = captureMessageHandler(chrome);
    await dispatchMessage(handler, { type: 'STOP_NOISE_CANCEL' });

    // sendMessage should NOT be called for OFFSCREEN_STOP
    const offscreenStopCalls = (chrome.runtime.sendMessage.mock.calls as Array<[unknown]>).filter(
      ([msg]) => (msg as { type?: string })?.type === 'OFFSCREEN_STOP'
    );
    expect(offscreenStopCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// SET_STRENGTH
// ---------------------------------------------------------------------------

describe('SET_STRENGTH handler', () => {
  let chrome: ChromeMock;

  beforeEach(async () => {
    vi.resetModules();
    chrome = buildChromeMock();
    await loadBackground();
  });

  it('always persists the value to storage', async () => {
    chrome.runtime.getContexts!.mockResolvedValue([]);
    const handler = captureMessageHandler(chrome);
    await dispatchMessage(handler, { type: 'SET_STRENGTH', value: 0.75 });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ noiseStrength: 0.75 });
  });

  it('forwards to offscreen when offscreen doc is alive', async () => {
    chrome.runtime.getContexts!.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
    const handler = captureMessageHandler(chrome);
    await dispatchMessage(handler, { type: 'SET_STRENGTH', value: 0.5 });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'SET_STRENGTH', value: 0.5 });
  });

  it('does NOT forward to offscreen when offscreen doc is absent', async () => {
    chrome.runtime.getContexts!.mockResolvedValue([]);
    const handler = captureMessageHandler(chrome);
    await dispatchMessage(handler, { type: 'SET_STRENGTH', value: 0.5 });

    const forwardCalls = (chrome.runtime.sendMessage.mock.calls as Array<[unknown]>).filter(
      ([msg]) => (msg as { type?: string })?.type === 'SET_STRENGTH'
    );
    expect(forwardCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// MIC_ENDED_UNEXPECTEDLY
// ---------------------------------------------------------------------------

describe('MIC_ENDED_UNEXPECTEDLY handler', () => {
  let chrome: ChromeMock;

  beforeEach(async () => {
    vi.resetModules();
    chrome = buildChromeMock();
    await loadBackground();
  });

  it('resets running state to false', async () => {
    chrome.runtime.getContexts!.mockResolvedValue([]);
    const handler = captureMessageHandler(chrome);
    handler({ type: 'MIC_ENDED_UNEXPECTEDLY' }, {} as chrome.runtime.MessageSender, vi.fn());

    // Allow microtask queue to flush
    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ noiseCancelRunning: false });
  });

  it('closes the offscreen document if one is open', async () => {
    chrome.runtime.getContexts!.mockResolvedValue([{ contextType: 'OFFSCREEN_DOCUMENT' }]);
    const handler = captureMessageHandler(chrome);
    handler({ type: 'MIC_ENDED_UNEXPECTEDLY' }, {} as chrome.runtime.MessageSender, vi.fn());

    await new Promise((r) => setTimeout(r, 0));

    expect(chrome.offscreen.closeDocument).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// CALIBRATION handlers
// ---------------------------------------------------------------------------

describe('CONFIRM_CALIBRATION / GET_CALIBRATION / CLEAR_CALIBRATION handlers', () => {
  let chrome: ChromeMock;

  beforeEach(async () => {
    vi.resetModules();
    chrome = buildChromeMock();
    await loadBackground();
  });

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

  it('CONFIRM_CALIBRATION persists the profile and returns ok:true', async () => {
    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, {
      type: 'CONFIRM_CALIBRATION',
      profile: fakeProfile,
    });

    expect(chrome.storage.local.set).toHaveBeenCalledWith({ noiseProfile: fakeProfile });
    expect(response).toMatchObject({ ok: true });
  });

  it('GET_CALIBRATION returns the stored profile', async () => {
    chrome.storage.local.get.mockResolvedValue({ noiseProfile: fakeProfile });
    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, { type: 'GET_CALIBRATION' });

    expect(response).toMatchObject({ ok: true, profile: fakeProfile });
  });

  it('GET_CALIBRATION returns profile:null when nothing is stored', async () => {
    chrome.storage.local.get.mockResolvedValue({});
    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, { type: 'GET_CALIBRATION' });

    expect(response).toMatchObject({ ok: true, profile: null });
  });

  it('CLEAR_CALIBRATION removes the stored profile and returns ok:true', async () => {
    const handler = captureMessageHandler(chrome);
    const response = await dispatchMessage(handler, { type: 'CLEAR_CALIBRATION' });

    expect(chrome.storage.local.remove).toHaveBeenCalledWith('noiseProfile');
    expect(response).toMatchObject({ ok: true });
  });
});
