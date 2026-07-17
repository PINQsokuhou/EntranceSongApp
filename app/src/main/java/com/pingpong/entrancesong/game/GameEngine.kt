package com.pingpong.entrancesong.game

import android.annotation.SuppressLint
import android.content.Context
import android.os.Handler
import android.os.Looper
import android.widget.Toast
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import com.pingpong.entrancesong.audio.AnnouncementPlayer
import com.pingpong.entrancesong.audio.SongPlayer
import com.pingpong.entrancesong.data.AppSettings
import com.pingpong.entrancesong.data.AtBatLog
import com.pingpong.entrancesong.data.GameState
import com.pingpong.entrancesong.data.HistoryGame
import com.pingpong.entrancesong.data.LogEntry
import com.pingpong.entrancesong.data.Member
import com.pingpong.entrancesong.data.PendingResult
import com.pingpong.entrancesong.data.Repository
import com.pingpong.entrancesong.data.SheetsExporter
import com.pingpong.entrancesong.data.SongRef
import com.pingpong.entrancesong.data.Team
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.text.Collator
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 試合進行・記録・登場曲連動の中核（仕様書 4.2 / 4.3）。
 * UI とリモコン（PlaybackService）の両方からここを呼ぶ。
 */
@SuppressLint("StaticFieldLeak")
object GameEngine {

    private const val DEFAULT_GAIN_MB = 1050
    private const val PITCHER_CHANGE_GAIN_MB = 1400

    /** Compose 再描画用のバージョンカウンタ。状態変更のたびに +1 */
    var tick by mutableIntStateOf(0)
        private set

    private lateinit var appContext: Context
    private lateinit var repo: Repository
    var player: SongPlayer? = null
        private set
    private var announcer: AnnouncementPlayer? = null
    private val mainHandler by lazy { Handler(Looper.getMainLooper()) }

    var members: MutableList<Member> = mutableListOf()
    var state: GameState = GameState()
    var history: MutableList<HistoryGame> = mutableListOf()
    var settings: AppSettings = AppSettings()

    /** 「前の球」（一手戻し）用の操作スナップショット。各操作の直前に積む */
    private class UndoEntry(val json: String) { var songPlayed = false }
    private val undoStack = ArrayDeque<UndoEntry>()
    val canUndo: Boolean get() = undoStack.isNotEmpty()

    private val engineJson = Json { ignoreUnknownKeys = true; encodeDefaults = true }

    /** 操作の直前に現在の状態を積む（前の球で戻せるように） */
    private fun pushUndo() {
        undoStack.addLast(UndoEntry(engineJson.encodeToString(state)))
        while (undoStack.size > 200) undoStack.removeFirst()
    }
    /** 直近の操作が次打者の登場曲を鳴らした場合、その旨を記録（戻したとき二度流し防止に使う） */
    private fun markUndoSongPlayed() {
        undoStack.lastOrNull()?.songPlayed = true
    }

    /** その打者が前回使ったバット種類（詳細ポップアップのデフォルト選択用） */
    fun lastBatTypeOf(memberId: String): String? = settings.lastBatType[memberId]

    fun init(context: Context) {
        appContext = context.applicationContext
        repo = Repository(appContext)
        members = repo.loadMembers()
        state = repo.loadState()
        history = repo.loadHistory()
        settings = repo.loadSettings()
        player = SongPlayer(appContext).also { it.onSongEnd = { onSongEnd() } }
        announcer = AnnouncementPlayer(appContext).also {
            it.onError = { uri, err -> toast("音声再生エラー: $err") }
        }
    }

    /** 曲が自然終了したとき（投手登場曲のあと先頭打者の曲へ自動で繋ぐ用） */
    private fun onSongEnd() {
        if (state.pendingLeadoff) triggerLeadoff()
    }

    /** pendingLeadoff 状態で、現在の（先頭）打者の曲を鳴らしてログに記録する */
    private fun triggerLeadoff() {
        state.pendingLeadoff = false
        val m = currentBatter() ?: run { changed(); return }
        playAndLog(m)
        changed()
    }

    // ---------- 参照ヘルパー ----------

    fun orderOf(team: Team): MutableList<String> =
        if (team == Team.FIRST) state.firstOrder else state.secondOrder

    fun indexOf(team: Team): Int =
        if (team == Team.FIRST) state.firstIndex else state.secondIndex

    private fun setIndex(team: Team, v: Int) {
        if (team == Team.FIRST) state.firstIndex = v else state.secondIndex = v
    }

    fun defendingTeam(): Team = if (state.attacking == Team.FIRST) Team.SECOND else Team.FIRST

    fun memberById(id: String?): Member? = members.find { it.id == id }

    private val jpCollator = Collator.getInstance(Locale.JAPANESE)

    /** 並び替え用の読みキー: フリガナ（aliases 先頭）があればそれ、なければ名前 */
    private fun sortKey(m: Member): String = m.aliases.firstOrNull()?.trim()?.ifBlank { null } ?: m.name

    /** あいうえお順（フリガナ基準）に並べたメンバー一覧（9） */
    fun membersSorted(): List<Member> =
        members.sortedWith { a, b -> jpCollator.compare(sortKey(a), sortKey(b)) }

    fun countOf(m: Member): Int = state.atBatCounts[m.id] ?: 0

    fun currentBatter(): Member? {
        val order = orderOf(state.attacking)
        val i = indexOf(state.attacking)
        return if (i in order.indices) memberById(order[i]) else null
    }

    /** 現在守備側の投手（先攻の攻撃時 = 後攻チームの投手） */
    fun currentPitcher(): Member? = memberById(
        if (state.attacking == Team.FIRST) state.pitcherOfSecond else state.pitcherOfFirst
    )

