import { describe, expect, it } from 'vitest';
import { isRuntimeMessage } from '../../../src/core/messages/messages';

describe('isRuntimeMessage', () => {
  it('returns true for a valid BackgroundRequest', () => {
    expect(isRuntimeMessage({ type: 'START_NOISE_CANCEL' })).toBe(true);
  });

  it('returns true for a valid OffscreenRequest', () => {
    expect(isRuntimeMessage({ type: 'OFFSCREEN_START' })).toBe(true);
  });

  it('returns true for an EngineReadyEvent', () => {
    expect(isRuntimeMessage({ type: 'ENGINE_READY', engine: 'rnnoise' })).toBe(true);
  });

  it('returns true for a MicEndedUnexpectedlyEvent', () => {
    expect(isRuntimeMessage({ type: 'MIC_ENDED_UNEXPECTEDLY' })).toBe(true);
  });

  it('returns false for null', () => {
    expect(isRuntimeMessage(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isRuntimeMessage(undefined)).toBe(false);
  });

  it('returns false for a plain object without type', () => {
    expect(isRuntimeMessage({ foo: 'bar' })).toBe(false);
  });

  it('returns false for an object with a non-string type', () => {
    expect(isRuntimeMessage({ type: 123 })).toBe(false);
  });

  it('returns false for a string', () => {
    expect(isRuntimeMessage('START_NOISE_CANCEL')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isRuntimeMessage(42)).toBe(false);
  });
});
