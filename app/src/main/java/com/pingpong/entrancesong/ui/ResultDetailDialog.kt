package com.pingpong.entrancesong.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pingpong.entrancesong.data.PendingResult
import com.pingpong.entrancesong.game.GameEngine
import com.pingpong.entrancesong.game.Scorebook

/** バット種類 r,d,y,t,i,w,b,o（色は記録員が見分けやすいよう実物の色に合わせる） */
private data class BatDef(
    val code: String,
    val label: String,
    val bg: Color,
    val fg: Color,
    val border: Color? = null,
    /** 2色バット（虎など）の背景。指定時は bg より優先 */
    val brush: Brush? = null
)

private val TIGER_YELLOW = Color(0xFFFDD835)
private val TIGER_BLACK = Color(0xFF212121)

private val BAT_DEFS = listOf(
    BatDef("r", "r 赤", Color(0xFFD32F2F), Color.White),
    BatDef("d", "d 竜", Color(0xFF1565C0), Color.White),          // ドラゴンズ=青
    BatDef("y", "y 黄", TIGER_YELLOW, Color.Black),
    // タイガース=黄と黒を横半分ずつ（黄バットと紛らわしくないように）。文字は白
    BatDef(
        "t", "t 虎", TIGER_YELLOW, Color.White,
        brush = Brush.horizontalGradient(
            0.0f to TIGER_YELLOW, 0.5f to TIGER_YELLOW, 0.5f to TIGER_BLACK, 1.0f to TIGER_BLACK
        )
    ),
    BatDef("i", "i 違反", Color(0xFFF57C00), Color.White),        // 違反=オレンジ
    BatDef("w", "w 白", Color.White, Color.Black, border = Color(0xFF9E9E9E)),
    BatDef("b", "b 黒", TIGER_BLACK, Color.White),
    BatDef("o", "o 他", Color(0xFF757575), Color.White)
)

/** 打球方向 0:投 1:左 2:左中 3:中 4:右中 5:右 6:ファール（色は付けない） */
private val DIR_FIELD = listOf(1 to "左", 2 to "左中", 3 to "中", 4 to "右中", 5 to "右")
private val DIR_OTHER = listOf(0 to "投", 6 to "ファール")

/** 打球結果（進塁判定に使用・スプシの結果列になる）: ゴロ / フライ / ライナー */
private val PLAY_RESULTS = listOf("ゴロ", "フライ", "ライナー")

/** 打球性質（記録用）: ゴロ / ライナー / フライ */
private val BALL_TYPES = listOf("ゴロ", "ライナー", "フライ")

/** 3ストライク時の空振り/見逃し選択（4.2.B）。押し間違い防止のため大きなボタンにする */
@Composable
fun StrikeoutChoiceDialog() {
    AlertDialog(
        onDismissRequest = { /* 選択必須 */ },
        title = { Text("3ストライク", fontWeight = FontWeight.Bold) },
        text = {
            Column {
                Text("空振りか見逃しかを選択してください")
                Spacer(Modifier.height(16.dp))
                Button(
                    onClick = { GameEngine.confirmStrikeout(swing = true) },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFC62828)),
                    modifier = Modifier.fillMaxWidth().height(64.dp)
                ) { Text("空 振 り", fontSize = 20.sp, fontWeight = FontWeight.Bold) }
                Spacer(Modifier.height(12.dp))
                Button(
                    onClick = { GameEngine.confirmStrikeout(swing = false) },
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1565C0)),
                    modifier = Modifier.fillMaxWidth().height(64.dp)
                ) { Text("見 逃 し", fontSize = 20.sp, fontWeight = FontWeight.Bold) }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = { GameEngine.undoThirdStrike() }) { Text("入力ミス（戻す）") }
        }
    )
}

