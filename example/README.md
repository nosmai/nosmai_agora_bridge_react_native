# Example — Nosmai → Agora

One screen that runs the whole flow in the order that works: share context, Nosmai
initialization and preview, Agora engine, bridge, join, and a teardown that stops
producing before it stops consuming. It also has a camera switch, a beauty toggle and a
"2× start" button that exercises the re-entrancy guard, plus live bridge stats.

## Prerequisites

- Node from `../.nvmrc`, Yarn 4 via Corepack.
- `@nosmai/react-native-effects-sdk` from npm (installed by `yarn install`). On iOS the
  bridge needs a release that exports `+[NosmaiCameraSdk setLiveStreamFrameCallback:]`;
  with an older one, `startStreaming` rejects with `E_SDK_TAP_UNAVAILABLE`.
- A physical device. Nosmai ships no simulator slice and no x86 Android build.

## Credentials (never committed)

```bash
cp src/credentials.example.ts src/credentials.local.ts   # git-ignored
```

Fill in the Nosmai licence keys and the Agora App ID and channel. Nosmai keys are bound to
the application id / bundle id they were issued for, so the app must be built with that id:

- **Android:** `nosmaiApplicationId=<licensed id>` in untracked `android/local.properties`,
  or `-PnosmaiApplicationId=...`. The committed default `com.nosmai.agorabridge.example`
  is a placeholder.
- **iOS:** override the bundle id and signing team on the command line (or in Xcode,
  without committing it):

  ```bash
  xcodebuild -workspace ios/NosmaiAgoraBridgeExample.xcworkspace \
    -scheme NosmaiAgoraBridgeExample -configuration Debug \
    -destination 'id=<DEVICE_UDID>' -allowProvisioningUpdates \
    PRODUCT_BUNDLE_IDENTIFIER=<licensed bundle id> DEVELOPMENT_TEAM=<TEAM_ID> build
  ```

## Run

```bash
yarn install
cd ios && pod install && cd ..        # iOS
yarn start                            # Metro
```

Android also needs the licensed AAR at `android/app/libs/nosmai-release.aar`
(git-ignored), then `yarn android`. The Android build is arm64-only.

The phone must reach Metro on the Mac's LAN address; on iOS allow the local-network
prompt on first launch. Watch the result in the browser with `../tools/serve-viewer.sh`
(see `../tools/README.md`).

## Reading the stats line

`pushed · dropped · failed · rc · W×H · inputMode`

- `pushed` rising, `failed` 0, `rc 0`: frames are reaching Agora.
- `failed` rising with `rc -4`: Agora rejects the frame description
  (`ERR_NOT_SUPPORTED`) — see `CONTRACT.md` invariant 10.
- `pushed` flat: on Android, check `registerShareContext` ran before Nosmai initialized.
