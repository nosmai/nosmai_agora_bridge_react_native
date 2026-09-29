import { Platform } from 'react-native';
import {
  ExternalVideoSourceType,
  OrientationMode,
  VideoMirrorModeType,
  type ChannelMediaOptions,
  type IRtcEngine,
  type VideoEncoderConfiguration,
} from 'react-native-agora';

import NativeBridge from './NativeNosmaiAgoraBridge';
import { NosmaiAgoraError, NosmaiAgoraErrorCode } from './errors';
import type { StreamStats } from './types';

/** What {@link NosmaiAgoraBridge.startStreaming} hands back for `joinChannel`. */
export type NosmaiAgoraStream = {
  /** The custom video track Nosmai's frames are pushed into. */
  videoTrackId: number;
  /**
   * Spread into your `joinChannel` / `updateChannelMediaOptions` options.
   * Publishes the custom track and, just as important, NOT the camera track —
   * Agora must never open the camera Nosmai owns.
   */
  channelMediaOptions: ChannelMediaOptions;
};

/**
 * The encoder settings every Nosmai bridge ships with: 720×1280 portrait at
 * 30 fps, fixed portrait orientation, and Agora's mirroring off (Nosmai has
 * already mirrored the front camera). Pass to
 * `engine.setVideoEncoderConfiguration()`; nothing here applies it for you.
 */
export const recommendedEncoderConfiguration: VideoEncoderConfiguration = {
  dimensions: { width: 720, height: 1280 },
  frameRate: 30,
  bitrate: 2500,
  minBitrate: 1200,
  orientationMode: OrientationMode.OrientationModeFixedPortrait,
  mirrorMode: VideoMirrorModeType.VideoMirrorModeDisabled,
};

/**
 * Publish a Nosmai-filtered camera feed to Agora with react-native-agora.
 *
 * **The model.** Nosmai owns the camera and the on-screen preview
 * (`NosmaiCameraView`). Agora only encodes and transports. Never enable
 * Agora's camera (`enableLocalVideo`/`startPreview`/`publishCameraTrack`) and
 * never render the local user with `RtcSurfaceView uid={0}` — a second capture
 * pipeline contends for Nosmai's single GL worker and costs ~⅓ of the fps.
 *
 * **Startup order** (Android is strict about step 1):
 * 1. `await NosmaiAgoraBridge.registerShareContext()` — before
 *    `NosmaiCameraSdk.initialize()`.
 * 2. Nosmai: mount `NosmaiCameraView`, initialize, configure, startProcessing.
 * 3. Agora: `createAgoraRtcEngine()`, `initialize()`, `enableVideo()`,
 *    optionally `setVideoEncoderConfiguration(recommendedEncoderConfiguration)`.
 * 4. `const s = await NosmaiAgoraBridge.startStreaming(engine)`.
 * 5. `engine.joinChannel(token, channel, uid, { ...s.channelMediaOptions, ... })`.
 *
 * **Teardown order:** `NosmaiAgoraBridge.stopStreaming(engine)` →
 * `engine.leaveChannel()` → `engine.release()`. Stopping after `release()`
 * leaves the native side holding a dangling engine pointer.
 */
export class NosmaiAgoraBridge {
  private static videoTrackId: number | null = null;
  private static starting: Promise<NosmaiAgoraStream> | null = null;

  private constructor() {}

  /**
   * Android: join Agora's root EGL share group. MUST be awaited before the
   * Nosmai SDK initializes. Resolves the EGL handle, or `null` on failure
   * (logged) — a failure here means a black remote, so surface it.
   *
   * iOS: resolves `0`. Safe to call unconditionally.
   */
  static async registerShareContext(): Promise<number | null> {
    try {
      return await NativeBridge.registerShareContext();
    } catch (e) {
      const err = NosmaiAgoraError.from(e);
      console.error(`[NosmaiAgoraBridge] registerShareContext: ${err.message}`);
      return null;
    }
  }

