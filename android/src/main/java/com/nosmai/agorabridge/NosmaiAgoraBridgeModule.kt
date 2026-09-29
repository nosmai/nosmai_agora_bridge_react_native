package com.nosmai.agorabridge

import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.annotations.ReactModule
import com.nosmai.effect.api.NosmaiSDK
import io.agora.rtc.ng.react.AgoraRtcNgModule
import io.agora.rtc2.gl.EglBaseProvider
import java.math.BigInteger

/**
 * The `NosmaiAgoraBridge` TurboModule (CONTRACT.md).
 *
 * Nosmai owns the camera and the preview; react-native-agora owns the engine, the channel
 * and the custom video track. This module only moves Nosmai's filtered frames into that
 * track. It never opens a camera and never joins or leaves a channel.
 */
@ReactModule(name = NosmaiAgoraBridgeModule.NAME)
class NosmaiAgoraBridgeModule(reactContext: ReactApplicationContext) :
    NativeNosmaiAgoraBridgeSpec(reactContext) {

    companion object {
        const val NAME = "NosmaiAgoraBridge"
        private const val TAG = "NosmaiAgoraBridge"

        private const val E_SHARE_CONTEXT = "E_SHARE_CONTEXT"
        private const val E_AGORA_UNAVAILABLE = "E_AGORA_UNAVAILABLE"
        private const val E_ALREADY_STREAMING = "E_ALREADY_STREAMING"
        private const val E_START_FAILED = "E_START_FAILED"
        private const val E_INVALID_ARGUMENT = "E_INVALID_ARGUMENT"

        // Process-wide and one-shot: the handle is consumed when Nosmai's GL context is
        // constructed and a later call is ignored natively. Static so a Metro reload (new
        // ReactContext, new module) cannot "re-register" against an existing context.
        @Volatile private var shareContextRegistered = false
        @Volatile private var shareContextHandle = 0L

        private val RESULT_NUMBER = Regex("\"result\"\\s*:\\s*\"?(-?\\d+)")
    }

    private val lock = Any()
    private var mediaEngine = 0L
    private var pusher: NosmaiAgoraTexturePusher? = null
    private var videoTrackId = -1

    // Counters of the last stream, so getStats() after a stop still explains what happened.
    private var last = Arguments.createMap().apply {
        putBoolean("streaming", false)
        for (k in arrayOf("pushed", "dropped", "failed", "lastResult", "width", "height")) putDouble(k, 0.0)
        putDouble("videoTrackId", -1.0)
        putString("inputMode", "texture2d")
    }

    override fun getName(): String = NAME

    // ── registerShareContext ────────────────────────────────────────────

    /**
     * Put Nosmai's GL context in Agora's root EGL share group, so the helper that feeds
     * Agora can read Nosmai's textures. MUST complete before the camera SDK initializes;
     * afterwards Nosmai already has a standalone context and the remote would be black.
     *
     * Needs no engine: Agora's root EglBase is a Java singleton in the full SDK, which
     * react-native-agora ships as an `api` dependency.
     */
    override fun registerShareContext(promise: Promise) {
        synchronized(lock) {
            if (shareContextRegistered) {
                promise.resolve(shareContextHandle.toDouble())
                return
            }
            try {
                // setAgoraShareContext is native; without the library loaded first it
                // throws UnsatisfiedLinkError and silently costs the share group.
                System.loadLibrary("nosmai")
                if (NosmaiSDK.isInitialized()) {
                    promise.reject(
                        E_SHARE_CONTEXT,
                        "Nosmai SDK is already initialized. registerShareContext() must " +
                            "complete before NosmaiCameraSdk.initialize().",
                    )
                    return
                }
                val handle = EglBaseProvider.instance().rootEglBase.eglBaseContext.nativeEglContext
                if (handle == 0L) {
                    promise.reject(E_SHARE_CONTEXT, "Agora's root EGL context is unavailable.")
                    return
                }
                NosmaiSDK.setAgoraShareContext(handle)
                shareContextHandle = handle
                shareContextRegistered = true
                Log.i(TAG, "EGL share context registered handle=0x${java.lang.Long.toHexString(handle)}")
                // Only for display/logging in JS; the native side never reads it back.
                promise.resolve(handle.toDouble())
            } catch (t: Throwable) {
                Log.e(TAG, "registerShareContext failed", t)
                promise.reject(E_SHARE_CONTEXT, "registerShareContext failed: ${t.message}", t)
            }
        }
    }

    // ── startStreaming ─────────────────────────────────────────────────

    override fun startStreaming(videoTrackId: Double, promise: Promise) {
        synchronized(lock) {
            // Re-entrancy guard: callers are often driven by socket events a server can
            // emit twice. A second start must never tear down the first.
            if (pusher != null) {
                promise.reject(E_ALREADY_STREAMING, "Already streaming to track ${this.videoTrackId}.")
                return
            }
            val trackId = videoTrackId.toInt()
            if (trackId < 0 || trackId.toDouble() != videoTrackId) {
                promise.reject(E_INVALID_ARGUMENT, "videoTrackId must be a non-negative integer (got $videoTrackId).")
                return
            }
            if (!shareContextRegistered) {
                promise.reject(
                    E_SHARE_CONTEXT,
                    "registerShareContext() was never called. Nosmai's textures are not " +
                        "shareable with Agora, and the remote would be black.",
                )
                return
            }
            NosmaiAgoraNative.ensureLoaded()?.let {
                promise.reject(E_START_FAILED, "libnosmai_agora_bridge.so failed to load: ${it.message}", it)
                return
            }

            val engineHandle = try {
                resolveRtcEngineHandle()
            } catch (t: Throwable) {
                promise.reject(E_AGORA_UNAVAILABLE, t.message ?: "react-native-agora is unavailable", t)
                return
            }

            val result = IntArray(1)
            val me = NosmaiAgoraNative.resolveMediaEngine(engineHandle, result)
            if (me == 0L) {
                promise.reject(
                    E_AGORA_UNAVAILABLE,
                    "Could not reach Agora's media engine (rc=${result[0]}). Create and " +
                        "initialize the engine with react-native-agora first.",
                )
                return
            }

            val p = NosmaiAgoraTexturePusher(me, trackId)
            try {
                p.start()
            } catch (t: Throwable) {
                p.release()
                NosmaiAgoraNative.releaseMediaEngine(me)
                promise.reject(E_START_FAILED, "startStreaming failed: ${t.message}", t)
                return
            }
            mediaEngine = me
            pusher = p
            this.videoTrackId = trackId
            promise.resolve(null)
        }
    }

    /**
     * The agora::rtc::IRtcEngine* behind react-native-agora's engine, read natively.
     *
     * Not from JS: `engine.getNativeHandle()` returns a JS number, and Android 11+ tags the
     * top byte of heap pointers (0xB4...), so the double JS receives has already lost the
     * low bits. Asking Iris here keeps all 64.
     */
    private fun resolveRtcEngineHandle(): Long {
        val module = reactApplicationContext.getNativeModule(AgoraRtcNgModule::class.java)
            ?: reactApplicationContext.getNativeModule(AgoraRtcNgModule.NAME) as? AgoraRtcNgModule
            ?: throw IllegalStateException("react-native-agora's AgoraRtcNg module is not registered.")
        val json = synchronized(module.irisApiLock) {
            val iris = module.irisApiEngine
                ?: throw IllegalStateException(
                    "react-native-agora has no engine yet. Call createAgoraRtcEngine() and " +
                        "initialize() before startStreaming().",
                )
            iris.callIrisApi("RtcEngine_getNativeHandle", "{}", null as List<ByteArray>?)
        }
        val digits = RESULT_NUMBER.find(json)?.groupValues?.get(1)
            ?: throw IllegalStateException("Unexpected RtcEngine_getNativeHandle result: $json")
        // Unsigned-safe: tagged pointers exceed Long.MAX_VALUE when printed as uint64.
        val handle = BigInteger(digits).toLong()
        if (handle == 0L) {
            throw IllegalStateException(
                "Agora engine handle is 0. Call engine.initialize() before startStreaming().",
            )
        }
        return handle
    }

    // ── stopStreaming ──────────────────────────────────────────────────

    /**
     * Stop producing, then release the media engine reference. Idempotent, never rejects.
     * Must run BEFORE the app calls engine.release(): afterwards the media engine pointer
     * dangles.
     */
    override fun stopStreaming(promise: Promise) {
        stopInternal()
        promise.resolve(null)
    }

    private fun stopInternal() {
        synchronized(lock) {
            val p = pusher ?: return
            pusher = null
            p.release()
            last = statsOf(p, streaming = false)
            if (mediaEngine != 0L) {
                NosmaiAgoraNative.releaseMediaEngine(mediaEngine)
                mediaEngine = 0L
            }
            Log.i(TAG, "stopped: pushed=${p.pushed.get()} dropped=${p.dropped.get()} failed=${p.failed.get()}")
            videoTrackId = -1
        }
    }

    override fun isStreaming(promise: Promise) {
        synchronized(lock) { promise.resolve(pusher != null) }
    }

    override fun getStats(promise: Promise) {
        synchronized(lock) {
            val p = pusher
            promise.resolve(if (p != null) statsOf(p, streaming = true) else last.copy())
        }
    }

    private fun statsOf(p: NosmaiAgoraTexturePusher, streaming: Boolean) = Arguments.createMap().apply {
        putBoolean("streaming", streaming)
        putDouble("videoTrackId", videoTrackId.toDouble())
        putDouble("pushed", p.pushed.get().toDouble())
        putDouble("dropped", p.dropped.get().toDouble())
        putDouble("failed", p.failed.get().toDouble())
        putDouble("lastResult", p.lastResult.toDouble())
        putDouble("width", p.width.toDouble())
        putDouble("height", p.height.toDouble())
        putString("inputMode", "texture2d")
    }

    override fun invalidate() {
        // A Metro reload must not leave the old instance's callback armed.
        stopInternal()
        super.invalidate()
    }
}
