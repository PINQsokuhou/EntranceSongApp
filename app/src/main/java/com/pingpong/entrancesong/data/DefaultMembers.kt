package com.pingpong.entrancesong.data

import java.util.UUID

/**
 * サークル員マスターの初期データ。
 * 管理用スプレッドシートのメンバー表（名前・打・投）から取り込んだもの。
 * 空欄だった投打は右として登録している。曲はアプリ上で各自登録する。
 *
 * フリガナ（yomi）はあいうえお順の並び替え・検索に使う。読みが複数考えられる姓
 * （上坂・梅谷・冨髙・野平・練石 など）は一般的な読みを暫定で入れているので、
 * 実際と違う場合はメンバー編集画面のフリガナ欄で直すこと。
 */
object DefaultMembers {

    private data class Seed(val name: String, val yomi: String, val bat: Hand, val throwSide: Hand)

    // 名前, フリガナ, 打, 投
    private val roster = listOf(
        Seed("上野", "うえの", Hand.RIGHT, Hand.RIGHT),
        Seed("清水川", "しみずかわ", Hand.RIGHT, Hand.RIGHT),
        Seed("西村", "にしむら", Hand.RIGHT, Hand.RIGHT),
        Seed("橋本", "はしもと", Hand.RIGHT, Hand.RIGHT),
        Seed("山村", "やまむら", Hand.RIGHT, Hand.RIGHT),
        Seed("藤田", "ふじた", Hand.RIGHT, Hand.RIGHT),
        Seed("堀江", "ほりえ", Hand.RIGHT, Hand.RIGHT),
        Seed("新井", "あらい", Hand.RIGHT, Hand.RIGHT),
        Seed("上坂", "うえさか", Hand.RIGHT, Hand.RIGHT),
        Seed("鵜飼", "うかい", Hand.RIGHT, Hand.RIGHT),
        Seed("川勝", "かわかつ", Hand.LEFT, Hand.RIGHT),
        Seed("仙田", "せんだ", Hand.RIGHT, Hand.RIGHT),
        Seed("田中", "たなか", Hand.RIGHT, Hand.RIGHT),
        Seed("冨髙", "とみたか", Hand.LEFT, Hand.RIGHT),
        Seed("布目", "ぬのめ", Hand.RIGHT, Hand.RIGHT),
        Seed("吉田", "よしだ", Hand.RIGHT, Hand.RIGHT),
        Seed("石田", "いしだ", Hand.RIGHT, Hand.RIGHT),
        Seed("梅谷", "うめたに", Hand.RIGHT, Hand.RIGHT),
        Seed("大嶋", "おおしま", Hand.LEFT, Hand.RIGHT),
        Seed("金田", "かねだ", Hand.RIGHT, Hand.RIGHT),
        Seed("谷", "たに", Hand.RIGHT, Hand.RIGHT),
        Seed("玉木", "たまき", Hand.LEFT, Hand.LEFT),
        Seed("中根", "なかね", Hand.LEFT, Hand.RIGHT),
        Seed("野平", "のひら", Hand.BOTH, Hand.RIGHT),
        Seed("原田", "はらだ", Hand.RIGHT, Hand.RIGHT),
        Seed("大庭", "おおば", Hand.RIGHT, Hand.RIGHT),
        Seed("杉江", "すぎえ", Hand.LEFT, Hand.RIGHT),
        Seed("練石", "ねりいし", Hand.RIGHT, Hand.RIGHT),
        Seed("林", "はやし", Hand.RIGHT, Hand.RIGHT),
        Seed("俣野", "またの", Hand.RIGHT, Hand.RIGHT),
        Seed("湯浅", "ゆあさ", Hand.RIGHT, Hand.RIGHT)
    )

    fun seed(): MutableList<Member> = roster.map { s ->
        Member(
            id = UUID.randomUUID().toString(),
            name = s.name,
            aliases = mutableListOf(s.yomi),
            batSide = s.bat,
            throwSide = s.throwSide
        )
    }.toMutableList()

    /** 名前からフリガナを引く（既存データへのフリガナ後埋め用） */
    fun yomiFor(name: String): String? = roster.firstOrNull { it.name == name }?.yomi
}