    /** この試合の球場を設定する（次回の既定値としても保存） */
    fun setStadium(name: String) {
        state.stadium = name.trim()
        state.stadiumConfirmed = state.stadium.isNotBlank()
        if (state.stadium.isNotBlank()) {
            settings.stadium = state.stadium
            repo.saveSettings(settings)
        }
        changed()
    }

    /** 指定チーム側の投手を登録する（先発入力・投手交代） */
    fun setPitcher(team: Team, memberId: String) {
        if (team == Team.FIRST) state.pitcherOfFirst = memberId
        else state.pitcherOfSecond = memberId
        // 1回裏の先発投手を入力した直後は、投手登場曲を先に流してから先頭打者へ（6）
        if (state.pendingLeadoff && team == defendingTeam()) {
            playPitcherIntroThenLeadoff(currentPitcher())
        }
        changed()
    }

    /** 選曲ルール（3.1）: N曲登録時、((打席数-1) mod N)+1 曲目 */
    fun songForCount(m: Member, count: Int): SongRef? {
        if (m.battingSongs.isEmpty()) return null
        return m.battingSongs[(count - 1).coerceAtLeast(0).mod(m.battingSongs.size)]
    }

    /**
     * 状況を考慮した選曲。優先度:
     * 1. 初打席 → firstAtBatSong
     * 2. 負け/引き分け＋得点圏 → losingChanceSong
     * 3. 得点圏 → chanceSong
     * 4. 通常ローテーション → songForCount
     */
    private fun selectSong(m: Member, count: Int): SongRef? {
        if (count == 1 && m.firstAtBatSong != null) return m.firstAtBatSong
        val hasScoring = state.bases.getOrElse(1) { false } || state.bases.getOrElse(2) { false }
        if (hasScoring) {
            val atkScore = if (state.attacking == Team.FIRST) state.scoreFirst else state.scoreSecond
            val defScore = if (state.attacking == Team.FIRST) state.scoreSecond else state.scoreFirst
            if (atkScore <= defScore && m.losingChanceSong != null) return m.losingChanceSong
            if (m.chanceSong != null) return m.chanceSong
        }
        return songForCount(m, count)
    }

    private fun selectSongWithBases(m: Member, count: Int, futureBases: List<Boolean>, runs: Int): SongRef? {
        if (count == 1 && m.firstAtBatSong != null) return m.firstAtBatSong
        val hasScoring = futureBases.getOrElse(1) { false } || futureBases.getOrElse(2) { false }
        if (hasScoring) {
            val atkScore = (if (state.attacking == Team.FIRST) state.scoreFirst else state.scoreSecond) + runs
            val defScore = if (state.attacking == Team.FIRST) state.scoreSecond else state.scoreFirst
            if (atkScore <= defScore && m.losingChanceSong != null) return m.losingChanceSong
            if (m.chanceSong != null) return m.chanceSong
        }
        return songForCount(m, count)
    }

    fun nextBatterHasChanceSong(): Boolean {
        val p = state.pending ?: return false
        val nm = memberById(p.nextBatterId) ?: return false
        return nm.chanceSong != null || nm.losingChanceSong != null
    }

    fun playDeferredSong(futureBases: List<Boolean>, runs: Int) {
        val p = state.pending ?: return
        if (p.autoChange) return
        val nextId = p.nextBatterId ?: return
        val nm = memberById(nextId) ?: return
        val count = countOf(nm) + 1
        val song = selectSongWithBases(nm, count, futureBases, runs)
        if (song == null) {
                    } else {
            player?.play(song.uri)
        }
        markUndoSongPlayed()
    }

    private fun topBottomLabel(): String = if (state.attacking == Team.FIRST) "表" else "裏"

    private fun basesStr(bases: List<Boolean>): String =
        bases.joinToString("") { if (it) "1" else "0" }

    /** 試合タイマー（秒）。開始前は0 */
    fun elapsedSec(): Long {
        val start = state.startEpochMs ?: return 0
        val end = state.endEpochMs ?: System.currentTimeMillis()
        return ((end - start) / 1000).coerceAtLeast(0L)
    }

    private fun changed() {
        repo.saveMembers(members)
        repo.saveState(state)
        repo.saveHistory(history)
        tick++
        // 1球速報: 試合中は状況変化のたびに現在状況を送る（fire-and-forget）
        if (state.started && settings.liveEnabled) {
            SheetsExporter.liveState(settings.gasUrl, buildLiveState())
        }
    }

    /** 1球速報用の現在状況スナップショットを作る */
    private fun buildLiveState(): SheetsExporter.LiveState {
        val b = currentBatter()
        val p = currentPitcher()
        return SheetsExporter.LiveState(
            inning = state.inning,
            tb = topBottomLabel(),
            outs = state.outs,
            balls = state.balls,
            strikes = state.strikes,
            bases = basesStr(state.bases),
            scoreF = state.scoreFirst,
            scoreS = state.scoreSecond,
            batter = b?.name ?: "",
            batSide = b?.batSide?.label ?: "",
            batNum = b?.let { countOf(it) } ?: 0,
            pitcher = p?.name ?: "",
            pitchSide = p?.throwSide?.label ?: "",
            pitches = state.curPitches.toList(),
            pending = state.pending != null
        )
    }

    fun saveSettings() {
        repo.saveSettings(settings)
        tick++
    }

    private fun toast(msg: String) {
        Toast.makeText(appContext, msg, Toast.LENGTH_SHORT).show()
    }

    // ---------- 再生 ----------

    /** 打席曲を再生して簡易ログに記録する */
    private fun playAndLog(m: Member) {
        val count = countOf(m)
        val song = selectSong(m, count)
        if (song == null) {
                    } else {
            player?.play(song.uri)
        }
        state.log.add(
            LogEntry(m.id, m.name, count, song?.name ?: "(曲未登録)", state.inning, topBottomLabel())
        )
    }

