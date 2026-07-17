package com.pingpong.entrancesong.game

import com.pingpong.entrancesong.data.AtBatLog
import com.pingpong.entrancesong.data.PitcherStat

/** 結果確定前に自動計算する「結果後の状態」。ポップアップ上で審判が補正できる */
data class Advance(
    val bases: List<Boolean>,
    val outsAdded: Int,
    val runs: Int,
    val rbi: Int
)

/**
 * 走者進塁の自動計算。
 * ピンポン野球では走者は基本的に打者走者と同数進塁する、という運用ルールに基づく
 * ベースライン実装。特殊ケースはポップアップの補正UIで審判が直せる。
 */
object Scorebook {

    const val RESULT_HIT = "ヒット"
    const val RESULT_OUT = "アウト"
    const val RESULT_ERROR = "エラー"
    const val RESULT_NHNE = "nHnE"
    const val RESULT_SAC = "犠牲"
    const val RESULT_SQUEEZE = "スクイズ"
    const val RESULT_HBP = "死球"
    const val RESULT_INTERFERE = "妨害"
    const val RESULT_BB = "四球"
    const val RESULT_K_SWING = "空三振"
    const val RESULT_K_LOOK = "見三振"

    val SITUATION_ALL = listOf("併殺", "三塁走者アウト")

    /**
     * スクイズシチュエーションか（結果ボタンにスクイズを出す条件）。
     * 三塁走者がいて、塁が埋まっておらず（満塁でない）、かつ0アウトまたは1アウトのときのみ企図される。
     */
    fun isSqueezeSituation(bases: List<Boolean>, outs: Int): Boolean =
        bases[2] && !(bases[0] && bases[1]) && outs < 2

    /** 打球を伴う結果か（打球方向・性質・バット種類の入力対象） */
    fun hasBattedBall(result: String): Boolean = when (result) {
        RESULT_HIT, RESULT_OUT, RESULT_ERROR, RESULT_NHNE, RESULT_SAC, RESULT_SQUEEZE -> true
        else -> false
    }

    fun forcedAdvance(bases: List<Boolean>): List<Boolean> {
        val b = bases.toMutableList()
        if (b[0]) {
            if (b[1]) { if (!b[2]) b[2] = true }
            else b[1] = true
        }
        b[0] = true
        return b
    }

    fun forcedAdvanceRuns(bases: List<Boolean>): Int =
        if (bases[0] && bases[1] && bases[2]) 1 else 0

    /** 打者がアウトになる結果として押下時点で確定しているもの（3アウト目の自動チェンジ判定用） */
    fun immediateOuts(result: String): Int = when (result) {
        // スクイズは成功なら打者、失敗なら三塁走者がアウトで、いずれも+1
        RESULT_OUT, RESULT_SAC, RESULT_SQUEEZE, RESULT_K_SWING, RESULT_K_LOOK -> 1
        else -> 0
    }

