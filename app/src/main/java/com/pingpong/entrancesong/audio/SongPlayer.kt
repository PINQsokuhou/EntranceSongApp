package com.pingpong.entrancesong.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.Toast

/**
 * mp3再生（音源は15秒カット・末尾3秒フェード加工済みの前提。
 * ファイル終端で自動停止 = 仕様の「15秒経過で自動停止」）。
 * 手動停止は2秒フェードアウト（仕様書 4.2.C）。
 */
class SongPlayer(private val context: Context) {

    private var mp: MediaPlayer? = null
    private val handler = Handler(Looper.getMainLooper())

    /** 曲が最後まで自然に再生し終わったときに呼ばれる（手動停止では呼ばれない） */
    var onSongEnd: (() -> Unit)? = null

    val isPlaying: Boolean
        get() = runCatching { mp?.isPlaying == true }.getOrDefault(false)

    fun play(uriString: String) {
        stopNow()
        try {
            mp = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                        .build()
                )
                setDataSource(context, Uri.parse(uriString))
                setOnPreparedListener {
                    it.setVolume(1f, 1f)
                    it.start()
                }
                setOnCompletionListener {
                    // 自然終了: 先に後片付けしてからコールバック（コールバック内で次の曲を鳴らせる）
                    stopNow()
                    onSongEnd?.invoke()
                }
                setOnErrorListener { _, _, _ ->
                    stopNow()
                    true
                }
                prepareAsync()
            }
        } catch (e: Exception) {
            Toast.makeText(context, "再生できません: ${e.message}", Toast.LENGTH_SHORT).show()
            stopNow()
        }
    }

    /** 2秒かけてフェードアウトして停止。onDone は完全に消音・停止した後に呼ばれる */
    fun fadeOutStop(durationMs: Long = 2000, onDone: (() -> Unit)? = null) {
        val p = mp ?: run {
            onDone?.invoke()
            return
        }
        if (!isPlaying) {
            stopNow()
            onDone?.invoke()
            return
        }
        val steps = 20
        val interval = durationMs / steps
        var remaining = steps
        val r = object : Runnable {
            override fun run() {
                remaining--
                val v = remaining / steps.toFloat()
                runCatching { p.setVolume(v, v) }
                if (remaining > 0) {
                    handler.postDelayed(this, interval)
                } else {
                    stopNow()
                    onDone?.invoke()
                }
            }
        }
        handler.post(r)
    }

    fun stopNow() {
        handler.removeCallbacksAndMessages(null)
        runCatching {
            mp?.stop()
        }
        runCatching { mp?.release() }
        mp = null
    }
}
