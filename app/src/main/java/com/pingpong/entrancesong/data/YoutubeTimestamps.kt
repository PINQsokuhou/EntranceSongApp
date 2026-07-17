package com.pingpong.entrancesong.data

import com.pingpong.entrancesong.game.Scorebook

/**
 * 試合履歴を YouTube 概要欄にそのまま貼れるタイムスタンプ文字列にする。
 *
 * 形式:
 *   ハイライト
 *   4:50 1回裏 玉木ソロホームラン
 *   6:54 2回表 布目タイムリーヒット
 *
 *   各選手の打席
 *   先攻チーム
 *   1.布目
 *   1:20 第1打席 三振
 *   6:54 第2打席 タイムリーヒット
 *
 * ハイライトの時刻 = 結果ボタン押下の10秒前（打点を生んだ1球が映る位置）。
 * 各打席の時刻 = 前の打者の結果入力が終わった瞬間（= 打席開始時間）。
 * どちらも試合ごとの一律補正（tsOffsetSec）を加算する。
 */
object YoutubeTimestamps {

    fun format(sec: Long): String {
        val s = sec.coerceAtLeast(0)
        val h = s / 3600
        val m = (s % 3600) / 60
        val ss = s % 60
        return if (h > 0) "%d:%02d:%02d".format(h, m, ss) else "%d:%02d".format(m, ss)
    }

    /** オフセットの表示（±M:SS） */
    fun formatOffset(sec: Long): String {
        val sign = if (sec < 0) "−" else "+"
        val s = kotlin.math.abs(sec)
        return "%s%d:%02d".format(sign, s / 60, s % 60)
    }

    /** 結果の読みやすい表記 */
    private fun label(log: AtBatLog): String = when (log.resultType) {
        Scorebook.RESULT_HIT -> when (log.basesGained) {
            4 -> when (log.runs) {
                1 -> "ソロホームラン"
                2 -> "2ランホームラン"
                3 -> "3ランホームラン"
                else -> "満塁ホームラン"
            }
            3 -> timely(log, "3塁打")
            2 -> timely(log, "2塁打")
            else -> timely(log, "ヒット")
        }
        Scorebook.RESULT_OUT ->
            if (log.situations.contains("併殺")) "併殺"
            else (log.playResult ?: "ゴロ") + "アウト"
        Scorebook.RESULT_ERROR -> "エラー出塁" + if (log.runs > 0) "（${log.runs}点）" else ""
        Scorebook.RESULT_NHNE -> timely(log, log.result) // 例 1H2E
        Scorebook.RESULT_SAC ->
            (if (log.situations.contains("タッチアップ")) "犠飛" else "犠打") + rbiSuffix(log)
        Scorebook.RESULT_SQUEEZE ->
            if (log.situations.contains("スクイズ失敗")) "スクイズ失敗" else "スクイズ成功"
        Scorebook.RESULT_BB -> "四球" + rbiSuffix(log)
        Scorebook.RESULT_HBP -> "死球" + rbiSuffix(log)
        Scorebook.RESULT_INTERFERE -> "妨害出塁" + rbiSuffix(log)
        Scorebook.RESULT_K_SWING, Scorebook.RESULT_K_LOOK -> "三振"
        else -> log.result
    }

    private fun timely(log: AtBatLog, base: String): String = when {
        log.rbi >= 2 -> "${log.rbi}点タイムリー$base"
        log.rbi == 1 -> "タイムリー$base"
        else -> base
    }

    private fun rbiSuffix(log: AtBatLog): String =
        if (log.rbi > 0) "（打点${log.rbi}）" else ""

    /** ハイライト行の時刻: 結果押下の10秒前。旧データは打点球時刻(押下−8秒)から復元 */
    private fun highlightSec(log: AtBatLog): Long {
        val press = when {
            log.resultPressSec > 0 -> log.resultPressSec
            log.rbiPitchSec != null -> log.rbiPitchSec + 8
            else -> log.paStartSec
        }
        return press - 10
    }

    fun build(game: HistoryGame): String {
        val off = game.tsOffsetSec
        val sb = StringBuilder()

        sb.appendLine("ハイライト")
        val highlights = game.detailLogs.filter { it.runs > 0 }
        if (highlights.isEmpty()) {
            sb.appendLine("（得点シーンなし）")
        } else {
            highlights.forEach { log ->
                sb.appendLine(
                    "${format(highlightSec(log) + off)} " +
                            "${log.inning}回${log.topBottom} ${log.batterName}${label(log)}"
                )
            }
        }

        sb.appendLine()
        sb.appendLine("各選手の打席")

        fun teamBlock(title: String, names: List<String>) {
            sb.appendLine(title)
            names.distinct().forEachIndexed { i, name ->
                sb.appendLine("${i + 1}.$name")
                game.detailLogs.filter { it.batterName == name }
                    .forEachIndexed { j, log ->
                        sb.appendLine("${format(log.paStartSec + off)} 第${j + 1}打席 ${label(log)}")
                    }
                sb.appendLine()
            }
        }
        teamBlock("先攻チーム", game.firstOrderNames)
        teamBlock("後攻チーム", game.secondOrderNames)

        return sb.toString().trimEnd()
    }
}
