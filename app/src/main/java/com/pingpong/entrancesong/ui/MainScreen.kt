package com.pingpong.entrancesong.ui

import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pingpong.entrancesong.data.Member
import com.pingpong.entrancesong.data.Team
import com.pingpong.entrancesong.game.GameEngine
import com.pingpong.entrancesong.game.Scorebook
import kotlinx.coroutines.delay

/**
 * メイン進行画面（仕様書 6-1, 5.2）。
 * スコアブック入力（カウント・結果）と登場曲操作を1画面に統合する。
 */
@Composable
fun MainScreen(modifier: Modifier = Modifier) {
    GameEngine.tick // 状態変更で再描画
    val st = GameEngine.state
    val ctx = LocalContext.current

    var pitcherDialogFor by remember { mutableStateOf<Member?>(null) }
    var confirmPitcherChange by remember { mutableStateOf<Member?>(null) }
    var confirmEnd by remember { mutableStateOf(false) }
    var pickSecondStarter by remember { mutableStateOf(false) }
    var stadiumDialog by remember { mutableStateOf(false) }

    // 試合タイマー表示の1秒更新
    var timerSec by remember { mutableLongStateOf(0L) }
    LaunchedEffect(st.started) {
        while (st.started) {
            timerSec = GameEngine.elapsedSec()
            delay(1000)
        }
    }

    Column(modifier.fillMaxSize().padding(12.dp)) {

        // ── ヘッダー: イニング / タイマー / 試合終了 ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                if (st.started) "${st.inning}回${if (st.attacking == Team.FIRST) "表" else "裏"}"
                else "試合開始前",
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.width(8.dp))
            if (st.started) {
                Text(formatTime(timerSec), style = MaterialTheme.typography.titleMedium)
            }
            Spacer(Modifier.weight(1f))
            if (st.started) {
                TextButton(onClick = { confirmEnd = true }) { Text("試合終了") }
            }
        }

        // ── スコア + 塁ダイヤ + S/B/O カウント（野球中継スタイル） ──
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "先攻 ${st.scoreFirst} - ${st.scoreSecond} 後攻",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(Modifier.weight(1f))
            if (st.started) {
                // 10: 塁状況をひし形で表示
                BasesDiamond(st.bases)
                Spacer(Modifier.width(12.dp))
                // 11: S/B/O を色付きの球の数で表示
                Column {
                    CountDots("B", st.balls, 3, Color(0xFF1565C0))
                    CountDots("S", st.strikes, 2, Color(0xFFF9A825))
                    CountDots("O", st.outs, 2, Color(0xFFD32F2F))
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        // ── 現在の打者 + カウント ──
        val order = GameEngine.orderOf(st.attacking)
        val idx = GameEngine.indexOf(st.attacking)
        val current = if (idx in order.indices) GameEngine.memberById(order[idx]) else null
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text(
                            current?.name ?: "―",
                            style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold
                        )
                        if (current != null) {
                            Text(
                                "通算 ${GameEngine.countOf(current)} 打席目（${current.batSide.label}打）",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                    if (st.started) {
                        Text("${st.pitchCount} 球", style = MaterialTheme.typography.bodySmall)
                    }
                }
                // 投手・次打者情報
                if (st.started) {
                    val pitcher = GameEngine.currentPitcher()
                    Text(
                        "投手: ${pitcher?.name ?: "未設定"}" +
                                if (st.pitcherInterrupt) "  ♪投手曲 割り込み中" else "",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (st.pitcherInterrupt) MaterialTheme.colorScheme.error
                        else MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (order.isNotEmpty()) {
                        val ni = (idx + 1).mod(order.size)
                        GameEngine.memberById(order[ni])?.let { next ->
                            val nc = GameEngine.countOf(next) + 1
                            val song = GameEngine.songForCount(next, nc)
                            Text(
                                "次: ${next.name}（${nc}打席目）♪ ${song?.name ?: "曲未登録"}",
                                style = MaterialTheme.typography.bodySmall
                            )
                        }
                    }
                }
            }
        }
        Spacer(Modifier.height(8.dp))

        if (!st.started) {
            // ── 試合開始前: 球場 + 後攻先発投手の設定 + 開始ボタン ──
            OutlinedButton(onClick = { stadiumDialog = true }, Modifier.fillMaxWidth()) {
                Text(
                    if (st.stadiumConfirmed && st.stadium.isNotBlank()) "球場: ${st.stadium}"
                    else "球場: 未設定（タップで入力）"
                )
            }
            Spacer(Modifier.height(8.dp))
            val starter = GameEngine.memberById(st.pitcherOfSecond)
            OutlinedButton(onClick = { pickSecondStarter = true }, Modifier.fillMaxWidth()) {
                Text("後攻 先発投手: ${starter?.name ?: "未設定（タップで選択）"}")
            }
            Spacer(Modifier.height(8.dp))
            val first = st.firstOrder.firstOrNull()?.let { GameEngine.memberById(it) }
            Text(
                if (first != null) "▶ を押すと試合開始（先攻1番: ${first.name}）"
                else "打順タブで先攻・後攻の打順（各3人以上）を設定してください",
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(Modifier.height(8.dp))
        } else {
            // ── カウントボタン（4.2.B）1: ストライク=黄 / ボール=青 / ファール=紫 ──
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CountButton("ボール", Color(0xFF1565C0), Modifier.weight(1f)) { GameEngine.addBall() }
                CountButton("ストライク", Color(0xFFF9A825), Modifier.weight(1f),
                    textColor = Color(0xFF212121)) { GameEngine.addStrike() }
                CountButton("ファール", Color(0xFFD7C9A0), Modifier.weight(1f),
                    textColor = Color(0xFF5D4037)) { GameEngine.addFoul() }
            }
            Spacer(Modifier.height(6.dp))

            // ── 結果ボタン（4.2.C）1: ヒット=緑 / アウト=赤 ──
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                CountButton("ヒット", Color(0xFF2E7D32), Modifier.weight(1f)) { GameEngine.beginResult(Scorebook.RESULT_HIT) }
                CountButton("アウト", Color(0xFFC62828), Modifier.weight(1f)) { GameEngine.beginResult(Scorebook.RESULT_OUT) }
                ResultButton("エラー", Modifier.weight(1f)) { GameEngine.beginResult(Scorebook.RESULT_ERROR) }
                ResultButton("nHnE", Modifier.weight(1f)) { GameEngine.beginResult(Scorebook.RESULT_NHNE) }
            }
            Spacer(Modifier.height(6.dp))
            // 3: 「犠牲」ボタンは廃止（犠飛はフライアウトのタッチアップ確認で表現できる）
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                ResultButton("死球", Modifier.weight(1f)) { GameEngine.beginResult(Scorebook.RESULT_HBP) }
                ResultButton("妨害", Modifier.weight(1f)) { GameEngine.beginResult(Scorebook.RESULT_INTERFERE) }
                // スクイズは三塁走者あり・満塁でない・0/1アウトのときだけ出す
                if (Scorebook.isSqueezeSituation(st.bases, st.outs)) {
                    Button(
                        onClick = { GameEngine.beginResult(Scorebook.RESULT_SQUEEZE) },
                        colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFE65100)),
                        modifier = Modifier.weight(1f)
                    ) { Text("スクイズ", fontSize = 13.sp) }
                } else {
                    Spacer(Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(8.dp))
        }

        // ── 操作ボタン（前/次の曲・チェンジの画面ボタンは廃止。チェンジはリモコン前トラック長押し） ──
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            OutlinedButton(
                onClick = { GameEngine.undoLast() },
                enabled = st.started && st.pending == null && GameEngine.canUndo,
                modifier = Modifier.weight(1f)
            ) { Text("◀ 前の球") }
            Button(
                onClick = {
                    if (!st.started) GameEngine.startGame() else GameEngine.stopWithFade()
                },
                modifier = Modifier.weight(1f)
            ) { Text(if (!st.started) "▶ 試合開始" else "■ 停止") }
        }

        Spacer(Modifier.height(8.dp))

        // ── 守備チーム（タップで投手交代 + 投手曲 4.2.F） ──
        Text("守備チーム（名前タップで投手交代の確認）", style = MaterialTheme.typography.labelMedium)
        val defense = GameEngine.orderOf(GameEngine.defendingTeam())
        val currentPitcherId = GameEngine.currentPitcher()?.id
        LazyColumn(Modifier.weight(1f)) {
            items(defense.distinct()) { id ->
                GameEngine.tick // アイテム単位で変更を購読（リスト内の再描画反映用）
                val m = GameEngine.memberById(id) ?: return@items
                Card(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp)
                        // 2: タップで即交代せず、確認ダイアログを挟む
                        .clickable(enabled = st.started) { confirmPitcherChange = m }
                ) {
                    Row(
                        Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            (if (id == currentPitcherId) "⚾ " else "") + m.name,
                            style = MaterialTheme.typography.bodyLarge,
                            fontWeight = if (id == currentPitcherId) FontWeight.Bold else FontWeight.Normal
                        )
                        Spacer(Modifier.weight(1f))
                        Text("投手曲 ${m.pitchingSongs.size}曲", style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }

    // ── ダイアログ群 ──

    // 打席結果の詳細入力（pending がある間は常に表示）
    st.pending?.let { ResultDetailDialog(it) }

    // 3ストライクの空振り/見逃し選択（曲は既に流れている）
    if (st.started && st.pending == null && st.awaitingStrikeoutChoice) {
        StrikeoutChoiceDialog()
    }

    // 1回裏開始時: 先攻チームの先発投手を入力（4.1）
    if (st.started && st.attacking == Team.SECOND && st.pitcherOfFirst == null && st.pending == null) {
        MemberPickerDialog(
            title = "先攻チームの先発投手を選択",
            onSelect = { m -> GameEngine.setPitcher(Team.FIRST, m.id) },
            onDismiss = { /* 必須入力 */ },
            candidateIds = st.firstOrder
        )
    }

    // 試合開始前: 球場の入力（打順を変えた場合は再入力を求める）
    if (stadiumDialog) {
        var name by remember {
            mutableStateOf(st.stadium.ifBlank { GameEngine.settings.stadium })
        }
        AlertDialog(
            onDismissRequest = { stadiumDialog = false },
            title = { Text("球場を入力") },
            text = {
                androidx.compose.material3.OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("球場名") },
                    modifier = Modifier.fillMaxWidth()
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    GameEngine.setStadium(name)
                    stadiumDialog = false
                }) { Text("決定") }
            },
            dismissButton = {
                TextButton(onClick = { stadiumDialog = false }) { Text("キャンセル") }
            }
        )
    }

    // 試合開始前: 後攻チームの先発投手
    if (pickSecondStarter) {
        MemberPickerDialog(
            title = "後攻チームの先発投手を選択",
            onSelect = { m ->
                GameEngine.setPitcher(Team.SECOND, m.id)
                pickSecondStarter = false
            },
            onDismiss = { pickSecondStarter = false },
            candidateIds = st.secondOrder
        )
    }

    // 2: 投手交代の確認ダイアログ（守備メンバー名タップ時）
    confirmPitcherChange?.let { m ->
        AlertDialog(
            onDismissRequest = { confirmPitcherChange = null },
            title = { Text("投手交代") },
            text = { Text("投手を ${m.name} に交代しますか？") },
            confirmButton = {
                TextButton(onClick = {
                    when {
                        m.pitchingSongs.isEmpty() -> {
                            GameEngine.changePitcherSilently(m)
                            Toast.makeText(ctx, "${m.name} に投手交代（投手曲未登録）", Toast.LENGTH_SHORT).show()
                        }
                        m.pitchingSongs.size == 1 -> GameEngine.playPitcherSong(m, m.pitchingSongs[0])
                        else -> pitcherDialogFor = m // 複数曲は曲選択へ
                    }
                    confirmPitcherChange = null
                }) { Text("交代する") }
            },
            dismissButton = {
                TextButton(onClick = { confirmPitcherChange = null }) { Text("キャンセル") }
            }
        )
    }

    // 投手曲選択ポップアップ（最大3曲）
    pitcherDialogFor?.let { m ->
        AlertDialog(
            onDismissRequest = { pitcherDialogFor = null },
            title = { Text("${m.name} の投手曲を選択") },
            text = {
                Column {
                    m.pitchingSongs.forEachIndexed { i, song ->
                        TextButton(onClick = {
                            GameEngine.playPitcherSong(m, song)
                            pitcherDialogFor = null
                        }) { Text("${i + 1}. ${song.name}") }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { pitcherDialogFor = null }) { Text("キャンセル") }
            }
        )
    }

    // 試合終了の確認
    if (confirmEnd) {
        AlertDialog(
            onDismissRequest = { confirmEnd = false },
            title = { Text("試合終了") },
            text = {
                Text(
                    "先攻 ${st.scoreFirst} - ${st.scoreSecond} 後攻\n" +
                            "投手成績を自動計算し、スプレッドシートへ送信して試合をリセットします。よろしいですか？"
                )
            },
            confirmButton = {
                TextButton(onClick = {
                    GameEngine.endGame()
                    confirmEnd = false
                }) { Text("終了する") }
            },
            dismissButton = {
                TextButton(onClick = { confirmEnd = false }) { Text("キャンセル") }
            }
        )
    }
}

