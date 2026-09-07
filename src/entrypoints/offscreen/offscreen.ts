// src/entrypoints/offscreen/offscreen.ts
// The only context in this extension that touches getUserMedia / AudioContext.
// Uses shared pipeline helpers to keep the lifecycle logic in one place.

import {
  startPipeline,
  stopPipeline,
  runCalibration,
  getVisualizerLevels,
  applyStrengthFromStorage,
  initialPipelineState,
} from '../../core/pipeline';
import { cancelCalibration } from '../../core/calibration/calibration-recorder';
import { setNoiseStrength } from '../../core/storage';

const state = { ...initialPipelineState };

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {
        case 'OFFSCREEN_START': {
          const result = await startPipeline(state);
          sendResponse(result);
          break;
        }
        case 'OFFSCREEN_STOP': {
          await stopPipeline(state);
          sendResponse({ ok: true });
          break;
        }
        case 'SET_STRENGTH': {
          await setNoiseStrength(message.value);
          await applyStrengthFromStorage(state);
          sendResponse({ ok: true });
          break;
        }
        case 'SET_MONITOR_AUDIBLE': {
          if (state.monitorAudioEl) state.monitorAudioEl.muted = !message.audible;
          sendResponse({ ok: true });
          break;
        }
        case 'SET_BYPASS': {
          if (state.workletNode) {
            state.workletNode.port.postMessage({ type: 'BYPASS', value: message.value });
          }
          sendResponse({ ok: true });
          break;
        }
        case 'GET_VISUALIZER_LEVELS': {
          sendResponse({ ok: true, levels: getVisualizerLevels(state) });
          break;
        }
        case 'OFFSCREEN_START_CALIBRATION': {
          sendResponse(await runCalibration(state, message.durationMs));
          break;
        }
        case 'OFFSCREEN_CANCEL_CALIBRATION': {
          cancelCalibration();
          sendResponse({ ok: true });
          break;
        }
        default:
          break;
      }
    } catch (err) {
      console.warn('[offscreen] Message handler error:', err);
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  })();
  return true;
});
