package com.pingpong.entrancesong.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.pingpong.entrancesong.data.Member
import com.pingpong.entrancesong.data.Team
import com.pingpong.entrancesong.game.GameEngine

/** 打順編集画面（仕様書 4.3 / 6-2）。OCRは廃止し、メンバー検索で打順を組む */
@Composable
fun OrderEditScreen(modifier: Modifier = Modifier) {
    GameEngine.tick
    var teamTab by remember { mutableIntStateOf(0) }
    val team = if (teamTab == 0) Team.FIRST else Team.SECOND

    // メンバー選択ダイアログ: 挿入位置を持つ（null = 非表示）
    var insertPos by remember { mutableStateOf<Int?>(null) }
    var confirmClearAll by remember { mutableStateOf(false) }

    Column(modifier.fillMaxSize().padding(16.dp)) {
        TabRow(selectedTabIndex = teamTab) {
            Tab(selected = teamTab == 0, onClick = { teamTab = 0 }, text = { Text("先攻") })
            Tab(selected = teamTab == 1, onClick = { teamTab = 1 }, text = { Text("後攻") })
        }
        Spacer(Modifier.height(8.dp))

        // 先攻・後攻の入れ替え / 一括削除（試合開始前のみ）
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { GameEngine.swapOrders() },
                enabled = !GameEngine.state.started
            ) { Text("先攻⇔後攻 入替") }
            OutlinedButton(
                onClick = { confirmClearAll = true },
                enabled = !GameEngine.state.started
            ) { Text("一括削除") }
        }
        if (GameEngine.state.started) {
            Text(
                "※ 試合中は一括削除できません。個別の削除・挿入は可能です",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Spacer(Modifier.height(8.dp))

        // tick を含めてリストを作り直すことで、挿入・削除が LazyColumn に即時反映される
        val tick = GameEngine.tick
        val order = remember(tick, teamTab) { GameEngine.orderOf(team).toList() }
        val currentIdx = GameEngine.indexOf(team)

        LazyColumn(Modifier.weight(1f)) {
            item {
                TextButton(onClick = { insertPos = 0 }) { Text("＋ 先頭に挿入") }
            }
            itemsIndexed(order) { i, id ->
                GameEngine.tick // アイテム単位で変更を購読
                val m = GameEngine.memberById(id)
                Card(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    Row(Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "${i + 1}番  ${m?.name ?: "(不明)"}" + if (i == currentIdx) "  ← 現打者" else "",
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier.weight(1f)
                        )
                        IconButton(onClick = { insertPos = i + 1 }) {
                            Icon(Icons.Filled.Add, "この下に挿入")
                        }
                        IconButton(onClick = { GameEngine.removeFromOrder(team, i) }) {
                            Icon(Icons.Filled.Delete, "削除")
                        }
                    }
                }
            }
            item {
                if (order.size < 3) {
                    Text(
                        "※ 試合開始には3人以上必要です（現在 ${order.size} 人）",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.error
                    )
                }
            }
        }
    }

    // メンバー選択（挿入）ダイアログ
    insertPos?.let { pos ->
        MemberPickerDialog(
            title = "打順 ${pos + 1} 番に挿入",
            onSelect = { m ->
                GameEngine.insertIntoOrder(team, pos, m.id)
                insertPos = null
            },
            onDismiss = { insertPos = null }
        )
    }

    // 打順一括削除の確認
    if (confirmClearAll) {
        AlertDialog(
            onDismissRequest = { confirmClearAll = false },
            title = { Text("打順を一括削除") },
            text = { Text("先攻・後攻の打順をすべて削除します。よろしいですか？") },
            confirmButton = {
                TextButton(onClick = {
                    GameEngine.clearAllOrders()
                    confirmClearAll = false
                }) { Text("削除する") }
            },
            dismissButton = {
                TextButton(onClick = { confirmClearAll = false }) { Text("キャンセル") }
            }
        )
    }
}

/** マスターから検索して1人選ぶ共通ダイアログ（あいうえお順・フリガナ検索対応） */
@Composable
fun MemberPickerDialog(
    title: String,
    onSelect: (Member) -> Unit,
    onDismiss: () -> Unit,
    candidateIds: List<String>? = null
) {
    var query by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column {
                OutlinedTextField(
                    value = query,
                    onValueChange = { query = it },
                    label = { Text("検索（名前・フリガナ）") },
                    modifier = Modifier.fillMaxWidth()
                )
                Spacer(Modifier.height(8.dp))
                val base = if (candidateIds != null)
                    candidateIds.mapNotNull { GameEngine.memberById(it) }
                else
                    GameEngine.membersSorted()
                val filtered = base.filter {
                    query.isBlank() || it.name.contains(query) ||
                            it.aliases.any { a -> a.contains(query) }
                }
                LazyColumn(Modifier.heightIn(max = 300.dp)) {
                    items(filtered) { m ->
                        GameEngine.tick // アイテム単位で変更を購読
                        Text(
                            m.name,
                            style = MaterialTheme.typography.bodyLarge,
                            modifier = Modifier
                                .fillMaxWidth()
                                .clickable { onSelect(m) }
                                .padding(vertical = 10.dp)
                        )
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("キャンセル") } }
    )
}
