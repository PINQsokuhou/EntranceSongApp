package com.pingpong.entrancesong.data

import com.pingpong.entrancesong.game.Scorebook

/**
 * アプリの記録を、ユーザーの既存スプレッドシート（2026春夏）の列・語彙へ変換する。
 * 各試合日は新しいシート（例 "2026-06-17"）に、A〜AB（1球ごと）と AD〜AL（出場者・投手成績）
 * の形式で書き出す。全試合経過・月間シートへも同じ行を追記する。
 */
object SheetMapper {

    /** 塁況の二値配列 [一,二,三] を日本語ラベルへ（F列・X列） */
    fun basesLabel(bases: List<Boolean>): String {
        val f = bases.getOrElse(0) { false }
        val s = bases.getOrElse(1) { false }
        val t = bases.getOrElse(2) { false }
        return when {
            !f && !s && !t -> "無塁"
            f && !s && !t -> "一塁"
            !f && s && !t -> "二塁"
            !f && !s && t -> "三塁"
            f && s && !t -> "一二塁"
            f && !s && t -> "一三塁"
            !f && s && t -> "二三塁"
            else -> "満塁"
        }
    }

    /** "101" などの二値文字列（AtBatLog 保存形式）を日本語ラベルへ */
    fun basesLabelFromStr(s: String): String =
        basesLabel(listOf(s.getOrNull(0) == '1', s.getOrNull(1) == '1', s.getOrNull(2) == '1'))

    /** 打者走者の塁打数（S列）: 安打はその塁打、nHnE は安打分のみ、それ以外は0 */
    private fun totalBases(log: AtBatLog): Int = when (log.resultType) {
        Scorebook.RESULT_HIT -> log.basesGained
        Scorebook.RESULT_NHNE -> (log.basesGained - log.errors).coerceAtLeast(0)
        else -> 0
    }

    /** 結果ラベル（O列）をスプレッドシートの語彙へ変換 */
    fun resultCell(log: AtBatLog): String = when (log.resultType) {
        Scorebook.RESULT_HIT -> "${log.basesGained.coerceIn(1, 4)}塁打"
        Scorebook.RESULT_NHNE -> "${(log.basesGained - log.errors).coerceIn(1, 4)}塁打"
        Scorebook.RESULT_OUT ->
            if (log.situations.contains("併殺")) "併殺"
            else (log.playResult ?: "ゴロ") // ゴロ / フライ / ライナー
        Scorebook.RESULT_ERROR -> "失策"
        Scorebook.RESULT_SAC -> "犠飛"
        Scorebook.RESULT_SQUEEZE -> "スクイズ"
        Scorebook.RESULT_HBP -> "死球"
        Scorebook.RESULT_INTERFERE -> "妨害"
        Scorebook.RESULT_BB -> "四球"
        Scorebook.RESULT_K_SWING -> "空三振"
        Scorebook.RESULT_K_LOOK -> "見三振"
        else -> log.result
    }

    /** バット種類のセル値。違反バット i はスプレッドシート上 i2 と記録する（#1） */
    private fun batTypeCell(code: String?): String = when (code) {
        null -> ""
        "i" -> "i2"
        else -> code
    }

    /** カウント "B-S" は先頭が0でないと日付と誤認されるため、先頭に ' を付ける（#2） */
    private fun countCell(count: String): String = "'$count"

    /** 1打席=1行を A〜AB（28列）の値配列にする。空欄は "" */
    fun playRow(log: AtBatLog): List<String> = listOf(
        log.date,                                   // A 日付
        log.stadium,                                // B 球場
        log.inning.toString(),                      // C 回
        log.topBottom,                              // D 表裏
        log.outs.toString(),                        // E アウト数
        basesLabelFromStr(log.bases),               // F 塁況
        log.scoreFirst.toString(),                  // G 得点・先
        log.scoreSecond.toString(),                 // H 得点・後
        log.batterName,                             // I 打者
        log.batSide,                                // J 打左右
        log.pitcherName,                            // K 投手
        log.pitchSide,                              // L 投左右
        log.pitchCount.toString(),                  // M 打席中球数
        countCell(log.count),                       // N カウント（先頭に ' を付け日付誤認を防ぐ）
        resultCell(log),                            // O 結果
        log.direction?.toString() ?: "",            // P 打球方向
        log.ballType ?: "",                         // Q 打球性質
        batTypeCell(log.batType),                   // R バット種類（違反バット i は i2 と記録）
        totalBases(log).toString(),                 // S 塁打数
        log.errors.toString(),                      // T 失策数
        log.nextInning.toString(),                  // U 次の回
        log.nextTopBottom,                          // V 次の表裏
        log.nextOuts.toString(),                    // W 次のアウト数
        basesLabelFromStr(log.nextBases),           // X 次の塁況
        log.nextScoreFirst.toString(),              // Y 次の得点・先
        log.nextScoreSecond.toString(),             // Z 次の得点・後
        log.runs.toString(),                        // AA 得点
        log.rbi.toString()                          // AB 打点
    )
}
