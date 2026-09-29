#include "NosmaiAgoraPush.h"

#include <agora/AgoraBase.h>
#include <agora/AgoraMediaBase.h>
#include <agora/IAgoraMediaEngine.h>

namespace nosmai_agora {

void* ResolveMediaEngine(uint64_t rtcEngineHandle, int* result) {
  if (rtcEngineHandle == 0) {
    if (result) *result = kResolveNullHandle;
    return nullptr;
  }
  // IRtcEngine's primary (and only) base is IEngineBase, so the handle is
  // usable as one without IAgoraRtcEngine.h — which would drag in most of the
  // SDK's headers for a single virtual call.
  auto* engine = reinterpret_cast<agora::base::IEngineBase*>(
      static_cast<uintptr_t>(rtcEngineHandle));
  void* mediaEngine = nullptr;
  int rc = engine->queryInterface(agora::rtc::AGORA_IID_MEDIA_ENGINE,
                                  &mediaEngine);
  if (rc != 0) {
    if (result) *result = rc;
    return nullptr;
  }
  if (!mediaEngine) {
    if (result) *result = kResolveNullMediaEngine;
    return nullptr;
  }
  if (result) *result = kResolveOk;
  return mediaEngine;
}

void ReleaseMediaEngine(void* mediaEngine) {
  if (!mediaEngine) return;
  // Balances the reference queryInterface handed out, exactly as Agora's own
  // AutoPtr<IMediaEngine> does in its destructor.
  static_cast<agora::media::IMediaEngine*>(mediaEngine)->release();
}

int PushTexture(void* mediaEngine, unsigned int videoTrackId, int textureId,
                void* eglContext, int width, int height, int64_t timestampMs) {
  if (!mediaEngine) return -1;
  agora::media::base::ExternalVideoFrame frame;
  frame.type = agora::media::base::ExternalVideoFrame::VIDEO_BUFFER_TEXTURE;
  frame.format = agora::media::base::VIDEO_TEXTURE_2D;
  frame.textureId = textureId;
  frame.eglContext = eglContext;
  frame.eglType = agora::media::base::ExternalVideoFrame::EGL_CONTEXT14;
  // For textures, stride is the texture width.
  frame.stride = width;
  frame.height = height;
  frame.timestamp = timestampMs;
  // Identity: the bridge's blit already flipped Y, so the texture is
  // top-left origin like video. A non-identity matrix confuses Agora's
  // dimension and orientation handling (same rule as the Flutter Agora bridge).
  for (int i = 0; i < 16; ++i) frame.matrix[i] = (i % 5 == 0) ? 1.0f : 0.0f;
  // 0 and correct: Nosmai renders an upright portrait target, so any other
  // value ADDS a quarter turn.
  frame.rotation = 0;
  return static_cast<agora::media::IMediaEngine*>(mediaEngine)
      ->pushVideoFrame(&frame, videoTrackId);
}

int PushRawBytes(void* mediaEngine, unsigned int videoTrackId, void* bytes,
                 int pixelFormat, int stridePixels, int width, int height,
                 int64_t timestampMs) {
  if (!mediaEngine || !bytes) return -1;
  agora::media::base::ExternalVideoFrame frame;
  frame.type = agora::media::base::ExternalVideoFrame::VIDEO_BUFFER_RAW_DATA;
  frame.format = static_cast<agora::media::base::VIDEO_PIXEL_FORMAT>(pixelFormat);
  frame.buffer = bytes;
  frame.stride = stridePixels;
  frame.height = height;
  // Row padding beyond the visible width is trimmed on the right.
  frame.cropRight = stridePixels - width;
  frame.timestamp = timestampMs;
  frame.rotation = 0;
  return static_cast<agora::media::IMediaEngine*>(mediaEngine)
      ->pushVideoFrame(&frame, videoTrackId);
}

}  // namespace nosmai_agora
