// test/helpers/chrome-mock.ts
// Minimal chrome extension API mock for Vitest integration tests.
// Only covers the surface used by background.ts and storage.ts.
// Each test should call buildChromeMock() and assign the result to
// globalThis.chrome so imports that call chrome.* see the mock.

import { vi, type Mock } from 'vitest';

export interface StorageArea {
  get: Mock;
  set: Mock;
  remove: Mock;
}

export interface RuntimeMock {
  sendMessage: Mock;
  getURL: Mock;
  getContexts: Mock | undefined;
  onMessage: { addListener: Mock };
  onStartup: { addListener: Mock };
  onInstalled: { addListener: Mock };
  ContextType: { OFFSCREEN_DOCUMENT: string };
}

export interface TabsMock {
  onUpdated: { addListener: Mock };
  onActivated: { addListener: Mock };
  get: Mock;
}

export interface OffscreenMock {
  createDocument: Mock;
  closeDocument: Mock;
  Reason: { USER_MEDIA: string };
}

export interface ChromeMock {
  storage: { local: StorageArea };
  runtime: RuntimeMock;
  offscreen: OffscreenMock;
  tabs: TabsMock;
}

/**
 * Build a fresh chrome mock. Call this in beforeEach to ensure test
 * isolation — each test gets its own set of vi.fn() spies.
 *
 * The returned object is also assigned to globalThis.chrome so that
 * modules imported under test can reach it via the bare `chrome` global.
 */
export function buildChromeMock(overrides: Partial<ChromeMock> = {}): ChromeMock {
  const storage: StorageArea = {
    get: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  const runtime: RuntimeMock = {
    sendMessage: vi.fn().mockResolvedValue({ ok: true }),
    getURL: vi.fn((path: string) => `chrome-extension://test-id/${path}`),
    // Returning an empty array means "no offscreen document exists" by default.
    getContexts: vi.fn().mockResolvedValue([]),
    onMessage: { addListener: vi.fn() },
    onStartup: { addListener: vi.fn() },
    onInstalled: { addListener: vi.fn() },
    ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
  };

  const offscreen: OffscreenMock = {
    createDocument: vi.fn().mockResolvedValue(undefined),
    closeDocument: vi.fn().mockResolvedValue(undefined),
    Reason: { USER_MEDIA: 'USER_MEDIA' },
  };

  const tabs: TabsMock = {
    onUpdated: { addListener: vi.fn() },
    onActivated: { addListener: vi.fn() },
    get: vi.fn().mockResolvedValue({ url: undefined, active: true }),
  };

  const mock: ChromeMock = {
    storage: { local: { ...storage, ...(overrides.storage?.local ?? {}) } },
    runtime: { ...runtime, ...(overrides.runtime ?? {}) },
    offscreen: { ...offscreen, ...(overrides.offscreen ?? {}) },
    tabs: { ...tabs, ...(overrides.tabs ?? {}) },
  };

  // Expose as global so bare `chrome` references in source resolve correctly.
  (globalThis as unknown as { chrome: ChromeMock }).chrome = mock;

  return mock;
}

/**
 * Helper: extract the async message handler that background.ts registers
 * via chrome.runtime.onMessage.addListener(). Returns a function you can
 * call directly with (message, sender, sendResponse).
 */
export function captureMessageHandler(
  mock: ChromeMock
): (
  message: Record<string, unknown>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean {
  const calls = mock.runtime.onMessage.addListener.mock.calls;
  if (calls.length === 0) {
    throw new Error(
      'No message listener registered. Make sure you import background.ts before calling captureMessageHandler().'
    );
  }
  // background.ts registers exactly one listener
  const firstCall = calls[0];
  if (!firstCall) {
    throw new Error('Expected at least one call to addListener but found none.');
  }
  return firstCall[0] as ReturnType<typeof captureMessageHandler>;
}

/**
 * Helper: call the captured message handler and await the sendResponse
 * callback value, returning it as a typed result. Handles the async
 * pattern background.ts uses (starts async IIFE, calls sendResponse inside).
 */
export async function dispatchMessage<T = unknown>(
  handler: ReturnType<typeof captureMessageHandler>,
  message: Record<string, unknown>
): Promise<T> {
  return new Promise<T>((resolve) => {
    handler(message, {} as chrome.runtime.MessageSender, (response) => {
      resolve(response as T);
    });
  });
}
