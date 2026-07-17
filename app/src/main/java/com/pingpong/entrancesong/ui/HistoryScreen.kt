package com.pingpong.entrancesong.ui

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pingpong.entrancesong.data.YoutubeTimestamps
import com.pingpong.entrancesong.game.GameEngine

/**
 * 履歴画面: 過去10試合分。YouTube概要欄にそのまま貼れるタイムスタンプ
 * （ハイライト + 各選手の打席開始時間）を表示・コピーできる。
 */
@Composable
fun HistoryScreen(modifier: Modifier = Modifier) {
    GameEngine.tick
    var expanded by remember { mutableStateOf<Int?>(null) }

    Column(modifier.fillMaxSize().padding(16.dp)) {
        Text("試合履歴（最新${GameEngine.history.size}件 / 最大10件）",
            style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))

        if (GameEngine.history.isEmpty()) {
            Text("まだ履歴がありません。試合終了時に自動保存されます。",
                style = MaterialTheme.typography.bodyMedium)
            return@Column
        }

        // tick を含めてリストを作り直し、オフセット変更などが即時反映されるようにする
        val tick = GameEngine.tick
        val games = remember(tick) { GameEngine.history.reversed().withIndex().toList() }
        LazyColumn {
            items(games) { (i, game) ->
                GameEngine.tick // アイテム単位で変更を購読
                Card(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                        .clickable { expanded = if (expanded == i) null else i }
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Row {
                            Text(
                                "${game.date} ${game.stadium}",
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier.weight(1f)
                            )
                            Text(
                                if (game.exported) "送信済" else "未送信",
                                style = MaterialTheme.typography.labelMedium,
                                color = if (game.exported) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.error
                            )
                        }
                        Text(
                            "先攻 ${game.scoreFirst} - ${game.scoreSecond} 後攻" +
                                    "（試合時間 ${game.durationSec / 60}分${game.durationSec % 60}秒）",
                            style = MaterialTheme.typography.bodyMedium,
                            fontWeight = FontWeight.Bold
                        )

                        if (expanded == i) {
                            if (!game.exported) {
                                TextButton(onClick = { GameEngine.exportGame(game) }) {
                                    Text("スプレッドシートへ再送信")
                                }
                            }

                            // ── タイムスタンプずれ補正（動画開始と記録開始のずれ吸収）──
                            Spacer(Modifier.height(6.dp))
                            Text("タイムスタンプ補正（動画開始とのずれ調整）",
                                style = MaterialTheme.typography.labelLarge)
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                OffsetButton("−10") { shiftOffset(game, -10) }
                                OffsetButton("−1") { shiftOffset(game, -1) }
                                Text(
                                    YoutubeTimestamps.formatOffset(game.tsOffsetSec),
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 8.dp)
                                )
                                OffsetButton("+1") { shiftOffset(game, 1) }
                                OffsetButton("+10") { shiftOffset(game, 10) }
                                Spacer(Modifier.weight(1f))
                                TextButton(onClick = { shiftOffset(game, -game.tsOffsetSec) }) {
                                    Text("リセット")
                                }
                            }
                            // mm:ss 直接入力
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                var mmssInput by remember(game.tsOffsetSec) {
                                    mutableStateOf(offsetToMmss(game.tsOffsetSec))
                                }
                                OutlinedTextField(
                                    value = mmssInput,
                                    onValueChange = { v ->
                                        mmssInput = v.filter { it == '-' || it == ':' || it.isDigit() }
                                    },
                                    label = { Text("mm:ss で入力（例: 1:30, -0:45）") },
                                    modifier = Modifier.weight(1f),
                                    singleLine = true,
                                    keyboardOptions = KeyboardOptions(
                                        keyboardType = KeyboardType.Number,
                                        imeAction = ImeAction.Done
                                    ),
                                    keyboardActions = KeyboardActions(
                                        onDone = {
                                            parseMmss(mmssInput)?.let { sec ->
                                                game.tsOffsetSec = sec
                                                GameEngine.persist()
                                            }
                                        }
                                    )
                                )
                                Spacer(Modifier.padding(start = 8.dp))
                                Button(onClick = {
                                    parseMmss(mmssInput)?.let { sec ->
                                        game.tsOffsetSec = sec
                                        GameEngine.persist()
                                    }
                                }) { Text("適用") }
                            }

                            // ── YouTube概要欄用テキスト ──
                            val tsText = YoutubeTimestamps.build(game)
                            CopyButton(tsText)
                            Spacer(Modifier.height(6.dp))
                            Text(
                                tsText,
                                style = MaterialTheme.typography.bodySmall,
                                fontFamily = FontFamily.Monospace,
                                fontSize = 12.sp,
                                lineHeight = 17.sp
                            )

                            // ── 投手成績 ──
                            if (game.pitcherStats.isNotEmpty()) {
                                Spacer(Modifier.height(10.dp))
                                Text("投手成績", style = MaterialTheme.typography.labelLarge)
                                game.pitcherStats.forEach { p ->
                                    val marks = buildList {
                                        if (p.starter) add("先発")
                                        if (p.win) add("勝")
                                        if (p.loss) add("敗")
                                        if (p.hold) add("H")
                                        if (p.save) add("S")
                                    }.joinToString("・")
                                    Text(
                                        "${p.name}（${p.team}）失点${p.runs} 自責${p.earnedRuns}" +
                                                if (marks.isNotEmpty()) "  $marks" else "",
                                        style = MaterialTheme.typography.bodySmall
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private fun shiftOffset(game: com.pingpong.entrancesong.data.HistoryGame, delta: Long) {
    game.tsOffsetSec += delta
    GameEngine.persist()
}

private fun offsetToMmss(sec: Long): String {
    val sign = if (sec < 0) "-" else ""
    val abs = kotlin.math.abs(sec)
    return "%s%d:%02d".format(sign, abs / 60, abs % 60)
}

private fun parseMmss(input: String): Long? {
    val trimmed = input.trim()
    if (trimmed.isEmpty()) return null
    val negative = trimmed.startsWith("-")
    val body = trimmed.removePrefix("-").removePrefix("+")
    val parts = body.split(":")
    val totalSec = when (parts.size) {
        1 -> parts[0].toLongOrNull() ?: return null
        2 -> {
            val m = parts[0].toLongOrNull() ?: return null
            val s = parts[1].toLongOrNull() ?: return null
            m * 60 + s
        }
        else -> return null
    }
    return if (negative) -totalSec else totalSec
}

@Composable
private fun OffsetButton(label: String, onClick: () -> Unit) {
    TextButton(onClick = onClick) { Text(label) }
}

@Composable
private fun CopyButton(text: String) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    Button(
        onClick = {
            val cm = ctx.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("timestamps", text))
            Toast.makeText(ctx, "コピーしました。YouTubeの概要欄に貼り付けてください", Toast.LENGTH_SHORT).show()
        },
        modifier = Modifier.fillMaxWidth()
    ) { Text("概要欄用テキストをコピー") }
}
