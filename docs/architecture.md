# Architecture

How the bridge works on each platform, and why each rule in
[`CONTRACT.md`](../CONTRACT.md) exists. Most of those rules guard failures that are
*silent* — a black remote, a frozen stream — so the symptom table at the end is the part
worth remembering.

**Validation.** iOS has streamed end to end on a physical device (see
[`testing.md`](testing.md)). The Android native path has not yet been built or run.

---

## The shape of it

```
                   ┌───────────────────────────────────────────┐
  camera ─────────►│  Nosmai SDK  (filters, AR, beauty)         │
                   └──────┬──────────────────────────┬─────────┘
                          │                          │
            NosmaiCameraView                 frame tap (this bridge)
            on-screen preview                        │
                                                     ▼
                                   IMediaEngine::pushVideoFrame(frame, customTrackId)
                                                     │
                                                     ▼
                              react-native-agora's engine ── encode ── channel
```

Nosmai owns capture and the preview; Agora only encodes and transports. The app owns
the engine, the channel and the custom video track through react-native-agora's public
API. The bridge only moves frames.

## Why the Flutter bridge's approach does not port

The Flutter Agora bridge (`nosmai_agora_bridge`) creates the Agora engine itself and pushes frames through Agora's
Java `RtcEngine` / ObjC `AgoraRtcEngineKit`. react-native-agora never creates either: it
drives Agora's C++ engine through Iris (`callIrisApi`). So the bridge talks C++:

1. **Engine handle, read natively.** The module finds react-native-agora's own module
   (`AgoraRtcNgModule` / `+[AgoraRtcNg shareInstance]`), takes its Iris instance and
   calls `RtcEngine_getNativeHandle`. The JSON result is parsed as a 64-bit integer.
   JS's `engine.getNativeHandle()` is not used: it returns a double, and Android 11+
   tagged heap pointers (`0xB4…` in the top byte) lose their low bits in that conversion.
2. **Media engine.** `IEngineBase::queryInterface(AGORA_IID_MEDIA_ENGINE)`. `IEngineBase`
   is `IRtcEngine`'s primary base, so no `IAgoraRtcEngine.h` is needed. The reference is
   released in `stopStreaming`.
3. **Push.** `pushVideoFrame` on the custom track the app created. Only six Agora public
   headers are vendored (`cpp/third_party/agora`); nothing from Agora is linked.

## Android

```
Nosmai GL worker ──texId──► onFrame (Nosmai render thread; never blocks)
                                 │ single-flight: drop if a push is in flight
                                 ▼
                     nosmai-agora-push worker ──invoke──► TextureBufferHelper GL thread
                                                            blit src → ring[slot] (Y-flip)
                                                            glFinish
                                                            releaseStreamSlot(texId)
                                                            JNI → pushVideoFrame(TEXTURE_2D,
                                                                  helper EGL14 context)
```

- **Share context.** Nosmai's GL context must be created in the same EGL share group as
  the context the push uses. `registerShareContext()` hands Agora's root `EglBase`
  context (available without an engine, since react-native-agora ships Agora's full SDK)
  to `NosmaiSDK.setAgoraShareContext` before Nosmai initializes.
- **Copy, then push.** Nosmai wants its producer slot back immediately; Agora may hold a
  frame longer. The blit into a 3-slot ring decouples the two lifetimes.
- **`glFinish`, not `glFlush`.** Agora reads the texture from its own context and thread,
  which only sees completed GL work. The cost lands on the helper thread, never on
  Nosmai's.
- **Render mode.** `DUAL_OUTPUT` plus the texture callback — both gates, or zero frames.
  The previous mode is restored on stop.

## iOS

```
Nosmai render thread ──CVPixelBuffer (BGRA)──► effects SDK live-frame fan-out
                                                 └─► bridge block: lock base address (read-only)
                                                                   pushVideoFrame(RAW_DATA, BGRA bytes)
                                                                   unlock
```

- **Tap.** `+[NosmaiCameraSdk setLiveStreamFrameCallback:]`, a native-only hook the
  effects SDK fans out from the live-frame callback it owns. The bridge never touches
  `NosmaiCore.liveFrameStreamCallback`; doing so would break the SDK's readiness event
  and frame stream.
- **Bytes, not the pixel buffer.** Measured on device: Agora's C++ `pushVideoFrame`
  rejects a `CVPixelBufferRef` with `-4` (`ERR_NOT_SUPPORTED`) in every combination of
  raw/texture × `VIDEO_CVPIXEL_NV12`/`BGRA`, with `useTexture` true or false. Raw
  `VIDEO_PIXEL_BGRA` bytes are accepted. Agora copies the plane during the call, so the
  lock is short and Nosmai gets its buffer back untouched.
- **Mirroring.** Nosmai mirrors at capture (`NosmaiCameraView`'s `mirror` prop), so the
  stream carries exactly what the preview shows. The bridge never mirrors.

## Silent failures and their symptoms

| Symptom | Likely cause |
|---|---|
| Android: remote black, `pushed` rising | Share context registered after Nosmai initialized (Nosmai got a standalone GL context). |
| `pushed` stays 0, `failed` 0 | Nosmai not processing, preview not mounted, or (Android) render mode not `DUAL_OUTPUT`. |
| `failed` rising, `rc -4` | Frame description Agora does not accept, or `useTexture` mismatch with the push type. |
| Stream freezes after a few frames (Android) | A Nosmai stream slot was never released. |
| Second go-live freezes then goes black (Android) | GL helper kept across streams instead of per stream. |
| fps drops to about a third | The app also enabled Agora's own camera — a second capture pipeline. |
| Crash after leaving | `stopStreaming` called after `engine.release()` (dangling media engine). |
