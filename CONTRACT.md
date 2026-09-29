# Native contract — `NosmaiAgoraBridge`

Binding for the TypeScript spec (`src/NativeNosmaiAgoraBridge.ts`), the Android module
(`android/src/main/java/com/nosmai/agorabridge/`) and the iOS module (`ios/`). When the
code and this file disagree, one of them is a bug.

## Module

TurboModule name `NosmaiAgoraBridge`; codegen library `RNNosmaiAgoraBridgeSpec`.

| Method | Resolves | Rejects |
|---|---|---|
| `registerShareContext()` | Android: EGL handle (number, display only). iOS: `0` | `E_SHARE_CONTEXT` |
| `startStreaming(videoTrackId)` | `void` | `E_ALREADY_STREAMING`, `E_INVALID_ARGUMENT`, `E_SHARE_CONTEXT` (Android, never registered), `E_AGORA_UNAVAILABLE`, `E_SDK_TAP_UNAVAILABLE` (iOS), `E_START_FAILED` |
| `stopStreaming()` | `void` — idempotent | never |
| `isStreaming()` | `boolean` | never |
| `getStats()` | `{streaming, videoTrackId, pushed, dropped, failed, lastResult, width, height}` | never |

`videoTrackId` comes from `engine.createCustomVideoTrack()`. The JS class
`NosmaiAgoraBridge.startStreaming(engine)` does that, plus
`setExternalVideoSource(true, useTexture, VideoFrame)` — `useTexture` is `true` on
Android and `false` on iOS — before calling native.

## How frames reach Agora

react-native-agora drives Agora through Iris (C++) and never creates a Java `RtcEngine`
or ObjC `AgoraRtcEngineKit`, so the Flutter bridge's push path does not exist here.
Instead:

1. **Engine handle, natively.** The module asks react-native-agora's own module for
   Iris (`AgoraRtcNgModule.irisApiEngine` under `irisApiLock` on Android;
   `+[AgoraRtcNg shareInstance].irisApiEngine` on iOS) and calls
   `RtcEngine_getNativeHandle`. The JSON result is parsed as an unsigned 64-bit integer.
   **Never take the handle from JS** — `engine.getNativeHandle()` is a double, and
   Android 11+ tagged heap pointers (`0xB4…`) do not survive the conversion.
2. **Media engine.** `IEngineBase::queryInterface(AGORA_IID_MEDIA_ENGINE)` (IRtcEngine's
   primary base). The returned `IMediaEngine*` holds a reference, released exactly once
   in `stopStreaming`.
3. **Push.** `IMediaEngine::pushVideoFrame(ExternalVideoFrame*, videoTrackId)`, all in
   `cpp/NosmaiAgoraPush.cpp`, compiled against Agora's public headers vendored in
   `cpp/third_party/agora` (4.6.4; the `IMediaEngine` vtable and `ExternalVideoFrame`
   layout are identical across 4.6.2–4.6.4 — re-verify before widening the peer range).
   Nothing from Agora is linked.

| | Android | iOS |
|---|---|---|
| Nosmai tap | `NosmaiSDK.setTextureFrameCallback` + `setRenderMode(DUAL_OUTPUT)` | `+[NosmaiCameraSdk setLiveStreamFrameCallback:]` (effects SDK fan-out hook) |
| Frame | blit into a 3-slot RGBA ring on an Agora `TextureBufferHelper` GL thread, `glFinish` | the BGRA plane of the delivered `CVPixelBuffer`, locked read-only for the call (Agora copies it) |
| `ExternalVideoFrame` | `VIDEO_BUFFER_TEXTURE`, `VIDEO_TEXTURE_2D`, helper's EGL14 context, identity matrix | `VIDEO_BUFFER_RAW_DATA`, `VIDEO_PIXEL_BGRA`, stride in pixels, row padding cropped right |
| Timestamp | ms (Nosmai ns / 1e6) | ms (Nosmai s × 1000) |

## Invariants

1. **Nosmai owns the camera and the preview.** The bridge never opens a camera; the app
   must never publish Agora's camera track or render `uid 0` through Agora.
2. **Android share context before Nosmai init.** `System.loadLibrary("nosmai")` →
   `EglBaseProvider.instance().rootEglBase` handle → `NosmaiSDK.setAgoraShareContext`.
   Latched process-wide. Registration after `NosmaiSDK.isInitialized()` rejects rather
   than silently producing a black remote.
3. **Two Android gates.** `DUAL_OUTPUT` *and* the texture callback; either alone yields
   zero frames. On stop the previous render mode is restored (never `STREAMING_ONLY`),
   not forced to `PREVIEW_ONLY`, so the effects SDK's own frame stream survives.
4. **`releaseStreamSlot` exactly once per Nosmai frame**, on every path including drops
   and errors. It runs as soon as the blit completes, before the push.
5. **Single-flight, drop don't queue** (Android). A frame arriving while one is in flight
   is dropped and its slot released.
6. **Per-stream GL helper.** Created in `startStreaming`, disposed in `stopStreaming`.
7. **Never call `invoke` on Nosmai's render thread.** A dedicated worker does.
8. **Rotation 0.** Nosmai delivers upright, already-mirrored frames.
9. **Teardown order.** Disarm the Nosmai tap → restore render mode → drain the push
   worker → release GL objects and helper → release the media engine. The app then
   destroys the custom track, leaves the channel, and releases the engine — in that
   order. `stopStreaming` after `engine.release()` touches a dangling pointer.
10. **iOS pushes bytes, never the `CVPixelBufferRef`.** Measured on device
    (react-native-agora 4.6.4): C++ `pushVideoFrame` rejects a CVPixelBuffer handle with
    `-4` (`ERR_NOT_SUPPORTED`) in every raw/texture × `VIDEO_CVPIXEL_NV12`/`BGRA`
    combination, with `useTexture` true or false. Raw `VIDEO_PIXEL_BGRA` bytes are
    accepted. The ObjC `AgoraVideoFrame.format = 12` path the Flutter bridge used does
    not exist under Iris.
11. **iOS never touches `NosmaiCore.liveFrameStreamCallback`.** The effects SDK owns that
    single slot (readiness + frame stream); the bridge uses the SDK's fan-out hook only,
    and fails with `E_SDK_TAP_UNAVAILABLE` rather than falling back.
12. **Re-entrancy.** A second `startStreaming` while one is running or starting never
    tears down the first.