    /** ステートを一切変えずに、その打者の現在打席数に応じた曲を再再生する */
    private fun replayOnly(m: Member) {
        val count = countOf(m).coerceAtLeast(1)
        val song = selectSong(m, count) ?: run {
                        return
        }
        player?.play(song.uri)
    }

    // ---------- 4.2.A 試合開始（画面上の再生・停止ボタン初回押下時のみ） ----------

    fun startGame() {
        if (state.started) return
        if (state.firstOrder.size < 3 || state.secondOrder.size < 3) {
            toast("先攻・後攻それぞれ3人以上の打順を設定してください")
            return
        }
        if (state.pitcherOfSecond == null) {
            toast("後攻チームの先発投手を設定してください")
            return
        }
        if (!state.stadiumConfirmed || state.stadium.isBlank()) {
            toast("球場を設定してください")
            return
        }
        state.started = true
        undoStack.clear()
        state.startEpochMs = System.currentTimeMillis()
        state.endEpochMs = null
        state.dateLabel = SimpleDateFormat("yyyy-MM-dd", Locale.JAPAN).format(Date())
        state.inning = 1
        state.attacking = Team.FIRST
        state.firstIndex = 0
        state.paStartSec = 0
        val m = memberById(state.firstOrder[0]) ?: return
        state.atBatCounts[m.id] = 1
        // 6: まず後攻の先発投手の登場曲を流し、そのあと（停止 or 自然終了で）先頭打者の曲へ
        playPitcherIntroThenLeadoff(currentPitcher())
        changed()
        // 速報サイトのLIVEを初期化
        if (settings.liveEnabled) {
            SheetsExporter.liveStart(settings.gasUrl, state.dateLabel, state.stadium)
        }
    }

    /**
     * 投手登場曲を先に流し、pendingLeadoff を立てる。
     * 投手曲が無ければ即座に先頭打者の曲を鳴らす。
     */
    private fun playPitcherIntroThenLeadoff(pitcher: Member?) {
        val song = pitcher?.pitchingSongs?.firstOrNull()
        if (song != null) {
            player?.play(song.uri)
            state.pendingLeadoff = true
        } else {
            triggerLeadoff()
        }
    }

    /** 1回表→1回裏の切り替えか（投手イントロフロー用） */
    private fun isFirstToSecondChange() =
        state.inning == 1 && state.attacking == Team.FIRST

    // ---------- ランナー自動スタート アナウンス ----------

    /**
     * カウントが変わった直後に呼ぶ。フルカウント(3-2)・2アウト・一塁走者あり の瞬間に
     * アナウンス音声を入場曲と重ねて再生する。
     * [justChanged] が true のときだけ鳴らす（フルカウント維持中のファールでは鳴らさない）。
     */
    private fun checkAutoStartAnnounce(justChanged: Boolean) {
        if (!justChanged) return
        val uri = settings.autoStartAnnounceUri
        if (uri.isBlank()) return
        if (state.balls == 3 && state.strikes == 2
            && state.outs == 2 && state.bases.getOrElse(0) { false }
        ) {
            toast("ランナー自動スタート")
            announcer?.gainMb = DEFAULT_GAIN_MB
            announcer?.play(uri)
        }
    }

    // ---------- 4.2.B 打席内のカウント進行 ----------

    /** ボール。4ボールで四球として結果確定フェーズへ */
    fun addBall() {
        if (!state.started || state.pending != null) return
        pushUndo()
        state.pitchCount++
        state.balls++
        state.curPitches.add("ボール")
        if (state.balls >= 4) {
            beginResult(Scorebook.RESULT_BB, snapshot = false)
            return
        }
        checkAutoStartAnnounce(justChanged = true)
        changed()
    }

    /**
     * ストライク。3ストライク目で true を返し、UI 側で空振り/見逃しの選択を出す。
     * 選択後に [confirmStrikeout] を呼ぶ（UI は strikes>=3 && pending==null で選択を表示）。
     */
    fun addStrike() {
        if (!state.started || state.pending != null || state.awaitingStrikeoutChoice) return
        pushUndo()
        state.pitchCount++
        state.strikes++
        state.curPitches.add("ストライク")
        // #1: 3ストライク到達＝三振確定。空振り/見逃しの選択を待たずに曲を先に流す
        if (state.strikes >= 3) {
            val autoChange = state.outs + 1 >= 3
            playNextBatterSong(autoChange)
            if (!(autoChange && isFirstToSecondChange())) markUndoSongPlayed()
            state.awaitingStrikeoutChoice = true
        } else {
            checkAutoStartAnnounce(justChanged = true)
        }
        changed()
    }

    /** 3ストライク後の空振り/見逃し選択（4.2.B）。曲は既に流れているので鳴らさない */
    fun confirmStrikeout(swing: Boolean) {
        if (!state.started || state.pending != null || !state.awaitingStrikeoutChoice) return
        state.awaitingStrikeoutChoice = false
        beginResult(if (swing) Scorebook.RESULT_K_SWING else Scorebook.RESULT_K_LOOK,
            playSong = false, snapshot = false)
    }

    /** 3ストライク目の入力ミスの取り消し（最後の1球をなかったことにする） */
    fun undoThirdStrike() {
        if (!state.awaitingStrikeoutChoice || state.pending != null) return
        state.awaitingStrikeoutChoice = false
        state.strikes = 2
        state.pitchCount = (state.pitchCount - 1).coerceAtLeast(0)
        player?.stopNow() // 先に流し始めた曲を止める
        changed()
    }

