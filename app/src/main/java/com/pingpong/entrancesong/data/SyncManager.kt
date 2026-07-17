package com.pingpong.entrancesong.data

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Base64
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.util.UUID

/**
 * サークル員マスター（名前・フリガナ・左右・登場曲）を、共有スプレッドシート＋共有Driveから
 * 同期する。楽曲は GAS 経由で Drive から base64 で取得し、端末ローカルに保存する。
 *
 * サーバー側の想定（README 参照）:
 *  - スプレッドシートに「楽曲登録」シート（名前/フリガナ/打/投/打席曲1〜6/投手曲1〜3、
 *    曲セルは Drive の共有リンク or ファイルID）
 *  - GAS doGet(action=roster) が上記を JSON で返す
 *  - GAS doGet(action=song&id=…) が Drive ファイルを base64 で返す
 */
object SyncManager {

    @Serializable
    private data class RosterResp(
        val ok: Boolean = false,
        val error: String = "",
        val members: List<RosterMember> = emptyList(),
        val announcements: Map<String, SongMeta> = emptyMap()
    )

    @Serializable
    private data class RosterMember(
        val name: String,
        val furigana: String = "",
        val bat: String = "右",
        @SerialName("throw") val throwSide: String = "右",
        val battingSongs: List<SongMeta> = emptyList(),
        val pitchingSongs: List<SongMeta> = emptyList(),
        val nameAnnounce: SongMeta? = null,
        val firstAtBatSong: SongMeta? = null,
        val chanceSong: SongMeta? = null,
        val losingChanceSong: SongMeta? = null
    )

    @Serializable
    private data class SongMeta(val id: String, val name: String = "")

    @Serializable
    private data class SongResp(
        val ok: Boolean = false,
        val error: String = "",
        val name: String = "",
        val dataBase64: String = ""
    )

    private val json = Json { ignoreUnknownKeys = true }
    private val mainHandler = Handler(Looper.getMainLooper())

    private fun handOf(s: String): Hand = when (s.trim()) {
        "左" -> Hand.LEFT
        "両" -> Hand.BOTH
        else -> Hand.RIGHT
    }

    /** 同期の実行。進捗は onProgress、完了は onDone（成功/メッセージ/生成メンバー）で返す */
    fun sync(
        context: Context,
        gasUrl: String,
        onProgress: (String) -> Unit,
        onDone: (Boolean, String, List<Member>?) -> Unit
    ) {
        if (gasUrl.isBlank()) {
            onDone(false, "設定でエクスポート先URLを設定してください", null)
            return
        }
        val appCtx = context.applicationContext
        Thread {
            val result = runCatching { doSync(appCtx, gasUrl) { p -> mainHandler.post { onProgress(p) } } }
            mainHandler.post {
                result.onSuccess { (msg, members) -> onDone(true, msg, members) }
                    .onFailure { onDone(false, "同期エラー: ${it.message}", null) }
            }
        }.start()
    }

