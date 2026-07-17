package com.pingpong.entrancesong.media

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.support.v4.media.session.MediaSessionCompat
import android.support.v4.media.session.PlaybackStateCompat
import android.view.KeyEvent
import androidx.core.app.NotificationCompat
import com.pingpong.entrancesong.MainActivity
import com.pingpong.entrancesong.game.GameEngine

/**
 * ワイヤレスリモコン（Bluetoothメディアボタン）のハンドリング（仕様書 5.1）。
 * バックグラウンド・画面オフでもボタンを受け取るためフォアグラウンドサービスで
 * MediaSession を保持する。
 *
 * 前のトラック: ACTION_DOWN から1.5秒以上でチェンジ（長押し）、それ未満で短押し。
 * 試合開始前（started=false）はリモコン入力をすべて無視する（4.2.A）。
 */
class PlaybackService : Service() {

    private lateinit var session: MediaSessionCompat
    private val handler = Handler(Looper.getMainLooper())

    private var prevKeyDown = false
    private var longPressFired = false
    private val longPressRunnable = Runnable {
        longPressFired = true
        GameEngine.changeSides()
    }

    override fun onCreate() {
        super.onCreate()
        session = MediaSessionCompat(this, "EntranceSongSession")
        session.setCallback(object : MediaSessionCompat.Callback() {

            override fun onMediaButtonEvent(mediaButtonEvent: Intent): Boolean {
                @Suppress("DEPRECATION")
                val ke: KeyEvent = mediaButtonEvent.getParcelableExtra(Intent.EXTRA_KEY_EVENT)
                    ?: return false
                if (!GameEngine.state.started) return true // 試合開始前は無効

                when (ke.keyCode) {
                    KeyEvent.KEYCODE_MEDIA_NEXT -> {
                        if (ke.action == KeyEvent.ACTION_UP) GameEngine.nextBatter()
                    }

                    KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE,
                    KeyEvent.KEYCODE_MEDIA_PLAY,
                    KeyEvent.KEYCODE_MEDIA_PAUSE,
                    KeyEvent.KEYCODE_MEDIA_STOP -> {
                        // リモコンの再生・停止はフェードアウト停止のみ（試合開始トリガーではない）
                        if (ke.action == KeyEvent.ACTION_UP) GameEngine.stopWithFade()
                    }

                    KeyEvent.KEYCODE_MEDIA_PREVIOUS -> handlePrevKey(ke)

                    else -> return false
                }
                return true
            }

            // 一部機器はキーイベントでなくトランスポート操作として届くため両対応
            override fun onSkipToNext() {
                if (GameEngine.state.started) GameEngine.nextBatter()
            }

            override fun onSkipToPrevious() {
                if (GameEngine.state.started) GameEngine.prevShort()
            }

            override fun onPlay() {
                if (GameEngine.state.started) GameEngine.stopWithFade()
            }

            override fun onPause() {
                if (GameEngine.state.started) GameEngine.stopWithFade()
            }
        })
        updatePlaybackState()
        session.isActive = true

        val notification = buildNotification()
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun handlePrevKey(ke: KeyEvent) {
        when (ke.action) {
            KeyEvent.ACTION_DOWN -> {
                if (ke.repeatCount == 0) {
                    prevKeyDown = true
                    longPressFired = false
                    handler.postDelayed(longPressRunnable, LONG_PRESS_MS)
                }
            }

            KeyEvent.ACTION_UP -> {
                handler.removeCallbacks(longPressRunnable)
                if (!prevKeyDown) {
                    // DOWN が届かない機器のフォールバック: 短押し扱い
                    GameEngine.prevShort()
                } else if (!longPressFired) {
                    GameEngine.prevShort()
                }
                prevKeyDown = false
            }
        }
    }

    /**
     * リモコンからのメディアボタンを本アプリにルーティングさせるため、
     * セッションを常に「再生中」として広告する。
     */
    private fun updatePlaybackState() {
        val actions = PlaybackStateCompat.ACTION_PLAY_PAUSE or
                PlaybackStateCompat.ACTION_PLAY or
                PlaybackStateCompat.ACTION_PAUSE or
                PlaybackStateCompat.ACTION_STOP or
                PlaybackStateCompat.ACTION_SKIP_TO_NEXT or
                PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS
        session.setPlaybackState(
            PlaybackStateCompat.Builder()
                .setActions(actions)
                .setState(PlaybackStateCompat.STATE_PLAYING, 0L, 1f)
                .build()
        )
    }

    private fun buildNotification(): Notification {
        val channelId = "playback"
        if (Build.VERSION.SDK_INT >= 26) {
            val channel = NotificationChannel(channelId, "試合進行", NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
        }
        val pi = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        return NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setContentTitle("登場曲コントローラー")
            .setContentText("リモコン操作を待機中")
            .setContentIntent(pi)
            .setOngoing(true)
            .build()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        handler.removeCallbacksAndMessages(null)
        session.isActive = false
        session.release()
        super.onDestroy()
    }

    companion object {
        private const val NOTIFICATION_ID = 1
        private const val LONG_PRESS_MS = 1500L // 1.5秒以上で長押し（仕様書 5.1）
    }
}