    /** 次打者（3アウト目確定なら相手先頭）の登場曲を再生する（結果押下・三振確定の即時再生用） */
    private fun playNextBatterSong(autoChange: Boolean) {
        // 1回表→1回裏: 投手イントロフローに委譲するためここでは何も流さない
        if (autoChange && isFirstToSecondChange()) return
        val nextTeam = if (autoChange) defendingTeam() else state.attacking
        val nextOrder = orderOf(nextTeam)
        if (nextOrder.isEmpty()) return
        val nextId = nextOrder[(indexOf(nextTeam) + 1).mod(nextOrder.size)]
        memberById(nextId)?.let { nm ->
            val count = countOf(nm) + 1
            val song = if (autoChange) songForCount(nm, count) else selectSong(nm, count)
            if (song == null) {
                            } else if (autoChange) {
                val newInning = if (nextTeam == Team.FIRST) state.inning + 1 else state.inning
                val nextPos = (indexOf(nextTeam) + 1).mod(nextOrder.size)
                playAnnounceSequence(nextTeam, newInning, nextPos, nm) {
                    player?.play(song.uri)
                }
            } else {
                player?.play(song.uri)
            }
        }
    }

    /** ファール。2ストライク未満のみストライク+1、投球数は常に+1 */
    fun addFoul() {
        if (!state.started || state.pending != null) return
        pushUndo()
        state.pitchCount++
        val strikeChanged = state.strikes < 2
        if (strikeChanged) state.strikes++
        state.curPitches.add("ファール")
        checkAutoStartAnnounce(justChanged = strikeChanged)
        changed()
    }

    // ---------- 4.2.C 打席結果の入力と登場曲の即時再生連動 ----------

    /**
     * 結果ボタン押下。次打者（3アウト目確定なら相手チームの先頭）の曲を即時再生し、
     * 詳細入力待ち（pending）に入る。ステートの前進は confirmResult まで行わない。
     */
    fun beginResult(type: String, playSong: Boolean = true, snapshot: Boolean = true) {
        if (!state.started || state.pending != null) return
        val batter = currentBatter() ?: return
        if (snapshot) pushUndo()
        state.speculativeBatter = false
        state.pitcherInterrupt = false // 次打者の曲再生に移るため割り込みは終了
        state.pendingLeadoff = false
        val press = elapsedSec()
        val autoChange = state.outs + Scorebook.immediateOuts(type) >= 3

        val nextTeam = if (autoChange) defendingTeam() else state.attacking
        val nextOrder = orderOf(nextTeam)
        val nextId = if (nextOrder.isEmpty()) null
        else nextOrder[(indexOf(nextTeam) + 1).mod(nextOrder.size)]

        // 1. 登場曲の即時再生開始。ただし
        //  - 三振で既に鳴らし済み（playSong=false）
        //  - 「前の球」で前打者に戻った直後の再入力（suppressNextResultSong）: 二度流し防止（#2）
        //  - 1回表→1回裏: 投手イントロフローに委譲するためここでは何も流さない
        //  - 塁状況が未確定かつ次打者にチャンス曲が設定されている: ポップアップで塁が確定してから再生
        val isFirstToSecond = autoChange && isFirstToSecondChange()
        val suppressed = state.suppressNextResultSong
        state.suppressNextResultSong = false
        val nextMember = memberById(nextId)
        val hasChanceSong = nextMember?.chanceSong != null || nextMember?.losingChanceSong != null
        val deferSong = !autoChange && hasChanceSong && (type == Scorebook.RESULT_HIT ||
                type == Scorebook.RESULT_ERROR || type == Scorebook.RESULT_OUT ||
                type == Scorebook.RESULT_SAC || type == Scorebook.RESULT_NHNE ||
                type == Scorebook.RESULT_SQUEEZE)
        if (playSong && !suppressed && !isFirstToSecond && !deferSong) {
            nextMember?.let { nm ->
                val count = countOf(nm) + 1
                if (autoChange) {
                    val song = songForCount(nm, count)
                    if (song == null) {
                                            } else {
                        val newInning = if (nextTeam == Team.FIRST) state.inning + 1 else state.inning
                        val nextPos = (indexOf(nextTeam) + 1).mod(nextOrder.size)
                        playAnnounceSequence(nextTeam, newInning, nextPos, nm) {
                            player?.play(song.uri)
                        }
                    }
                } else {
                    val walkBases = Scorebook.forcedAdvance(state.bases)
                    val walkRuns = if (walkBases == state.bases) 0 else
                        Scorebook.forcedAdvanceRuns(state.bases)
                    val song = selectSongWithBases(nm, count, walkBases, walkRuns)
                    if (song == null) {
                                            } else {
                        player?.play(song.uri)
                    }
                }
            }
            markUndoSongPlayed()
        }

        val pitcher = currentPitcher()
        state.pending = PendingResult(
            resultType = type,
            batterId = batter.id,
            batterName = batter.name,
            batSide = batter.batSide.label,
            atBatNumber = countOf(batter),
            inning = state.inning,
            topBottom = topBottomLabel(),
            outsBefore = state.outs,
            basesBefore = state.bases.toList(),
            scoreFirstBefore = state.scoreFirst,
            scoreSecondBefore = state.scoreSecond,
            pitcherId = pitcher?.id,
            pitcherName = pitcher?.name ?: "",
            pitchSide = pitcher?.throwSide?.label ?: "",
            balls = state.balls,
            strikes = state.strikes,
            pitchCount = state.pitchCount,
            paStartSec = state.paStartSec,
            resultPressSec = press,
            autoChange = autoChange,
            nextBatterId = nextId
        )
        changed()
    }

