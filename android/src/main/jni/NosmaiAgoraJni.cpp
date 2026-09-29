// JNI surface of libnosmai_agora_bridge.so. Thin by design: every Agora call
// lives in cpp/NosmaiAgoraPush.cpp, shared with iOS.

#include <jni.h>

#include <android/log.h>

#include "NosmaiAgoraPush.h"

#define LOG_TAG "NosmaiAgoraBridge"

extern "C" {

// Returns the IMediaEngine* as a jlong, or 0 with the reason written into
// result[0] (ResolveResult or a negative Agora error).
JNIEXPORT jlong JNICALL
Java_com_nosmai_agorabridge_NosmaiAgoraNative_resolveMediaEngine(
    JNIEnv* env, jclass, jlong rtcEngineHandle, jintArray result) {
  int rc = 0;
  void* mediaEngine = nosmai_agora::ResolveMediaEngine(
      static_cast<uint64_t>(rtcEngineHandle), &rc);
  if (result && env->GetArrayLength(result) > 0) {
    jint out = rc;
    env->SetIntArrayRegion(result, 0, 1, &out);
  }
  if (!mediaEngine) {
    __android_log_print(ANDROID_LOG_ERROR, LOG_TAG,
                        "queryInterface(AGORA_IID_MEDIA_ENGINE) failed rc=%d", rc);
  }
  return static_cast<jlong>(reinterpret_cast<uintptr_t>(mediaEngine));
}

JNIEXPORT void JNICALL
Java_com_nosmai_agorabridge_NosmaiAgoraNative_releaseMediaEngine(
    JNIEnv*, jclass, jlong mediaEngine) {
  nosmai_agora::ReleaseMediaEngine(
      reinterpret_cast<void*>(static_cast<uintptr_t>(mediaEngine)));
}

JNIEXPORT jint JNICALL
Java_com_nosmai_agorabridge_NosmaiAgoraNative_pushTexture(
    JNIEnv*, jclass, jlong mediaEngine, jint videoTrackId, jint textureId,
    jlong eglContext, jint width, jint height, jlong timestampMs) {
  return nosmai_agora::PushTexture(
      reinterpret_cast<void*>(static_cast<uintptr_t>(mediaEngine)),
      static_cast<unsigned int>(videoTrackId), textureId,
      reinterpret_cast<void*>(static_cast<uintptr_t>(eglContext)), width,
      height, static_cast<int64_t>(timestampMs));
}

}  // extern "C"
