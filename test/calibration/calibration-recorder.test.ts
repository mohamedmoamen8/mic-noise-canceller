import { describe, expect, it, vi } from 'vitest';
import { isCalibrationRunning, cancelCalibration, recordAmbientNoise } from '../../src/core/calibration/calibration-recorder';

describe('calibration-recorder', () => {
  // ---------------------------------------------------------------------------
  // isCalibrationRunning
  // ---------------------------------------------------------------------------

  describe('isCalibrationRunning', () => {
    it('returns false when no recorder is active', () => {
      expect(isCalibrationRunning()).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // cancelCalibration
  // ---------------------------------------------------------------------------

  describe('cancelCalibration', () => {
    it('does nothing when no recorder is active', () => {
      expect(() => cancelCalibration()).not.toThrow();
    });

    it('stops the active recorder and resets state', async () => {
      const stop = vi.fn();
      const mockRecorder = {
        state: 'recording',
        start: vi.fn(),
        stop,
        mimeType: 'audio/webm',
        ondataavailable: vi.fn(),
        onerror: vi.fn(),
        onstop: vi.fn(),
      } as unknown as MediaRecorder;

      const MockMediaRecorder = vi.fn(function MediaRecorder() {
        return mockRecorder;
      });

      vi.stubGlobal('MediaRecorder', MockMediaRecorder);

      const mockBlob = {
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
        type: 'audio/webm',
      } as unknown as Blob;

      vi.stubGlobal('Blob', vi.fn(function Blob() {
        return mockBlob;
      }));

      const mockAudioContext = {
        decodeAudioData: vi.fn().mockResolvedValue({
          getChannelData: () => new Float32Array(0),
          sampleRate: 48000,
        }),
        close: vi.fn().mockResolvedValue(undefined),
        state: 'running',
      } as unknown as AudioContext;

      vi.stubGlobal('AudioContext', vi.fn(function AudioContext() {
        return mockAudioContext;
      }));

      const mockFileReader = {
        readAsDataURL: vi.fn(),
        result: 'data:audio/webm;base64,',
        error: null,
        onloadend: null as (() => void) | null,
      } as unknown as FileReader;

      vi.stubGlobal('FileReader', vi.fn(function FileReader() {
        return mockFileReader;
      }));

      const mockStream = {
        getTracks: () => [{ stop: vi.fn() }],
      } as unknown as MediaStream;

      vi.useFakeTimers();

      void recordAmbientNoise(mockStream, 100);

      expect(isCalibrationRunning()).toBe(true);

      cancelCalibration();

      expect(stop).toHaveBeenCalledOnce();
      expect(isCalibrationRunning()).toBe(false);

      vi.useRealTimers();
      vi.unstubAllGlobals();
    });

    it('does not call stop when the recorder is already inactive', async () => {
      const stop = vi.fn();
      const mockRecorder = {
        state: 'inactive',
        start: vi.fn(),
        stop,
        mimeType: 'audio/webm',
        ondataavailable: vi.fn(),
        onerror: vi.fn(),
        onstop: vi.fn(),
      } as unknown as MediaRecorder;

      const MockMediaRecorder = vi.fn(function MediaRecorder() {
        return mockRecorder;
      });

      vi.stubGlobal('MediaRecorder', MockMediaRecorder);

      const mockStream = {
        getTracks: () => [{ stop: vi.fn() }],
      } as unknown as MediaStream;

      void recordAmbientNoise(mockStream, 100);

      cancelCalibration();

      expect(stop).not.toHaveBeenCalled();

      vi.unstubAllGlobals();
    });
  });
});
