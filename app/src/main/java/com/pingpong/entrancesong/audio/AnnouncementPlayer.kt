package com.pingpong.entrancesong.audio

import android.content.Context
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.audiofx.LoudnessEnhancer
import android.net.Uri

/**
 * 入場曲（SongPlayer）と同時再生できるアナウンス専用プレーヤー。
 * playSequence() で複数の音声を順番に再生し、全て終わったら onDone を呼ぶ。
 */
class AnnouncementPlayer(private val context: Context) {

    private var mp: MediaPlayer? = null
    private var nextMp: MediaPlayer? = null
    private var enhancer: LoudnessEnhancer? = null
    private var nextEnhancer: LoudnessEnhancer? = null
    private var queue: MutableList<String> = mutableListOf()
    private var doneCallback: (() -> Unit)? = null

    /** 音量ブースト（ミリベル単位。1050 = +10.5dB ≒ 振幅3.4倍） */
    var gainMb: Int = 1050

    /** 再生エラー時に呼ばれるコールバック（URI を渡す） */
    var onError: ((uri: String, error: String) -> Unit)? = null

    private val audioAttrs = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()

    fun play(uriString: String, onDone: (() -> Unit)? = null) {
        playSequence(listOf(uriString), onDone)
    }

    fun playSequence(uris: List<String>, onDone: (() -> Unit)? = null) {
        stop()
        queue = uris.filter { it.isNotBlank() }.toMutableList()
        doneCallback = onDone
        playNext()
    }

    private fun playNext() {
        if (queue.isEmpty()) {
            doneCallback?.invoke()
            doneCallback = null
            return
        }
        val uri = queue.removeAt(0)
        val prepared = nextMp
        if (prepared != null) {
            releaseEnhancer()
            mp = prepared
            enhancer = nextEnhancer
            nextMp = null
            nextEnhancer = null
            prepared.setOnCompletionListener { it.release(); mp = null; releaseEnhancer(); playNext() }
            prepared.setOnErrorListener { p, what, extra ->
                p.release(); mp = null; releaseEnhancer()
                onError?.invoke(uri, "MediaPlayer error ($what/$extra)")
                playNext(); true
            }
            prepared.start()
            prepareNext()
            return
        }
        try {
            mp = MediaPlayer().apply {
                setAudioAttributes(audioAttrs)
                setDataSource(context, Uri.parse(uri))
                setOnCompletionListener { it.release(); mp = null; releaseEnhancer(); playNext() }
                setOnErrorListener { p, what, extra ->
                    p.release(); mp = null; releaseEnhancer()
                    onError?.invoke(uri, "MediaPlayer error ($what/$extra)")
                    playNext(); true
                }
                setOnPreparedListener {
                    applyGain(it)
                    it.start()
                    prepareNext()
                }
                prepareAsync()
            }
        } catch (e: Exception) {
            mp = null
            onError?.invoke(uri, e.message ?: "setDataSource failed")
            playNext()
        }
    }

    private fun prepareNext() {
        val nextUri = queue.firstOrNull() ?: return
        try {
            nextMp = MediaPlayer().apply {
                setAudioAttributes(audioAttrs)
                setDataSource(context, Uri.parse(nextUri))
                setOnPreparedListener { applyGainToNext(it) }
                setOnErrorListener { p, _, _ -> p.release(); nextMp = null; releaseNextEnhancer(); true }
                prepareAsync()
            }
        } catch (_: Exception) { nextMp = null }
    }

    private fun applyGain(player: MediaPlayer) {
        try {
            releaseEnhancer()
            enhancer = LoudnessEnhancer(player.audioSessionId).apply {
                setTargetGain(gainMb)
                enabled = true
            }
        } catch (_: Exception) { }
    }

    private fun applyGainToNext(player: MediaPlayer) {
        try {
            releaseNextEnhancer()
            nextEnhancer = LoudnessEnhancer(player.audioSessionId).apply {
                setTargetGain(gainMb)
                enabled = true
            }
        } catch (_: Exception) { }
    }

    private fun releaseEnhancer() {
        runCatching { enhancer?.release() }
        enhancer = null
    }

    private fun releaseNextEnhancer() {
        runCatching { nextEnhancer?.release() }
        nextEnhancer = null
    }

    fun stop() {
        queue.clear()
        doneCallback = null
        runCatching { mp?.stop() }
        runCatching { mp?.release() }
        mp = null
        releaseEnhancer()
        runCatching { nextMp?.release() }
        nextMp = null
        releaseNextEnhancer()
    }
}
