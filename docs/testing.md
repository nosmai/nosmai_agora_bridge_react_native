# Acceptance test matrix

**Android and iOS are scored separately — a pass on one is not a pass on the other.** The
two frame paths share only `cpp/NosmaiAgoraPush.cpp` below the JS layer.

Setup: the example app (`example/README.md`) and the browser viewer
(`tools/README.md`). App ID authentication needs no token server.

| Mark | Means |
|---|---|
| `PASS` | Ran on a physical device, observed the expected result. |
| `FAIL` | Ran, did not get the expected result. |
| `BLOCKED` | Cannot be run yet; reason in the notes. |
| blank | Not attempted. |

## Run log

- **iOS — 2026-09-29, iPhone 15 Plus (iOS 26.6.1)**, react-native-agora 4.6.4
  (Agora 4.6.4, Iris 4.6.4-build.6), NosmaiCameraSDK 3.0.5, React Native 0.81.5.
- **Android** — not yet run (no device at the time of the first iOS pass).

## Matrix

| ID | Test | Expected | Android | iOS | Notes |
|---|---|---|---|---|---|
| S2 | Engine handle + media engine resolve natively | no `E_AGORA_UNAVAILABLE` | | PASS | `queryInterface(iid 4)` on the same `IRtcEngine*` Iris uses (agoraapi.log). |
| S3 | Frames accepted by `pushVideoFrame` | `rc 0`, `pushed` rising | | PASS | iOS only after switching to raw BGRA bytes; every CVPixelBuffer description returned `-4`. Android texture path untested. |
| T00 | Remote video visible in the web viewer | filtered portrait video | | PASS | 576×1024 with the default camera preset. |
| T01 | Share context before `initialize` | remote video visible | | n/a | Android only. |
| T02 | Share context after `initialize` | rejects `E_SHARE_CONTEXT` | | n/a | Android only. |
| T03 | Publish, 10 min soak | ~30 fps, `failed` 0, `dropped` slow | | | |
| T04 | Swap filters / beauty while streaming | remote updates immediately | | | |
| T05 | `switchCamera` while streaming | no freeze; front mirrored like the preview, back not | | | Example follows `mirror={position === 'front'}`. |
| T06 | Stop → start (second go-live) | second stream works | | | |
| T07 | "2× start" button | one stream; the duplicate shares or rejects | | | |
| T08 | Record + stream | both valid | | | |
| T09 | Effects SDK `startFrameStream` + bridge, stop either first | the other keeps running | | | Android render-mode limitation documented in the effects SDK. |
| T10 | Background / foreground | recovers or fails cleanly | | | |
| T11 | Documented teardown ×10 | no crash, no leak | | | |
| T12 | Metro reload while streaming | old tap disarmed; restart works | | | |
| T13 | Release build (R8 on Android) | no missing classes | | | |
| T14 | `yarn validate` | passes | PASS | PASS | Not a device test; gates the package. |
