package com.pingpong.entrancesong

import android.Manifest
import android.content.Intent
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SportsBaseball
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.pingpong.entrancesong.media.PlaybackService
import com.pingpong.entrancesong.ui.HistoryScreen
import com.pingpong.entrancesong.ui.MainScreen
import com.pingpong.entrancesong.ui.MemberScreen
import com.pingpong.entrancesong.ui.OrderEditScreen
import com.pingpong.entrancesong.ui.SettingsScreen

class MainActivity : ComponentActivity() {

    private val notifPermission =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        if (Build.VERSION.SDK_INT >= 33) {
            notifPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
        ContextCompat.startForegroundService(this, Intent(this, PlaybackService::class.java))

        setContent {
            MaterialTheme {
                AppRoot()
            }
        }
    }
}

@androidx.compose.runtime.Composable
private fun AppRoot() {
    var tab by remember { mutableIntStateOf(0) }
    Scaffold(
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = tab == 0, onClick = { tab = 0 },
                    icon = { Icon(Icons.Filled.SportsBaseball, null) }, label = { Text("試合") }
                )
                NavigationBarItem(
                    selected = tab == 1, onClick = { tab = 1 },
                    icon = { Icon(Icons.Filled.Edit, null) }, label = { Text("打順") }
                )
                NavigationBarItem(
                    selected = tab == 2, onClick = { tab = 2 },
                    icon = { Icon(Icons.Filled.People, null) }, label = { Text("メンバー") }
                )
                NavigationBarItem(
                    selected = tab == 3, onClick = { tab = 3 },
                    icon = { Icon(Icons.Filled.History, null) }, label = { Text("履歴") }
                )
                NavigationBarItem(
                    selected = tab == 4, onClick = { tab = 4 },
                    icon = { Icon(Icons.Filled.Settings, null) }, label = { Text("設定") }
                )
            }
        }
    ) { padding ->
        val m = Modifier.padding(padding)
        when (tab) {
            0 -> MainScreen(m)
            1 -> OrderEditScreen(m)
            2 -> MemberScreen(m)
            3 -> HistoryScreen(m)
            else -> SettingsScreen(m)
        }
    }
}
