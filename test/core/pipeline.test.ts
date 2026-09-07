import { describe, expect, it, vi } from 'vitest';
import {
  startPipeline,
  stopPipeline,
  runCalibration,
  applyStrengthFromStorage,
  getVisualizerLevels,
  initialPipelineState,
  describeMicError,
} from '../../src/core/pipeline';

function buildMockPipelineState(): typeof initialPipelineState {
  return {
    audioContext: null,
    micStream: null,
    sourceNode: null,
    workletNode: null,
    analyserNode: null,
    destinationNode: null,
    monitorAudioEl: null,
  };
}

describe('pipeline', () => {
  describe('describeMicError', () => {
    it('maps NotAllowedError to a permission message', () => {
      const err = new DOMException('', 'NotAllowedError');
      expect(describeMicError(err)).toBe(
        'Microphone permission was denied. Allow mic access for this extension and try again.'
      );
    });

    it('maps NotFoundError to a no-mic message', () => {
      const err = new DOMException('', 'NotFoundError');
      expect(describeMicError(err)).toBe('No microphone was found on this device.');
    });

    it('maps NotReadableError to an in-use message', () => {
      const err = new DOMException('', 'NotReadableError');
      expect(describeMicError(err)).toBe(
        'The microphone is already in use by another application.'
      );
    });

    it('falls back to err.message for unknown DOMExceptions', () => {
      const err = new DOMException('something weird', 'UnknownError');
      expect(describeMicError(err)).toBe('something weird');
    });

    it('falls back to Unknown microphone error for non-Error values', () => {
      expect(describeMicError('raw string')).toBe('Unknown microphone error.');
    });
  });

  describe('startPipeline / stopPipeline', () => {
    it('returns ok:true when audioContext is already running', async () => {
      const state = buildMockPipelineState();
      state.audioContext = {} as AudioContext;

      const result = await startPipeline(state);
      expect(result).toEqual({ ok: true });
    });

    it('returns ok:false when getUserMedia throws NotAllowedError', async () => {
      const state = buildMockPipelineState();
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new DOMException('', 'NotAllowedError')),
        },
      });

      const result = await startPipeline(state);
      expect(result.ok).toBe(false);
      expect(result.error).toContain('permission');

      vi.unstubAllGlobals();
    });

    it('stopPipeline resets all state to null', async () => {
      const state = buildMockPipelineState();
      state.audioContext = { close: vi.fn().mockResolvedValue(undefined), state: 'running' } as unknown as AudioContext;
      state.micStream = { getTracks: () => [{ stop: vi.fn() }], active: true } as unknown as MediaStream;
      state.monitorAudioEl = { pause: vi.fn(), srcObject: null } as unknown as HTMLAudioElement;
      state.sourceNode = { disconnect: vi.fn(), mediaStream: null } as unknown as MediaStreamAudioSourceNode;
      state.workletNode = { disconnect: vi.fn(), port: { postMessage: vi.fn() } } as unknown as AudioWorkletNode;
      state.analyserNode = { disconnect: vi.fn() } as unknown as AnalyserNode;

      await stopPipeline(state);

      expect(state.audioContext).toBeNull();
      expect(state.micStream).toBeNull();
      expect(state.sourceNode).toBeNull();
      expect(state.workletNode).toBeNull();
      expect(state.analyserNode).toBeNull();
      expect(state.destinationNode).toBeNull();
      expect(state.monitorAudioEl).toBeNull();
    });
  });

  describe('applyStrengthFromStorage', () => {
    it('returns early when workletNode or audioContext is missing', async () => {
      const state = buildMockPipelineState();
      await applyStrengthFromStorage(state);
      // no-op, should not throw
    });
  });

  describe('getVisualizerLevels', () => {
    it('returns null when analyserNode is missing', () => {
      const state = buildMockPipelineState();
      expect(getVisualizerLevels(state)).toBeNull();
    });
  });

  describe('runCalibration', () => {
    it('returns ok:false when getUserMedia throws', async () => {
      const state = buildMockPipelineState();
      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockRejectedValue(new DOMException('', 'NotFoundError')),
        },
      });

      const result = await runCalibration(state, 1000);
      expect(result.ok).toBe(false);

      vi.unstubAllGlobals();
    });
  });
});
