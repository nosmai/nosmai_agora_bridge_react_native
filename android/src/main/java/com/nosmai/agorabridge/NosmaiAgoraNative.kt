package com.nosmai.agorabridge

/** JNI entry points of libnosmai_agora_bridge.so (android/src/main/jni/NosmaiAgoraJni.cpp). */
internal object NosmaiAgoraNative {

    @Volatile private var loadError: Throwable? = null
    @Volatile private var loaded = false

    /** Loads the library once. Returns the load failure, or null when usable. */
    @Synchronized
    fun ensureLoaded(): Throwable? {
        if (loaded) return null
        loadError?.let { return it }
        return try {
            System.loadLibrary("nosmai_agora_bridge")
            loaded = true
            null
        } catch (t: Throwable) {
            loadError = t
            t
        }
    }

    /** IRtcEngine* -> IMediaEngine* (holding a reference), or 0 with the reason in result[0]. */
    @JvmStatic external fun resolveMediaEngine(rtcEngineHandle: Long, result: IntArray): Long

    /** Releases the reference [resolveMediaEngine] handed out. Exactly once per resolve. */
    @JvmStatic external fun releaseMediaEngine(mediaEngine: Long)

    /** Agora's pushVideoFrame result: 0 = queued, negative = error. */
    @JvmStatic external fun pushTexture(
        mediaEngine: Long,
        videoTrackId: Int,
        textureId: Int,
        eglContext: Long,
        width: Int,
        height: Int,
        timestampMs: Long,
    ): Int
}