    /** 結果ボタンの誤タップ取り消し。曲を止めて打席の途中状態へ戻す */
    fun cancelResult() {
        val p = state.pending ?: return
        player?.fadeOutStop(500L)
        when (p.resultType) {
            Scorebook.RESULT_BB -> {
                state.balls = 3
                state.pitchCount = (state.pitchCount - 1).coerceAtLeast(0)
            }
            Scorebook.RESULT_K_SWING, Scorebook.RESULT_K_LOOK -> {
                state.strikes = 2
                state.pitchCount = (state.pitchCount - 1).coerceAtLeast(0)
            }
        }
        state.pending = null
        changed()
    }

    // ---------- 4.2.D 入力完了と登場曲の自動停止連動 ----------

    /**
     * 詳細入力の確定。曲を2秒フェードで停止し、ログ確定・ステート前進・
     * 次打者の打席開始時間の記録までを一括で行う。
     * 塁況・アウト・得点・打点はポップアップで補正済みの最終値を受け取る。
     */
    fun confirmResult(
        direction: Int?,
        playResult: String?,
        ballType: String?,
        batType: String?,
        situations: List<String>,
        basesGained: Int,
        hits: Int,
        errors: Int,
        finalBases: List<Boolean>,
        outsAfter: Int,
        runs: Int,
        rbi: Int,
        /** 両打者のとき、この打席で左右どちらで打ったか（"右"/"左"）。null なら pending の値 */
        batSideOverride: String? = null
    ) {
        val p = state.pending ?: return
        pushUndo() // 前の球で「確定前の詳細入力」に戻せるように

        // 2の前に: この打者が使ったバットを次回のデフォルト用に記憶（#2）
        if (batType != null) {
            settings.lastBatType[p.batterId] = batType
            repo.saveSettings(settings)
        }

        // 併殺などポップアップで初めて3アウト目が判明した場合も、確定と同時にチェンジする
        val lateChange = !p.autoChange && outsAfter >= 3

        // 2. 回の途中の確定時のみ曲を停止（チェンジ時は入場曲を流し続ける）
        if (!p.autoChange && !lateChange) {
            announcer?.stop()
            player?.fadeOutStop(2000L)
        }
        val now = elapsedSec()

        // 得点反映（pending中の打席は p.topBottom のチームの攻撃）
        if (p.topBottom == "表") state.scoreFirst += runs else state.scoreSecond += runs

        // チェンジ or 通常進行
        if (p.autoChange || lateChange) {
            state.attacking = defendingTeam()
            if (state.attacking == Team.FIRST) state.inning += 1
            state.outs = 0
            state.bases = mutableListOf(false, false, false)
        } else {
            state.outs = outsAfter.coerceIn(0, 3)
            state.bases = finalBases.toMutableList()
        }

        // カウント表記は決め球の前のカウント（例: フルカウントから四球 → "3-2"）
        val countStr = when (p.resultType) {
            Scorebook.RESULT_BB -> "${(p.balls - 1).coerceAtLeast(0)}-${p.strikes}"
            Scorebook.RESULT_K_SWING, Scorebook.RESULT_K_LOOK ->
                "${p.balls}-${(p.strikes - 1).coerceAtLeast(0)}"
            else -> "${p.balls}-${p.strikes}"
        }
        val resultLabel =
            if (p.resultType == Scorebook.RESULT_NHNE) "${hits}H${errors}E" else p.resultType
        val songName = state.log.lastOrNull { it.memberId == p.batterId }?.songName ?: ""

        val entry =
            AtBatLog(
                date = state.dateLabel,
                stadium = state.stadium,
                inning = p.inning,
                topBottom = p.topBottom,
                outs = p.outsBefore,
                bases = basesStr(p.basesBefore),
                scoreFirst = p.scoreFirstBefore,
                scoreSecond = p.scoreSecondBefore,
                batterName = p.batterName,
                batSide = batSideOverride ?: p.batSide,
                pitcherName = p.pitcherName,
                pitchSide = p.pitchSide,
                pitchCount = p.pitchCount,
                count = countStr,
                result = resultLabel,
                resultType = p.resultType,
                direction = direction,
                playResult = playResult,
                ballType = ballType,
                batType = batType,
                situations = situations,
                basesGained = basesGained,
                errors = errors,
                nextInning = state.inning,
                nextTopBottom = topBottomLabel(),
                nextOuts = if (p.autoChange || lateChange) 0 else state.outs,
                nextBases = basesStr(state.bases),
                nextScoreFirst = state.scoreFirst,
                nextScoreSecond = state.scoreSecond,
                runs = runs,
                rbi = rbi,
                paStartSec = p.paStartSec,
                resultPressSec = p.resultPressSec,
                rbiPitchSec = if (runs > 0) (p.resultPressSec - 8).coerceAtLeast(0L) else null,
                atBatNumber = p.atBatNumber,
                songName = songName
            )
        state.detailLogs.add(entry)

        // 打順を次打者へ前進（曲は押下時から再生済み。簡易ログのみここで追加）
        // lateChange の場合は押下時に流した曲が同チームの次打者（誤り）なので、
        // ここで相手チーム先頭打者の曲を流し直す
        // 1回表→1回裏は投手イントロフローに委譲する
        val isFirstToSecond = (p.autoChange || lateChange) &&
            p.inning == 1 && p.topBottom == "表"
        val team = state.attacking
        val order = orderOf(team)
        if (order.isNotEmpty()) {
            state.speculativePrevIndex = indexOf(team)
            val ni = (indexOf(team) + 1).mod(order.size)
            setIndex(team, ni)
            memberById(order[ni])?.let { nm ->
                state.atBatCounts[nm.id] = countOf(nm) + 1
                if (isFirstToSecond) {
                    // ログは triggerLeadoff → playAndLog で追加
                } else if (lateChange) {
                    playChangeAnnounceThenSong(team, nm)
                } else {
                    val song = selectSong(nm, countOf(nm))
                    state.log.add(
                        LogEntry(nm.id, nm.name, countOf(nm), song?.name ?: "(曲未登録)",
                            state.inning, topBottomLabel())
                    )
                }
            }
            state.speculativeBatter = true
        }

        // 1回表→1回裏: 投手イントロ → 先頭打者の曲
        if (isFirstToSecond) {
            val pitcher = currentPitcher()
            if (pitcher != null) playPitcherIntroThenLeadoff(pitcher)
            else state.pendingLeadoff = true
        }

        // 3. 確定の瞬間 = 次打者の打席開始時間
        state.balls = 0
        state.strikes = 0
        state.pitchCount = 0
        state.curPitches = mutableListOf()
        state.paStartSec = now
        state.pending = null
        changed()
        // 速報サイトへ1打席分を送信
        if (settings.liveEnabled) SheetsExporter.livePA(settings.gasUrl, entry)
    }