    /**
     * @param basesGained 打者走者が進んだ塁数（四球等の押し出し系は0を渡す）
     * @param playResult  打球結果 ゴロ / フライ（アウト系の進塁判定に使用）。
     *                    打球性質がフライでも1バウンド捕球ならゴロを渡す＝進塁が起こる
     * @param autoStart 走者自動スタート（2アウト・フルカウント かつ一塁が埋まっているとき）。安打系で走者が+1余分に進む
     * @param tagThird フライアウト時、三塁走者がタッチアップして生還したか
     * @param tagSecond フライアウト時、二塁走者がタッチアップして三塁へ進んだか
     * @param fumble ゴロアウト時、守備がワンファンブルして三塁走者が生還したか
     */
    fun compute(
        result: String,
        basesBefore: List<Boolean>,
        basesGained: Int,
        situations: List<String>,
        playResult: String? = null,
        autoStart: Boolean = false,
        tagThird: Boolean = false,
        tagSecond: Boolean = false,
        fumble: Boolean = false,
        outsBefore: Int = 0
    ): Advance {
        var bases = basesBefore.toMutableList()
        var outsAdded = 0
        var runs = 0

        when (result) {
            RESULT_BB, RESULT_HBP, RESULT_INTERFERE -> {
                // 強制進塁のみ（詰まっている走者だけ1つ進む）
                if (bases[0]) {
                    if (bases[1]) {
                        if (bases[2]) runs++ else bases[2] = true
                    } else bases[1] = true
                }
                bases[0] = true
            }

            RESULT_K_SWING, RESULT_K_LOOK -> outsAdded = 1

            RESULT_OUT -> {
                outsAdded = 1
                when {
                    situations.contains("併殺") -> {
                        outsAdded = 2
                        if (bases[0] && bases[2] && !bases[1]) {
                            // 1・3塁で併殺: 一塁走者+打者がアウト。
                            // 3アウト目でない場合のみ三塁走者が生還する
                            bases[0] = false
                            bases[2] = false
                            if (outsBefore + 2 < 3) runs++
                        } else {
                            // 1塁 / 1・2塁 / 満塁: 先頭走者+打者走者がアウト、残走者は1つ進塁
                            val lead = bases.indexOfLast { it }
                            if (lead >= 0) bases[lead] = false
                            val next = groundAdvance(bases, fumble = false)
                            bases = next.first
                            runs += next.second
                        }
                    }
                    // 1・3塁のもう一方の選択: 三塁走者を封殺し、打者走者は一塁に生きる
                    situations.contains("三塁走者アウト") -> {
                        bases[2] = false
                        if (bases[1]) {
                            bases[1] = false
                            bases[2] = true
                        }
                        if (bases[0]) {
                            bases[0] = false
                            bases[1] = true
                        }
                        bases[0] = true
                    }
                    // ゴロアウト: 走者は1つ進塁。三塁走者はワンファンブル確認でONのときのみ生還
                    playResult == "ゴロ" -> {
                        val next = groundAdvance(bases, fumble)
                        bases = next.first
                        runs += next.second
                    }
                    // フライアウト: タッチアップ確認で選択された走者だけ進む
                    playResult == "フライ" -> {
                        val next = tagUp(bases, tagThird, tagSecond)
                        bases = next.first
                        runs += next.second
                    }
                    // ライナー等: 走者そのまま
                }
            }

            RESULT_SAC -> {
                outsAdded = 1
                when {
                    // 犠牲フライ: タッチアップ確認で選択された走者が進む
                    playResult == "フライ" -> {
                        val next = tagUp(bases, tagThird, tagSecond)
                        bases = next.first
                        runs += next.second
                    }
                    else -> {
                        // 犠打（送りバント）: 走者は1つ進塁。三塁走者は生還しない
                        // （三塁走者を還すのは独立した結果「スクイズ」で記録する）
                        val next = groundAdvance(bases, fumble = false)
                        bases = next.first
                        runs += next.second
                    }
                }
            }

            RESULT_SQUEEZE -> {
                // スクイズ（三塁走者あり・満塁でないときのみ企図される）
                outsAdded = 1
                if (situations.contains("スクイズ失敗")) {
                    // 失敗: 三塁走者が本塁でアウト（アウトは走者の1つのみ）、打者走者は一塁に生きる
                    bases[2] = false
                    if (bases[1]) {
                        bases[1] = false
                        bases[2] = true
                    }
                    if (bases[0]) {
                        bases[0] = false
                        bases[1] = true
                    }
                    bases[0] = true
                } else {
                    // 成功: 打者はアウト、三塁走者が生還し他の走者も1つ進塁
                    val next = groundAdvance(bases, fumble = true)
                    bases = next.first
                    runs += next.second
                }
            }

            else -> {
                // ヒット / エラー / nHnE: 全走者が塁打数と同数進塁、打者走者も同じ。
                // 自動スタート時は「フォースされた走者」だけ+1余分に進む
                // （一三塁のとき一塁走者はフォース＝+1、三塁走者は非フォース＝通常）
                val n = basesGained.coerceIn(1, 4)
                val next = advanceHit(bases, n, autoStart)
                bases = next.first
                runs += next.second
                if (n >= 4) runs++ else bases[n - 1] = true
            }
        }

        // 打点: 発生した得点と同数。ただしエラー(のみ)による得点は打点にしない慣例
        val rbi = if (result == RESULT_ERROR) 0 else runs

        return Advance(bases, outsAdded, runs, rbi)
    }

    /** 走者iがフォースされているか（塁iより手前の塁がすべて埋まっている） */
    private fun isForced(bases: List<Boolean>, i: Int): Boolean {
        for (j in 0 until i) if (!bases[j]) return false
        return true
    }

