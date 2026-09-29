package com.nosmai.agorabridge

import android.opengl.GLES20
import android.opengl.GLES30
import android.os.SystemClock
import android.util.Log
import com.nosmai.effect.api.NosmaiSDK
import io.agora.base.TextureBufferHelper
import io.agora.rtc2.gl.EglBaseProvider
import java.util.concurrent.Callable
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

/**
 * One stream's worth of Nosmai texture -> Agora custom video track.
 *
 * A port of the Flutter Agora bridge's texture bridge (`AgoraTextureBridge`) with one change: the push goes through
 * Agora's C++ `IMediaEngine::pushVideoFrame` (via JNI) instead of the Java `RtcEngine`,
 * which react-native-agora never creates. Everything else — and every rule — carries over:
 *
 *  1. GL work runs inside [TextureBufferHelper.invoke], on the helper's GL thread with its
 *     context current. Its context is in Agora's root EGL share group, which is also the
 *     group Nosmai joined in `registerShareContext`, so Nosmai's texture ids are legible.
 *  2. Never `invoke` from Nosmai's render thread — it blocks the caller and freezes the
 *     preview. A dedicated worker blocks instead.
 *  3. Push a copy, never Nosmai's live texture: blit into a 3-slot ring we own.
 *  4. Flip Y in the blit and push an identity matrix.
 *  5. Single-flight: a frame that arrives while one is in flight is dropped, never queued,
 *     so Nosmai's GL worker (which renders the filter) can never back up behind us.
 *  6. `releaseStreamSlot` runs exactly once per Nosmai frame, on every path. Leaking one
 *     starves Nosmai's 4-deep producer ring and the stream freezes with no error.
 *
 * Changed from the Flutter bridge: `glFinish` instead of `glFlush`. There, the encoder sampled on
 * the helper thread itself, so command order was enough. Here Agora samples the texture
 * from its own context on its own thread, which only sees completed GL work. The cost is
 * one blit's GPU time on this helper thread, never on Nosmai's.
 *
 * Created in start, released in stop — never kept across streams (the "second go-live
 * freezes, then goes black" bug).
 */