@Composable
private fun CountButton(
    label: String,
    color: Color,
    modifier: Modifier = Modifier,
    textColor: Color = Color.White,
    onClick: () -> Unit
) {
    Button(
        onClick = onClick,
        colors = ButtonDefaults.buttonColors(containerColor = color, contentColor = textColor),
        modifier = modifier
    ) { Text(label, fontSize = 13.sp) }
}

@Composable
private fun ResultButton(label: String, modifier: Modifier = Modifier, onClick: () -> Unit) {
    OutlinedButton(onClick = onClick, modifier = modifier) { Text(label, fontSize = 13.sp) }
}

/** 10: 塁状況を野球中継風のひし形4つ（本塁+一二三塁）で表示 */
@Composable
private fun BasesDiamond(bases: List<Boolean>, modifier: Modifier = Modifier) {
    val occupied = Color(0xFFF9A825)
    val empty = Color(0xFFE0E0E0)
    val d = 16.dp
    Box(modifier.size(48.dp)) {
        // 二塁（上）
        BaseMark(if (bases.getOrElse(1) { false }) occupied else empty, d,
            Modifier.align(Alignment.TopCenter))
        // 三塁（左）
        BaseMark(if (bases.getOrElse(2) { false }) occupied else empty, d,
            Modifier.align(Alignment.CenterStart))
        // 一塁（右）
        BaseMark(if (bases.getOrElse(0) { false }) occupied else empty, d,
            Modifier.align(Alignment.CenterEnd))
        // 本塁（下・常に無色の枠）
        BaseMark(Color(0xFFBDBDBD), 12.dp, Modifier.align(Alignment.BottomCenter))
    }
}

/** ひし形1つ（45°回転した四角） */
@Composable
private fun BaseMark(color: Color, size: Dp, modifier: Modifier = Modifier) {
    Box(
        modifier
            .size(size)
            .rotate(45f)
            .background(color)
    )
}

/** 11: S/B/O を色付きの球で表示（点灯した球の数） */
@Composable
private fun CountDots(label: String, count: Int, max: Int, color: Color) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(
            label,
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.width(14.dp)
        )
        repeat(max) { i ->
            Spacer(Modifier.width(2.dp))
            Box(
                Modifier
                    .size(11.dp)
                    .background(if (i < count.coerceAtMost(max)) color else Color(0xFFDDDDDD), CircleShape)
            )
        }
    }
}

private fun formatTime(sec: Long): String = "%d:%02d".format(sec / 60, sec % 60)