    // ---------- 投機的前進の巻き戻し ----------

    /**
     * 直近に打順を進めた打者がまだ1球も受けていなければ巻き戻す。
     * 併殺入力で3アウトが確定した後のチェンジや、チェンジ連打の補正用。
     */
    private fun rollbackSpeculativeIfClean() {
        if (!state.speculativeBatter) return
        if (state.balls != 0 || state.strikes != 0 || state.pitchCount != 0) return
        val team = state.attacking
        val order = orderOf(team)
        val i = indexOf(team)
        if (i in order.indices) {
            memberById(order[i])?.let { m ->
                state.atBatCounts[m.id] = (countOf(m) - 1).coerceAtLeast(0)
                val li = state.log.indexOfLast { it.memberId == m.id }
                if (li >= 0) state.log.removeAt(li)
            }
        }
        setIndex(team, state.speculativePrevIndex)
        state.speculativeBatter = false
    }

    // ---------- 次のトラック（手動スキップ / 投手曲からの通常復帰） ----------

    fun nextBatter() {
        if (!state.started || state.pending != null) return
        if (state.pendingLeadoff) { triggerLeadoff(); return } // 投手曲イントロ中なら先頭打者へ
        pushUndo()
        state.pitcherInterrupt = false // 投手曲割り込みからの通常復帰
        val order = orderOf(state.attacking)
        if (order.isEmpty()) return
        state.speculativePrevIndex = indexOf(state.attacking)
        val ni = (indexOf(state.attacking) + 1).mod(order.size)
        setIndex(state.attacking, ni)
        val m = memberById(order[ni]) ?: return
        state.atBatCounts[m.id] = countOf(m) + 1
        playAndLog(m)
        state.balls = 0
        state.strikes = 0
        state.pitchCount = 0
        state.curPitches = mutableListOf()
        state.paStartSec = elapsedSec()
        state.speculativeBatter = true
        changed()
    }

    // ---------- 前のトラック短押し ----------

    fun prevShort() {
        if (!state.started || state.pending != null) return
        if (state.pendingLeadoff) { triggerLeadoff(); return } // 投手曲イントロ中なら先頭打者へ

        if (state.pitcherInterrupt) {
            // 4.2.F-3: 割り込み情報を破棄し、打席を終えた打者の曲をステート変更なしで再再生
            state.pitcherInterrupt = false
            val order = orderOf(state.attacking)
            val i = indexOf(state.attacking)
            if (i in order.indices) memberById(order[i])?.let { replayOnly(it) }
            changed()
            return
        }

        // 通常時: 打順を1つ戻し、個人打席数を1減らして前の打者の曲を再再生
        val order = orderOf(state.attacking)
        if (order.isEmpty()) return
        val i = indexOf(state.attacking)
        if (i < 0) return
        pushUndo()
        memberById(order[i])?.let { cur ->
            state.atBatCounts[cur.id] = (countOf(cur) - 1).coerceAtLeast(0)
        }
        if (state.log.isNotEmpty()) state.log.removeAt(state.log.lastIndex)
        val pi = (i - 1).mod(order.size)
        setIndex(state.attacking, pi)
        state.balls = 0
        state.strikes = 0
        state.pitchCount = 0
        state.curPitches = mutableListOf()
        state.speculativeBatter = false
        memberById(order[pi])?.let { replayOnly(it) }
        changed()
    }

    // ---------- 前の球（一手戻し。直前の操作をやり直す。#4） ----------

    /**
     * 直前の操作（ボール/ストライク/ファール/結果/確定）を1つ取り消す。
     * 打者をまたいで前の打者に戻った場合は、次打者の曲を二度流さない（#2 の仕組みを保持）。
     */
    fun undoLast() {
        if (!state.started) return
        val entry = undoStack.removeLastOrNull() ?: return
        val prev = engineJson.decodeFromString<GameState>(entry.json)
        // 確定済みの打席が取り消される＝速報の1行も取り消す
        val removedPA = prev.detailLogs.size < state.detailLogs.size
        state = prev
        player?.stopNow()
        announcer?.stop()
        // 戻した操作が次打者の曲を鳴らしていたなら、再入力時に二度流さない
        if (entry.songPlayed) state.suppressNextResultSong = true
        changed()
        if (removedPA && settings.liveEnabled) SheetsExporter.liveUndo(settings.gasUrl)
    }

    // ---------- 手動停止 ----------

    fun stopWithFade() {
        announcer?.stop()
        // 6: 投手登場曲の再生中に停止を押したら、フェードアウト完了後に先頭打者の曲へ
        if (state.pendingLeadoff) {
            state.pendingLeadoff = false
            changed()
            player?.fadeOutStop(2000L) {
                currentBatter()?.let { playAndLog(it) }
                changed()
            }
            return
        }
        player?.fadeOutStop(2000L)
    }

