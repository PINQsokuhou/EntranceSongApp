package com.pingpong.entrancesong.data

import kotlinx.serialization.Serializable

/** mp3ファイルへの参照。uri は SAF の永続化 URI 文字列 */
@Serializable
data class SongRef(
    val uri: String,
    val name: String
)

/** 投・打の左右（3.1） */
@Serializable
enum class Hand(val label: String) {
    RIGHT("右"), LEFT("左"), BOTH("両")
}

/** サークル員マスター（3.1） */
@Serializable
data class Member(
    val id: String,
    var name: String,
    var aliases: MutableList<String> = mutableListOf(),
    var batSide: Hand = Hand.RIGHT,
    var throwSide: Hand = Hand.RIGHT,
    /** 打席用登場曲 1〜6曲。選曲は ((通算打席数-1) mod N)+1 曲目 */
    var battingSongs: MutableList<SongRef> = mutableListOf(),
    /** 投手用登場曲 最大3曲 */
    var pitchingSongs: MutableList<SongRef> = mutableListOf(),
    /** 名前アナウンス音声（チェンジ時に「○○」と読み上げる） */
    var nameAnnounceSong: SongRef? = null,
    /** 1打席目専用曲（初打席のみ通常ローテの代わりに再生） */
    var firstAtBatSong: SongRef? = null,
    /** チャンス時の曲（得点圏＝二塁 or 三塁に走者がいるとき） */
    var chanceSong: SongRef? = null,
    /** 負けている or 引き分け時のチャンス曲 */
    var losingChanceSong: SongRef? = null
)

@Serializable
enum class Team { FIRST, SECOND }

/** 曲再生の簡易ログ（履歴画面の「誰が何打席目に何の曲」表示用） */
@Serializable
data class LogEntry(
    val memberId: String,
    val memberName: String,
    val atBatNumber: Int,
    val songName: String,
    val inning: Int,
    val topBottom: String
)

/**
 * 結果ボタン押下〜詳細確定までの間だけ存在する打席スナップショット（4.2.C）。
 * プロセス死対策で GameState 内に永続化する。
 */
@Serializable
data class PendingResult(
    val resultType: String,
    val batterId: String,
    val batterName: String,
    val batSide: String,
    val atBatNumber: Int,
    val inning: Int,
    val topBottom: String,
    val outsBefore: Int,
    val basesBefore: List<Boolean>,
    val scoreFirstBefore: Int,
    val scoreSecondBefore: Int,
    val pitcherId: String?,
    val pitcherName: String,
    val pitchSide: String,
    val balls: Int,
    val strikes: Int,
    val pitchCount: Int,
    val paStartSec: Long,
    /** 結果ボタンが押された瞬間の試合タイマー値 */
    val resultPressSec: Long,
    /** この結果で自動的にチェンジになるか（アウト/三振で3アウト目） */
    val autoChange: Boolean,
    /** 結果押下時に曲を流した次打者の memberId（確定時に打順を進める対象） */
    val nextBatterId: String?
)

