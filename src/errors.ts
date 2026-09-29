/**
 * Stable error codes rejected by the bridge. The code is the contract; the
 * message is for humans and may change.
 */
export const NosmaiAgoraErrorCode = {
  /** Android: the EGL share group could not be joined, or was joined too late. */
  SHARE_CONTEXT: 'E_SHARE_CONTEXT',
  /** react-native-agora's engine or media engine is unreachable or not initialized. */
  AGORA_UNAVAILABLE: 'E_AGORA_UNAVAILABLE',
  /** iOS: @nosmai/react-native-effects-sdk exposes no native frame tap (too old). */
  SDK_TAP_UNAVAILABLE: 'E_SDK_TAP_UNAVAILABLE',
  /** startStreaming() called while already streaming. */
  ALREADY_STREAMING: 'E_ALREADY_STREAMING',
  /** Native start failed for a reason the message explains. */
  START_FAILED: 'E_START_FAILED',
  /** An argument was outside its documented range. */
  INVALID_ARGUMENT: 'E_INVALID_ARGUMENT',
} as const;

export type NosmaiAgoraErrorCode =
  (typeof NosmaiAgoraErrorCode)[keyof typeof NosmaiAgoraErrorCode];

/** Error thrown by every rejecting method on `NosmaiAgoraBridge`. */
export class NosmaiAgoraError extends Error {
  readonly code: NosmaiAgoraErrorCode | string;

  constructor(code: NosmaiAgoraErrorCode | string, message: string) {
    super(message);
    this.name = 'NosmaiAgoraError';
    this.code = code;
  }

  static from(e: unknown): NosmaiAgoraError {
    if (e instanceof NosmaiAgoraError) return e;
    const anyErr = e as { code?: unknown; message?: unknown } | null;
    const code =
      typeof anyErr?.code === 'string' ? anyErr.code : 'E_START_FAILED';
    const message =
      typeof anyErr?.message === 'string' ? anyErr.message : String(e);
    return new NosmaiAgoraError(code, message);
  }
}
