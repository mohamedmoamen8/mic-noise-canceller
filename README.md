# Mic Noise Canceller

A Manifest V3 Chrome extension providing **real-time, client-side microphone noise cancellation** using RNNoise (a trained ML noise-suppression model compiled to WASM) with an automatic JavaScript fallback engine.

## Badges

[![Build & Package](https://github.com/mohamedmoamen8/mic-noise-canceller/actions/workflows/ci.yml/badge.svg)](https://github.com/mohamedmoamen8/mic-noise-canceller/actions)
[![Chrome Extension](https://img.shields.io/badge/Chrome%20Extension-MV3-blue?logo=googlechrome)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

## Demo

![Extension Demo](docs/demo.svg)

*Toggle noise cancellation on/off, adjust suppression strength from 0–100%, enable audio monitoring to hear the difference, and run a one-time mic calibration to measure your room's ambient noise.*

## Quick Start

```bash
npm install
npm run package   # typecheck → test → build → zip
```

Then in Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select the `dist/` folder (or unzip `mic-noise-canceller.zip` and load that).

## Features

- **RNNoise ML engine** — Real trained noise suppression from the [xiph/rnnoise](https://github.com/xiph/rnnoise) project, compiled to WebAssembly via [@jitsi/rnnoise-wasm](https://github.com/jitsi/rnnoise-wasm). Effective against fans, traffic, keyboard noise, and other steady/transient background sounds.
- **JS fallback** — If WASM fails to initialize (CSP issues, unsupported browser, corrupted bundle), the extension automatically falls back to an adaptive noise gate with no dependencies, so audio never stops.
- **One-time mic calibration** — Records 3 seconds of ambient room noise, lets you play it back to confirm it's just background noise, then persists only a handful of computed numbers (no raw audio ever touches disk or storage). Seeds the fallback engine and suggests an optimal suppression strength.
- **Real-time visualizer** — Live frequency bar display driven by the `AnalyserNode` in the audio pipeline.
- **Audio monitor** — Optional local `<audio>` playback of the cleaned signal so you can hear the difference instantly.

## Scripts

| Command              | What it does                                              |
|----------------------|-----------------------------------------------------------|
| `npm run build`      | Bundles all entry points into `dist/` with esbuild        |
| `npm run watch`      | Same, but rebuilds on file change                         |
| `npm run typecheck`  | Runs `tsc --noEmit` against both tsconfigs                |
| `npm test`           | Runs the vitest suite (unit + real-WASM integration tests)|
| `npm run package`    | typecheck → test → build → zip, in that order             |
| `npm run clean`      | Removes the `dist/` directory                             |

## Folder Structure

```
src/
  entrypoints/           # one folder per Chrome extension context
    background/
      background.ts      # service worker — offscreen lifecycle + message relay
    offscreen/
      offscreen.ts       # only context with getUserMedia / AudioContext
    popup/
      popup.ts           # UI logic, calibration flow
    worklet/
      noise-processor.ts # AudioWorkletProcessor (runs on the audio thread)

  core/                  # pure logic, no chrome.* calls, trivially unit-testable
    dsp/
      engine.ts          # NoiseSuppressionEngine interface
      rnnoise-engine.ts  # WASM wrapper with 128↔480 sample ring-buffer bridging
      gate-engine.ts     # JS fallback adaptive noise gate
      ring-buffer.ts     # fixed-capacity circular Float32 buffer
    calibration/
      noise-profile.ts   # PCM analysis → NoiseProfile (pure, no DOM)
      calibration-recorder.ts  # MediaRecorder + decode + base64
    storage.ts            # resilient chrome.storage.local wrapper

  types/
    rnnoise-wasm.d.ts    # ambient module declaration

public/                  # static assets copied as-is into dist/
  manifest.json          # MV3 manifest with "storage" + "offscreen" permissions
  popup.html             # popup UI (inline styles, no external CSS deps)
  offscreen.html         # offscreen document shell
  icons/                  # 16 / 48 / 128 px PNGs

scripts/
  build.mjs              # esbuild bundler for all entry points
  zip.mjs                # cross-platform zip packaging (no Unix tools required)

test/
  dsp/                   # unit + real-WASM integration tests
  calibration/           # noise profile analysis tests
```

The split between `entrypoints/` and `core/` is deliberate: everything in `core/` is plain TypeScript with no `chrome.*` calls and no assumption about which extension context it runs in, so it's trivially unit-testable. `entrypoints/` is the thin Chrome-API-heavy glue that wires `core/` logic into the extension lifecycle.

## Architecture

```
popup.ts ──chrome.runtime.sendMessage──▶ background.ts (service worker)
                                              │
                              chrome.offscreen.createDocument()
                                              │
                                              ▼
                                    offscreen.ts (DOM context)
                                              │
                       getUserMedia ──▶ AudioContext ──▶ AudioWorkletNode
                                              │
                                    noise-processor.ts (worklet thread)
                                              │
                      RNNoiseEngine (WASM) ◀── falls back to ──▶ GateEngine (pure JS)
```

### Data flow

1. **Popup** sends `START_NOISE_CANCEL` to **background**.
2. **Background** creates an offscreen document via `chrome.offscreen.createDocument()`.
3. **Offscreen** opens `getUserMedia`, creates an `AudioContext`, loads the AudioWorklet, and builds the pipeline:
   ```
   MediaStreamSource → AudioWorkletNode → AnalyserNode → MediaStreamDestination → <audio>
   ```
4. The **AudioWorklet** runs on the real-time audio thread. It tries RNNoise WASM first; if that throws, it instantiates the JS `GateEngine`. Either way, 128-sample PCM frames flow in and cleaned PCM frames flow out.
5. The cleaned stream feeds the `<audio>` monitor element (muted by default; toggle "Monitor cleaned audio" to unmute) and the `AnalyserNode` for the visualizer.

### Why RNNoise via @jitsi/rnnoise-wasm

RNNoise is a trained ML model requiring real neural-network weights baked in at compile time. `@jitsi/rnnoise-wasm` is Jitsi's own prebuilt, Apache-2.0-licensed build of [xiph/rnnoise](https://github.com/xiph/rnnoise) — the same one Jitsi Meet uses in production.

RNNoise operates on 480-sample (10ms @ 48kHz) frames, but Web Audio delivers fixed 128-sample callbacks. `RNNoiseEngine` bridges the two with `RingBuffer` instances, adding under 10ms of constant algorithmic latency — imperceptible for voice chat.

## Microphone Calibration

Before your first session, calibrate to measure your room's actual ambient noise:

1. Click **Record 3s of background noise** and stay quiet.
2. The clip plays back in the popup so you can confirm it's just room noise (not your voice), along with a plain-language read on how noisy your room is.
3. **Use this & save** persists only the computed profile (mean level, peak, suggested noise floor + suppression strength) to `chrome.storage.local`. **Discard & retry** keeps nothing.
4. The raw audio clip is deleted immediately after playback — it only exists as an in-memory `data:` URI and is never written to disk or sync storage.

The saved profile seeds `GateEngine`'s initial noise-floor estimate so the fallback starts accurate. RNNoise ignores this — it's a trained model, not a threshold gate.

## Testing

26 tests across 4 files, all real logic (nothing mocked):

- `test/dsp/ring-buffer.test.ts` — FIFO, wraparound, overflow/underflow
- `test/dsp/gate-engine.test.ts` — JS fallback DSP correctness, calibration seeding
- `test/dsp/rnnoise-engine.test.ts` — Loads the **actual** `@jitsi/rnnoise-wasm` binary under Node's built-in `WebAssembly` global and verifies real noise reduction.
- `test/calibration/noise-profile.test.ts` — Classification thresholds, edge cases (silence, empty buffers, single-sample peaks)

## Permissions

| Permission | Why it's needed |
|---|---|
| `offscreen` | Host a DOM/Web Audio context from the service worker (where no DOM exists) |
| `storage` | Persist running state, suppression strength, and calibration profile (numbers only, never raw audio) |

`tabCapture` is intentionally **not** requested: this captures the microphone via `getUserMedia`, not tab audio.

## Known Limitations

- The cleaned audio only loops back to an optional local `<audio>` monitor element so you can hear the effect. Routing it system-wide as a virtual microphone that other apps can select requires a native companion application — Chrome extensions can't register a system audio input device on their own.
- RNNoise is trained primarily on speech + steady/transient noise. It's strong on typical background noise (fans, traffic, keyboards) but isn't a universal denoiser for music or highly unusual signals.
- If you calibrate and never start a real session afterward, the offscreen document stays open until you start or Chrome reclaims it — only the dedicated calibration mic capture is guaranteed to close immediately.

## Troubleshooting

### "chrome.storage.local is not available"

This is a non-blocking warning — the extension still works; you just won't have persisted settings across sessions. Try:

1. Ensure you loaded the extension from the `dist/` folder, not the project root or `public/`.
2. Go to `chrome://extensions`, find the extension, click **Reload**.
3. If it persists, remove and re-add the unpacked extension.

### AudioContext is suspended

If the visualizer is idle and no engine badge appears, the `AudioContext` may be in a suspended state. The extension attempts `audioContext.resume()` automatically. If that fails, click the toggle off and back on — the user-gesture from the click should resolve it.

### No audible difference with monitor on

- Ensure **Monitor cleaned audio** is checked.
- Set strength slider to 100% for maximum noise suppression.
- The effect may be subtle on quiet background noise — try in a noisier environment or record a calibration for optimal threshold seeding.

### Zip/packaging fails on Windows

The `npm run package` script uses a cross-platform Node.js zip writer (no external `zip` or `rm` utilities required). If you still see errors, ensure you're running the latest code:
```bash
npm install
npm run package
```

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Run `npm run typecheck && npm test` before submitting
4. Add unit tests for any new DSP logic in `src/core/`

All code in `src/core/` should remain pure TypeScript with no `chrome.*` calls, to maintain unit-testability.

## License

MIT — see [LICENSE](LICENSE). RNNoise model weights are distributed under the BSD-like license of the xiph/rnnoise project; see the upstream [LICENSE](https://github.com/xiph/rnnoise/blob/master/COPYING) for details.