    /** 安打時の進塁。全走者 n 進塁。自動スタート時はフォースされた走者のみ +1 余分に進む */
    private fun advanceHit(bases: List<Boolean>, n: Int, autoStart: Boolean): Pair<MutableList<Boolean>, Int> {
        val next = mutableListOf(false, false, false)
        var runs = 0
        for (i in 2 downTo 0) {
            if (!bases[i]) continue
            val extra = if (autoStart && isForced(bases, i)) 1 else 0
            val dest = i + n + extra
            if (dest >= 3) runs++ else next[dest] = true
        }
        return next to runs
    }

    /** 全走者を n 個進塁させる。戻り値: (新塁況, 生還数) */
    private fun advanceAll(bases: List<Boolean>, n: Int): Pair<MutableList<Boolean>, Int> {
        val next = mutableListOf(false, false, false)
        var runs = 0
        for (i in 2 downTo 0) {
            if (!bases[i]) continue
            val dest = i + n
            if (dest >= 3) runs++ else next[dest] = true
        }
        return next to runs
    }

    /**
     * ゴロアウト時の進塁。走者は1つ進むが、三塁走者は守備がファンブルした場合のみ生還、
     * しなければ三塁に留まる（後続走者は塁が空かない限り進めない）。
     */
    private fun groundAdvance(bases: List<Boolean>, fumble: Boolean): Pair<MutableList<Boolean>, Int> {
        val next = bases.toMutableList()
        var runs = 0
        if (next[2] && fumble) {
            next[2] = false
            runs++
        }
        if (next[1] && !next[2]) {
            next[1] = false
            next[2] = true
        }
        if (next[0] && !next[1]) {
            next[0] = false
            next[1] = true
        }
        return next to runs
    }

    /**
     * フライアウトのタッチアップ。三塁走者・二塁走者を個別に進める。
     *  - tagThird: 三塁走者が生還（本塁へ）
     *  - tagSecond: 二塁走者が三塁へ進む（三塁が空くときのみ有効）
     * 一塁走者はそのまま。
     */
    private fun tagUp(bases: List<Boolean>, tagThird: Boolean, tagSecond: Boolean): Pair<MutableList<Boolean>, Int> {
        val next = bases.toMutableList()
        var runs = 0
        if (tagThird && next[2]) {
            next[2] = false
            runs++
        }
        if (tagSecond && next[1] && !next[2]) {
            next[1] = false
            next[2] = true
        }
        return next to runs
    }