/**
 * 打席結果の詳細入力ポップアップ（4.2.C-3）。
 * 表示中も次打者の曲はバックグラウンドで再生され続け、確定した瞬間に停止する（4.2.D）。
 * 塁況・アウト・得点・打点は自動計算し、プレビューは読み取り専用（手動補正は行わない）。
 */
@Composable
fun ResultDetailDialog(pending: PendingResult) {
    val type = pending.resultType
    val batted = Scorebook.hasBattedBall(type)
    val isNhne = type == Scorebook.RESULT_NHNE
    val isSqueeze = type == Scorebook.RESULT_SQUEEZE
    val needBasesGained = type == Scorebook.RESULT_HIT || type == Scorebook.RESULT_ERROR
    val isStrikeout = type == Scorebook.RESULT_K_SWING || type == Scorebook.RESULT_K_LOOK
    // 打球結果（ゴロ/フライ）で進塁が変わる結果: アウト・犠牲
    val needPlayResult = type == Scorebook.RESULT_OUT || type == Scorebook.RESULT_SAC

    // 3: ヒット/エラー等の塁打数はデフォルト未選択（null）にする
    var basesGained by remember(pending) { mutableStateOf<Int?>(null) }
    var hits by remember(pending) { mutableIntStateOf(1) }
    var errs by remember(pending) { mutableIntStateOf(1) }
    var direction by remember(pending) { mutableStateOf<Int?>(null) }
    var playResult by remember(pending) { mutableStateOf<String?>(null) }
    var ballType by remember(pending) { mutableStateOf<String?>(null) }
    // 2: バット種類は、その打者が前回使ったバットをデフォルト選択にする
    var batType by remember(pending) { mutableStateOf(GameEngine.lastBatTypeOf(pending.batterId)) }
    var situations by remember(pending) { mutableStateOf(setOf<String>()) }
    var squeezeSuccess by remember(pending) { mutableStateOf<Boolean?>(null) }
    val isSwitch = pending.batSide == "両"
    var batSide by remember(pending) { mutableStateOf<String?>(null) }
    // 3: タッチアップ確認（フライアウト時）。三塁・二塁走者を個別に選択。ワンファンブルはゴロアウト時
    var tagThird by remember(pending) { mutableStateOf<Boolean?>(null) }
    var tagSecond by remember(pending) { mutableStateOf<Boolean?>(null) }
    var fumble by remember(pending) { mutableStateOf<Boolean?>(null) }
    val hasSecond = pending.basesBefore.getOrElse(1) { false }
    val hasThird = pending.basesBefore.getOrElse(2) { false }
    val notDpOut = !situations.contains("併殺") && !situations.contains("三塁走者アウト")
    val askFly = needPlayResult && playResult == "フライ" && notDpOut && !pending.autoChange
    val askTagThird = askFly && hasThird
    val askTagSecond = askFly && hasSecond
    val askFumble = needPlayResult && playResult == "ゴロ" && hasThird &&
            pending.outsBefore <= 1 && notDpOut && !pending.autoChange

    val effBases = when {
        isNhne -> (hits + errs).coerceIn(1, 4)
        needBasesGained -> basesGained ?: 1
        else -> 0
    }
    // スクイズ・タッチアップ・ワンファンブルは記録用に個別状況へ残す（計算は専用パラメータで行う）
    val effSituations = buildList {
        addAll(situations)
        if (isSqueeze && squeezeSuccess != null) {
            add(if (squeezeSuccess == true) "スクイズ成功" else "スクイズ失敗")
        }
        if (tagThird == true || tagSecond == true) add("タッチアップ")
        if (fumble == true) add("ワンファンブル")
    }
    // 2アウト・フルカウントは走者自動スタート（安打系で走者が+1余分に進塁）
    // 走者自動スタート: 2アウト・フルカウント かつ 一塁に走者がいるとき（一塁/一二塁/一三塁/満塁）。
    // 実際に+1進むのはフォースされた走者のみ（一三塁は一塁走者だけ）— 判定は Scorebook 側
    val basesForced = pending.basesBefore.getOrElse(0) { false }
    val autoStart = pending.outsBefore == 2 && pending.balls == 3 && pending.strikes == 2 && basesForced
    val auto = Scorebook.compute(
        type, pending.basesBefore, effBases, effSituations, playResult,
        autoStart = autoStart,
        tagThird = tagThird == true,
        tagSecond = tagSecond == true,
        fumble = fumble == true,
        outsBefore = pending.outsBefore
    )

    val shownBases = auto.bases
    val shownOuts = pending.outsBefore + auto.outsAdded
    val shownRuns = auto.runs
    val shownRbi = auto.rbi

    val errorCount = when (type) {
        Scorebook.RESULT_ERROR -> effBases
        Scorebook.RESULT_NHNE -> errs
        else -> 0
    }
    val canConfirm =
        (!batted || (direction != null && ballType != null)) &&
        (batType != null) && // 1: バット種類は四球・死球等も含め全結果で選択（前回バットが初期選択）
        (!needBasesGained || basesGained != null) &&
        (!needPlayResult || playResult != null) &&
        (!askTagThird || tagThird != null) &&
        (!askTagSecond || tagSecond != null) &&
        (!askFumble || fumble != null) &&
        (!isSqueeze || squeezeSuccess != null) &&
        (!isSwitch || batSide != null)

    val deferredType = !pending.autoChange && GameEngine.nextBatterHasChanceSong() &&
            (needBasesGained || needPlayResult || isNhne || isSqueeze)
    val basesKnown = when {
        !deferredType -> false
        needBasesGained -> basesGained != null
        needPlayResult -> playResult != null &&
                (!askTagThird || tagThird != null) &&
                (!askTagSecond || tagSecond != null) &&
                (!askFumble || fumble != null)
        isNhne -> true
        isSqueeze -> squeezeSuccess != null
        else -> false
    }
    val songTrigger = if (basesKnown)
        shownBases.toString() + "|" + shownRuns else ""
    LaunchedEffect(songTrigger) {
        if (songTrigger.isNotEmpty()) {
            GameEngine.playDeferredSong(shownBases, shownRuns)
        }
    }

    AlertDialog(
        onDismissRequest = { /* 確定かキャンセルのみ */ },
        title = {
            Column {
                Text("${pending.batterName}：$type", fontWeight = FontWeight.Bold)
                Text(
                    "${pending.inning}回${pending.topBottom} ${pending.outsBefore}アウト  " +
                            "B${pending.balls} S${pending.strikes} ${pending.pitchCount}球",
                    style = MaterialTheme.typography.bodySmall
                )
            }
        },
        text = {
            Column(
                Modifier
                    .heightIn(max = 480.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                if (isSwitch) {
                    SectionLabel("この打席の左右（両打者・必須）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SelBox("右打ち", selected = batSide == "右", modifier = Modifier.weight(1f)) {
                            batSide = "右"
                        }
                        SelBox("左打ち", selected = batSide == "左", modifier = Modifier.weight(1f)) {
                            batSide = "左"
                        }
                    }
                }
                if (isSqueeze) {
                    SectionLabel("スクイズの結果（必須）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SelBox("成功（三塁走者 生還）", selected = squeezeSuccess == true,
                            modifier = Modifier.weight(1f)) { squeezeSuccess = true }
                        SelBox("失敗（三塁走者 アウト）", selected = squeezeSuccess == false,
                            modifier = Modifier.weight(1f)) { squeezeSuccess = false }
                    }
                }
                if (isNhne) {
                    SectionLabel("ヒット数 / エラー数（例: 1H2E = 3進塁）")
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Stepper("H", hits, 1, 3) { hits = it }
                        Spacer(Modifier.width(16.dp))
                        Stepper("E", errs, 1, 3) { errs = it }
                        Spacer(Modifier.width(12.dp))
                        Text("計 ${effBases} 進塁", style = MaterialTheme.typography.bodyMedium)
                    }
                }
                if (needBasesGained) {
                    SectionLabel(if (type == Scorebook.RESULT_HIT) "塁打数" else "進塁数（=失策数）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        val labels = if (type == Scorebook.RESULT_HIT)
                            listOf("単打", "二塁打", "三塁打", "本塁打") else listOf("1", "2", "3", "4")
                        labels.forEachIndexed { i, label ->
                            SelBox(
                                label = label,
                                selected = basesGained == i + 1,
                                modifier = Modifier.weight(1f)
                            ) { basesGained = i + 1 }
                        }
                    }
                }
                if (needPlayResult) {
                    SectionLabel("打球結果（進塁の判定に使用。フライを1バウンド捕球ならゴロ）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        PLAY_RESULTS.forEach { r ->
                            SelBox(r, selected = playResult == r, modifier = Modifier.weight(1f)) {
                                playResult = r
                            }
                        }
                    }
                }
                if (batted) {
                    SectionLabel("打球方向")
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        DIR_FIELD.forEach { (v, label) ->
                            SelBox(label, selected = direction == v, modifier = Modifier.weight(1f)) {
                                direction = v
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        DIR_OTHER.forEach { (v, label) ->
                            SelBox(label, selected = direction == v, modifier = Modifier.weight(1f)) {
                                direction = v
                            }
                        }
                        Spacer(Modifier.weight(1f))
                    }

                    SectionLabel("打球性質（記録用）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        BALL_TYPES.forEach { t ->
                            SelBox(t, selected = ballType == t, modifier = Modifier.weight(1f)) {
                                ballType = t
                            }
                        }
                    }
                }
                run {
                    // 1: バット種類は全結果（四球・死球なども含む）で選択できるようにする
                    SectionLabel("バット種類")
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        BAT_DEFS.take(4).forEach { b ->
                            BatBox(b, selected = batType == b.code, modifier = Modifier.weight(1f)) {
                                batType = b.code
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        BAT_DEFS.drop(4).forEach { b ->
                            BatBox(b, selected = batType == b.code, modifier = Modifier.weight(1f)) {
                                batType = b.code
                            }
                        }
                    }
                }
                if (batted && !isSqueeze) {
                    SectionLabel("個別状況")
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Scorebook.SITUATION_ALL.take(2).forEach { s ->
                            SelBox(s, selected = situations.contains(s), modifier = Modifier.weight(1f)) {
                                situations = if (situations.contains(s)) situations - s else situations + s
                            }
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        Scorebook.SITUATION_ALL.drop(2).forEach { s ->
                            SelBox(s, selected = situations.contains(s), modifier = Modifier.weight(1f)) {
                                situations = if (situations.contains(s)) situations - s else situations + s
                            }
                        }
                    }

                }

                // 3: タッチアップ確認（フライアウトで2塁/3塁走者がいるとき、走者ごとに選択）
                if (askTagThird) {
                    SectionLabel("三塁走者のタッチアップ（必須）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SelBox("生還した", selected = tagThird == true, modifier = Modifier.weight(1f)) { tagThird = true }
                        SelBox("進まない", selected = tagThird == false, modifier = Modifier.weight(1f)) { tagThird = false }
                    }
                }
                if (askTagSecond) {
                    SectionLabel("二塁走者のタッチアップ（必須）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SelBox("三塁へ進んだ", selected = tagSecond == true, modifier = Modifier.weight(1f)) { tagSecond = true }
                        SelBox("進まない", selected = tagSecond == false, modifier = Modifier.weight(1f)) { tagSecond = false }
                    }
                }
                // 3: ワンファンブル確認（ゴロアウト・三塁走者あり・1アウト以下）
                if (askFumble) {
                    SectionLabel("ワンファンブル（三塁走者の生還／必須）")
                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        SelBox("あった（生還）", selected = fumble == true, modifier = Modifier.weight(1f)) { fumble = true }
                        SelBox("なし", selected = fumble == false, modifier = Modifier.weight(1f)) { fumble = false }
                    }
                }

                if (autoStart) {
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "⚡ 2アウト フルカウント: 自動スタート適用（フォースされた走者が+1進塁）",
                        color = MaterialTheme.colorScheme.primary,
                        style = MaterialTheme.typography.bodySmall
                    )
                }

                // 結果後の状態プレビュー（自動計算・読み取り専用）
                SectionLabel("結果後（自動計算）")
                val baseLabel = listOf("一", "二", "三")
                    .filterIndexed { i, _ -> shownBases[i] }
                    .joinToString("・").ifEmpty { "走者なし" }
                Text(
                    "アウト $shownOuts / 塁: $baseLabel / 得点 +$shownRuns / 打点 $shownRbi",
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.Bold
                )
                if (pending.autoChange || shownOuts >= 3) {
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "⚠ 3アウト目 → 確定と同時にチェンジします",
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = canConfirm,
                onClick = {
                    GameEngine.confirmResult(
                        direction = direction,
                        playResult = playResult,
                        ballType = ballType,
                        batType = batType,
                        situations = effSituations,
                        basesGained = effBases,
                        hits = if (isNhne) hits else if (type == Scorebook.RESULT_HIT) 1 else 0,
                        errors = errorCount,
                        finalBases = shownBases,
                        outsAfter = shownOuts,
                        runs = shownRuns,
                        rbi = shownRbi,
                        batSideOverride = batSide
                    )
                }
            ) { Text(if (canConfirm) "確定（曲停止）" else "未入力あり", fontWeight = FontWeight.Bold) }
        },
        dismissButton = {
            TextButton(onClick = { GameEngine.cancelResult() }) {
                Text(if (isStrikeout || type == Scorebook.RESULT_BB) "入力ミス（戻す）" else "キャンセル")
            }
        }
    )
}

