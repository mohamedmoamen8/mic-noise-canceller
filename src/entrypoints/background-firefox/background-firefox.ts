// src/entrypoints/background-firefox/background-firefox.ts
// Firefox MV2 persistent background page.
//
// Uses shared pipeline and message-handler modules to avoid duplicating
// the audio lifecycle and message routing logic already used by the Chrome
// offscreen document.

import {
  startPipeline,
  stopPipeline,
  runCalibration,
  applyStrengthFromStorage,
  getVisualizerLevels,
  initialPipelineState,
} from '../../core/pipeline';
import { cancelCalibration } from '../../core/calibration/calibration-recorder';
import { hostnameFromUrl } from '../../core/url';
import {
  getRunningState,
  setRunningState,
  setNoiseStrength,
  getAutoStart,
  getAllowlistedSites,
} from '../../core/storage';
import {
  handleConfirmCalibration,
  handleClearCalibration,
  handleGetCalibration,
  handleGetSites,
  handleAddSite,
  handleRemoveSite,
  handleSetStrength,
} from '../../core/message-handlers';

const state = { ...initialPipelineState };

let autoStartedByRule = false;

async function handleTabUrl(url: string | undefined): Promise<void> {
  if (!url) return;
  const sites = await getAllowlistedSites();
  if (sites.length === 0) return;

  const hostname = hostnameFromUrl(url);
  const isAllowlisted = hostname !== null && sites.some((s) => hostname === s || hostname.endsWith(`.${s}`));
  const running = await getRunningState();

  if (isAllowlisted && !running) {
    const result = await startPipeline(state, (engine) => {
      if (engine) {
        chrome.runtime.sendMessage({ type: 'ENGINE_READY', engine }).catch(() => {});
      }
    });
    if (result.ok) {
      await setRunningState(true);
      autoStartedByRule = true;
    }
  } else if (!isAllowlisted && running && autoStartedByRule) {
    await stopPipeline(state);
    await setRunningState(false);
    autoStartedByRule = false;
  }
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active && tab.url) {
    void handleTabUrl(tab.url);
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    void handleTabUrl(tab.url);
  } catch {
    // tab may have closed
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'START_NOISE_CANCEL': {
          const result = await startPipeline(state, (engine) => {
            if (engine) {
              chrome.runtime.sendMessage({ type: 'ENGINE_READY', engine }).catch(() => {});
            }
          });
          if (result.ok) {
            await setRunningState(true);
            autoStartedByRule = false;
          }
          sendResponse(result);
          break;
        }

        case 'STOP_NOISE_CANCEL': {
          await stopPipeline(state);
          await setRunningState(false);
          autoStartedByRule = false;
          sendResponse({ ok: true });
          break;
        }

        case 'GET_STATE': {
          const running = await getRunningState();
          sendResponse({ ok: true, running });
          break;
        }

        case 'SET_STRENGTH': {
          await setNoiseStrength(message.value);
          await applyStrengthFromStorage(state);
          sendResponse(await handleSetStrength(message.value));
          break;
        }

        case 'SET_BYPASS': {
          if (state.workletNode) {
            state.workletNode.port.postMessage({ type: 'BYPASS', value: message.value });
          }
          sendResponse({ ok: true });
          break;
        }

        case 'SET_MONITOR_AUDIBLE': {
          if (state.monitorAudioEl) state.monitorAudioEl.muted = !message.audible;
          sendResponse({ ok: true });
          break;
        }

        case 'GET_VISUALIZER_LEVELS': {
          sendResponse({ ok: true, levels: getVisualizerLevels(state) });
          break;
        }

        case 'START_CALIBRATION': {
          sendResponse(await runCalibration(state, message.durationMs));
          break;
        }

        case 'CANCEL_CALIBRATION': {
          cancelCalibration();
          sendResponse({ ok: true });
          break;
        }

        case 'CONFIRM_CALIBRATION': {
          sendResponse(await handleConfirmCalibration(message.profile));
          break;
        }

        case 'CLEAR_CALIBRATION': {
          sendResponse(await handleClearCalibration());
          break;
        }

        case 'GET_CALIBRATION': {
          sendResponse(await handleGetCalibration());
          break;
        }

        case 'GET_SITES': {
          sendResponse(await handleGetSites());
          break;
        }

        case 'ADD_SITE': {
          sendResponse(await handleAddSite(message.hostname));
          break;
        }

        case 'REMOVE_SITE': {
          sendResponse(await handleRemoveSite(message.hostname));
          break;
        }

        default:
          break;
      }
    } catch (err) {
      console.warn('[background-firefox] Message handler error:', err);
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();

  return true;
});

chrome.runtime.onStartup?.addListener(async () => {
  await setRunningState(false);
});

chrome.runtime.onInstalled.addListener(async () => {
  await setRunningState(false);
  if (await getAutoStart()) {
    const result = await startPipeline(state, (engine) => {
      if (engine) {
        chrome.runtime.sendMessage({ type: 'ENGINE_READY', engine }).catch(() => {});
      }
    });
    if (result.ok) await setRunningState(true);
  }
});