    /**
     * チェンジアナウンス（回 → 打順 → 名前）を再生してから onDone を呼ぶ。
     * アナウンスが未設定なら即座に onDone を呼ぶ。
     */
    private fun playAnnounceSequence(
        team: Team, inning: Int, orderIndex: Int, batter: Member,
        onDone: () -> Unit
    ) {
        val inningIndex = inning - 1
        val templateUri = if (team == Team.FIRST)
            settings.changeAnnounceFirstUris.getOrElse(inningIndex) { "" }
        else
            settings.changeAnnounceSecondUris.getOrElse(inningIndex) { "" }
        val orderUri = settings.orderAnnounceUris.getOrElse(orderIndex) { "" }
        val nameUri = batter.nameAnnounceSong?.uri ?: ""
        val uris = listOfNotNull(
            templateUri.takeIf { it.isNotBlank() },
            orderUri.takeIf { it.isNotBlank() },
            nameUri.takeIf { it.isNotBlank() }
        )
        if (uris.isEmpty()) {
            onDone()
            return
        }
        player?.stopNow()
        announcer?.gainMb = DEFAULT_GAIN_MB
        announcer?.playSequence(uris) { onDone() }
    }

    /** 手動チェンジ用: アナウンス → playAndLog */
    private fun playChangeAnnounceThenSong(team: Team, batter: Member) {
        playAnnounceSequence(team, state.inning, indexOf(team), batter) {
            playAndLog(batter)
            changed()
        }
    }

    // ---------- 4.2.E 攻守交代（チェンジ） ----------

    fun changeSides() {
        if (!state.started || state.pending != null) return
        pushUndo()
        state.pitcherInterrupt = false
        rollbackSpeculativeIfClean()
        state.attacking = defendingTeam()
        if (state.attacking == Team.FIRST) state.inning += 1 // 裏→表でイニング+1
        state.outs = 0
        state.bases = mutableListOf(false, false, false)
        state.balls = 0
        state.strikes = 0
        state.pitchCount = 0
        state.curPitches = mutableListOf()
        // 3. 曲が停止した瞬間 = 新イニング先頭打者の打席開始時間
        state.paStartSec = elapsedSec()
        val order = orderOf(state.attacking)
        if (order.isEmpty()) {
            changed()
            return
        }
        // インデックスを1進めてから再生（−1 の場合は 0 = 1番打者）
        state.speculativePrevIndex = indexOf(state.attacking)
        val ni = (indexOf(state.attacking) + 1).mod(order.size)
        setIndex(state.attacking, ni)
        val m = memberById(order[ni]) ?: return
        state.atBatCounts[m.id] = countOf(m) + 1
        state.speculativeBatter = true

        // 6: 1回裏の開始時は、先攻の先発投手の登場曲を先に流してから先頭打者へ
        val isFirstBottom = state.inning == 1 && state.attacking == Team.SECOND
        val pitcher = currentPitcher()
        when {
            // 1回裏で先発投手がまだ未入力 → 投手選択ダイアログ側で intro を鳴らすため待機
            isFirstBottom && pitcher == null -> state.pendingLeadoff = true
            // 1回裏で投手が既に判明している → 投手曲 → 先頭打者
            isFirstBottom -> playPitcherIntroThenLeadoff(pitcher)
            // 2回以降の通常イニング先頭はチェンジアナウンス → 入場曲
            else -> playChangeAnnounceThenSong(state.attacking, m)
        }
        changed()
    }

    // ---------- 4.2.F 投手交代 ----------

    /** 守備側リストの名前タップ → 曲選択 → 再生。タップされた選手を守備側の現投手として登録する */
    fun playPitcherSong(m: Member, song: SongRef) {
        if (!state.started) return
        val defTeam = defendingTeam()
        val outgoing = currentPitcher()
        if (state.attacking == Team.FIRST) state.pitcherOfSecond = m.id
        else state.pitcherOfFirst = m.id
        player?.play(song.uri)
        state.pitcherInterrupt = true

        playPitcherChangeAnnounce(defTeam, outgoing, m, delay = 3000)
        changed()
    }

    /** 曲を流さない投手交代（曲未登録の投手用） */
    fun changePitcherSilently(m: Member) {
        if (!state.started) return
        val defTeam = defendingTeam()
        val outgoing = currentPitcher()
        if (state.attacking == Team.FIRST) state.pitcherOfSecond = m.id
        else state.pitcherOfFirst = m.id
        state.pitcherInterrupt = true

        playPitcherChangeAnnounce(defTeam, outgoing, m, delay = 0)
        changed()
    }

    private fun playPitcherChangeAnnounce(defTeam: Team, outgoing: Member?, incoming: Member, delay: Long) {
        if (outgoing == null) return
        val frontUri = if (defTeam == Team.FIRST)
            settings.pitchChangeFirstFrontUri else settings.pitchChangeSecondFrontUri
        val backUri = if (defTeam == Team.FIRST)
            settings.pitchChangeFirstBackUri else settings.pitchChangeSecondBackUri
        val outgoingNameUri = outgoing.nameAnnounceSong?.uri ?: ""
        val incomingNameUri = incoming.nameAnnounceSong?.uri ?: ""
        val uris = listOfNotNull(
            frontUri.takeIf { it.isNotBlank() },
            outgoingNameUri.takeIf { it.isNotBlank() },
            backUri.takeIf { it.isNotBlank() },
            incomingNameUri.takeIf { it.isNotBlank() }
        )
        if (uris.isEmpty()) return
        val action = Runnable {
            if (state.pitcherInterrupt) {
                announcer?.gainMb = PITCHER_CHANGE_GAIN_MB
                announcer?.playSequence(uris) {
                    announcer?.gainMb = DEFAULT_GAIN_MB
                }
            }
        }
        if (delay > 0) mainHandler.postDelayed(action, delay) else action.run()
    }

