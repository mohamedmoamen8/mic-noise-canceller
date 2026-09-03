// src/background/background.ts
import type { BackgroundResponse, RuntimeMessage } from '../../core/messages/messages';
import {
  getRunningState,
  setRunningState,
  getStoredNoiseProfile,
  setStoredNoiseProfile,
  clearStoredNoiseProfile,
} from '../../core/storage';

const OFFSCREEN_PATH = 'offscreen.html';

let creatingOffscreenPromise: Promise<void> | null = null;

async function hasOffscreenDocument(): Promise<boolean> {
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
      documentUrls: [chrome.runtime.getURL(OFFSCREEN_PATH)]
    });
    return contexts.length > 0;
  }
  const matchedClients = await (self as unknown as ServiceWorkerGlobalScope).clients.matchAll();
  return matchedClients.some((c) => c.url === chrome.runtime.getURL(OFFSCREEN_PATH));
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) return;

  if (creatingOffscreenPromise) {
    await creatingOffscreenPromise;
    return;
  }

  creatingOffscreenPromise = chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: [chrome.offscreen.Reason.USER_MEDIA],
    justification: 'Capture microphone audio and run a real-time noise-cancellation AudioWorklet pipeline.'
  });

  try {
    await creatingOffscreenPromise;
  } finally {
    creatingOffscreenPromise = null;
  }
}

async function closeOffscreenDocument(): Promise<void> {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'START_NOISE_CANCEL': {
          await ensureOffscreenDocument();
          const response = (await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START' })) as BackgroundResponse;
          if (response?.ok) {
            await setRunningState(true);
            sendResponse({ ok: true });
          } else {
            await closeOffscreenDocument();
            await setRunningState(false);
            const error = 'error' in response ? response.error : 'Unknown error starting capture.';
            sendResponse({ ok: false, error });
          }
          break;
        }

        case 'STOP_NOISE_CANCEL': {
          if (await hasOffscreenDocument()) {
            await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' }).catch(() => {});
          }
          await closeOffscreenDocument();
          await setRunningState(false);
          sendResponse({ ok: true });
          break;
        }

        case 'GET_STATE': {
          const running = await getRunningState();
          sendResponse({ ok: true, running });
          break;
        }

        case 'START_CALIBRATION': {
          // Calibration needs live mic access but not the full noise-cancel
          // pipeline, so it shares the offscreen document lifecycle without
          // touching the START_NOISE_CANCEL running-state flag at all.
          await ensureOffscreenDocument();
          const response = await chrome.runtime.sendMessage({
            type: 'OFFSCREEN_START_CALIBRATION',
            durationMs: message.durationMs
          });
          sendResponse(response);
          break;
        }

        case 'CANCEL_CALIBRATION': {
          if (await hasOffscreenDocument()) {
            await chrome.runtime.sendMessage({ type: 'OFFSCREEN_CANCEL_CALIBRATION' }).catch(() => {});
          }
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

        default:
          break;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true; // keep the message channel open for the async response
});

chrome.runtime.onStartup?.addListener(async () => {
  await setRunningState(false);
});

chrome.runtime.onInstalled.addListener(async () => {
  await setRunningState(false);
});