/** 打席ごとの詳細ログ1行（3.3）。列順はスプレッドシート出力順と同じ */
@Serializable
data class AtBatLog(
    val date: String,
    val stadium: String,
    val inning: Int,
    val topBottom: String,
    val outs: Int,
    /** 一・二・三塁の順の "0"/"1" 3文字（例: 走者一三塁 = "101"） */
    val bases: String,
    val scoreFirst: Int,
    val scoreSecond: Int,
    val batterName: String,
    val batSide: String,
    val pitcherName: String,
    val pitchSide: String,
    /** 打席中球数 */
    val pitchCount: Int,
    /** カウント "B-S"（例: "3-2"） */
    val count: String,
    /** 表示・履歴用の結果ラベル（例 "1H2E"）。スプレッドシート出力は resultType から別途変換する */
    val result: String,
    /** 内部の結果種別（Scorebook.RESULT_*）。スプレッドシートの「結果」列変換に使う */
    val resultType: String = "",
    /** 打球方向 0:投 1:左 2:左中 3:中 4:右中 5:右 6:ファール。打球なしは null */
    val direction: Int? = null,
    /** 打球結果（進塁判定に使う）: ゴロ / フライ。フライを1バウンドで捕った等はゴロになる */
    val playResult: String? = null,
    /** 打球性質（記録用）: ゴロ / ライナー / フライ */
    val ballType: String? = null,
    /** バット種類 r,d,y,t,i,w,b,o */
    val batType: String? = null,
    /** 個別状況（併殺、タッチアップ、ワンファンブル、スクイズ成否 など） */
    val situations: List<String> = emptyList(),
    /** 塁打数（打者走者が進んだ塁数） */
    val basesGained: Int = 0,
    /** 失策数 */
    val errors: Int = 0,
    val nextInning: Int,
    val nextTopBottom: String,
    val nextOuts: Int,
    val nextBases: String,
    val nextScoreFirst: Int,
    val nextScoreSecond: Int,
    /** このプレーで入った得点 */
    val runs: Int = 0,
    /** 打点 */
    val rbi: Int = 0,
    /** 打席開始時間（試合タイマー秒）= 前の打者の結果入力が終わった時刻 */
    val paStartSec: Long,
    /** 結果ボタンを押した時刻（試合タイマー秒）。YouTubeハイライト用（−10秒して使う） */
    val resultPressSec: Long = 0,
    /** 打点球投球前時間（得点発生時のみ。結果押下時刻 − 8秒、下限0） */
    val rbiPitchSec: Long? = null,
    /** 何打席目か・流した曲（アプリ内履歴表示用） */
    val atBatNumber: Int = 0,
    val songName: String = ""
)

/** 試合進行ステート（3.2） */
@Serializable
data class GameState(
    var started: Boolean = false,
    /** 試合タイマー起点の epoch ms。null = 未開始 */
    var startEpochMs: Long? = null,
    var endEpochMs: Long? = null,
    var dateLabel: String = "",
    var stadium: String = "",
    /**
     * この試合の球場が確定しているか。試合終了時に true のまま引き継ぐ（同じ打順なら同じ球場）。
     * 打順を編集すると false になり、次の試合開始前に球場の入力を求める。
     */
    var stadiumConfirmed: Boolean = false,
    var inning: Int = 1,
    var attacking: Team = Team.FIRST,
    var firstOrder: MutableList<String> = mutableListOf(),
    var secondOrder: MutableList<String> = mutableListOf(),
    /** −1 = まだ誰も打席に立っていない */
    var firstIndex: Int = -1,
    var secondIndex: Int = -1,
    var outs: Int = 0,
    /** 一・二・三塁の走者有無 */
    var bases: MutableList<Boolean> = mutableListOf(false, false, false),
    var scoreFirst: Int = 0,
    var scoreSecond: Int = 0,
    /** 先攻チーム側の現在投手（後攻の攻撃時に投げる） */
    var pitcherOfFirst: String? = null,
    /** 後攻チーム側の現在投手（先攻の攻撃時に投げる） */
    var pitcherOfSecond: String? = null,
    /** 現在打席のカウント */
    var balls: Int = 0,
    var strikes: Int = 0,
    var pitchCount: Int = 0,
    /** 現在打席の開始時間（試合タイマー秒） */
    var paStartSec: Long = 0,
    /** 現在打席の投球経過（1球速報用。ボール/ストライク/ファール を順に記録） */
    var curPitches: MutableList<String> = mutableListOf(),
    var atBatCounts: MutableMap<String, Int> = mutableMapOf(),
    var pitcherInterrupt: Boolean = false,
    /**
     * 試合開始時・1回裏開始時に投手登場曲を先に流している状態。
     * true の間に停止ボタンを押すか投手曲が自然終了すると先頭打者の曲が流れる（4.2.A）。
     */
    var pendingLeadoff: Boolean = false,
    /** 3ストライク到達後、空振り/見逃しの選択待ち（曲は既に再生開始済み） */
    var awaitingStrikeoutChoice: Boolean = false,
    /** 「前の打者」で戻した直後の1回だけ、次の結果確定で曲を鳴らさない（#2 二度流し防止） */
    var suppressNextResultSong: Boolean = false,
    /** 詳細入力ポップアップ待ちの打席（null = 通常進行中） */
    var pending: PendingResult? = null,
    /**
     * 直近の確定で打順を進めた打者がまだ1球も受けていない状態。
     * この間にチェンジが押されたら投機的な打順前進を巻き戻す
     * （併殺などポップアップで初めて3アウトが判明したケース用）。
     */
    var speculativeBatter: Boolean = false,
    /** speculativeBatter 巻き戻し時に復元する打順インデックス */
    var speculativePrevIndex: Int = -1,
    var log: MutableList<LogEntry> = mutableListOf(),
    var detailLogs: MutableList<AtBatLog> = mutableListOf()
)