    /**
     * 詳細ログから投手成績を自動計算する（3.3）。プロ野球の公式規則に準拠:
     *
     * 【失点】走者を出塁させた投手の責任（継投後に生還しても前の投手に付く）。
     * 【自責点】イニングを失策なしで再構成して判定:
     *  - 失策出塁・打撃妨害出塁の走者の生還は自責にしない
     *  - 失策が無ければ3アウトでイニングが終わっていた後の得点は自責にしない
     *  - 失策による進塁が無ければ生還できなかった走者（nHnEの安打部分だけでは本塁に
     *    届かない走者）の得点は自責にしない
     * 【勝】勝利チームが最後に勝ち越した時点で登板していた投手（未登板なら先発）。
     * 【敗】その決勝点の責任投手（走者を出塁させた投手）。
     * 【セーブ】勝利チームの最終投手で勝利投手でなく、1アウト以上を記録し、かつ登板時に
     *  (a)3点差以内のリード (b)塁上・打者・次打者に同点の走者がいる状況のリード
     *  (c)3イニング以上投球 のいずれかを満たす。
     * 【ホールド】勝利チームの救援でセーブ・勝敗投手でなく、上のセーブ要件と同じ状況で
     *  リード時に登板し、1アウト以上を記録し、降板までリードを守り切った投手。
     */
    fun pitcherStats(
        logs: List<AtBatLog>,
        finalFirst: Int,
        finalSecond: Int
    ): List<PitcherStat> {
        if (logs.isEmpty()) return emptyList()

        // 表 = 先攻の攻撃 → 投げているのは後攻チーム
        fun defTeam(topBottom: String) = if (topBottom == "表") "後攻" else "先攻"

        class Acc(val team: String, val order: Int) {
            var runs = 0            // 失点（責任走者ベース）
            var earned = 0          // 自責点
            var starter = false
            var outs = 0            // 記録したアウト数（投球回 = outs/3）
            var firstIdx = -1       // 初登板のログ位置
            var lastIdx = -1        // 最終登板のログ位置
            var leadKept = true     // 登板中にリードを失わなかったか
        }

        val acc = LinkedHashMap<String, Acc>()
        var orderCounter = 0
        fun accOf(name: String, team: String): Acc = acc.getOrPut(name) {
            Acc(team, orderCounter++).also { a ->
                if (acc.values.none { it.team == team }) a.starter = true
            }
        }

        /** 塁上の走者: 出塁時の責任投手と、失策・妨害での出塁かを保持 */
        class Runner(val pitcher: String, val viaError: Boolean)

        /** 1点ごとの得点イベント（勝敗の決定に使う） */
        class RunEvent(val logIndex: Int, val team: String, val pitcher: String)

        val runEvents = mutableListOf<RunEvent>()

        var curInning = -1
        var curTB = ""
        var runners = arrayOfNulls<Runner>(3) // [0]=一塁 [1]=二塁 [2]=三塁
        var reconOuts = 0                     // 失策なし再構成でのアウト数

        logs.forEachIndexed { idx, log ->
            val pitcher = log.pitcherName
            if (pitcher.isBlank()) return@forEachIndexed
            val team = defTeam(log.topBottom)
            val attackTeam = if (log.topBottom == "表") "先攻" else "後攻"
            val a = accOf(pitcher, team)
            if (a.firstIdx < 0) a.firstIdx = idx
            a.lastIdx = idx

            // イニングの切り替わりでシミュレーションをリセット
            if (log.inning != curInning || log.topBottom != curTB) {
                curInning = log.inning
                curTB = log.topBottom
                runners = arrayOfNulls(3)
                reconOuts = 0
                // データ欠けでイニング途中の走者が居る場合は現投手の責任として扱う
                log.bases.forEachIndexed { b, c -> if (c == '1') runners[b] = Runner(pitcher, false) }
            }

            // このプレーで増えたアウト数（イニング終了プレーは3アウトまで埋まったとみなす）
            val inningEnded = log.nextTopBottom != log.topBottom || log.nextInning != log.inning
            val outsAdded =
                if (inningEnded) (3 - log.outs).coerceAtLeast(0)
                else (log.nextOuts - log.outs).coerceAtLeast(0)
            a.outs += outsAdded

            // ── 得点の帰属（前の走者から順に生還する）──
            val hitPortion = (log.basesGained - log.errors).coerceAtLeast(0)
            // このプレーの失策が無くても、b塁の走者は生還できたか
            fun wouldScoreWithoutError(base: Int): Boolean = when {
                log.errors == 0 -> true
                log.resultType == RESULT_ERROR -> false          // 失策が無ければ打者アウトで走者は進めない
                log.resultType == RESULT_NHNE -> base + hitPortion >= 3 // 安打部分だけで本塁に届くか
                else -> true
            }
            var toScore = log.runs
            for (b in 2 downTo 0) {
                if (toScore <= 0) break
                val r = runners[b] ?: continue
                runners[b] = null
                toScore--
                val ra = accOf(r.pitcher, team) // 走者を出した投手の失点
                ra.runs++
                val earned = !r.viaError && reconOuts < 3 && wouldScoreWithoutError(b)
                if (earned) ra.earned++
                runEvents.add(RunEvent(idx, attackTeam, r.pitcher))
            }
            // 打者走者自身の生還（本塁打・ランニング本塁打等）
            if (toScore > 0) {
                val earnedB = reconOuts < 3 &&
                        (log.errors == 0 || (log.resultType == RESULT_NHNE && hitPortion >= 4))
                a.runs += toScore
                if (earnedB) a.earned += toScore
                repeat(toScore) { runEvents.add(RunEvent(idx, attackTeam, pitcher)) }
            }

            // 再構成アウト: 実際のアウト + 「失策が無ければ打者はアウトだった」分
            reconOuts += outsAdded
            if (log.resultType == RESULT_ERROR) reconOuts += 1

            // ── 次の塁況へ走者を再配置 ──
            if (inningEnded) {
                runners = arrayOfNulls(3)
            } else {
                val batterOnBase = when (log.resultType) {
                    RESULT_HIT, RESULT_ERROR, RESULT_NHNE,
                    RESULT_BB, RESULT_HBP, RESULT_INTERFERE -> log.basesGained < 4
                    RESULT_SQUEEZE -> log.situations.contains("スクイズ失敗") // 打者走者は一塁に生きる
                    RESULT_OUT -> log.situations.contains("三塁走者アウト")   // 本塁封殺で打者走者は一塁へ
                    else -> false
                }
                val next = arrayOfNulls<Runner>(3)
                val placed = (2 downTo 0).filter { log.nextBases.getOrNull(it) == '1' } // 前(三塁)から
                val survivors = (2 downTo 0).mapNotNull { runners[it] }                  // 前の走者から順
                val runnerSlots = placed.size - (if (batterOnBase) 1 else 0)
                var si = 0
                placed.forEachIndexed { pi, base ->
                    next[base] = if (pi < runnerSlots) {
                        survivors.getOrNull(si++) ?: Runner(pitcher, false)
                    } else {
                        // 最後尾の塁 = 打者走者（失策・打撃妨害での出塁は自責対象外の走者）
                        Runner(
                            pitcher,
                            log.resultType == RESULT_ERROR || log.resultType == RESULT_INTERFERE
                        )
                    }
                }
                runners = next
            }

            // ホールド判定用: 登板中（自分の打席後）にリードを失っていないか
            val leadAfter =
                if (team == "先攻") log.nextScoreFirst - log.nextScoreSecond
                else log.nextScoreSecond - log.nextScoreFirst
            if (leadAfter <= 0) a.leadKept = false
        }

        // ── 勝敗（決勝点 = 勝利チームが最後に勝ち越した1点）──
        val winnerTeam = when {
            finalFirst > finalSecond -> "先攻"
            finalSecond > finalFirst -> "後攻"
            else -> ""
        }
        var winName: String? = null
        var lossName: String? = null
        if (winnerTeam.isNotEmpty()) {
            var sf = 0
            var ss = 0
            var prevLead = ""
            var decisiveIdx = -1
            for (ev in runEvents) {
                if (ev.team == "先攻") sf++ else ss++
                val lead = if (sf > ss) "先攻" else if (ss > sf) "後攻" else ""
                if (lead == winnerTeam && prevLead != winnerTeam) {
                    lossName = ev.pitcher // 決勝点の責任投手が敗戦投手
                    decisiveIdx = ev.logIndex
                }
                prevLead = lead
            }
            // 勝利投手 = 決勝点の時点で勝利チーム側の登板投手（それ以前の最後の守備の投手）
            if (decisiveIdx >= 0) {
                for (i in decisiveIdx downTo 0) {
                    if (defTeam(logs[i].topBottom) == winnerTeam && logs[i].pitcherName.isNotBlank()) {
                        winName = logs[i].pitcherName
                        break
                    }
                }
            }
            if (winName == null) {
                winName = acc.entries.firstOrNull { it.value.team == winnerTeam && it.value.starter }?.key
            }
        }

        // ── セーブ・ホールド（登板時状況の判定つき）──
        // 登板時: リード点差と、同点の走者が塁上・打席・次打者に居るか（走者数+2人以内）
        fun entryLead(a: Acc): Int {
            val log = logs[a.firstIdx]
            return if (a.team == "先攻") log.scoreFirst - log.scoreSecond
            else log.scoreSecond - log.scoreFirst
        }

        fun saveSituation(a: Acc): Boolean {
            val lead = entryLead(a)
            if (lead < 1) return false
            val runnersOn = logs[a.firstIdx].bases.count { it == '1' }
            return lead <= 3 ||            // (a) 3点差以内
                    lead <= runnersOn + 2 || // (b) 同点の走者が塁上・打者・次打者
                    a.outs >= 9              // (c) 3イニング以上の投球
        }

        val saveName = acc.entries
            .filter { it.value.team == winnerTeam }
            .maxByOrNull { it.value.lastIdx }?.key
            ?.takeIf { name ->
                val a = acc[name]!!
                winnerTeam.isNotEmpty() && name != winName && !a.starter &&
                        a.outs >= 1 && saveSituation(a)
            }

        return acc.map { (name, a) ->
            PitcherStat(
                name = name,
                team = a.team,
                runs = a.runs,
                earnedRuns = a.earned,
                starter = a.starter,
                win = name == winName,
                loss = name == lossName && a.team != winnerTeam,
                hold = a.team == winnerTeam && !a.starter &&
                        name != winName && name != saveName &&
                        a.outs >= 1 && saveSituation(a) && a.leadKept,
                save = name == saveName
            )
        }
    }
}
