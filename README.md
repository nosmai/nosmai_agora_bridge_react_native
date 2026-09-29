# @nosmai/react-native-agora-bridge

Publish a Nosmai-filtered camera feed to Agora from React Native.

> **Status: 0.1.0 preview.** iOS streams end to end on a physical device (iPhone 15 Plus,
> react-native-agora 4.6.4). Android is implemented but not yet built or run on a device.
> See [`docs/testing.md`](docs/testing.md).

Nosmai owns the camera and the preview. Agora only encodes and transports. The bridge
moves Nosmai's filtered frames into a react-native-agora custom video track: GL textures
on Android (no CPU readback) and BGRA frames on iOS (one copy, made by Agora).

## Requirements

| | |
|---|---|
| React Native | 0.81.x, New Architecture |
| `@nosmai/react-native-effects-sdk` | 1.0.x **with** `+[NosmaiCameraSdk setLiveStreamFrameCallback:]` (iOS) |
| `react-native-agora` | 4.6.x |
| Android | API 24+, arm64-v8a / armeabi-v7a, `nosmai-release.aar` in `app/libs` |
| iOS | 15.1+, physical device |

## Usage

```ts
import { NosmaiCameraSdk, NosmaiCameraView } from '@nosmai/react-native-effects-sdk';
import { createAgoraRtcEngine, ChannelProfileType, ClientRoleType } from 'react-native-agora';
import { NosmaiAgoraBridge, recommendedEncoderConfiguration } from '@nosmai/react-native-agora-bridge';

// 1. Android: BEFORE Nosmai initializes. A failure here means a black remote.
await NosmaiAgoraBridge.registerShareContext();

// 2. Nosmai, as usual: mount <NosmaiCameraView/>, initialize, configure, startProcessing.

// 3. Agora engine — owned by the app.
const engine = createAgoraRtcEngine();
engine.initialize({ appId, channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting });
engine.enableVideo();
engine.setVideoEncoderConfiguration(recommendedEncoderConfiguration);

// 4. Bridge: external source + custom track + native push.
const stream = await NosmaiAgoraBridge.startStreaming(engine);

// 5. Join, publishing the custom track and NOT the camera.
engine.joinChannel(token, channelId, uid, {
  ...stream.channelMediaOptions,
  clientRoleType: ClientRoleType.ClientRoleBroadcaster,
  publishMicrophoneTrack: true,
});

// Teardown — this order.
await NosmaiAgoraBridge.stopStreaming(engine);
engine.leaveChannel();
engine.release();
```

Render the local preview with `NosmaiCameraView`, never `RtcSurfaceView` with `uid 0`.
Switch cameras through Nosmai, never Agora. Don't call `enableLocalVideo` or
`startPreview`. A second capture pipeline contends for Nosmai's GL worker and costs
about a third of the frame rate.

## Diagnostics

`await NosmaiAgoraBridge.getStats()` returns `pushed`, `dropped`, `failed`,
`lastResult`, `width` and `height`.

- `pushed` not rising means no frames are reaching Agora. On Android, check that
  `registerShareContext` ran before Nosmai initialized (logcat: *"Creating GL context in
  a SHARED group"*).
- `failed` rising means Agora rejected the frames; `lastResult` holds Agora's error code.

Logs are tagged `NosmaiAgoraBridge` (logcat) and `[NosmaiAgora]` (Xcode).

## Example and viewer

- [`example/`](example/README.md): a one-screen app that runs the whole flow, with live
  bridge stats.
- [`tools/`](tools/README.md): a browser receiver for watching the channel.

## Documentation

- [`CONTRACT.md`](CONTRACT.md): the native contract and its invariants.
- [`docs/architecture.md`](docs/architecture.md): how each platform works, and a table
  mapping silent failures to their causes.
- [`docs/testing.md`](docs/testing.md): the device test matrix and results.
- [`docs/releasing.md`](docs/releasing.md): the release checklist.