    // ---------- 4.3 試合中の打順編集 ----------

    fun removeFromOrder(team: Team, pos: Int) {
        val order = orderOf(team)
        if (pos !in order.indices) return
        order.removeAt(pos)
        val idx = indexOf(team)
        // 現在打者より前の削除、または現在打者自身の削除はインデックスを −1 補正
        if (pos <= idx) setIndex(team, idx - 1)
        if (!state.started) state.stadiumConfirmed = false // 打順が変わった → 次の試合は球場を確認
        changed()
    }

    fun insertIntoOrder(team: Team, pos: Int, memberId: String) {
        val order = orderOf(team)
        val p = pos.coerceIn(0, order.size)
        order.add(p, memberId)
        val idx = indexOf(team)
        if (idx >= 0 && p <= idx) setIndex(team, idx + 1)
        // 途中参加者はカウント0のまま → 初打席は1打席目の曲から
        if (!state.atBatCounts.containsKey(memberId)) state.atBatCounts[memberId] = 0
        if (!state.started) state.stadiumConfirmed = false // 打順が変わった → 次の試合は球場を確認
        changed()
    }

    fun setOrder(team: Team, memberIds: List<String>) {
        val order = orderOf(team)
        order.clear()
        order.addAll(memberIds)
        setIndex(team, -1)
        state.stadiumConfirmed = false
        changed()
    }

    // ---------- 試合終了（成績自動計算 + エクスポート + ステート初期化） ----------

    fun endGame() {
        player?.stopNow()
        announcer?.stop()
        state.endEpochMs = System.currentTimeMillis()
        val date = state.dateLabel.ifBlank {
            SimpleDateFormat("yyyy-MM-dd", Locale.JAPAN).format(Date())
        }
        val stats = Scorebook.pitcherStats(state.detailLogs, state.scoreFirst, state.scoreSecond)
        val game = HistoryGame(
            date = date,
            stadium = state.stadium,
            scoreFirst = state.scoreFirst,
            scoreSecond = state.scoreSecond,
            durationSec = elapsedSec(),
            firstOrderNames = state.firstOrder.mapNotNull { memberById(it)?.name },
            secondOrderNames = state.secondOrder.mapNotNull { memberById(it)?.name },
            entries = state.log.toList(),
            detailLogs = state.detailLogs.toList(),
            pitcherStats = stats
        )
        history.add(game)
        while (history.size > 10) history.removeAt(0) // 過去10試合分を保持
        // 8: 打順は次の試合でも使えるよう残し、進行ステートだけ初期化する。
        // 球場は「打順を変えなければ同じ」ルールで引き継ぐ（打順編集で要再入力になる）
        val keepFirst = state.firstOrder.toMutableList()
        val keepSecond = state.secondOrder.toMutableList()
        state = GameState(
            firstOrder = keepFirst,
            secondOrder = keepSecond,
            stadium = state.stadium,
            stadiumConfirmed = state.stadium.isNotBlank()
        )
        undoStack.clear()
        changed()
        // 速報サイトのLIVE表示を終了（本保存の日付シートに置き換わる）
        if (settings.liveEnabled) SheetsExporter.liveEnd(settings.gasUrl)
        exportGame(game)
    }

    /** 先攻・後攻の打順を入れ替え（試合開始前のみ） */
    fun swapOrders() {
        if (state.started) {
            toast("試合中は先攻・後攻を入れ替えられません")
            return
        }
        val tmpOrder = state.firstOrder.toMutableList()
        val tmpIndex = state.firstIndex
        state.firstOrder.clear()
        state.firstOrder.addAll(state.secondOrder)
        state.firstIndex = state.secondIndex
        state.secondOrder.clear()
        state.secondOrder.addAll(tmpOrder)
        state.secondIndex = tmpIndex
        changed()
    }

    /** 先攻・後攻の打順を一括削除（試合開始前のみ） */
    fun clearAllOrders() {
        if (state.started) {
            toast("試合中は打順を一括削除できません")
            return
        }
        state.firstOrder.clear()
        state.secondOrder.clear()
        state.firstIndex = -1
        state.secondIndex = -1
        state.atBatCounts.clear()
        state.stadiumConfirmed = false
        changed()
    }

    /** スプレッドシートへの送信（試合終了時、および履歴画面からの再送） */
    fun exportGame(game: HistoryGame) {
        if (settings.gasUrl.isBlank()) {
            toast("エクスポート先URL未設定のためローカル保存のみ行いました")
            return
        }
        SheetsExporter.export(settings.gasUrl, game) { ok, msg ->
            if (ok) {
                game.exported = true
                changed()
            }
            toast(msg)
        }
    }

    // ---------- メンバーマスター管理 ----------

    fun addMember(m: Member) {
        members.add(m)
        changed()
    }

    /** 共有サーバー（スプレッドシート＋Drive）から取得したメンバーで一括置き換え（#3 同期） */
    fun replaceMembersFromSync(list: List<Member>) {
        members = list.toMutableList()
        changed()
    }

    fun deleteMember(id: String) {
        members.removeAll { it.id == id }
        // 打順からも取り除く（インデックス補正込み）
        for (team in listOf(Team.FIRST, Team.SECOND)) {
            while (true) {
                val pos = orderOf(team).indexOf(id)
                if (pos < 0) break
                removeFromOrder(team, pos)
            }
        }
        changed()
    }

    fun persist() = changed()
}
