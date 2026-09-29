import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/**
 * Counters for diagnosing a stream without a debugger attached.
 *
 * - `pushed`: frames Agora accepted (pushVideoFrame returned 0). Accepted means
 *   queued, not encoded.
 * - `dropped`: single-flight drops — a frame arriving while the previous push
 *   is in flight is discarded rather than queued. A slowly rising count is
 *   normal; a `pushed` that stops rising while streaming is not.
 * - `failed`: pushes Agora rejected; `lastResult` is its most recent code
 *   (-4 = ERR_NOT_SUPPORTED: the frame description, not the data, is wrong).
 */
export type NativeStreamStats = {
  streaming: boolean;
  videoTrackId: number;
  pushed: number;
  dropped: number;
  failed: number;
  lastResult: number;
  width: number;
  height: number;
  /**
   * How frames are handed to Agora: `texture2d` (Android) or `bgra-bytes` (iOS).
   */
  inputMode: string;
};

export interface Spec extends TurboModule {
  /**
   * Android: put Nosmai's GL context in Agora's root EGL share group. MUST be
   * awaited before the Nosmai SDK initializes. Resolves the EGL handle.
   *
   * iOS: resolves 0. CVPixelBuffers are IOSurface-backed and need no share.
   */
  registerShareContext(): Promise<number>;

  /**
   * Resolve Agora's media engine natively from react-native-agora's engine
   * and start feeding Nosmai's frames into `videoTrackId` (from
   * `engine.createCustomVideoTrack()`). Rejects E_ALREADY_STREAMING if a
   * stream is running.
   */
  startStreaming(videoTrackId: number): Promise<void>;

  /** Stop producing, then release the media engine. Idempotent; never rejects. */
  stopStreaming(): Promise<void>;

  isStreaming(): Promise<boolean>;

  getStats(): Promise<NativeStreamStats>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('NosmaiAgoraBridge');