internal class NosmaiAgoraTexturePusher(
    private val mediaEngine: Long,
    private val videoTrackId: Int,
) {
    companion object {
        private const val TAG = "NosmaiAgoraBridge"
        private const val RING = 3
    }

    private var helper: TextureBufferHelper? = null
    private var eglContextHandle = 0L

    private val tex = IntArray(RING)
    private val fbo = IntArray(RING)
    private var srcFbo = 0
    private var ringW = 0
    private var ringH = 0
    private var nextSlot = 0

    private val worker: ExecutorService =
        Executors.newSingleThreadExecutor { r -> Thread(r, "nosmai-agora-push") }
    private val inFlight = AtomicBoolean(false)
    @Volatile private var armed = false
    @Volatile private var previousRenderMode: NosmaiSDK.RenderMode? = null

    val pushed = AtomicLong(0)
    val dropped = AtomicLong(0)
    val failed = AtomicLong(0)
    @Volatile var lastResult = 0
        private set
    @Volatile var width = 0
        private set
    @Volatile var height = 0
        private set

    /** Creates the helper and arms both Nosmai gates. Throws on failure, leaving nothing armed. */
    fun start() {
        val root = EglBaseProvider.instance().rootEglBase.eglBaseContext
        val h = TextureBufferHelper.create("nosmai-rn-agora", root)
            ?: throw IllegalStateException("TextureBufferHelper.create returned null")
        helper = h
        eglContextHandle = h.eglBase.eglBaseContext.nativeEglContext
        if (eglContextHandle == 0L) {
            release()
            throw IllegalStateException("Agora helper has no EGL14 context")
        }

        // Two independent gates — arming only one produces zero frames with no error.
        // Restore whatever mode was in place on stop rather than forcing PREVIEW_ONLY, so
        // the camera SDK's own frame stream (which also uses DUAL_OUTPUT) is not cut off.
        previousRenderMode = runCatching { NosmaiSDK.getRenderMode() }.getOrNull()
        armed = true
        NosmaiSDK.setRenderMode(NosmaiSDK.RenderMode.DUAL_OUTPUT)
        NosmaiSDK.setTextureFrameCallback { texId, w, h2, tsNs, _ -> onFrame(texId, w, h2, tsNs) }
        Log.i(TAG, "armed: track=$videoTrackId egl=0x${java.lang.Long.toHexString(eglContextHandle)}")
    }

    /**
     * Stop producing, then tear down the consumer (teardown order invariant). Idempotent.
     * The caller releases the media engine only after this returns.
     */
    fun release() {
        if (armed) {
            armed = false
            runCatching { NosmaiSDK.setTextureFrameCallback(null) }
            val restore = previousRenderMode
                ?.takeIf { it != NosmaiSDK.RenderMode.STREAMING_ONLY }
                ?: NosmaiSDK.RenderMode.PREVIEW_ONLY
            runCatching { NosmaiSDK.setRenderMode(restore) }
        }
        worker.shutdown()
        // Drain the in-flight push so nothing touches the media engine after we return.
        runCatching { worker.awaitTermination(500, java.util.concurrent.TimeUnit.MILLISECONDS) }
        val h = helper ?: return
        helper = null
        runCatching {
            h.invoke(Callable {
                if (tex[0] != 0) {
                    GLES20.glDeleteTextures(RING, tex, 0)
                    GLES20.glDeleteFramebuffers(RING, fbo, 0)
                    tex.fill(0)
                    fbo.fill(0)
                }
                if (srcFbo != 0) {
                    GLES20.glDeleteFramebuffers(1, intArrayOf(srcFbo), 0)
                    srcFbo = 0
                }
                null
            })
        }
        runCatching { h.dispose() }
    }

    // Nosmai's render thread. Must return fast and must release the slot exactly once.
    private fun onFrame(texId: Int, w: Int, h: Int, timestampNs: Long) {
        if (!armed || !inFlight.compareAndSet(false, true)) {
            if (armed) dropped.incrementAndGet()
            NosmaiSDK.releaseStreamSlot(texId)
            return
        }
        try {
            worker.execute { pushOnWorker(texId, w, h, timestampNs) }
        } catch (t: Throwable) {
            // Executor shut down between the armed check and here.
            inFlight.set(false)
            NosmaiSDK.releaseStreamSlot(texId)
        }
    }

    private fun pushOnWorker(texId: Int, w: Int, h: Int, timestampNs: Long) {
        var sourceReleased = false
        try {
            val helper = this.helper ?: return
            helper.invoke(Callable {
                ensureRing(w, h)
                val slot = nextSlot
                nextSlot = (nextSlot + 1) % RING

                if (srcFbo == 0) {
                    val f = IntArray(1)
                    GLES20.glGenFramebuffers(1, f, 0)
                    srcFbo = f[0]
                }
                GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, srcFbo)
                GLES30.glFramebufferTexture2D(
                    GLES30.GL_READ_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0,
                    GLES20.GL_TEXTURE_2D, texId, 0,
                )
                GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, fbo[slot])
                // dst top/bottom swapped = Y flip (rule 4).
                GLES30.glBlitFramebuffer(0, 0, w, h, 0, h, w, 0, GLES20.GL_COLOR_BUFFER_BIT, GLES20.GL_NEAREST)
                GLES30.glFramebufferTexture2D(
                    GLES30.GL_READ_FRAMEBUFFER, GLES30.GL_COLOR_ATTACHMENT0,
                    GLES20.GL_TEXTURE_2D, 0, 0,
                )
                GLES30.glBindFramebuffer(GLES30.GL_READ_FRAMEBUFFER, 0)
                GLES30.glBindFramebuffer(GLES30.GL_DRAW_FRAMEBUFFER, 0)
                GLES20.glFinish()

                // The copy is complete: Nosmai's slot can go back before the push.
                NosmaiSDK.releaseStreamSlot(texId)
                sourceReleased = true

                if (!armed) return@Callable null
                val rc = NosmaiAgoraNative.pushTexture(
                    mediaEngine, videoTrackId, tex[slot], eglContextHandle, w, h,
                    timestampNs / 1_000_000L,
                )
                lastResult = rc
                if (rc == 0) {
                    pushed.incrementAndGet()
                } else if (failed.incrementAndGet() % 60 == 1L) {
                    Log.w(TAG, "pushVideoFrame rc=$rc (track=$videoTrackId)")
                }
                null
            })
        } catch (t: Throwable) {
            failed.incrementAndGet()
            Log.e(TAG, "push failed", t)
        } finally {
            if (!sourceReleased) NosmaiSDK.releaseStreamSlot(texId)
            inFlight.set(false)
        }
    }

    /** Helper thread only. */
    private fun ensureRing(w: Int, h: Int) {
        if (ringW == w && ringH == h && tex[0] != 0) return
        if (tex[0] != 0) {
            GLES20.glDeleteTextures(RING, tex, 0)
            GLES20.glDeleteFramebuffers(RING, fbo, 0)
        }
        GLES20.glGenTextures(RING, tex, 0)
        GLES20.glGenFramebuffers(RING, fbo, 0)
        for (i in 0 until RING) {
            GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, tex[i])
            GLES20.glTexImage2D(
                GLES20.GL_TEXTURE_2D, 0, GLES20.GL_RGBA, w, h, 0,
                GLES20.GL_RGBA, GLES20.GL_UNSIGNED_BYTE, null,
            )
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glTexParameteri(GLES20.GL_TEXTURE_2D, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE)
            GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, fbo[i])
            GLES20.glFramebufferTexture2D(
                GLES20.GL_FRAMEBUFFER, GLES20.GL_COLOR_ATTACHMENT0,
                GLES20.GL_TEXTURE_2D, tex[i], 0,
            )
        }
        GLES20.glBindTexture(GLES20.GL_TEXTURE_2D, 0)
        GLES20.glBindFramebuffer(GLES20.GL_FRAMEBUFFER, 0)
        ringW = w
        ringH = h
        width = w
        height = h
        Log.i(TAG, "ring ${w}x$h (t=${SystemClock.uptimeMillis()})")
    }
}
