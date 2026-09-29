# Changelog

## [Unreleased]

## 0.1.0 — preview

- Initial bridge: react-native-agora 4.6.x, React Native 0.81, `@nosmai/react-native-effects-sdk` 1.0.x.
- Android: GL texture push through Agora's C++ `IMediaEngine` via JNI.
- iOS: BGRA frames pushed through Agora's C++ `IMediaEngine`, fed by the effects SDK's `+setLiveStreamFrameCallback:` hook. `CVPixelBufferRef`s are rejected by Agora's C++ API with `-4` on iOS.
- Engine handle is read natively through react-native-agora's Iris instance; the JS `getNativeHandle()` double cannot carry Android tagged pointers.
- Example app, browser viewer (`tools/`), device test matrix.
