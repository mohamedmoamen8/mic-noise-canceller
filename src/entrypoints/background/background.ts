// src/background/background.ts
import type { BackgroundResponse, RuntimeMessage } from '../../core/messages/messages';
import {
  getRunningState,
  setRunningState,
  getStoredNoiseProfile,
  setStoredNoiseProfile,
  clearStoredNoiseProfile,
  setNoiseStrength,
  getAutoStart,
  getAllowlistedSites,
  addAllowlistedSite,
  removeAllowlistedSite,
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

        case 'SET_STRENGTH': {
          // Always persist to storage so the value survives before the
          // pipeline starts and across service-worker restarts.
          await setNoiseStrength(message.value);
          // Forward to offscreen only if the document is already alive —
          // if it isn't, applyStrengthFromStorage() will pick up the stored
          // value when the pipeline next starts.
          if (await hasOffscreenDocument()) {
            await chrome.runtime.sendMessage({ type: 'SET_STRENGTH', value: message.value }).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }

        case 'SET_BYPASS': {
          // Bypass is not persisted — it is a transient A/B toggle only
          // meaningful while the pipeline is running.
          if (await hasOffscreenDocument()) {
            await chrome.runtime.sendMessage({ type: 'SET_BYPASS', value: message.value }).catch(() => {});
          }
          sendResponse({ ok: true });
          break;
        }

        case 'MIC_ENDED_UNEXPECTEDLY': {
          // The mic track was cut externally (device unplugged, permission
          // revoked, OS mute, etc.). Reset state and tear down the offscreen
          // document so we start clean on the next user-initiated start.
          await setRunningState(false);
          await closeOffscreenDocument();
          // No sendResponse — this is a fire-and-forget event from offscreen,
          // not a request/response exchange.
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
  // If the user has opted into auto-start, kick off noise cancellation
  // immediately so it's active as soon as the extension is (re)installed.
  if (await getAutoStart()) {
    await ensureOffscreenDocument();
    const response = (await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START' })) as BackgroundResponse;
    if (response?.ok) {
      await setRunningState(true);
    } else {
      await closeOffscreenDocument();
    }
  }
});


// ---------------------------------------------------------------------------
// Per-site auto-enable
// ---------------------------------------------------------------------------
// Tracks whether the current noise-reduction session was started by the
// site-rule watcher (as opposed to manually by the user). This flag lives
// in memory only — it resets every time the service worker restarts, which
// is fine: after a restart the pipeline is already stopped (onStartup resets
// state), so the watcher will re-evaluate on the next tab navigation.
let autoStartedByRule = false;

function hostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

async function handleTabUrl(url: string | undefined): Promise<void> {
  if (!url) return;

  const sites = await getAllowlistedSites();
  if (sites.length === 0) return;

  const hostname = hostnameFromUrl(url);
  const isAllowlisted = hostname !== null && sites.some((s) => hostname === s || hostname.endsWith(`.${s}`));
  const running = await getRunningState();

  if (isAllowlisted && !running) {
    // Navigate to an allowlisted site while stopped → auto-start.
    await ensureOffscreenDocument();
    const response = (await chrome.runtime.sendMessage({ type: 'OFFSCREEN_START' })) as BackgroundResponse;
    if (response?.ok) {
      await setRunningState(true);
      autoStartedByRule = true;
    } else {
      await closeOffscreenDocument();
    }
  } else if (!isAllowlisted && running && autoStartedByRule) {
    // Navigate away from an allowlisted site, and the session was started by
    // the rule (not manually) → auto-stop.
    if (await hasOffscreenDocument()) {
      await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP' }).catch(() => {});
    }
    await closeOffscreenDocument();
    await setRunningState(false);
    autoStartedByRule = false;
  }
}

// Watch for URL changes within a tab (navigation, SPA history pushes).
chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url) {
    void handleTabUrl(tab.url);
  }
});

// Watch for the user switching between tabs.
chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    void handleTabUrl(tab.url);
  } catch {
    /* tab may have closed between the event and the get() call */
  }
});