  /**
   * Point `engine` at an external video source, create a custom video track,
   * and start pushing Nosmai's frames into it.
   *
   * Concurrent calls share one attempt, and a call while already streaming
   * rejects with `E_ALREADY_STREAMING` — so a duplicated socket event cannot
   * tear down the stream that is about to succeed.
   *
   * @throws NosmaiAgoraError
   */
  static startStreaming(engine: IRtcEngine): Promise<NosmaiAgoraStream> {
    if (this.starting) return this.starting;
    this.starting = this.startInternal(engine).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private static async startInternal(
    engine: IRtcEngine
  ): Promise<NosmaiAgoraStream> {
    if (this.videoTrackId !== null) {
      throw new NosmaiAgoraError(
        NosmaiAgoraErrorCode.ALREADY_STREAMING,
        `Already streaming to custom track ${this.videoTrackId}.`
      );
    }

    // Must match how frames are pushed: Android pushes GL textures
    // (VIDEO_BUFFER_TEXTURE), iOS pushes raw BGRA bytes.
    const useTexture = Platform.OS === 'android';
    const rc = engine
      .getMediaEngine()
      .setExternalVideoSource(
        true,
        useTexture,
        ExternalVideoSourceType.VideoFrame
      );
    if (rc < 0) {
      throw new NosmaiAgoraError(
        NosmaiAgoraErrorCode.AGORA_UNAVAILABLE,
        `setExternalVideoSource failed (${rc}). Is the engine initialized?`
      );
    }

    const videoTrackId = engine.createCustomVideoTrack();
    if (videoTrackId < 0) {
      throw new NosmaiAgoraError(
        NosmaiAgoraErrorCode.AGORA_UNAVAILABLE,
        `createCustomVideoTrack failed (${videoTrackId}).`
      );
    }

    try {
      await NativeBridge.startStreaming(videoTrackId);
    } catch (e) {
      engine.destroyCustomVideoTrack(videoTrackId);
      throw NosmaiAgoraError.from(e);
    }

    this.videoTrackId = videoTrackId;
    return {
      videoTrackId,
      channelMediaOptions: {
        publishCameraTrack: false,
        publishCustomVideoTrack: true,
        customVideoTrackId: videoTrackId,
      },
    };
  }

  /**
   * Stop producing, then (when `engine` is given) destroy the custom track.
   * Call BEFORE `engine.leaveChannel()` / `engine.release()`. Idempotent and
   * never throws.
   */
  static async stopStreaming(engine?: IRtcEngine): Promise<void> {
    // Let an in-flight start settle first, so it cannot re-arm after we stop.
    await this.starting?.catch(() => undefined);
    try {
      await NativeBridge.stopStreaming();
    } catch (e) {
      console.warn(
        `[NosmaiAgoraBridge] stopStreaming: ${NosmaiAgoraError.from(e).message}`
      );
    }
    const trackId = this.videoTrackId;
    this.videoTrackId = null;
    if (engine && trackId !== null) {
      try {
        engine.destroyCustomVideoTrack(trackId);
      } catch (e) {
        console.warn(`[NosmaiAgoraBridge] destroyCustomVideoTrack: ${e}`);
      }
    }
  }

  static async isStreaming(): Promise<boolean> {
    try {
      return await NativeBridge.isStreaming();
    } catch {
      return false;
    }
  }

  /** @throws NosmaiAgoraError */
  static async getStats(): Promise<StreamStats> {
    try {
      return await NativeBridge.getStats();
    } catch (e) {
      throw NosmaiAgoraError.from(e);
    }
  }

  /** The platform-specific input Agora is fed, for logs and support tickets. */
  static get inputDescription(): string {
    return Platform.OS === 'android'
      ? 'GL_TEXTURE_2D via IMediaEngine::pushVideoFrame (EGL share group)'
      : 'raw BGRA bytes via IMediaEngine::pushVideoFrame';
  }
}

export default NosmaiAgoraBridge;
