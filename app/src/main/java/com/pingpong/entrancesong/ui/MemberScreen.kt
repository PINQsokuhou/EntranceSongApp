package com.pingpong.entrancesong.ui

import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.material3.FilterChip
import com.pingpong.entrancesong.data.Hand
import com.pingpong.entrancesong.data.Member
import com.pingpong.entrancesong.data.SongRef
import com.pingpong.entrancesong.game.GameEngine
import java.util.UUID

/** メンバー・楽曲データベース管理画面（仕様書 3.1 / 6-3） */
@Composable
fun MemberScreen(modifier: Modifier = Modifier) {
    GameEngine.tick
    var editingId by remember { mutableStateOf<String?>(null) }
    var showAdd by remember { mutableStateOf(false) }

    val editing = GameEngine.members.find { it.id == editingId }

    if (editing != null) {
        MemberEditor(editing, onClose = { editingId = null }, modifier = modifier)
        return
    }

    Column(modifier.fillMaxSize().padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("サークル員一覧", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.weight(1f))
            Button(onClick = { showAdd = true }) { Text("＋ 追加") }
        }
        Spacer(Modifier.height(8.dp))
        val tick = GameEngine.tick
        val sorted = remember(tick) { GameEngine.membersSorted() }
        LazyColumn {
            items(sorted) { m ->
                GameEngine.tick // アイテム単位で変更を購読
                Card(
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 2.dp)
                        .clickable { editingId = m.id }
                ) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.name, style = MaterialTheme.typography.bodyLarge)
                            Text(
                                "${m.batSide.label}打${m.throwSide.label}投 / " +
                                        "打席曲 ${m.battingSongs.size}曲 / 投手曲 ${m.pitchingSongs.size}曲",
                                style = MaterialTheme.typography.labelSmall
                            )
                        }
                    }
                }
            }
        }
    }

    if (showAdd) {
        var name by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showAdd = false },
            title = { Text("メンバー追加") },
            text = {
                OutlinedTextField(value = name, onValueChange = { name = it }, label = { Text("名前") })
            },
            confirmButton = {
                TextButton(onClick = {
                    if (name.isNotBlank()) {
                        val m = Member(id = UUID.randomUUID().toString(), name = name.trim())
                        GameEngine.addMember(m)
                        showAdd = false
                        editingId = m.id
                    }
                }) { Text("追加") }
            },
            dismissButton = { TextButton(onClick = { showAdd = false }) { Text("キャンセル") } }
        )
    }
}

@Composable
private fun MemberEditor(member: Member, onClose: () -> Unit, modifier: Modifier = Modifier) {
    GameEngine.tick
    val ctx = LocalContext.current
    var name by remember(member.id) { mutableStateOf(member.name) }
    var aliases by remember(member.id) { mutableStateOf(member.aliases.joinToString(", ")) }
    var confirmDelete by remember { mutableStateOf(false) }

    fun displayName(uri: Uri): String {
        var result = uri.lastPathSegment ?: "音源"
        runCatching {
            ctx.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)
                ?.use { c ->
                    if (c.moveToFirst()) result = c.getString(0)
                }
        }
        return result
    }

    val pickBatting = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        member.battingSongs.add(SongRef(uri.toString(), displayName(uri)))
        GameEngine.persist()
    }
    val pickPitching = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri ->
        uri ?: return@rememberLauncherForActivityResult
        ctx.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        member.pitchingSongs.add(SongRef(uri.toString(), displayName(uri)))
        GameEngine.persist()
    }

    Column(
        modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("メンバー編集", style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { confirmDelete = true }) { Text("削除") }
        }
        Spacer(Modifier.height(8.dp))

        OutlinedTextField(
            value = name, onValueChange = { name = it },
            label = { Text("名前") }, modifier = Modifier.fillMaxWidth()
        )
        OutlinedTextField(
            value = aliases, onValueChange = { aliases = it },
            label = { Text("フリガナ（あいうえお順の並び替え・検索に使用）") },
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(12.dp))

        // 投・打の左右（3.1）
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("打:", style = MaterialTheme.typography.labelLarge)
            Hand.entries.forEach { h ->
                Spacer(Modifier.padding(2.dp))
                FilterChip(
                    selected = member.batSide == h,
                    onClick = {
                        member.batSide = h
                        GameEngine.persist()
                    },
                    label = { Text(h.label) }
                )
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("投:", style = MaterialTheme.typography.labelLarge)
            Hand.entries.forEach { h ->
                Spacer(Modifier.padding(2.dp))
                FilterChip(
                    selected = member.throwSide == h,
                    onClick = {
                        member.throwSide = h
                        GameEngine.persist()
                    },
                    label = { Text(h.label) }
                )
            }
        }
        Spacer(Modifier.height(16.dp))

        // 打席用登場曲（1〜6曲）
        Text("打席用登場曲（1〜6曲。N曲登録時は打席数に応じて順番に使用）",
            style = MaterialTheme.typography.labelLarge)
        member.battingSongs.toList().forEachIndexed { i, song ->
            SongRow(label = "${i + 1}曲目", song = song) {
                member.battingSongs.removeAt(i)
                GameEngine.persist()
            }
        }
        OutlinedButton(
            onClick = {
                if (member.battingSongs.size >= 6) {
                    Toast.makeText(ctx, "打席用曲は最大6曲です", Toast.LENGTH_SHORT).show()
                } else pickBatting.launch(arrayOf("audio/*"))
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("＋ mp3を追加（${member.battingSongs.size}/6）") }

        Spacer(Modifier.height(16.dp))

        // 投手用登場曲（最大3曲）
        Text("投手用登場曲（最大3曲）", style = MaterialTheme.typography.labelLarge)
        member.pitchingSongs.toList().forEachIndexed { i, song ->
            SongRow(label = "${i + 1}曲目", song = song) {
                member.pitchingSongs.removeAt(i)
                GameEngine.persist()
            }
        }
        OutlinedButton(
            onClick = {
                if (member.pitchingSongs.size >= 3) {
                    Toast.makeText(ctx, "投手用曲は最大3曲です", Toast.LENGTH_SHORT).show()
                } else pickPitching.launch(arrayOf("audio/*"))
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("＋ mp3を追加（${member.pitchingSongs.size}/3）") }

        Spacer(Modifier.height(24.dp))
        Button(
            onClick = {
                member.name = name.trim()
                member.aliases = aliases.split(",", "、")
                    .map { it.trim() }
                    .filter { it.isNotEmpty() }
                    .toMutableList()
                GameEngine.persist()
                onClose()
            },
            modifier = Modifier.fillMaxWidth()
        ) { Text("保存して戻る") }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("メンバー削除") },
            text = { Text("${member.name} をマスターと打順から削除します。よろしいですか？") },
            confirmButton = {
                TextButton(onClick = {
                    GameEngine.deleteMember(member.id)
                    confirmDelete = false
                    onClose()
                }) { Text("削除する") }
            },
            dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("キャンセル") } }
        )
    }
}

@Composable
private fun SongRow(label: String, song: SongRef, onDelete: () -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text("$label: ${song.name}", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        IconButton(onClick = onDelete) { Icon(Icons.Filled.Delete, "削除") }
    }
}
