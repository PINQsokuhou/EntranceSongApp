package com.pingpong.entrancesong

import android.app.Application
import com.pingpong.entrancesong.game.GameEngine

class EntranceApp : Application() {
    override fun onCreate() {
        super.onCreate()
        GameEngine.init(this)
    }
}
