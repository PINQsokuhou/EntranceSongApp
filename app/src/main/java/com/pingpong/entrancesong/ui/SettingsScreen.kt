package com.pingpong.entrancesong.ui

import android.content.Intent
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.pingpong.entrancesong.data.SyncManager
import com.pingpong.entrancesong.game.GameEngine

/** 設定画面: 球場名の既定値と、Google スプレッドシートへのエクスポート先URL */
@Composable
fun SettingsScreen(modifier: Modifier = Modifier) {
    GameEngine.tick
    val ctx = LocalContext.current
    var stadium by remember { mutableStateOf(GameEngine.settings.stadium) }
    var gasUrl by remember { mutableStateOf(GameEngine.settings.gasUrl) }
    var syncing by remember { mutableStateOf(false) }
    var syncStatus by remember { mutableStateOf("") }
    var confirmSync by remember { mutableStateOf(false) }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Text("設定", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = stadium,
            onValueChange = { stadium = it },
            label = { Text("球場名の既定値（試合開始前の入力欄に自動で入る）") },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))

        OutlinedTextField(
            value = gasUrl,
            onValueChange = { gasUrl = it },
            label = { Text("エクスポート先URL（Apps Script WebアプリのURL）") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 2
        )
        Spacer(Modifier.height(12.dp))

        Button(
            onClick = {
                GameEngine.settings.stadium = stadium.trim()
                GameEngine.settings.gasUrl = gasUrl.trim()
                GameEngine.saveSettings()
                Toast.makeText(ctx, "保存しました", Toast.LENGTH_SHORT).show()
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("保存") }

        Spacer(Modifier.height(16.dp))

        // 速報サイト: リアルタイム送信のON/OFF
        var live by remember { mutableStateOf(GameEngine.settings.liveEnabled) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("リアルタイム速報送信", style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.Bold)
                Text(
                    "試合中、1打席ごとに速報サイトへ送信します。" +
                            "速報サイトは上のURLをブラウザで開くと見られます（サークル員に共有可）",
                    style = MaterialTheme.typography.bodySmall
                )
            }
            Switch(checked = live, onCheckedChange = {
                live = it
                GameEngine.settings.liveEnabled = it
                GameEngine.saveSettings()
            })
        }

        Spacer(Modifier.height(24.dp))

        // アナウンス音声セクション
        Text("アナウンス音声", style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(
            "楽曲登録シートの同期で自動設定されます。端末のファイルから個別に設定することもできます。",
            style = MaterialTheme.typography.bodySmall
        )
        Spacer(Modifier.height(8.dp))

        AnnouncePicker(
            label = "自動スタート（2アウト・フルカウント・一塁走者あり）",
            currentName = GameEngine.settings.autoStartAnnounceName,
            onPicked = { uri, name ->
                GameEngine.settings.autoStartAnnounceUri = uri
                GameEngine.settings.autoStartAnnounceName = name
                GameEngine.saveSettings()
            },
            onClear = {
                GameEngine.settings.autoStartAnnounceUri = ""
                GameEngine.settings.autoStartAnnounceName = ""
                GameEngine.saveSettings()
            }
        )
        val firstCount = GameEngine.settings.changeAnnounceFirstUris.count { it.isNotBlank() }
        val secondCount = GameEngine.settings.changeAnnounceSecondUris.count { it.isNotBlank() }
        val orderCount = GameEngine.settings.orderAnnounceUris.count { it.isNotBlank() }
        val pitchChangeCount = listOf(
            GameEngine.settings.pitchChangeFirstFrontUri,
            GameEngine.settings.pitchChangeFirstBackUri,
            GameEngine.settings.pitchChangeSecondFrontUri,
            GameEngine.settings.pitchChangeSecondBackUri
        ).count { it.isNotBlank() }
        if (firstCount > 0 || secondCount > 0 || orderCount > 0) {
            Text(
                "チェンジアナウンス: 先攻${firstCount}回分 / 後攻${secondCount}回分 / 打順${orderCount}番分（同期済み）",
                style = MaterialTheme.typography.bodySmall
            )
        } else {
            Text(
                "チェンジアナウンス: 楽曲登録シートの同期で設定（回・打順ごとに個別設定可）",
                style = MaterialTheme.typography.bodySmall
            )
        }
        if (pitchChangeCount > 0) {
            Text(
                "投手交代アナウンス: ${pitchChangeCount}/4トラック（同期済み）",
                style = MaterialTheme.typography.bodySmall
            )
        }

        Spacer(Modifier.height(24.dp))

        // #3 サークル共有: メンバー・楽曲を同期
        Text("メンバー・楽曲の同期", style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(
            "共有スプレッドシートの「楽曲登録」シートと共有Driveから、メンバー（名前・フリガナ・左右）と" +
                    "登場曲を一括で取得します。現在のメンバー一覧は置き換えられます。",
            style = MaterialTheme.typography.bodySmall
        )
        Spacer(Modifier.height(8.dp))
        OutlinedButton(
            onClick = { confirmSync = true },
            enabled = !syncing && !GameEngine.state.started,
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (syncing) "同期中…" else "メンバー・楽曲を同期") }
        if (GameEngine.state.started) {
            Text("※ 試合中は同期できません", style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.error)
        }
        if (syncStatus.isNotBlank()) {
            Spacer(Modifier.height(6.dp))
            Text(syncStatus, style = MaterialTheme.typography.bodySmall)
        }

        Spacer(Modifier.height(24.dp))
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp)) {
                Text("スプレッドシート連携の設定手順", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(8.dp))
                Text(
                    "1. 記録用スプレッドシート（2026春夏）を開く\n" +
                            "2. 拡張機能 → Apps Script を開く\n" +
                            "3. プロジェクトの README.md にある GAS スクリプトを貼り付けて保存\n" +
                            "4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」\n" +
                            "   ・次のユーザーとして実行: 自分\n" +
                            "   ・アクセスできるユーザー: 全員\n" +
                            "5. 発行された WebアプリURL を上の欄に貼り付けて保存\n\n" +
                            "試合終了時に、その日付の新しいシートを作成して既存の試合と同じ形式で記録し、" +
                            "「全試合経過」と該当月の「◯月月間試合経過」へも同じ行を追記します。" +
                            "送信に失敗した場合は履歴画面から再送できます。",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        }
    }

    if (confirmSync) {
        AlertDialog(
            onDismissRequest = { confirmSync = false },
            title = { Text("メンバー・楽曲を同期") },
            text = {
                Text(
                    "共有スプレッドシート＋Driveから最新のメンバーと楽曲を取得し、" +
                            "この端末のメンバー一覧を置き換えます。楽曲のダウンロードに時間がかかる場合があります。"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    confirmSync = false
                    // 最新のURLを保存してから同期
                    GameEngine.settings.gasUrl = gasUrl.trim()
                    GameEngine.saveSettings()
                    syncing = true
                    syncStatus = "同期を開始しています…"
                    SyncManager.sync(
                        ctx, GameEngine.settings.gasUrl,
                        onProgress = { syncStatus = it },
                        onDone = { ok, msg, members ->
                            syncing = false
                            syncStatus = msg
                            if (ok && members != null) {
                                GameEngine.replaceMembersFromSync(members)
                                Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
                            } else {
                                Toast.makeText(ctx, msg, Toast.LENGTH_LONG).show()
                            }
                        }
                    )
                }) { Text("同期する") }
            },
            dismissButton = {
                TextButton(onClick = { confirmSync = false }) { Text("キャンセル") }
            }
        )
    }
}

@Composable
private fun AnnouncePicker(
    label: String,
    currentName: String,
    onPicked: (uri: String, name: String) -> Unit,
    onClear: () -> Unit
) {
    val ctx = LocalContext.current
    val picker = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        ctx.contentResolver.takePersistableUriPermission(
            uri, Intent.FLAG_GRANT_READ_URI_PERMISSION
        )
        var name = uri.lastPathSegment ?: "audio"
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c -> if (c.moveToFirst()) name = c.getString(0) }
        }
        onPicked(uri.toString(), name)
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        if (currentName.isNotBlank()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(currentName, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                TextButton(onClick = onClear) { Text("削除") }
            }
        }
        OutlinedButton(
            onClick = { picker.launch(arrayOf("audio/*")) },
            modifier = Modifier.fillMaxWidth()
        ) { Text(if (currentName.isBlank()) "音声を選択" else "変更") }
    }
}