/** 投手成績（試合終了時に詳細ログから自動計算） */
@Serializable
data class PitcherStat(
    val name: String,
    val team: String,
    val runs: Int,
    val earnedRuns: Int,
    val starter: Boolean,
    val win: Boolean,
    val loss: Boolean,
    val hold: Boolean,
    val save: Boolean
)

/** 履歴データベース（3.3）: 過去3試合分 */
@Serializable
data class HistoryGame(
    val date: String,
    val stadium: String = "",
    val scoreFirst: Int = 0,
    val scoreSecond: Int = 0,
    val durationSec: Long = 0,
    val firstOrderNames: List<String>,
    val secondOrderNames: List<String>,
    val entries: List<LogEntry>,
    val detailLogs: List<AtBatLog> = emptyList(),
    val pitcherStats: List<PitcherStat> = emptyList(),
    var exported: Boolean = false,
    /** YouTubeタイムスタンプの一律ずらし補正（秒。動画開始と記録開始のずれ吸収用） */
    var tsOffsetSec: Long = 0
)

/** アプリ設定 */
@Serializable
data class AppSettings(
    /** Google Apps Script WebアプリのURL（試合終了時のエクスポート先・速報サイト） */
    var gasUrl: String = "",
    /** 球場名の既定値 */
    var stadium: String = "",
    /** 試合中、1打席ごとに速報サイトへリアルタイム送信するか */
    var liveEnabled: Boolean = true,
    /** 各打者が前回使ったバット種類（memberId → コード）。次の打席のデフォルト選択に使う */
    var lastBatType: MutableMap<String, String> = mutableMapOf(),
    /** ランナー自動スタート時のアナウンス音声 */
    var autoStartAnnounceUri: String = "",
    var autoStartAnnounceName: String = "",
    /** チェンジ時アナウンス（回ごと。インデックス0=1回, 11=12回） */
    var changeAnnounceFirstUris: MutableList<String> = mutableListOf(),
    var changeAnnounceFirstNames: MutableList<String> = mutableListOf(),
    var changeAnnounceSecondUris: MutableList<String> = mutableListOf(),
    var changeAnnounceSecondNames: MutableList<String> = mutableListOf(),
    /** 打順番号アナウンス（インデックス0=1番, 14=15番） */
    var orderAnnounceUris: MutableList<String> = mutableListOf(),
    var orderAnnounceNames: MutableList<String> = mutableListOf(),
    /** 投手交代アナウンス（前半=「○○チーム ピッチャーの交代を…」、後半=「に代わりまして ピッチャー」） */
    var pitchChangeFirstFrontUri: String = "",
    var pitchChangeFirstFrontName: String = "",
    var pitchChangeFirstBackUri: String = "",
    var pitchChangeFirstBackName: String = "",
    var pitchChangeSecondFrontUri: String = "",
    var pitchChangeSecondFrontName: String = "",
    var pitchChangeSecondBackUri: String = "",
    var pitchChangeSecondBackName: String = ""
)
