// src/worklet/noise-processor.ts
// Runs on the dedicated real-time audio rendering thread. Tries to
// initialize the real RNNoise WASM engine synchronously (the "sync" build
// instantiates its WASM module via `new WebAssembly.Instance()` rather than
// the async streaming API, which is what makes it usable from inside an
// AudioWorkletProcessor constructor at all). If that fails for any reason
// (CSP blocking wasm-unsafe-eval, an unsupported engine, a corrupted
// bundle), it falls back to the dependency-free JS gate so audio never
// just stops.

import createRNNWasmModuleSync from '@jitsi/rnnoise-wasm/dist/rnnoise-sync';
import type { NoiseSuppressionEngine } from '../../core/dsp/engine';
import { GateEngine } from '../../core/dsp/gate-engine';
import { RNNoiseEngine, type RNNoiseWasmModule } from '../../core/dsp/rnnoise-engine';

interface BypassMessage {
  type: 'BYPASS';
  value: boolean;
}

interface StopMessage {
  type: 'STOP';
}

interface ErrorMessage {
  type: 'ERROR';
  message: string;
}

interface EngineReadyMessage {
  type: 'ENGINE_READY';
  engine: 'rnnoise' | 'gate';
}

interface NoiseProcessorOptions {
  initialNoiseFloor?: number;
}

function buildEngine(initialNoiseFloor?: number): { engine: NoiseSuppressionEngine; name: 'rnnoise' | 'gate' } {
  try {
    const module = createRNNWasmModuleSync() as unknown as RNNoiseWasmModule;
    return { engine: new RNNoiseEngine(module), name: 'rnnoise' };
  } catch (_err) {
    // Intentionally swallow — this is the designed fallback path, not an
    // exceptional bug. The ERROR message below tells the popup why.
    // initialNoiseFloor (from a prior calibration) only matters here: RNNoise
    // is a trained model with no equivalent "seed" concept.
    return { engine: new GateEngine(initialNoiseFloor), name: 'gate' };
  }
}

class NoiseSuppressionProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'strength',
        defaultValue: 0.85,
        minValue: 0,
        maxValue: 1,
        automationRate: 'k-rate' as const
      }
    ];
  }

  private engine: NoiseSuppressionEngine;
  private bypass = false;

  constructor(options?: { processorOptions?: NoiseProcessorOptions }) {
    super();

    const { engine, name } = buildEngine(options?.processorOptions?.initialNoiseFloor);
    this.engine = engine;

    console.log(`[noise-processor] Initialized with engine: ${name}`);

    const readyMsg: EngineReadyMessage = { type: 'ENGINE_READY', engine: name };
    this.port.postMessage(readyMsg);

    if (name === 'gate') {
      const errMsg: ErrorMessage = {
        type: 'ERROR',
        message: 'RNNoise WASM failed to initialize; using the JS noise-gate fallback instead.'
      };
      this.port.postMessage(errMsg);
    }

    this.port.onmessage = (event: MessageEvent<BypassMessage | StopMessage>) => {
      if (event.data?.type === 'BYPASS') {
        this.bypass = Boolean((event.data as BypassMessage).value);
      } else if (event.data?.type === 'STOP') {
        // Pipeline is tearing down — free WASM memory immediately so it
        // is not held until the AudioWorkletGlobalScope is GC'd.
        this.engine.dispose();
        this.port.close();
      }
    };
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const input = inputs[0];
    const output = outputs[0];

    if (!input || input.length === 0 || !input[0] || input[0].length === 0 || !output || !output[0]) {
      return true;
    }

    const inputChannel = input[0];
    const outputChannel = output[0];
    const strength = parameters.strength?.[0] ?? 0.85;

    try {
      if (this.bypass) {
        outputChannel.set(inputChannel);
      } else {
        const cleaned = this.engine.process(inputChannel, strength);
        outputChannel.set(cleaned);
      }
    } catch (err) {
      const message: ErrorMessage = { type: 'ERROR', message: err instanceof Error ? err.message : String(err) };
      this.port.postMessage(message);
      outputChannel.set(inputChannel); // fail open — never drop audio entirely
    }

    return true;
  }
}

registerProcessor('noise-suppression-processor', NoiseSuppressionProcessor);
