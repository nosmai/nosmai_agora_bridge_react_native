// Shared by Android (JNI) and iOS (ObjC++). The only code in this package that
// touches Agora's C++ API.
//
// Everything goes through virtual calls on pointers Agora hands us, so this
// compiles against Agora's public headers only (cpp/third_party/agora) and
// links nothing from Agora: react-native-agora already loads the engine into
// the process, and we must never load a second copy.

#pragma once

#include <cstdint>

namespace nosmai_agora {

// Agora's VIDEO_PIXEL_FORMAT values we push, restated so callers need not
// include the Agora headers.
enum PixelFormat : int {
  kPixelFormatBGRA = 2,  // VIDEO_PIXEL_BGRA (raw bytes)
  kPixelFormatTexture2D = 10,  // VIDEO_TEXTURE_2D
};

// Result codes for ResolveMediaEngine. Negative Agora error codes from
// queryInterface are passed through unchanged.
enum ResolveResult : int {
  kResolveOk = 0,
  kResolveNullHandle = 1,
  kResolveNullMediaEngine = 2,
};

// Turns react-native-agora's engine handle (the agora::rtc::IRtcEngine*
// returned by RtcEngine_getNativeHandle) into an IMediaEngine*.
//
// The returned pointer holds a reference and MUST be passed to
// ReleaseMediaEngine exactly once. Returns nullptr and sets *result on failure.
void* ResolveMediaEngine(uint64_t rtcEngineHandle, int* result);

void ReleaseMediaEngine(void* mediaEngine);

// Android: pushes an RGBA GL_TEXTURE_2D owned by `eglContext` (an EGL14
// EGLContext) as one frame of the custom video track. The texture must be
// complete (glFinish'd or fenced) before this call — Agora samples it from its
// own context. Returns Agora's result: 0 = queued, negative = error.
int PushTexture(void* mediaEngine, unsigned int videoTrackId, int textureId,
                void* eglContext, int width, int height, int64_t timestampMs);

// iOS: pushes raw pixel bytes (a locked CVPixelBuffer's BGRA plane). Agora's
// C++ pushVideoFrame rejects CVPixelBufferRefs on iOS with -4 in every
// raw/texture x CVPIXEL combination (measured, react-native-agora 4.6.4). `stride`
// is in PIXELS, not bytes. Agora copies the bytes before returning.
int PushRawBytes(void* mediaEngine, unsigned int videoTrackId, void* bytes,
                 int pixelFormat, int stridePixels, int width, int height,
                 int64_t timestampMs);

}  // namespace nosmai_agora
