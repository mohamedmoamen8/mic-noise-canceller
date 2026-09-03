// src/core/messages/messages.ts
// Single source of truth for every message shape exchanged between
// popup <-> background <-> offscreen. Keeping these as discriminated
// unions means a typo in a `type` string, or a missing field, is a
// compile error instead of a silent runtime failure.

import type { NoiseProfile } from '../calibration/noise-profile';

export interface StartNoiseCancelRequest {
  type: 'START_NOISE_CANCEL';
}

export interface StopNoiseCancelRequest {
  type: 'STOP_NOISE_CANCEL';
}

export interface GetStateRequest {
  type: 'GET_STATE';
}

export interface SetStrengthRequest {
  type: 'SET_STRENGTH';
  value: number; // 0..1
}

export interface SetMonitorAudibleRequest {
  type: 'SET_MONITOR_AUDIBLE';
  audible: boolean;
}

export interface GetVisualizerLevelsRequest {
  type: 'GET_VISUALIZER_LEVELS';
}

export interface OffscreenStartRequest {
  type: 'OFFSCREEN_START';
}

export interface OffscreenStopRequest {
  type: 'OFFSCREEN_STOP';
}

export interface MicEndedUnexpectedlyEvent {
  type: 'MIC_ENDED_UNEXPECTEDLY';
}

export interface EngineReadyEvent {
  type: 'ENGINE_READY';
  engine: 'rnnoise' | 'gate';
}

// --- Calibration flow -------------------------------------------------
// Record a short ambient-noise clip -> let the user play it back to
// confirm it's just background noise -> store only the computed profile
// (numbers) -> the raw clip is discarded by the caller once the user
// confirms or discards (see popup.ts), never written to chrome.storage.

export interface StartCalibrationRequest {
  type: 'START_CALIBRATION';
  durationMs?: number;
}

export interface CancelCalibrationRequest {
  type: 'CANCEL_CALIBRATION';
}

export interface ConfirmCalibrationRequest {
  type: 'CONFIRM_CALIBRATION';
  profile: NoiseProfile;
}

export interface ClearCalibrationRequest {
  type: 'CLEAR_CALIBRATION';
}

export interface GetCalibrationRequest {
  type: 'GET_CALIBRATION';
}

export interface OffscreenStartCalibrationRequest {
  type: 'OFFSCREEN_START_CALIBRATION';
  durationMs?: number;
}

export interface OffscreenCancelCalibrationRequest {
  type: 'OFFSCREEN_CANCEL_CALIBRATION';
}

export type BackgroundRequest =
  | StartNoiseCancelRequest
  | StopNoiseCancelRequest
  | GetStateRequest
  | StartCalibrationRequest
  | CancelCalibrationRequest
  | ConfirmCalibrationRequest
  | ClearCalibrationRequest
  | GetCalibrationRequest;

export type OffscreenRequest =
  | OffscreenStartRequest
  | OffscreenStopRequest
  | SetStrengthRequest
  | SetMonitorAudibleRequest
  | GetVisualizerLevelsRequest
  | OffscreenStartCalibrationRequest
  | OffscreenCancelCalibrationRequest;

export type RuntimeMessage = BackgroundRequest | OffscreenRequest | MicEndedUnexpectedlyEvent | EngineReadyEvent;

export interface OkResponse {
  ok: true;
}

export interface ErrorResponse {
  ok: false;
  error: string;
}

export interface StateResponse extends OkResponse {
  running: boolean;
}

export interface VisualizerLevelsResponse extends OkResponse {
  levels: number[] | null;
}

export interface CalibrationResultResponse extends OkResponse {
  profile: NoiseProfile;
  audioBase64: string;
  mimeType: string;
}

export interface StoredCalibrationResponse extends OkResponse {
  profile: NoiseProfile | null;
}

export type BackgroundResponse =
  | OkResponse
  | ErrorResponse
  | StateResponse
  | CalibrationResultResponse
  | StoredCalibrationResponse;

export type OffscreenResponse = OkResponse | ErrorResponse | VisualizerLevelsResponse | CalibrationResultResponse;

/** Type guard used at runtime boundaries where `unknown` messages arrive. */
export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}
