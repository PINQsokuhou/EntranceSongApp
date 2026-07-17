package com.pingpong.entrancesong.data

import android.os.Handler
import android.os.Looper
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.net.HttpURLConnection
import java.net.URL

/**
 * 試合結果を Google スプレッドシートへ送る（ユーザーの「2026春夏」形式）。
 * Google Apps Script の Webアプリへ JSON を POST し、GAS 側で
 *  - 試合日ごとの新シート（例 "2026-06-17"）を作成して A〜AB + AD〜AL を書き込み
 *  - 「全試合経過」と、該当月の「◯月月間試合経過」シートへ同じ行を追記
 * する。
 */
object SheetsExporter {

    @Serializable
    data class PitcherRow(val name: String, val runs: Int, val earned: Int)

    @Serializable
    data class Payload(
        val date: String,
        val stadium: String,
        val scoreFirst: Int,
        val scoreSecond: Int,
        /** A〜AB（28列）の行データ配列 */
        val playRows: List<List<String>>,
        /** AD 出場者 */
        val roster: List<String>,
        /** AE/AF/AG 投手名・失点・自責点 */
        val pitchers: List<PitcherRow>,
        /** AH 先発（両チームの先発名） */
        val starters: List<String>,
        /** AI 勝 / AJ 敗 */
        val win: String,
        val loss: String,
        /** AK ホールド / AL セーブ */
        val holds: List<String>,
        val saves: List<String>
    )

    private val json = Json { encodeDefaults = true }
    private val mainHandler = Handler(Looper.getMainLooper())

    // ---- 試合中のリアルタイム速報（失敗しても無視。試合終了時の本保存が正となる） ----

    @Serializable
    private data class LiveStart(val action: String = "liveStart", val date: String, val stadium: String)

    @Serializable
    private data class LivePA(val action: String = "livePA", val row: List<String>)

    @Serializable
    private data class LiveCmd(val action: String)

    /** 1球速報用の「現在の状況」スナップショット */
    @Serializable
    data class LiveState(
        val action: String = "liveState",
        val inning: Int,
        val tb: String,
        val outs: Int,
        val balls: Int,
        val strikes: Int,
        val bases: String,
        val scoreF: Int,
        val scoreS: Int,
        val batter: String,
        val batSide: String,
        val batNum: Int,
        val pitcher: String,
        val pitchSide: String,
        val pitches: List<String>,
        val pending: Boolean
    )

    /** 1球ごと・状況変化ごとに現在状況を送信（速報サイトのライブ表示用） */
    fun liveState(gasUrl: String, s: LiveState) =
        firePost(gasUrl, json.encodeToString(s))

    private fun firePost(gasUrl: String, body: String) {
        if (gasUrl.isBlank()) return
        Thread { runCatching { post(gasUrl, body) } }.start()
    }

    /** 試合開始: LIVEシートを初期化 */
    fun liveStart(gasUrl: String, date: String, stadium: String) =
        firePost(gasUrl, json.encodeToString(LiveStart(date = date, stadium = stadium)))

    /** 打席確定のたびに1行送信 */
    fun livePA(gasUrl: String, log: AtBatLog) =
        firePost(gasUrl, json.encodeToString(LivePA(row = SheetMapper.playRow(log))))

    /** 「前の打者」で戻したとき、直前の行を取り消す */
    fun liveUndo(gasUrl: String) = firePost(gasUrl, json.encodeToString(LiveCmd("liveUndo")))

    /** 試合終了: LIVEシートをクリア（本保存の日付シートに引き継がれる） */
    fun liveEnd(gasUrl: String) = firePost(gasUrl, json.encodeToString(LiveCmd("liveEnd")))

    fun buildPayload(game: HistoryGame): Payload {
        val stats = game.pitcherStats
        return Payload(
            date = game.date,
            stadium = game.stadium,
            scoreFirst = game.scoreFirst,
            scoreSecond = game.scoreSecond,
            playRows = game.detailLogs.map { SheetMapper.playRow(it) },
            roster = (game.firstOrderNames + game.secondOrderNames).distinct(),
            pitchers = stats.map { PitcherRow(it.name, it.runs, it.earnedRuns) },
            starters = stats.filter { it.starter }.map { it.name },
            win = stats.firstOrNull { it.win }?.name ?: "",
            loss = stats.firstOrNull { it.loss }?.name ?: "",
            holds = stats.filter { it.hold }.map { it.name },
            saves = stats.filter { it.save }.map { it.name }
        )
    }

    /** バックグラウンドで POST し、結果をメインスレッドへ返す */
    fun export(gasUrl: String, game: HistoryGame, onDone: (Boolean, String) -> Unit) {
        if (gasUrl.isBlank()) {
            onDone(false, "設定画面でエクスポート先URLを設定してください")
            return
        }
        Thread {
            val (ok, msg) = runCatching { post(gasUrl, json.encodeToString(buildPayload(game))) }
                .getOrElse { false to "送信エラー: ${it.message}" }
            mainHandler.post { onDone(ok, msg) }
        }.start()
    }

    /** GAS は 302 で script.googleusercontent.com へ飛ばすため、リダイレクトを1回手動で追う */
    private fun post(urlStr: String, body: String): Pair<Boolean, String> {
        var conn = open(urlStr, "POST")
        conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        var code = conn.responseCode
        if (code in 300..399) {
            val location = conn.getHeaderField("Location")
                ?: return false to "リダイレクト先が不明です (HTTP $code)"
            conn.disconnect()
            conn = open(location, "GET")
            code = conn.responseCode
        }
        val text = runCatching {
            (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText() ?: ""
        }.getOrDefault("")
        conn.disconnect()
        if (code !in 200..299) return false to "送信失敗 (HTTP $code) ${text.take(200)}"
        // GAS はスクリプト内部でエラーが起きても HTTP 200 で返す。本文の ok を確認する
        return when {
            text.contains("\"ok\":true") -> {
                val sheet = Regex("\"sheet\":\"(.*?)\"").find(text)?.groupValues?.get(1)
                true to ("スプレッドシートへ送信しました" + (sheet?.let { "（シート: $it）" } ?: ""))
            }
            text.contains("\"ok\":false") -> {
                val err = Regex("\"error\":\"(.*?)\"").find(text)?.groupValues?.get(1) ?: text.take(200)
                false to "GAS側でエラー: $err"
            }
            // ok が無い＝古いスクリプト or HTMLエラーページ
            else -> false to "GASの応答が不正です（デプロイを新バージョンに更新してください）: ${text.take(150)}"
        }
    }

    private fun open(urlStr: String, method: String): HttpURLConnection =
        (URL(urlStr).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 30000
            instanceFollowRedirects = false
            if (method == "POST") {
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
            }
        }
}
