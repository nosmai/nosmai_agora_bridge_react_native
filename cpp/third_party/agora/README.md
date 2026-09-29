# Agora public C++ headers (vendored)

Six unmodified headers from the Agora RTC SDK **4.6.4** (`AgoraRtcKit.framework/Headers`
in `AgoraRtcEngine_iOS 4.6.4`), the version `react-native-agora` 4.6.4 pins. Copyright
Agora.io; see each file's header.

They are here only so the bridge can make virtual calls through the engine pointer
`react-native-agora` already created (`IEngineBase::queryInterface`,
`IMediaEngine::pushVideoFrame`). Nothing from Agora is compiled or linked into this
package; Agora's Android AAR ships no C++ headers, which is why they are vendored.

The bridge depends only on the `IMediaEngine` vtable and the `ExternalVideoFrame` layout,
verified identical from 4.6.2 to 4.6.4. Re-verify both before widening the
`react-native-agora` peer range (see `docs/releasing.md`).
