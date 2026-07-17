package com.pingpong.entrancesong.data

import android.content.Context
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import java.io.File

class Repository(private val context: Context) {
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
        prettyPrint = true
    }

    private fun file(name: String) = File(context.filesDir, name)

    /** 初回起動時はサークル員マスターの初期データ（名前と投打）を投入する */
    fun loadMembers(): MutableList<Member> {
        val loaded = load<MutableList<Member>>("members.json")
            ?: return DefaultMembers.seed().also { saveMembers(it) }
        // 既存データにフリガナが無いメンバーは、既定名簿から名前一致で後埋めする
        var changed = false
        loaded.forEach { m ->
            if (m.aliases.isEmpty()) {
                DefaultMembers.yomiFor(m.name)?.let { m.aliases.add(it); changed = true }
            }
        }
        if (changed) saveMembers(loaded)
        return loaded
    }

    fun saveMembers(members: List<Member>) = save("members.json", json.encodeToString(members))

    fun loadState(): GameState = load("state.json") ?: GameState()
    fun saveState(state: GameState) = save("state.json", json.encodeToString(state))

    fun loadHistory(): MutableList<HistoryGame> = load("history.json") ?: mutableListOf()
    fun saveHistory(history: List<HistoryGame>) = save("history.json", json.encodeToString(history))

    fun loadSettings(): AppSettings = load("settings.json") ?: AppSettings()
    fun saveSettings(settings: AppSettings) = save("settings.json", json.encodeToString(settings))

    private inline fun <reified T> load(name: String): T? = runCatching {
        val f = file(name)
        if (!f.exists()) null else json.decodeFromString<T>(f.readText())
    }.getOrNull()

    private fun save(name: String, text: String) {
        runCatching { file(name).writeText(text) }
    }
}