@Composable
private fun SectionLabel(text: String) {
    Spacer(Modifier.height(10.dp))
    Text(text, style = MaterialTheme.typography.labelLarge)
    Spacer(Modifier.height(4.dp))
}

/** 単色の選択ボックス（選択中は色を反転） */
@Composable
private fun SelBox(
    label: String,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val bg = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant
    val fg = if (selected) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurfaceVariant
    Text(
        label,
        textAlign = TextAlign.Center,
        color = fg,
        style = MaterialTheme.typography.bodyMedium,
        modifier = modifier
            .background(bg, RoundedCornerShape(8.dp))
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp)
    )
}

/** バット種類の固有色ボックス（虎は2色ブラシ） */
@Composable
private fun BatBox(
    def: BatDef,
    selected: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit
) {
    val shape = RoundedCornerShape(8.dp)
    var m = if (def.brush != null) modifier.background(def.brush, shape)
    else modifier.background(def.bg, shape)
    m = when {
        selected -> m.border(BorderStroke(3.dp, MaterialTheme.colorScheme.primary), shape)
        def.border != null -> m.border(BorderStroke(2.dp, def.border), shape)
        else -> m
    }
    Text(
        def.label,
        textAlign = TextAlign.Center,
        color = def.fg,
        fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
        style = MaterialTheme.typography.bodyMedium,
        modifier = m
            .clickable(onClick = onClick)
            .padding(vertical = 10.dp)
    )
}

/** ラベル付き +/− ステッパー */
@Composable
private fun Stepper(label: String, value: Int, min: Int, max: Int, onChange: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("$label:", style = MaterialTheme.typography.bodyMedium)
        TextButton(onClick = { if (value > min) onChange(value - 1) }) { Text("−") }
        Text("$value", fontWeight = FontWeight.Bold)
        TextButton(onClick = { if (value < max) onChange(value + 1) }) { Text("＋") }
    }
}