    private fun doSync(
        context: Context,
        gasUrl: String,
        progress: (String) -> Unit
    ): Pair<String, List<Member>> {
        progress("メンバー情報を取得中…")
        val rosterText = httpGet("$gasUrl?action=roster")
        val roster = json.decodeFromString<RosterResp>(rosterText)
        if (!roster.ok) throw IllegalStateException(roster.error.ifBlank { "roster取得に失敗" })

        val songDir = File(context.filesDir, "songs").apply { mkdirs() }

        // 全楽曲のファイルIDを重複排除（名前アナウンス・状況別曲・システムアナウンス含む）
        val allIds = (roster.members
            .flatMap { it.battingSongs + it.pitchingSongs +
                    listOfNotNull(it.nameAnnounce, it.firstAtBatSong, it.chanceSong, it.losingChanceSong) } +
            roster.announcements.values)
            .map { it.id }
            .filter { it.isNotBlank() }
            .distinct()

        // ファイルIDごとにローカル保存（既にあればスキップ）→ id→(localUri, name)
        val downloaded = HashMap<String, Pair<String, String>>()
        var done = 0
        for (id in allIds) {
            done++
            val local = File(songDir, "$id.mp3")
            if (local.exists() && local.length() > 0) {
                downloaded[id] = ("file://" + local.absolutePath) to local.nameWithoutExtension
                continue
            }
            progress("楽曲をダウンロード中… ($done/${allIds.size})")
            val songText = httpGet("$gasUrl?action=song&id=${URLEncoder.encode(id, "UTF-8")}")
            val song = json.decodeFromString<SongResp>(songText)
            if (!song.ok || song.dataBase64.isBlank()) continue
            val bytes = Base64.decode(song.dataBase64, Base64.DEFAULT)
            local.writeBytes(bytes)
            downloaded[id] = ("file://" + local.absolutePath) to song.name.ifBlank { id }
        }

        // メンバーを組み立て（IDは名前から決定的に。既存の打順参照が壊れないように）
        fun songRefs(metas: List<SongMeta>): MutableList<SongRef> =
            metas.mapNotNull { m ->
                downloaded[m.id]?.let { (uri, name) -> SongRef(uri, m.name.ifBlank { name }) }
            }.toMutableList()

        val members = roster.members.map { rm ->
            fun optSong(meta: SongMeta?): SongRef? = meta?.let { m ->
                downloaded[m.id]?.let { (uri, name) -> SongRef(uri, m.name.ifBlank { name }) }
            }
            Member(
                id = stableId(rm.name),
                name = rm.name,
                aliases = if (rm.furigana.isBlank()) mutableListOf() else mutableListOf(rm.furigana),
                batSide = handOf(rm.bat),
                throwSide = handOf(rm.throwSide),
                battingSongs = songRefs(rm.battingSongs),
                pitchingSongs = songRefs(rm.pitchingSongs),
                nameAnnounceSong = optSong(rm.nameAnnounce),
                firstAtBatSong = optSong(rm.firstAtBatSong),
                chanceSong = optSong(rm.chanceSong),
                losingChanceSong = optSong(rm.losingChanceSong)
            )
        }

        // システムアナウンスを AppSettings に保存
        fun announceUri(key: String): Pair<String, String> {
            val meta = roster.announcements[key] ?: return "" to ""
            val d = downloaded[meta.id] ?: return "" to ""
            return d.first to d.second
        }
        val settings = com.pingpong.entrancesong.game.GameEngine.settings
        announceUri("autoStart").let { (uri, name) ->
            if (uri.isNotBlank()) { settings.autoStartAnnounceUri = uri; settings.autoStartAnnounceName = name }
        }
        val firstUris = mutableListOf<String>()
        val firstNames = mutableListOf<String>()
        val secondUris = mutableListOf<String>()
        val secondNames = mutableListOf<String>()
        for (i in 1..12) {
            announceUri("changeFirst$i").let { (uri, name) -> firstUris.add(uri); firstNames.add(name) }
            announceUri("changeSecond$i").let { (uri, name) -> secondUris.add(uri); secondNames.add(name) }
        }
        settings.changeAnnounceFirstUris = firstUris
        settings.changeAnnounceFirstNames = firstNames
        settings.changeAnnounceSecondUris = secondUris
        settings.changeAnnounceSecondNames = secondNames
        val orderUris = mutableListOf<String>()
        val orderNames = mutableListOf<String>()
        for (i in 1..15) {
            announceUri("order$i").let { (uri, name) -> orderUris.add(uri); orderNames.add(name) }
        }
        settings.orderAnnounceUris = orderUris
        settings.orderAnnounceNames = orderNames
        // 投手交代アナウンス
        announceUri("pitchChangeFirst1").let { (uri, name) ->
            if (uri.isNotBlank()) { settings.pitchChangeFirstFrontUri = uri; settings.pitchChangeFirstFrontName = name }
        }
        announceUri("pitchChangeFirst2").let { (uri, name) ->
            if (uri.isNotBlank()) { settings.pitchChangeFirstBackUri = uri; settings.pitchChangeFirstBackName = name }
        }
        announceUri("pitchChangeSecond1").let { (uri, name) ->
            if (uri.isNotBlank()) { settings.pitchChangeSecondFrontUri = uri; settings.pitchChangeSecondFrontName = name }
        }
        announceUri("pitchChangeSecond2").let { (uri, name) ->
            if (uri.isNotBlank()) { settings.pitchChangeSecondBackUri = uri; settings.pitchChangeSecondBackName = name }
        }
        com.pingpong.entrancesong.game.GameEngine.saveSettings()

        return "同期完了: ${members.size}名 / 楽曲 ${downloaded.size}曲" to members
    }

    /** 名前から決定的な ID（再同期しても打順参照が保たれるように） */
    fun stableId(name: String): String =
        "srv-" + UUID.nameUUIDFromBytes(name.toByteArray(Charsets.UTF_8)).toString()

    /** GAS の doGet を叩く。302 リダイレクト（googleusercontent）を最大3回追う */
    private fun httpGet(urlStr: String): String {
        var url = urlStr
        var redirects = 0
        while (true) {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 15000
                readTimeout = 60000
                instanceFollowRedirects = false
            }
            val code = conn.responseCode
            if (code in 300..399 && redirects < 3) {
                val loc = conn.getHeaderField("Location") ?: throw IllegalStateException("リダイレクト先不明")
                conn.disconnect()
                url = loc
                redirects++
                continue
            }
            val text = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.readText() ?: ""
            conn.disconnect()
            if (code !in 200..299) throw IllegalStateException("HTTP $code ${text.take(120)}")
            return text
        }
    }
}
