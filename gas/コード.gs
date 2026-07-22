// ============================================================
// 登場曲アプリ 連携 Apps Script 完全版
//  1. 試合終了時の記録受信（日付シート作成 + 全試合経過/月間へ追記）
//  2. メンバー・楽曲の同期 (?action=roster / ?action=song&id=)
//  3. 野球速報サイト（WebアプリURLをブラウザで開くと試合一覧・スコアが見える）
//  4. 試合中のリアルタイム速報（アプリが1打席ごとに送信 → LIVEシート）
// 貼り付け後は「デプロイ → デプロイを管理 → 新バージョンで更新」を忘れずに。
// ============================================================

const ALL_GAMES = "全試合経過";   // 全試合を積み上げるシート名
const ROSTER_SHEET = "楽曲登録";  // メンバー・楽曲の一元管理シート（タブ名）
// 楽曲登録を別ファイルに置く場合、そのスプレッドシートIDを入れる（"" なら同じファイル内）
const ROSTER_SS_ID = "1_7pMPpgLpNvroqfYcMRODo3t8S_OHVzP69nqMAzLbig";
const LIVE_SHEET = "LIVE";        // 試合中のリアルタイム記録
// 新しい月の「N月間成績」を作るときに複製するテンプレシート名。
// A1に経過シート名を入れると全数式が追従する作りのシートを指定する。
const SEISEKI_TEMPLATE = "シーズン通算成績";

// サイトの表示バージョン（デプロイ反映確認用。ページ最下部に表示される）
const SITE_VER = "site v21";

// サイトパスワード（空ならパスワードなし）
const SITE_PASSWORD = "pingpong";

// アプリ配布: APK を Drive にアップして共有リンク（またはファイルID）をここに貼ると、
// 試合一覧ページに「アプリをダウンロード」ボタンが出る。空なら非表示。
const APK_URL = "";

// 率系ランキング（打率・防御率など）の規定ライン
const BAT_MIN_PA = 10;   // 打者: 10打席以上
const PIT_MIN_OUTS = 15; // 投手: 5回（15アウト）以上

// ---- 戦評の自動生成（Gemini API）----
// 使い方: Apps Script の プロジェクトの設定 → スクリプト プロパティ に
// GEMINI_API_KEY = （aistudio.google.com で取得したAPIキー） を追加する。
// キーが未設定なら戦評セクションは表示されないだけで、他の機能に影響はない。
const REVIEW_SHEET = "戦評";
const GEMINI_MODEL = "gemini-2.5-flash";

const HEADER = [
  "日付","球場","回","表裏","アウト数","塁況","得点・先","得点・後",
  "打者","打左右","投手","投左右","打席中球数","カウント","結果",
  "打球方向","打球性質","バット種類","塁打数","失策数",
  "次の回","次の表裏","次のアウト数","次の塁況","次の得点・先","次の得点・後",
  "得点","打点"
];
const PBLOCK_HEADER = ["出場者","投手名","失点","自責点","先発","勝","敗","ホールド","セーブ"];
const PBLOCK_COL = 30; // AD列

// ---------------- エントリポイント ----------------

function doGet(e) {
  const p = (e && e.parameter) ? e.parameter : {};
  if (p.action === "roster") return json(getRoster());
  if (p.action === "song") return json(getSong(p.id));

  // スコアブック記録ページ（ブラウザ版・試合前セットアップ〜1球速報〜試合終了保存）
  // renderRecord() は完全なHTMLを自前で組み立てて返すため、page()やraw=1のURL置換は経由しない
  // （ページ内のfetch送信先として絶対URLが必要なため）
  if (p.view === "record") return htmlOut(renderRecord());

  const cache = CacheService.getScriptCache();
  let h;
  // 試合ページ（ライブは毎回最新、終了試合はキャッシュ）
  if (p.view === "game") {
    // 終了した試合の内容はもう変わらないので長めにキャッシュする（ライブは毎回最新）
    h = (p.sheet === LIVE_SHEET) ? renderGame(p.sheet)
      : cached(cache, "g:" + p.sheet, 1800, function () { return renderGame(p.sheet); });
  } else if (p.view === "stats") {
    // 個人成績（種目・期間ごとにキャッシュ）
    const key = "s:" + (p.type || "") + ":" + (p.period || "") + ":" + (p.stat || "");
    h = cached(cache, key, 90, function () {
      return renderStats(p.type || "bat", p.stat || "", p.period || "");
    });
  } else if (p.view === "music") {
    h = cached(cache, "music", 600, function () { return renderMusic(); });
  } else {
    // 試合一覧（全シートを読むので特にキャッシュが効く）
    h = cached(cache, "index", 60, function () { return renderIndex(); });
  }

  // raw=1: 静的ホスティングのラッパーページ（site/index.html）から fetch で読む用。
  // Cookieが送られないためGoogleの多重ログイン問題を回避できる。
  // 自身のexec URLを取り除き、リンクをラッパー相対（?view=...）に変換して素のHTMLを返す
  if (p.raw === "1") {
    const u = ScriptApp.getService().getUrl();
    return ContentService.createTextOutput(h.split(u).join(""));
  }
  return htmlOut(h);
}

// キャッシュにあれば返し、無ければ生成して保存（100KB未満のみ保存）
function cached(cache, key, ttl, build) {
  let h = cache.get(key);
  if (h) return h;
  h = build();
  if (h && h.length < 100000) { try { cache.put(key, h, ttl); } catch (e) {} }
  return h;
}

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.action === "liveStart") return json(liveStart(d));
    if (d.action === "livePA") return json(livePA(d));
    if (d.action === "liveUndo") return json(liveUndo());
    if (d.action === "liveEnd") return json(liveEnd());
    if (d.action === "liveState") return json(liveSetState(d));
    return json(saveGame(d)); // 試合終了時の本保存
  } catch (err) {
    return json({ ok: false, error: String(err) });
  }
}

// google.script.run から呼べるディスパッチ関数（record ページ用）
function recordAction(d) {
  if (d.action === "liveStart") return liveStart(d);
  if (d.action === "livePA") return livePA(d);
  if (d.action === "liveUndo") return liveUndo();
  if (d.action === "liveEnd") return liveEnd();
  if (d.action === "liveState") return liveSetState(d);
  return saveGame(d);
}

function json(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function htmlOut(s) {
  // GASはHTMLをiframeで包むため、viewportは addMetaTag で外側ページに設定する必要がある
  return HtmlService.createHtmlOutput(s)
    .setTitle("ピンポン野球 速報")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}
function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

// ---------------- 1) 試合終了時の本保存 ----------------

function saveGame(d) {
  const book = ss();
  // 試合日ごとの新シート（重複したら -2, -3 …）
  let name = d.date, i = 2;
  while (book.getSheetByName(name)) { name = d.date + "-" + i; i++; }
  // #3 新しい試合シートは一番右（末尾）に作る
  const sheet = book.insertSheet(name, book.getNumSheets());
  sheet.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  sheet.getRange(1, PBLOCK_COL, 1, PBLOCK_HEADER.length).setValues([PBLOCK_HEADER]);
  writeGame(sheet, 2, d);

  const allSheet = book.getSheetByName(ALL_GAMES);
  appendGame(allSheet, d);

  // #1 該当月の「N月試合経過」へ追記。無ければ経過シート＋「N月間成績」を自動作成
  const month = parseInt(d.date.split("-")[1], 10);
  const monthly = ensureMonthlySheets(book, month);
  if (monthly) appendGame(monthly, d);

  SpreadsheetApp.flush();
  // 一覧キャッシュを消して、終わった試合をすぐ反映
  try { CacheService.getScriptCache().remove("index"); } catch (e) {}
  return { ok: true, sheet: name, allGames: !!allSheet, monthly: monthly ? monthly.getName() : null };
}

// その月の月間経過シートを返す。無ければ「N月試合経過」＋「N月間成績」を新規作成
function ensureMonthlySheets(book, month) {
  // 既存の範囲シート（"4-5月月間試合経過" 等）がこの月を含むならそれを使う（後方互換）
  const ranged = findMonthlySheet(book, month);
  if (ranged) return ranged;
  const name = month + "月試合経過";
  let sh = book.getSheetByName(name);
  if (sh) return sh;
  // 新規作成: 経過シート（ヘッダー付き）
  sh = book.insertSheet(name, book.getNumSheets());
  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  sh.getRange(1, PBLOCK_COL, 1, PBLOCK_HEADER.length).setValues([PBLOCK_HEADER]);
  // 成績シートをテンプレ複製で作成（A1に経過シート名を入れると全数式が追従する）
  createMonthlySeiseki(book, month, name);
  return sh;
}

function createMonthlySeiseki(book, month, keikaName) {
  const seisekiName = month + "月間成績";
  if (book.getSheetByName(seisekiName)) return;
  const tmpl = book.getSheetByName(SEISEKI_TEMPLATE);
  if (!tmpl) return; // テンプレが無ければ成績シートはスキップ（経過シートだけ作る）
  const copy = tmpl.copyTo(book);
  copy.setName(seisekiName);
  copy.getRange("A1").setValue(keikaName); // 全数式 INDIRECT($A$1) がこの経過シートを参照
}

function num(v) {
  return (v !== "" && /^-?\d+(\.\d+)?$/.test(v)) ? Number(v) : v;
}

function appendGame(sheet, d) {
  if (!sheet) return;
  writeGame(sheet, sheet.getLastRow() + 1, d);
}

function writeGame(sheet, startRow, d) {
  if (d.playRows.length > 0) {
    const rows = d.playRows.map(r => r.map(num));
    sheet.getRange(startRow, 1, rows.length, HEADER.length).setValues(rows);
  }
  const n = Math.max(d.roster.length, d.pitchers.length, d.starters.length,
    d.holds.length, d.saves.length, 1);
  const block = [];
  for (let r = 0; r < n; r++) {
    block.push([
      d.roster[r] || "",
      d.pitchers[r] ? d.pitchers[r].name : "",
      d.pitchers[r] ? d.pitchers[r].runs : "",
      d.pitchers[r] ? d.pitchers[r].earned : "",
      d.starters[r] || "",
      r === 0 ? (d.win || "") : "",
      r === 0 ? (d.loss || "") : "",
      d.holds[r] || "",
      d.saves[r] || ""
    ]);
  }
  sheet.getRange(startRow, PBLOCK_COL, n, PBLOCK_HEADER.length).setValues(block);
}

function findMonthlySheet(book, month) {
  const re = /^(\d+)(?:-(\d+))?月月間試合経過$/;
  const sheets = book.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const m = sheets[i].getName().match(re);
    if (!m) continue;
    const lo = parseInt(m[1], 10);
    const hi = m[2] ? parseInt(m[2], 10) : lo;
    if (month >= lo && month <= hi) return sheets[i];
  }
  return null;
}

// ---------------- 2) メンバー・楽曲の同期 ----------------

function getRoster() {
  try {
    const book = ROSTER_SS_ID ? SpreadsheetApp.openById(ROSTER_SS_ID) : ss();
    const sh = book.getSheetByName(ROSTER_SHEET);
    if (!sh) return { ok: false, error: ROSTER_SHEET + " シートがありません", members: [] };
    const v = sh.getDataRange().getValues();
    const members = [];
    for (let r = 1; r < v.length; r++) {
      const name = (v[r][0] || "").toString().trim();
      if (!name) continue; // 名前が無い行はURL行（下段）なのでスキップ
      // 直下の行に名前が無ければ、それがこのメンバーのURL行
      const urlRow = (r + 1 < v.length && !(v[r + 1][0] || "").toString().trim()) ? v[r + 1] : null;
      function song(c) {
        const title = (v[r][c] || "").toString().trim();
        let id = urlRow ? fileId(urlRow[c]) : "";
        // 旧形式・貼り間違い対応: 上段のセルがURLならそこからIDを取る
        if (!id && /^https?:/.test(title)) id = fileId(title);
        if (!id) return null;
        return { id: id, name: /^https?:/.test(title) ? "" : title };
      }
      const bat = [];
      for (let c = 4; c <= 9; c++) { const s = song(c); if (s) bat.push(s); }
      const pit = [];
      for (let c = 10; c <= 12; c++) { const s = song(c); if (s) pit.push(s); }
      const na = song(13);
      const fab = song(14);
      const ch = song(15);
      const lch = song(16);
      const m = {
        name: name,
        furigana: (v[r][1] || "").toString().trim(),
        bat: (v[r][2] || "右").toString().trim(),
        throw: (v[r][3] || "右").toString().trim(),
        battingSongs: bat,
        pitchingSongs: pit
      };
      if (na) m.nameAnnounce = na;
      if (fab) m.firstAtBatSong = fab;
      if (ch) m.chanceSong = ch;
      if (lch) m.losingChanceSong = lch;
      members.push(m);
    }
    // システムアナウンス: S2=自動スタート, T2:AE2=先攻1〜12回, AF2:AQ2=後攻1〜12回, AS2:BG2=1番〜15番, BH2:BK2=投手交代
    const announcements = {};
    try {
      var asId = fileId(sh.getRange("S2").getValue());
      if (asId) announcements.autoStart = { id: asId, name: "" };
      var firstRow = sh.getRange("T2:AE2").getValues()[0];
      for (var i = 0; i < 12; i++) {
        var id = fileId(firstRow[i]);
        if (id) announcements["changeFirst" + (i + 1)] = { id: id, name: "" };
      }
      var secondRow = sh.getRange("AF2:AQ2").getValues()[0];
      for (var i = 0; i < 12; i++) {
        var id = fileId(secondRow[i]);
        if (id) announcements["changeSecond" + (i + 1)] = { id: id, name: "" };
      }
      var orderRow = sh.getRange("AS2:BG2").getValues()[0];
      for (var i = 0; i < 15; i++) {
        var id = fileId(orderRow[i]);
        if (id) announcements["order" + (i + 1)] = { id: id, name: "" };
      }
      // BH2:BK2 = 投手交代アナウンス（先攻前半/後半、後攻前半/後半）
      var pcRow = sh.getRange("BH2:BK2").getValues()[0];
      var pcKeys = ["pitchChangeFirst1","pitchChangeFirst2","pitchChangeSecond1","pitchChangeSecond2"];
      for (var i = 0; i < 4; i++) {
        var id = fileId(pcRow[i]);
        if (id) announcements[pcKeys[i]] = { id: id, name: "" };
      }
    } catch (e) { /* 列が無い場合は無視 */ }
    return { ok: true, members: members, announcements: announcements };
  } catch (err) {
    return { ok: false, error: String(err), members: [] };
  }
}

function getSong(id) {
  try {
    const f = DriveApp.getFileById(id);
    return { ok: true, name: f.getName(), dataBase64: Utilities.base64Encode(f.getBlob().getBytes()) };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function fileId(v) {
  if (!v) return "";
  const m = v.toString().match(/[-\w]{25,}/);
  return m ? m[0] : "";
}

// ---------------- 4) リアルタイム速報の受信 ----------------

function liveSheet() {
  const book = ss();
  return book.getSheetByName(LIVE_SHEET) || book.insertSheet(LIVE_SHEET);
}

function liveStart(d) {
  const sh = liveSheet();
  sh.clear();
  sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]);
  PropertiesService.getScriptProperties().setProperty(
    "liveMeta", JSON.stringify({ date: d.date || "", stadium: d.stadium || "" })
  );
  try { CacheService.getScriptCache().remove("index"); } catch (e) {}
  return { ok: true };
}

function livePA(d) {
  const sh = liveSheet();
  sh.getRange(sh.getLastRow() + 1, 1, 1, HEADER.length).setValues([d.row.map(num)]);
  return { ok: true };
}

function liveUndo() {
  const sh = liveSheet();
  if (sh.getLastRow() >= 2) sh.deleteRow(sh.getLastRow());
  return { ok: true };
}

function liveEnd() {
  const sh = liveSheet();
  sh.clear();
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty("liveMeta");
  props.deleteProperty("liveState");
  try { CacheService.getScriptCache().remove("index"); } catch (e) {}
  return { ok: true };
}

function liveMeta() {
  const s = PropertiesService.getScriptProperties().getProperty("liveMeta");
  return s ? JSON.parse(s) : null;
}

// 1球速報: 現在状況（現打者・カウント・投球経過）を保存
function liveSetState(d) {
  PropertiesService.getScriptProperties().setProperty("liveState", JSON.stringify(d));
  return { ok: true };
}

function liveState() {
  const s = PropertiesService.getScriptProperties().getProperty("liveState");
  return s ? JSON.parse(s) : null;
}

// ---------------- 3) 速報サイト ----------------

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function gameSheetNames() {
  return ss().getSheets().map(s => s.getName())
    .filter(n => /^\d{4}-\d{2}-\d{2}/.test(n));
}

function rowsOf(name) {
  const sh = ss().getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  // 打席記録は A〜AB(28列)だけ。getDataRange() だと右側の投手成績ブロック(AD列〜)まで
  // 読んでしまい、全試合経過のような大きいシートで無駄に遅くなる
  const cols = Math.min(28, Math.max(1, sh.getMaxColumns()));
  const v = sh.getRange(1, 1, sh.getLastRow(), cols).getValues();
  const rows = [];
  for (let r = 1; r < v.length; r++) {
    if (!v[r][0] && v[r][0] !== 0) continue;
    if (String(v[r][8] || "") === "") continue; // 打者名が無い行は打席行でない
    rows.push(rowObj(v[r]));
  }
  return rows;
}

// 試合一覧カード用の要約（球場・チーム名・スコア）をまとめて返す。
// 終了した試合の内容は変わらないので ScriptProperties に永続保存し、
// 一覧を開くたびに全試合シート（数十枚）を読み直さないようにする。
// これが無いとシート1枚ごとにスプレッドシートへ問い合わせが飛び、一覧の表示に十数秒かかる。
function gameSummaries(names) {
  const props = PropertiesService.getScriptProperties();
  let all = {};
  try { all = props.getProperties(); } catch (e) { all = {}; } // 1回の呼び出しで全部読む
  const map = {}, add = {};
  names.forEach(function (n) {
    const raw = all["gs:" + n];
    if (raw) {
      try { map[n] = JSON.parse(raw); return; } catch (e) { /* 壊れていたら作り直す */ }
    }
    const rows = rowsOf(n);
    if (rows.length === 0) return;
    const l = lineScore(rows), tn = teamNames(rows);
    const o = { st: rows[0].stadium, f: tn.f, s: tn.s, a: l.scoreF, b: l.scoreS };
    map[n] = o;
    add["gs:" + n] = JSON.stringify(o);
  });
  if (Object.keys(add).length) {
    try { props.setProperties(add, false); } catch (e) {} // false = 既存プロパティは消さない
  }
  return map;
}

// スプレッドシートを手で修正したあとに1回実行する。
// 試合要約の永続キャッシュと一覧キャッシュを捨てて、次の表示で作り直させる。
// （試合ページ・成績ページのキャッシュは最長30分で自然に切れる）
function clearSiteCache() {
  const props = PropertiesService.getScriptProperties();
  let all = {};
  try { all = props.getProperties(); } catch (e) {}
  let n = 0;
  Object.keys(all).forEach(function (k) {
    if (k.indexOf("gs:") === 0) { try { props.deleteProperty(k); n++; } catch (e) {} }
  });
  try { CacheService.getScriptCache().removeAll(["index", "music"]); } catch (e) {}
  const msg = "試合要約 " + n + " 件と一覧キャッシュを削除しました";
  Logger.log(msg);
  return msg;
}

function rowObj(a) {
  return {
    date: String(a[0]), stadium: String(a[1] || ""),
    inning: +a[2] || 0, tb: String(a[3] || ""), outs: +a[4] || 0, bases: String(a[5] || ""),
    batter: String(a[8] || ""), pitcher: String(a[10] || ""),
    pitches: +a[12] || 0, result: String(a[14] || ""),
    tbases: +a[18] || 0, errs: +a[19] || 0,
    nInning: +a[20] || 0, nTb: String(a[21] || ""), nOuts: +a[22] || 0,
    nSf: +a[24] || 0, nSs: +a[25] || 0,
    runs: +a[26] || 0, rbi: +a[27] || 0
  };
}

// 出場者・投手成績ブロック（AD〜AL）を読む
function pblockOf(name) {
  const sh = ss().getSheetByName(name);
  if (!sh) return null;
  const v = sh.getDataRange().getValues();
  const out = { pitchers: {}, starters: [], win: "", loss: "", holds: [], saves: [] };
  for (let r = 1; r < v.length; r++) {
    if (v[r].length < PBLOCK_COL + 8) continue;
    const pn = String(v[r][PBLOCK_COL] || "");        // AE 投手名
    if (pn) out.pitchers[pn] = { runs: +v[r][PBLOCK_COL + 1] || 0, er: +v[r][PBLOCK_COL + 2] || 0 };
    const st = String(v[r][PBLOCK_COL + 3] || "");    // AH 先発
    if (st) out.starters.push(st);
    if (r === 1) {
      out.win = String(v[r][PBLOCK_COL + 4] || "");   // AI 勝
      out.loss = String(v[r][PBLOCK_COL + 5] || "");  // AJ 敗
    }
    const h = String(v[r][PBLOCK_COL + 6] || "");
    if (h) out.holds.push(h);
    const sv = String(v[r][PBLOCK_COL + 7] || "");
    if (sv) out.saves.push(sv);
  }
  return out;
}

// シーズン通算の勝敗・H・S を全試合経過の投手成績欄（AI〜AL列）から集計。
// uptoDate を渡すと、その日付が最後に現れる行まで（=その試合終了時点）で打ち切る
function seasonPitcherRecords(uptoDate) {
  const rec = {}; // name -> {w,l,h,s}
  const sh = ss().getSheetByName(ALL_GAMES);
  if (!sh) return rec;
  const v = sh.getDataRange().getValues();
  let end = v.length;
  if (uptoDate) {
    let last = -1;
    for (let r = 1; r < v.length; r++) {
      if (String(v[r][0]) === String(uptoDate)) last = r;
    }
    if (last >= 0) end = last + 1;
  }
  function add(name, key) {
    const n = String(name || "").trim();
    if (!n) return;
    if (!rec[n]) rec[n] = { w: 0, l: 0, h: 0, s: 0 };
    rec[n][key]++;
  }
  for (let r = 1; r < end; r++) {
    if (v[r].length < PBLOCK_COL + 8) continue;
    add(v[r][PBLOCK_COL + 4], "w"); // AI 勝
    add(v[r][PBLOCK_COL + 5], "l"); // AJ 敗
    add(v[r][PBLOCK_COL + 6], "h"); // AK ホールド
    add(v[r][PBLOCK_COL + 7], "s"); // AL セーブ
  }
  return rec;
}

// 「5勝3敗4H6S」形式（Hは0のとき省略）
function recStr(rec, name) {
  const r = rec[name];
  if (!r) return "";
  return "（" + r.w + "勝" + r.l + "敗" + (r.h > 0 ? r.h + "H" : "") + r.s + "S）";
}

// ---------------- 登場曲紹介ページ ----------------

function renderMusic() {
  const url = ScriptApp.getService().getUrl();
  let book, sh;
  try {
    book = ROSTER_SS_ID ? SpreadsheetApp.openById(ROSTER_SS_ID) : ss();
    sh = book.getSheetByName(ROSTER_SHEET);
  } catch (e) {
    return page("登場曲", '<p>スプレッドシートを開けませんでした。</p><p style="color:#999;font-size:.8em">ID: ' + esc(ROSTER_SS_ID) + '<br>エラー: ' + esc(String(e)) + '</p>', false);
  }
  if (!sh) {
    var names = book.getSheets().map(function(s){ return s.getName(); });
    return page("登場曲", '<p>「' + esc(ROSTER_SHEET) + '」シートが見つかりません。</p><p style="color:#999;font-size:.8em">存在するシート: ' + esc(names.join(", ")) + '</p>', false);
  }
  const v = sh.getDataRange().getValues();

  let body = '<div class="top"><a href="' + url + '?">← 一覧へ</a></div>' +
    '<h1>🎵 登場曲紹介</h1>';

  const members = [];
  for (let r = 1; r < v.length; r++) {
    const name = (v[r][0] || "").toString().trim();
    if (!name) continue;
    const furigana = (v[r][1] || "").toString().trim();
    const bat = [];
    const batSpotify = [];
    for (let c = 4; c <= 9; c++) {
      const t = (v[r][c] || "").toString().trim();
      if (t && !/^https?:/.test(t)) bat.push(t);
      // Spotify URL: BL〜BQ列 (64〜69、0-indexed 63〜68)
      const sp = (v[r][63 + (c - 4)] || "").toString().trim();
      batSpotify.push(sp);
    }
    const pit = [];
    const pitSpotify = [];
    for (let c = 10; c <= 12; c++) {
      const t = (v[r][c] || "").toString().trim();
      if (t && !/^https?:/.test(t)) pit.push(t);
      // Spotify URL: BR〜BT列 (70〜72、0-indexed 69〜71)
      const sp = (v[r][69 + (c - 10)] || "").toString().trim();
      pitSpotify.push(sp);
    }
    // 状況別楽曲: O=14(1打席目), P=15(チャンス), Q=16(負けチャンス)
    var sitLabels = ["1打席目専用曲", "チャンス曲", "負け/引き分けチャンス曲"];
    var sit = [];
    var sitSpotify = [];
    for (var s = 0; s < 3; s++) {
      var st = (v[r][14 + s] || "").toString().trim();
      if (st && !/^https?:/.test(st)) sit.push({ label: sitLabels[s], title: st });
      else sit.push(null);
      // Spotify URL: BU〜BW列 (73〜75、0-indexed 72〜74)
      var ssp = (v[r][72 + s] || "").toString().trim();
      sitSpotify.push(ssp);
    }
    var hasSit = sit.some(function (x) { return x !== null; });
    if (bat.length > 0 || pit.length > 0 || hasSit) {
      members.push({ name: name, furigana: furigana, bat: bat, batSpotify: batSpotify, pit: pit, pitSpotify: pitSpotify, sit: sit, sitSpotify: sitSpotify });
    }
  }

  if (members.length === 0) {
    body += '<p class="sub">楽曲登録シートに曲名が登録されていません。</p>';
    return page("登場曲", body, false);
  }

  members.forEach(function (m) {
    body += '<div class="mc">' +
      '<div class="mn">' + esc(m.name) +
      (m.furigana ? '<span class="furi">' + esc(m.furigana) + '</span>' : '') +
      '</div>';
    if (m.bat.length > 0) {
      body += '<div class="ml">打席曲</div>';
      m.bat.forEach(function (t, i) {
        var parts = t.split("/");
        var artist = parts.length > 1 ? parts[0].trim() : "";
        var title = parts.length > 1 ? parts.slice(1).join("/").trim() : t;
        // 複数曲登録時は選曲ルール（N曲中i曲目 → Nn+i打席で使用）をバッジで表示
        var cyc = m.bat.length > 1 ? '<span class="sl">' + m.bat.length + 'n+' + (i + 1) + '打席</span> ' : '';
        body += '<div class="mt">' + cyc + '<span class="tt">' + esc(title) + '</span>' +
          (artist ? '<span class="ar">' + esc(artist) + '</span>' : '') + '</div>';
        var sp = m.batSpotify[i] || "";
        var tid = spotifyTrackId(sp);
        if (tid) {
          body += '<iframe style="border-radius:12px;margin:4px 0 8px" src="https://open.spotify.com/embed/track/' +
            tid + '?utm_source=generator&theme=0" width="100%" height="80" frameborder="0" ' +
            'allow="autoplay;clipboard-write;encrypted-media;fullscreen;picture-in-picture" loading="lazy"></iframe>';
        }
      });
    }
    if (m.pit.length > 0) {
      body += '<div class="ml">投手曲</div>';
      m.pit.forEach(function (t, i) {
        var parts = t.split("/");
        var artist = parts.length > 1 ? parts[0].trim() : "";
        var title = parts.length > 1 ? parts.slice(1).join("/").trim() : t;
        body += '<div class="mt"><span class="tt">' + esc(title) + '</span>' +
          (artist ? '<span class="ar">' + esc(artist) + '</span>' : '') + '</div>';
        var sp = m.pitSpotify[i] || "";
        var tid = spotifyTrackId(sp);
        if (tid) {
          body += '<iframe style="border-radius:12px;margin:4px 0 8px" src="https://open.spotify.com/embed/track/' +
            tid + '?utm_source=generator&theme=0" width="100%" height="80" frameborder="0" ' +
            'allow="autoplay;clipboard-write;encrypted-media;fullscreen;picture-in-picture" loading="lazy"></iframe>';
        }
      });
    }
    var hasSit = m.sit.some(function (x) { return x !== null; });
    if (hasSit) {
      body += '<div class="ml">状況別</div>';
      m.sit.forEach(function (s, i) {
        if (!s) return;
        var parts = s.title.split("/");
        var artist = parts.length > 1 ? parts[0].trim() : "";
        var title = parts.length > 1 ? parts.slice(1).join("/").trim() : s.title;
        body += '<div class="mt"><span class="sl">' + esc(s.label) + '</span> ' +
          '<span class="tt">' + esc(title) + '</span>' +
          (artist ? '<span class="ar">' + esc(artist) + '</span>' : '') + '</div>';
        var sp = m.sitSpotify[i] || "";
        var tid = spotifyTrackId(sp);
        if (tid) {
          body += '<iframe style="border-radius:12px;margin:4px 0 8px" src="https://open.spotify.com/embed/track/' +
            tid + '?utm_source=generator&theme=0" width="100%" height="80" frameborder="0" ' +
            'allow="autoplay;clipboard-write;encrypted-media;fullscreen;picture-in-picture" loading="lazy"></iframe>';
        }
      });
    }
    body += '</div>';
  });

  return page("登場曲紹介", body, false);
}

function spotifyTrackId(url) {
  if (!url) return "";
  // https://open.spotify.com/track/XXXX?si=... or spotify:track:XXXX or just XXXX
  var m = url.match(/track[\/:]([a-zA-Z0-9]+)/);
  if (m) return m[1];
  if (/^[a-zA-Z0-9]{22}$/.test(url.trim())) return url.trim();
  return "";
}

// ---------------- 楽曲登録シートのひな型作成 ----------------
// エディタでこの関数（createRosterTemplate）を選んで実行すると、
// メンバー31名入りの「楽曲登録」シートを自動作成する。
//  - ROSTER_SS_ID が設定済み → そのスプレッドシート内に「楽曲登録」タブを作る
//  - 未設定 → 新しいスプレッドシートを作成し、実行ログに URL と ID を表示する
// あとは各曲のセルに、共有Driveに置いた mp3 の共有リンクを貼るだけ。

// [名前, フリガナ, 打, 投, 打席曲タイトル(最大6), 投手曲タイトル(最大3)]
// タイトルは楽曲募集フォームの回答から「最新の登録」を反映済み（URLは各自で貼る）
const ROSTER_MEMBERS = [
  ["上野", "うえの", "右", "右", ["Ed Sheeran/Shape of You"], []],
  ["清水川", "しみずかわ", "右", "右",
    ["スピッツ/えにし", "Mr.Children/足音〜Be Strong"],
    ["サカナクション/ナイトフィッシングイズグッド"]],
  ["西村", "にしむら", "右", "右",
    ["globe/compass", "L'Arc〜en〜Ciel/Driver's High"],
    ["LINDBERG/every little thing every precious thing"]],
  ["橋本", "はしもと", "右", "右",
    ["浜崎あゆみ/SEASONS", "浜崎あゆみ/M", "浜崎あゆみ/mimosa", "浜崎あゆみ/grateful days"],
    ["浜崎あゆみ/because of you"]],
  ["山村", "やまむら", "右", "右",
    ["ONE OK ROCK/C.h.a.o.s.m.y.t.h.", "スキマスイッチ/全力少年", "EXILE/together", "サザンオールスターズ/彩〜Aja〜"],
    ["nobodyknows+/ココロオドル", "あいみょん/ハルノヒ"]],
  ["藤田", "ふじた", "右", "右", ["Mrs. GREEN APPLE/Magic"], []],
  ["堀江", "ほりえ", "右", "右", [], []],
  ["新井", "あらい", "右", "右",
    ["ラッツ&スター/め組のひと", "雨宮天/PARADOX", "ティーンビーチムービー/サーフ・アップ", "フィル・コリンズ/You'll Be in My Heart"],
    ["アンドレア・ボチェッリ他/Funiculi Funicula（先発）", "東京ディズニーシー/ザ・シティ・オブ・ドリームス（中継ぎ）", "フィル・コリンズ/Strangers Like Me（セーブ）"]],
  ["上坂", "うえさか", "右", "右", ["ジョン・ケージ/4分33秒（無音希望）"], ["Fantastic Youth/雲外憧憬"]],
  ["鵜飼", "うかい", "右", "右", ["El Mio Tu si suena（ビシエド登場曲）", "暴れん坊将軍メインテーマ"], []],
  ["川勝", "かわかつ", "左", "右", [], []],
  ["仙田", "せんだ", "右", "右",
    ["HONEBONE/夜をこえて", "SMAP/オリジナルスマイル", "ハジ→/春色。", "GReeeeN/キセキ"],
    ["鬼滅の刃/炎の呼吸 壱ノ型 不知火・弐ノ型 昇り炎天"]],
  ["田中", "たなか", "右", "右", ["幸祜/始まりの銃声"], []],
  ["冨髙", "とみたか", "左", "右", ["Ed Sheeran/Shape of You"], []],
  ["布目", "ぬのめ", "右", "右", ["Mr.Children/HANABI"], []],
  ["吉田", "よしだ", "右", "右", ["Mrs. GREEN APPLE/ライラック"], []],
  ["石田", "いしだ", "右", "右", [], []],
  ["梅谷", "うめたに", "右", "右", ["大原ゆい子/ハイステッパー"], ["ドヴォルザーク/交響曲第9番「新世界より」第4楽章"]],
  ["大嶋", "おおしま", "左", "右", ["桑田佳祐/白い恋人達"], []],
  ["金田", "かねだ", "右", "右", ["Lia/時を刻む唄"], []],
  ["谷", "たに", "右", "右", ["miwa/ヒカリへ"], []],
  ["玉木", "たまき", "左", "左",
    ["One Direction/Live While We're Young", "Jonas Blue/Rise"],
    ["Panic! At The Disco/High Hopes", "Aqua Timez/虹"]],
  ["中根", "なかね", "左", "右", ["", "FUNKY MONKEY BABYS/あとひとつ"], []],
  ["野平", "のひら", "両", "右", ["SPYAIR/オレンジ"], []],
  ["原田", "はらだ", "右", "右", ["ゆず/イロトリドリ"], ["BUMP OF CHICKEN/ray", "Avicii/The Nights"]],
  ["大庭", "おおば", "右", "右", [], []],
  ["杉江", "すぎえ", "左", "右", ["幾田りら/ハミング", "ヨルシカ/あぶく"], []],
  ["練石", "ねりいし", "右", "右", [], []],
  ["林", "はやし", "右", "右", [], []],
  ["俣野", "またの", "右", "右", [], []],
  ["湯浅", "ゆあさ", "右", "右", [], []]
];

function createRosterTemplate() {
  let book;
  let created = false;
  if (ROSTER_SS_ID) {
    book = SpreadsheetApp.openById(ROSTER_SS_ID);
  } else {
    book = SpreadsheetApp.create("登場曲リスト（楽曲登録）");
    created = true;
  }
  let sh = book.getSheetByName(ROSTER_SHEET);
  if (sh && sh.getLastRow() > 1) {
    Logger.log("中断: 「" + ROSTER_SHEET + "」シートに既にデータがあるため上書きしません。");
    Logger.log("ファイル: " + book.getUrl());
    return;
  }
  if (!sh) sh = book.insertSheet(ROSTER_SHEET);
  sh.clear();
  const header = ["名前", "フリガナ", "打", "投",
    "打席曲1", "打席曲2", "打席曲3", "打席曲4", "打席曲5", "打席曲6",
    "投手曲1", "投手曲2", "投手曲3", "名前アナウンス",
    "1打席目専用曲", "チャンス曲", "負け/引き分けチャンス曲"];
  sh.getRange(1, 1, 1, header.length).setValues([header])
    .setFontWeight("bold").setBackground("#fff2cc");

  // 1人につき2行: 上段 = アーティスト名/曲名（表示用）、下段 = mp3のDrive共有リンク
  const rows = [];
  ROSTER_MEMBERS.forEach(m => {
    const bat = m[4] || [], pit = m[5] || [];
    const titleRow = [m[0], m[1], m[2], m[3]];
    for (let i = 0; i < 6; i++) titleRow.push(bat[i] || "");
    for (let i = 0; i < 3; i++) titleRow.push(pit[i] || "");
    titleRow.push("", "", "", "");
    const urlRow = ["", "", "", "URL→", "", "", "", "", "", "", "", "", "", "", "", "", ""];
    rows.push(titleRow, urlRow);
  });
  sh.getRange(2, 1, rows.length, header.length).setValues(rows);

  // URL行（下段）は薄い青で塗って見分けやすくする
  for (let i = 0; i < ROSTER_MEMBERS.length; i++) {
    sh.getRange(3 + i * 2, 4, 1, 14).setBackground("#e8f0fe");
  }

  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  sh.setColumnWidth(1, 90);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidth(3, 40);
  sh.setColumnWidth(4, 60);
  for (let c = 5; c <= 17; c++) sh.setColumnWidth(c, 230);
  sh.getRange("E1").setNote(
    "1人につき2行:\n・上段（白）= アーティスト名/曲名（表示・管理用）\n" +
    "・下段（青）= mp3のDrive共有リンクを貼る\n\n" +
    "貼り方: mp3を共有Driveにアップロード → 右クリック「リンクをコピー」→ 下段のセルに貼り付け" +
    "（ファイルIDだけでも可）。\nURLが空のスロットは未登録として扱われます。\n" +
    "打席曲は1〜6曲まで自由、投手曲は最大3曲。"
  );
  sh.getRange("O1").setNote(
    "状況別楽曲:\n" +
    "・1打席目専用曲: 初打席のみ再生（2打席目以降は通常ローテ）\n" +
    "・チャンス曲: 得点圏（二塁 or 三塁に走者）で再生\n" +
    "・負け/引き分けチャンス曲: 負け or 引き分け時のチャンスで再生\n\n" +
    "設定しなければ通常の打席曲ローテーションが使われます。\n" +
    "優先度: 1打席目 > 負け/引き分けチャンス > チャンス > 通常ローテ"
  );
  // システムアナウンス欄: S=自動スタート, T〜AE=先攻1〜12回, AF〜AQ=後攻1〜12回, AS〜BG=打順1〜15番
  sh.getRange("S1").setValue("自動スタート").setFontWeight("bold").setBackground("#d9ead3");
  sh.getRange("S2").setBackground("#e8f0fe");
  for (let i = 0; i < 12; i++) {
    sh.getRange(1, 20 + i).setValue("先攻" + (i + 1) + "回").setFontWeight("bold").setBackground("#cfe2f3");
    sh.getRange(2, 20 + i).setBackground("#e8f0fe");
  }
  for (let i = 0; i < 12; i++) {
    sh.getRange(1, 32 + i).setValue("後攻" + (i + 1) + "回").setFontWeight("bold").setBackground("#d9d2e9");
    sh.getRange(2, 32 + i).setBackground("#e8f0fe");
  }
  sh.setColumnWidth(44, 20);
  for (let i = 0; i < 15; i++) {
    sh.getRange(1, 45 + i).setValue((i + 1) + "番").setFontWeight("bold").setBackground("#fce5cd");
    sh.getRange(2, 45 + i).setBackground("#e8f0fe");
  }
  // 投手交代アナウンス: BH〜BK(60〜63)
  var pcLabels = ["先攻投手交代前半","先攻投手交代後半","後攻投手交代前半","後攻投手交代後半"];
  for (let i = 0; i < 4; i++) {
    sh.getRange(1, 60 + i).setValue(pcLabels[i]).setFontWeight("bold").setBackground("#ea9999");
    sh.getRange(2, 60 + i).setBackground("#e8f0fe");
  }
  sh.getRange("S1").setNote(
    "システムアナウンス音声:\n" +
    "・自動スタート(S列): 2アウト・フルカウント・一塁走者あり で自動再生\n" +
    "・先攻1〜12回(T〜AE列): チェンジ時「○回の表/裏、○○チームの攻撃は」\n" +
    "・後攻1〜12回(AF〜AQ列): 同上\n" +
    "・打順1〜15番(AS〜BG列): 「○番」の音声\n" +
    "・投手交代(BH〜BK列): 前半=「○○チーム ピッチャーの交代を…」後半=「に代わりまして ピッチャー」\n\n" +
    "再生順序: 回アナウンス → 打順番号 → 名前 → 入場曲\n" +
    "投手交代: 入場曲3秒後に 前半 → 退く投手名 → 後半 → 新投手名\n" +
    "2行目にDrive共有リンクを貼ってください。未設定の項目はスキップされます。"
  );
  // Spotify URL: BL〜BT (64〜72) = 打席曲1〜6 + 投手曲1〜3
  var spLabels = ["打席曲1 Spotify","打席曲2 Spotify","打席曲3 Spotify",
    "打席曲4 Spotify","打席曲5 Spotify","打席曲6 Spotify",
    "投手曲1 Spotify","投手曲2 Spotify","投手曲3 Spotify",
    "1打席目専用 Spotify","チャンス曲 Spotify","負けチャンス Spotify"];
  for (let i = 0; i < 12; i++) {
    sh.getRange(1, 64 + i).setValue(spLabels[i]).setFontWeight("bold").setBackground("#1db954");
    sh.setColumnWidth(64 + i, 180);
  }
  sh.getRange(1, 64).setNote(
    "Spotify 登場曲紹介ページ用:\n" +
    "各曲のSpotifyリンクを貼ると、速報サイトの登場曲ページに\n" +
    "試聴プレーヤーが埋め込まれます。\n\n" +
    "貼り方: Spotifyで曲を検索 → 共有 → リンクをコピー → セルに貼り付け\n" +
    "（トラックIDだけでも可）"
  );
  sh.setColumnWidth(19, 200);
  for (let c = 20; c <= 43; c++) sh.setColumnWidth(c, 120);
  for (let c = 45; c <= 59; c++) sh.setColumnWidth(c, 120);
  for (let c = 60; c <= 63; c++) sh.setColumnWidth(c, 160);
  if (created) {
    Logger.log("★ 新しいスプレッドシートを作成しました");
    Logger.log("URL: " + book.getUrl());
    Logger.log("ID: " + book.getId());
    Logger.log("→ コード上部の ROSTER_SS_ID にこのIDを設定して、新バージョンでデプロイしてください");
  } else {
    Logger.log("既存ファイル内に「" + ROSTER_SHEET + "」シートを作成しました: " + book.getUrl());
  }
}

// ---------------- 戦評（Gemini API） ----------------

function geminiKey() {
  return PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY") || "";
}

/** 保存済みの戦評を取得（シート名で引く） */
function getReview(sheetName) {
  const sh = ss().getSheetByName(REVIEW_SHEET);
  if (!sh) return "";
  const v = sh.getDataRange().getValues();
  for (let r = 0; r < v.length; r++) {
    if (String(v[r][0]) === sheetName) return String(v[r][1] || "");
  }
  return "";
}

function saveReview(sheetName, text) {
  const sh = ss().getSheetByName(REVIEW_SHEET) || ss().insertSheet(REVIEW_SHEET);
  sh.appendRow([sheetName, text, new Date()]);
}

/** 戦評を返す。未生成なら生成して保存（1試合につき1回だけAPIを呼ぶ） */
function ensureReview(sheetName, rows, pb) {
  let t = getReview(sheetName);
  if (t) return t;
  if (!geminiKey() || rows.length === 0) return "";
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(2000)) return ""; // 同時アクセスで二重生成しない
  try {
    t = getReview(sheetName);
    if (t) return t;
    t = generateReview(rows, pb);
    if (t) saveReview(sheetName, t);
    return t;
  } catch (e) {
    return "";
  } finally {
    lock.releaseLock();
  }
}

function generateReview(rows, pb) {
  const l = lineScore(rows);
  const scenes = rows.filter(r => r.runs > 0).map(r =>
    r.inning + "回" + r.tb + " " + r.batter + "の" + r.result + "で" + r.runs + "点（先攻" +
    r.nSf + "-" + r.nSs + "後攻）").join("\n");
  const hrs = rows.filter(r => r.result === "4塁打").map(r =>
    r.batter + "（" + r.inning + "回" + r.tb + "・" + r.runs + "点）").join("、");
  const prompt =
    "あなたはスポーツ新聞の記者です。以下はピンポン野球（卓球ボールを使うサークル内の野球、紅白戦）の試合データです。" +
    "プロ野球のニュースサイトに載るような戦評を、日本語で200字前後・1段落で書いてください。" +
    "チーム名は「先攻」「後攻」。データにある事実だけを使い、憶測や誇張はしない。選手名は敬称なし。\n\n" +
    "最終スコア: 先攻 " + l.scoreF + " - " + l.scoreS + " 後攻\n" +
    "イニング別得点 先攻: " + l.fi.join(",") + " / 後攻: " + l.se.join(",") + "\n" +
    (scenes ? "得点経過:\n" + scenes + "\n" : "") +
    (hrs ? "本塁打: " + hrs + "\n" : "") +
    (pb && pb.win ? "勝利投手: " + pb.win + "\n" : "") +
    (pb && pb.loss ? "敗戦投手: " + pb.loss + "\n" : "") +
    (pb && pb.saves.length ? "セーブ: " + pb.saves.join("、") + "\n" : "") +
    (pb && pb.holds.length ? "ホールド: " + pb.holds.join("、") + "\n" : "") +
    (pb && pb.starters.length ? "先発投手: " + pb.starters.join("、") + "\n" : "");
  const res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL +
    ":generateContent?key=" + geminiKey(),
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      muteHttpExceptions: true
    }
  );
  if (res.getResponseCode() !== 200) return "";
  try {
    const data = JSON.parse(res.getContentText());
    return data.candidates[0].content.parts[0].text.trim();
  } catch (e) {
    return "";
  }
}

/** 設定確認用: エディタでこの関数を実行すると承認ダイアログが出て、キーの状態がログに出る */
function testGemini() {
  Logger.log(geminiKey() ? "APIキー: 設定済み" : "APIキー: 未設定（スクリプト プロパティに GEMINI_API_KEY を追加）");
  if (!geminiKey()) return;
  const res = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" + GEMINI_MODEL + "?key=" + geminiKey(),
    { muteHttpExceptions: true }
  );
  Logger.log("HTTP " + res.getResponseCode() + (res.getResponseCode() === 200 ? " → 接続OK" : " → " + res.getContentText().slice(0, 200)));
}

function isHitResult(res) { return /塁打$/.test(res); }
function isAtBatResult(res) {
  return !(res === "四球" || res === "死球" || res === "妨害" ||
    res === "犠飛" || res === "犠打" || res === "スクイズ");
}
function outsAddedOf(r) {
  const ended = r.nTb !== r.tb || r.nInning !== r.inning;
  return ended ? Math.max(0, 3 - r.outs) : Math.max(0, r.nOuts - r.outs);
}

function lineScore(rows) {
  const maxIn = Math.max(1, rows.reduce((m, r) => Math.max(m, r.inning), 1));
  const fi = new Array(maxIn).fill(0), se = new Array(maxIn).fill(0);
  let hitsF = 0, hitsS = 0, errF = 0, errS = 0;
  rows.forEach(r => {
    const top = r.tb === "表";
    if (r.runs > 0) (top ? fi : se)[r.inning - 1] += r.runs;
    if (isHitResult(r.result)) top ? hitsF++ : hitsS++;
    if (r.errs > 0) { if (top) errS += r.errs; else errF += r.errs; } // 失策は守備側に付く
  });
  const last = rows[rows.length - 1];
  return {
    maxIn: maxIn, fi: fi, se: se,
    scoreF: last ? last.nSf : 0, scoreS: last ? last.nSs : 0,
    hitsF: hitsF, hitsS: hitsS, errF: errF, errS: errS
  };
}

// #5 先発投手の名を冠したチーム名 { f: 先攻名, s: 後攻名 }
function teamNames(rows) {
  var f = "", s = "";
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!s && r.tb === "表" && r.pitcher) s = r.pitcher; // 後攻の先発 = 表で投げる投手
    if (!f && r.tb === "裏" && r.pitcher) f = r.pitcher; // 先攻の先発 = 裏で投げる投手
    if (f && s) break;
  }
  return { f: f ? "チーム" + f : "先攻", s: s ? "チーム" + s : "後攻" };
}

// 1球速報カードのHTML（ライブ状況から生成）
function live1HTML(g) {
  if (!g || !g.batter) return "";
  function pips(cls, n, max) {
    var h = "";
    for (var i = 0; i < max; i++) h += '<span class="pip' + (i < n ? " " + cls : "") + '"></span>';
    return h;
  }
  var bs = String(g.bases || "000");
  var dia = '<div class="dia">' +
    '<i class="b2' + (bs.charAt(1) === "1" ? " on" : "") + '"></i>' +
    '<i class="b3' + (bs.charAt(2) === "1" ? " on" : "") + '"></i>' +
    '<i class="b1' + (bs.charAt(0) === "1" ? " on" : "") + '"></i></div>';
  var lr = function (s) { return s ? '<span class="lr">' + esc(s) + '</span>' : ""; };

  var head = '<div class="row">' +
    '<div class="who"><div class="lab">投手</div><div class="nm">' + esc(g.pitcher || "-") + lr(g.pitchSide) + '</div></div>' +
    '<div class="who" style="text-align:right"><div class="lab">打者' +
    (g.batNum ? ' 第' + g.batNum + '打席' : '') + '</div><div class="nm">' + esc(g.batter) + lr(g.batSide) + '</div></div></div>';

  var count = '<div class="count">' +
    '<div class="g"><span class="lb">B</span>' + pips("b", g.balls || 0, 3) + '</div>' +
    '<div class="g"><span class="lb">S</span>' + pips("s", g.strikes || 0, 2) + '</div>' +
    '<div class="g"><span class="lb">O</span>' + pips("o", g.outs || 0, 2) + '</div>' +
    dia + '</div>';

  var list = "";
  var arr = g.pitches || [];
  for (var i = 0; i < arr.length; i++) {
    var t = arr[i];
    var cls = t === "ボール" ? "b" : (t === "ストライク" ? "s" : "f");
    list += '<div class="p"><span class="n ' + cls + '">' + (i + 1) + '</span><span>' + esc(t) + '</span></div>';
  }
  var plist = list ? '<div class="plist">' + list + '</div>' : '';

  return '<div class="live1">' + head + count + plist + '</div>';
}

// #6 打順（初登場順）。top=true→先攻(表)、false→後攻(裏)
function battingOrder(rows, top) {
  var seen = [];
  rows.forEach(function (r) {
    if ((r.tb === "表") === top && r.batter && seen.indexOf(r.batter) < 0) seen.push(r.batter);
  });
  return seen;
}

// 打者集計 { name: {ab,h,rbi,hr,order} }
function batStats(rows, top) {
  const map = {};
  let order = 0;
  rows.filter(r => (r.tb === "表") === top).forEach(r => {
    if (!map[r.batter]) map[r.batter] = { ab: 0, h: 0, rbi: 0, hr: 0, order: order++ };
    const b = map[r.batter];
    if (isAtBatResult(r.result)) b.ab++;
    if (isHitResult(r.result)) b.h++;
    if (r.result === "4塁打") b.hr++;
    b.rbi += r.rbi;
  });
  return map;
}

// 投手集計（先攻チームの投手 = 裏の行）
function pitStats(rows, top) {
  const map = {};
  let order = 0;
  rows.filter(r => (r.tb === "裏") === top).forEach(r => {
    if (!r.pitcher) return;
    if (!map[r.pitcher]) map[r.pitcher] = { outs: 0, np: 0, h: 0, k: 0, bb: 0, hbp: 0, runs: 0, order: order++ };
    const p = map[r.pitcher];
    p.outs += outsAddedOf(r);
    p.np += r.pitches;
    if (isHitResult(r.result)) p.h++;
    if (r.result === "空三振" || r.result === "見三振") p.k++;
    if (r.result === "四球") p.bb++;
    if (r.result === "死球") p.hbp++;
    p.runs += r.runs;
  });
  return map;
}

function ipStr(outs) {
  const i = Math.floor(outs / 3), r = outs % 3;
  return r === 0 ? String(i) : i + "." + r;
}
function avgStr(h, ab) {
  if (ab === 0) return "-";
  return (h / ab).toFixed(3).replace(/^0/, "");
}

// ---------------- 個人成績ランキング ----------------

/** 指定した経過シートの行から打者集計。rab/rh=得点圏（二塁or三塁走者あり）の打数/安打 */
function batAllFrom(rows) {
  const m = {};
  rows.forEach(r => {
    if (!r.batter) return;
    const b = m[r.batter] || (m[r.batter] = {
      pa: 0, ab: 0, h: 0, d2: 0, d3: 0, hr: 0, tb: 0, bb: 0, hbp: 0, sf: 0, so: 0, rbi: 0,
      rab: 0, rh: 0
    });
    const risp = /[二三]/.test(r.bases); // 塁況ラベルに二 or 三 → 得点圏
    b.pa++;
    if (isAtBatResult(r.result)) { b.ab++; if (risp) b.rab++; }
    if (isHitResult(r.result)) { b.h++; if (risp) b.rh++; }
    if (r.result === "2塁打") b.d2++;
    if (r.result === "3塁打") b.d3++;
    if (r.result === "4塁打") b.hr++;
    b.tb += r.tbases;
    if (r.result === "四球") b.bb++;
    if (r.result === "死球") b.hbp++;
    if (r.result === "犠飛") b.sf++;
    if (r.result === "空三振" || r.result === "見三振") b.so++;
    b.rbi += r.rbi;
  });
  return m;
}

/** 指定した経過シートの行＋そのシートの投手成績ブロックから投手集計 */
function pitAllFrom(rows, blockSheet) {
  const m = {};
  function ent(name) {
    return m[name] || (m[name] = {
      outs: 0, np: 0, ab: 0, h: 0, k: 0, bb: 0, hbp: 0, runs: 0, er: 0, w: 0, l: 0, hld: 0, sv: 0
    });
  }
  rows.forEach(r => {
    if (!r.pitcher) return;
    const p = ent(r.pitcher);
    p.outs += outsAddedOf(r);
    p.np += r.pitches;
    if (isAtBatResult(r.result)) p.ab++; // 被打率の分母（対戦打数）
    if (isHitResult(r.result)) p.h++;
    if (r.result === "空三振" || r.result === "見三振") p.k++;
    if (r.result === "四球") p.bb++;
    if (r.result === "死球") p.hbp++;
  });
  // 失点・自責・勝敗HSは投手成績ブロック（AE〜AL列）から
  const sh = ss().getSheetByName(blockSheet);
  if (sh) {
    const v = sh.getDataRange().getValues();
    for (let r = 1; r < v.length; r++) {
      if (v[r].length < PBLOCK_COL + 8) continue;
      const pn = String(v[r][PBLOCK_COL] || "").trim();
      if (pn) {
        const p = ent(pn);
        p.runs += +v[r][PBLOCK_COL + 1] || 0;
        p.er += +v[r][PBLOCK_COL + 2] || 0;
      }
      const w = String(v[r][PBLOCK_COL + 4] || "").trim(); if (w) ent(w).w++;
      const l = String(v[r][PBLOCK_COL + 5] || "").trim(); if (l) ent(l).l++;
      const h = String(v[r][PBLOCK_COL + 6] || "").trim(); if (h) ent(h).hld++;
      const s = String(v[r][PBLOCK_COL + 7] || "").trim(); if (s) ent(s).sv++;
    }
  }
  return m;
}

function f3(x) { return x.toFixed(3).replace(/^0/, ""); }  // .345
function f2(x) { return x.toFixed(2); }

// 基本 Runs Created: (安+四+死)×塁打 / (打数+四+死)
function rcOf(b) {
  const d = b.ab + b.bb + b.hbp;
  return d ? (b.h + b.bb + b.hbp) * b.tb / d : 0;
}

// 打者データ全員に WRC+（リーグ平均=100）を付与する
function attachWrcPlus(data) {
  let sumRc = 0, sumPa = 0;
  Object.keys(data).forEach(function (nm) { sumRc += rcOf(data[nm]); sumPa += data[nm].pa; });
  const lg = sumPa ? sumRc / sumPa : 0; // リーグの RC/打席
  Object.keys(data).forEach(function (nm) {
    const b = data[nm];
    b.wrcplus = (lg > 0 && b.pa > 0) ? (rcOf(b) / b.pa) / lg * 100 : null;
  });
}

// 打者ランキング種目（上から順にセレクタに並ぶ。rate=規定打席あり、asc=小さいほど上位）
const BAT_RANK = [
  { id: "avg", label: "打率", rate: true, val: b => b.ab ? b.h / b.ab : null, fmt: f3 },
  { id: "obp", label: "出塁率", rate: true, fmt: f3,
    val: b => (b.ab + b.bb + b.hbp + b.sf) ? (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf) : null },
  { id: "hr", label: "本塁打", val: b => b.hr },
  { id: "rbi", label: "打点", val: b => b.rbi },
  { id: "ops", label: "OPS", rate: true, fmt: f3,
    val: b => {
      if (!b.ab || !(b.ab + b.bb + b.hbp + b.sf)) return null;
      return (b.h + b.bb + b.hbp) / (b.ab + b.bb + b.hbp + b.sf) + b.tb / b.ab;
    } },
  // 得点圏（二塁 or 三塁走者あり）の打率
  { id: "risp", label: "得点圏打率", rate: true, fmt: f3, val: b => b.rab ? b.rh / b.rab : null },
  // WRC+ = リーグ(サークル全体)平均を100とした得点創出。renderStatsで b.wrcplus を事前計算
  { id: "wrcplus", label: "WRC+", rate: true, fmt: x => Math.round(x), val: b => b.wrcplus },
  { id: "slg", label: "長打率", rate: true, val: b => b.ab ? b.tb / b.ab : null, fmt: f3 },
  { id: "hits", label: "安打", val: b => b.h },
  { id: "d2", label: "二塁打", val: b => b.d2 },
  { id: "d3", label: "三塁打", val: b => b.d3 },
  { id: "tb", label: "塁打", val: b => b.tb },
  { id: "bb", label: "四球", val: b => b.bb },
  { id: "so", label: "三振", val: b => b.so },
  { id: "pa", label: "打席", val: b => b.pa }
];

// 投手ランキング種目
const PIT_RANK = [
  { id: "w", label: "勝利", val: p => p.w },
  { id: "hld", label: "ホールド", val: p => p.hld },
  { id: "sv", label: "セーブ", val: p => p.sv },
  { id: "era", label: "防御率", rate: true, asc: true, fmt: f2,
    val: p => p.outs ? p.er * 9 / (p.outs / 3) : null },
  { id: "whip", label: "WHIP", rate: true, asc: true, fmt: f2,
    val: p => p.outs ? (p.h + p.bb) / (p.outs / 3) : null },
  { id: "kbb", label: "K/BB", rate: true,
    val: p => p.bb > 0 ? p.k / p.bb : (p.k > 0 ? Infinity : null),
    fmt: x => x === Infinity ? "∞" : f2(x) },
  // 被打率 = 被安打 / 対戦打数（小さいほど上位）
  { id: "oavg", label: "被打率", rate: true, asc: true, fmt: f3, val: p => p.ab ? p.h / p.ab : null },
  // 失点率 = 失点 × 9 / 投球回（小さいほど上位）
  { id: "ra", label: "失点率", rate: true, asc: true, fmt: f2, val: p => p.outs ? p.runs * 27 / p.outs : null },
  // K/9 = 奪三振 × 9 / 投球回
  { id: "k9", label: "K/9", rate: true, fmt: f2, val: p => p.outs ? p.k * 27 / p.outs : null },
  // BB/9 = 与四球 × 9 / 投球回（小さいほど上位）
  { id: "bb9", label: "BB/9", rate: true, asc: true, fmt: f2, val: p => p.outs ? p.bb * 27 / p.outs : null },
  { id: "k", label: "奪三振", val: p => p.k },
  { id: "ip", label: "投球回", val: p => p.outs / 3, fmt: x => ipStr(Math.round(x * 3)) },
  { id: "l", label: "敗戦", val: p => p.l },
  { id: "r", label: "失点", rate: true, asc: true, val: p => p.runs },
  { id: "er", label: "自責点", rate: true, asc: true, val: p => p.er }
];

// 期間タブ用: 存在する月間経過シートを列挙（[{sheet, label}]。先頭は全期間）
function statPeriods() {
  const out = [{ sheet: ALL_GAMES, label: "全期間" }];
  ss().getSheets().forEach(function (s) {
    const n = s.getName();
    const m = n.match(/^(\d+(?:-\d+)?)月月間試合経過$/) || n.match(/^(\d+(?:-\d+)?)月試合経過$/);
    if (m) out.push({ sheet: n, label: m[1] + "月" });
  });
  return out;
}

function renderStats(type, statId, period) {
  const url = ScriptApp.getService().getUrl();
  const isBat = type !== "pit";
  const defs = isBat ? BAT_RANK : PIT_RANK;
  const def = defs.filter(d => d.id === statId)[0] || defs[0];

  // 期間（全期間=全試合経過、または月間経過シート）
  const periods = statPeriods();
  const per = periods.filter(p => p.sheet === period)[0] || periods[0];
  const rows = rowsOf(per.sheet);
  const data = isBat ? batAllFrom(rows) : pitAllFrom(rows, per.sheet);
  if (isBat) attachWrcPlus(data); // WRC+ はリーグ全体から算出するため事前に付与

  // 対象者の抽出（率系は規定ライン以上のみ）
  const list = [];
  Object.keys(data).forEach(nm => {
    const d = data[nm];
    if (def.rate) {
      if (isBat && d.pa < BAT_MIN_PA) return;
      if (!isBat && d.outs < PIT_MIN_OUTS) return;
    }
    const v = def.val(d);
    if (v === null || v === undefined || isNaN(v) && v !== Infinity) return;
    list.push({ name: nm, v: v, d: d });
  });
  list.sort((a, b) => def.asc ? a.v - b.v : b.v - a.v);

  // セレクタ（変更で即再読み込み）
  function sel(name, opts, current) {
    let s = '<select name="' + name + '" onchange="this.form.submit()">';
    opts.forEach(o => {
      s += '<option value="' + o.value + '"' + (o.value === current ? ' selected' : '') + '>' +
        esc(o.label) + '</option>';
    });
    return s + '</select>';
  }
  let body = '<div class="top"><a target="_top" href="' + url + '?">‹ 試合一覧</a></div>' +
    '<h1>個人成績ランキング</h1>' +
    '<form method="get" action="' + url + '" target="_top" class="selrow">' +
    '<input type="hidden" name="view" value="stats">' +
    sel("type", [{ value: "bat", label: "打者成績" }, { value: "pit", label: "投手成績" }], isBat ? "bat" : "pit") +
    sel("period", periods.map(p => ({ value: p.sheet, label: p.label })), per.sheet) +
    sel("stat", defs.map(d => ({ value: d.id, label: d.label })), def.id) +
    '</form>';

  // ランキング表（同値は同順位）
  let t = '<div class="tbl"><table class="st"><tr><th style="width:3em">順位</th>' +
    '<th class="name">選手名</th><th>' + esc(def.label) + '</th>' +
    (isBat ? '<th>打席</th>' : '<th>投球回</th>') + '</tr>';
  let rank = 0, shown = 0, prev = null;
  list.forEach(e => {
    shown++;
    if (prev === null || e.v !== prev) rank = shown;
    prev = e.v;
    const disp = def.fmt ? def.fmt(e.v) : String(e.v);
    t += '<tr><td>' + rank + '</td><td class="name">' + esc(e.name) + '</td>' +
      '<td><b>' + disp + '</b></td>' +
      (isBat ? '<td>' + e.d.pa + '</td>' : '<td>' + ipStr(e.d.outs) + '</td>') + '</tr>';
  });
  if (list.length === 0) t += '<tr><td colspan="4">対象者がいません</td></tr>';
  t += '</table></div>';
  body += t;
  if (def.rate) {
    body += '<p class="sub">※ ' + (isBat ? '規定打席: ' + BAT_MIN_PA + '打席以上'
      : '規定投球回: ' + ipStr(PIT_MIN_OUTS) + '回以上') +
      (def.asc ? '（数値が小さいほど上位）' : '') + '</p>';
  }
  return page("個人成績", body, false);
}

function page(title, body, autoRefresh) {
  return '<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    // GASのWebページはiframe内で動くため、リンクは最上位ウィンドウで開く必要がある
    '<base target="_top">' +
    // 自動更新は meta refresh でなく JS（ラッパーページ経由でも動くように）
    (autoRefresh ? '<script>setTimeout(function(){location.reload()},15000)</script>' : '') +
    '<title>' + esc(title) + '</title><style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;background:#0d0d10;color:#e9e9ec;' +
    'font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;' +
    '-webkit-font-smoothing:antialiased}' +
    '.wrap{max-width:520px;margin:0 auto;padding:10px 12px 48px}' +
    '.top a{color:#9fa3ad;font-size:.9em}' +
    'h1{font-size:1.12em;margin:8px 2px 12px;line-height:1.4}' +
    'h2{font-size:.92em;margin:22px 2px 8px;padding-left:9px;border-left:4px solid #f5a623;color:#fff}' +
    'a{color:inherit;text-decoration:none}' +
    '.card{display:block;background:#17181d;border:1px solid #26272e;border-radius:14px;padding:13px 16px;margin:10px 0}' +
    '.card .d{color:#9fa3ad;font-size:.8em}' +
    '.card .s{font-size:1.2em;font-weight:700;margin-top:3px;text-align:center;letter-spacing:.04em}' +
    '.card.live{border-color:#e5484d;box-shadow:0 0 12px rgba(229,72,77,.25)}' +
    '.dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#e5484d;margin-right:6px;' +
    'vertical-align:1px;animation:pk 1.3s ease-in-out infinite}' +
    '@keyframes pk{50%{opacity:.2}}' +
    '.badge{display:inline-block;background:#e5484d;color:#fff;border-radius:5px;padding:1px 8px;font-size:.68em;' +
    'vertical-align:2px;margin-left:8px}' +
    '.sub{color:#9fa3ad;font-size:.82em;margin:6px 2px}' +
    '.board{background:#17181d;border:1px solid #26272e;border-radius:14px;padding:10px 8px;overflow-x:auto}' +
    '.board table{border-collapse:separate;border-spacing:3px;margin:0 auto}' +
    '.board th{color:#9fa3ad;font-size:.72em;font-weight:600;padding:0 2px 3px;min-width:24px}' +
    '.board td{background:#23252d;border-radius:5px;min-width:26px;height:30px;text-align:center;' +
    'font-weight:700;font-size:.95em;padding:0 4px}' +
    '.board td.tm{background:none;font-weight:700;min-width:30px;font-size:.85em;color:#cfd2da}' +
    '.board td.tot{background:#333748;color:#ffd479}' +
    '.tbl{background:#17181d;border:1px solid #26272e;border-radius:14px;overflow:hidden;margin:8px 0}' +
    'table.st{width:100%;border-collapse:collapse;font-size:.88em}' +
    '.st th{background:#1e2026;color:#9fa3ad;font-weight:600;font-size:.75em;padding:8px 3px}' +
    '.st td{padding:9px 3px;text-align:center;border-top:1px solid #24252b}' +
    '.st .name{text-align:left;padding-left:14px;white-space:nowrap}' +
    '.chip{display:inline-block;min-width:1.6em;text-align:center;border-radius:5px;padding:2px 6px;' +
    'font-size:.78em;font-weight:700;color:#fff}' +
    '.chip.win{background:#2f6fdd}.chip.lose{background:#c04343}.chip.hold{background:#3aa06b}.chip.save{background:#b8862f}' +
    '.foot{color:#63666e;font-size:.75em;text-align:center;margin-top:34px}' +
    'table.order{width:100%;border-collapse:collapse;font-size:.9em}' +
    'table.order th{background:#1e2026;color:#cfd2da;font-weight:700;padding:8px 4px;border-bottom:1px solid #33343c}' +
    'table.order th+th{border-left:1px solid #33343c}' +
    'table.order td{padding:9px 4px;border-top:1px solid #24252b}' +
    'table.order td.no{width:2em;text-align:center;color:#9fa3ad}' +
    'table.order td.nm{text-align:left;white-space:nowrap}' +
    'table.order td.no:nth-child(3){border-left:1px solid #33343c}' +
    // 1球速報カード
    '.live1{background:#17181d;border:1px solid #26272e;border-radius:14px;padding:12px 14px;margin:10px 0}' +
    '.live1 .row{display:flex;align-items:center;gap:10px}' +
    '.live1 .who{flex:1}' +
    '.live1 .who .lab{color:#9fa3ad;font-size:.72em}' +
    '.live1 .who .nm{font-size:1.05em;font-weight:700}' +
    '.live1 .who .nm .lr{background:#e5006e;color:#fff;border-radius:4px;font-size:.6em;padding:1px 5px;margin-left:5px;vertical-align:2px}' +
    '.count{display:flex;gap:14px;align-items:center;margin:10px 0 4px}' +
    '.count .g{display:flex;align-items:center;gap:4px}' +
    '.count .lb{color:#9fa3ad;font-weight:700;font-size:.8em}' +
    '.pip{width:12px;height:12px;border-radius:50%;background:#3a3d46;display:inline-block}' +
    '.pip.b{background:#18b56a}.pip.s{background:#f5c518}.pip.o{background:#e5484d}' +
    '.dia{position:relative;width:34px;height:34px;margin-left:auto}' +
    '.dia i{position:absolute;width:13px;height:13px;background:#3a3d46;transform:rotate(45deg)}' +
    '.dia i.on{background:#f5a623}' +
    '.dia .b1{right:0;top:10px}.dia .b2{left:10px;top:0}.dia .b3{left:0;top:10px}' +
    '.plist{margin-top:8px}' +
    '.plist .p{display:flex;align-items:center;gap:10px;padding:7px 2px;border-top:1px solid #24252b}' +
    '.plist .n{width:22px;height:22px;border-radius:50%;background:#3a3d46;color:#fff;font-size:.78em;' +
    'display:flex;align-items:center;justify-content:center;font-weight:700}' +
    '.plist .n.b{background:#18b56a}.plist .n.s{background:#f5c518;color:#111}.plist .n.f{background:#c7b37a;color:#111}' +
    '.selrow{display:flex;gap:8px;margin:10px 0}' +
    '.selrow select{flex:1;background:#17181d;color:#e9e9ec;border:1px solid #33343c;' +
    'border-radius:10px;padding:10px 12px;font-size:.95em}' +
    '.mc{background:#17181d;border:1px solid #26272e;border-radius:14px;padding:14px 16px;margin:10px 0}' +
    '.mn{font-size:1.05em;font-weight:700;margin-bottom:8px}' +
    '.furi{color:#9fa3ad;font-size:.75em;font-weight:400;margin-left:8px}' +
    '.ml{color:#f5a623;font-size:.72em;font-weight:700;margin:10px 0 4px;padding-left:2px}' +
    '.mt{margin:2px 0}.mt .tt{font-weight:600;font-size:.92em}' +
    '.mt .ar{color:#9fa3ad;font-size:.78em;margin-left:6px}' +
    '.mt .sl{background:#f5a623;color:#fff;font-size:.68em;font-weight:700;padding:1px 5px;border-radius:3px;margin-right:4px}' +
    '</style></head><body>' + (SITE_PASSWORD ? '<div id="gate" style="max-width:320px;margin:80px auto;text-align:center">' +
    '<h2 style="color:#e9e9ec">🔒 パスワードを入力</h2>' +
    '<input id="pw" type="password" placeholder="パスワード" style="width:100%;padding:12px;border-radius:10px;border:1px solid #33343c;background:#17181d;color:#e9e9ec;font-size:1em;margin:12px 0">' +
    '<button onclick="chk()" style="width:100%;padding:12px;border-radius:10px;border:none;background:#2f6fdd;color:#fff;font-size:1em;font-weight:700;cursor:pointer">入場</button>' +
    '<p id="err" style="color:#e5484d;font-size:.85em;margin-top:8px"></p></div>' : '') +
    '<div id="main" class="wrap"' + (SITE_PASSWORD ? ' style="display:none"' : '') + '>' + body +
    '<p class="foot">ピンポン野球サークル 速報 (' + SITE_VER + ')</p></div>' +
    (SITE_PASSWORD ? '<script>' +
    'var P="' + SITE_PASSWORD + '";' +
    'if(localStorage.getItem("site_auth")===P){document.getElementById("gate").style.display="none";document.getElementById("main").style.display=""}' +
    'function chk(){var v=document.getElementById("pw").value;if(v===P){localStorage.setItem("site_auth",P);document.getElementById("gate").style.display="none";document.getElementById("main").style.display=""}else{document.getElementById("err").textContent="パスワードが違います"}}' +
    'document.getElementById("pw").addEventListener("keydown",function(e){if(e.key==="Enter")chk()})' +
    '</script>' : '') +
    '</body></html>';
}

function renderIndex() {
  const url = ScriptApp.getService().getUrl();
  let body = '<h1>⚾ ピンポン野球 速報</h1>' +
    '<a class="card" target="_top" href="' + url + '?view=stats">' +
    '<div class="d">📊 個人成績ランキング</div>' +
    '<div style="font-size:.85em;color:#9fa3ad;margin-top:2px">打率・本塁打・防御率など</div></a>' +
    '<a class="card" target="_top" href="' + url + '?view=music">' +
    '<div class="d">🎵 登場曲紹介</div>' +
    '<div style="font-size:.85em;color:#9fa3ad;margin-top:2px">メンバーの打席曲・投手曲一覧</div></a>';

  // アプリ配布リンク（APK_URL 設定時のみ表示）。Driveのプレビューページ経由が最も確実
  const apkId = fileId(APK_URL);
  if (apkId) {
    body += '<a class="card" target="_top" href="https://drive.google.com/file/d/' + apkId + '/view">' +
      '<div class="d">📲 記録アプリをダウンロード（Android）</div>' +
      '<div style="font-size:.85em;color:#9fa3ad;margin-top:2px">開いた画面の⬇ダウンロードでAPKを保存 → インストール</div></a>';
  }

  // 試合中（LIVE）
  const liveRows = rowsOf(LIVE_SHEET);
  const meta = liveMeta();
  if (meta || liveRows.length > 0) {
    const l = lineScore(liveRows);
    const d = liveRows[0] ? liveRows[0].date : (meta ? meta.date : "");
    const st = liveRows[0] ? liveRows[0].stadium : (meta ? meta.stadium : "");
    body += '<a class="card live" target="_top" href="' + url + '?view=game&sheet=' + LIVE_SHEET + '">' +
      '<div class="d"><span class="dot"></span>試合中　' + esc(d) + '　' + esc(st) + '</div>' +
      '<div class="s">先攻 ' + l.scoreF + ' - ' + l.scoreS + ' 後攻</div></a>';
  }

  const names = gameSheetNames().reverse();
  if (names.length === 0 && !meta) body += '<p class="sub">まだ試合がありません。</p>';
  const sums = gameSummaries(names); // 要約は永続キャッシュ済み（初回だけ各シートを読む）
  names.forEach(n => {
    const g = sums[n];
    if (!g) return;
    body += '<a class="card" target="_top" href="' + url + '?view=game&sheet=' + encodeURIComponent(n) + '">' +
      '<div class="d">' + esc(n) + '　' + esc(g.st) + '</div>' +
      '<div class="s">' + esc(g.f) + ' ' + g.a + ' - ' + g.b + ' ' + esc(g.s) + '</div></a>';
  });
  return page("試合一覧", body, false);
}

function renderGame(name) {
  const isLive = name === LIVE_SHEET;
  const rows = rowsOf(name);
  const meta = isLive ? liveMeta() : null;
  const url = ScriptApp.getService().getUrl();
  if (rows.length === 0 && !meta) {
    return page("試合", '<p>データがありません。</p><a class="card" target="_top" href="' + url + '?">← 一覧へ</a>', isLive);
  }
  const date = rows[0] ? rows[0].date : meta.date;
  const stadium = rows[0] ? rows[0].stadium : meta.stadium;
  const l = lineScore(rows);
  // シーズン集計は「その試合終了時点」まで。全試合経過は追記順なので、
  // この試合の日付が最後に現れる行までで打ち切る。
  // ライブ中は12秒ごとに再読込されるため、重い全試合経過は読まず当日分のみで集計する
  let allRows = isLive ? [] : rowsOf(ALL_GAMES);
  if (!isLive) {
    let lastIdx = -1;
    for (let i = 0; i < allRows.length; i++) {
      if (String(allRows[i].date) === String(date)) lastIdx = i;
    }
    if (lastIdx >= 0) allRows = allRows.slice(0, lastIdx + 1);
  }
  const seasonRows = allRows.concat(isLive ? rows : []);

  // タイトル: "2026年7月17日 ○○小 第2試合" 形式（1試合のみなら第○試合省略）
  var gameNum = "";
  if (!isLive) {
    var m = name.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/);
    if (m) {
      var sameDay = gameSheetNames().filter(function(n){ return n === m[1] || n.indexOf(m[1] + "-") === 0; });
      if (sameDay.length > 1) gameNum = " 第" + (m[2] ? m[2] : "1") + "試合";
    }
  }
  // シート名(YYYY-MM-DD形式)から日付を取得。ライブ時やマッチしない場合はDateオブジェクトをパース
  var dateStr;
  var nm = String(name).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (nm) {
    dateStr = nm[1] + "年" + parseInt(nm[2]) + "月" + parseInt(nm[3]) + "日";
  } else {
    var dt = new Date(date);
    dateStr = isNaN(dt.getTime()) ? String(date)
      : dt.getFullYear() + "年" + (dt.getMonth()+1) + "月" + dt.getDate() + "日";
  }
  let body = '<div class="top"><a target="_top" href="' + url + '?">‹ 試合一覧</a></div>' +
    '<h1>' + esc(dateStr) + ' ' + esc(stadium) + esc(gameNum) +
    (isLive ? '<span class="badge">試合中</span>' : '') + '</h1>';
  if (isLive) {
    const last = rows[rows.length - 1];
    body += '<p class="sub"><span class="dot"></span>' +
      (last ? last.nInning + '回' + esc(last.nTb) + ' ' + last.nOuts + 'アウト　' : '試合開始前　') +
      '約12秒ごとに自動更新</p>';
  }

  const tn = teamNames(rows);

  // スコアボード（マス目表示）。チーム名は頭文字（チーム山村→山）
  var shortF = tn.f.replace(/^チーム/, "").charAt(0) || "先";
  var shortS = tn.s.replace(/^チーム/, "").charAt(0) || "後";
  let sb = '<div class="board"><table><tr><th></th>';
  for (let i = 1; i <= l.maxIn; i++) sb += '<th>' + i + '</th>';
  sb += '<th>計</th><th>安</th><th>失</th></tr>';
  sb += '<tr><td class="tm">' + esc(shortF) + '</td>' + l.fi.map(x => '<td>' + x + '</td>').join('') +
    '<td class="tot">' + l.scoreF + '</td><td>' + l.hitsF + '</td><td>' + l.errF + '</td></tr>';
  sb += '<tr><td class="tm">' + esc(shortS) + '</td>' + l.se.map(x => '<td>' + x + '</td>').join('') +
    '<td class="tot">' + l.scoreS + '</td><td>' + l.hitsS + '</td><td>' + l.errS + '</td></tr></table></div>';
  body += sb;

  // 1球速報（試合中のみ。現在の打者・カウント・投球経過）
  if (isLive) body += live1HTML(liveState());

  // #6 打順（スコアボードの下に両チームを2列で表示）
  const ordF = battingOrder(rows, true), ordS = battingOrder(rows, false);
  const rowsN = Math.max(ordF.length, ordS.length);
  if (rowsN > 0) {
    let ob = '<div class="tbl"><table class="order">' +
      '<tr><th colspan="2">' + esc(tn.f) + '</th><th colspan="2">' + esc(tn.s) + '</th></tr>';
    for (let i = 0; i < rowsN; i++) {
      ob += '<tr>' +
        '<td class="no">' + (ordF[i] ? (i + 1) : '') + '</td><td class="nm">' + esc(ordF[i] || '') + '</td>' +
        '<td class="no">' + (ordS[i] ? (i + 1) : '') + '</td><td class="nm">' + esc(ordS[i] || '') + '</td>' +
        '</tr>';
    }
    body += ob + '</table></div>';
  }

  // 責任投手（試合終了後のみ。シーズン通算の勝敗HSを併記）
  const pb = isLive ? null : pblockOf(name);
  if (pb && (pb.win || pb.loss || pb.saves.length || pb.holds.length)) {
    const srec = seasonPitcherRecords(date);
    body += '<h2>責任投手</h2><div class="tbl"><table class="st">';
    if (pb.win) body += '<tr><td style="width:3.2em"><span class="chip win">勝</span></td><td class="name">' +
      esc(pb.win) + '<span class="sub">' + recStr(srec, pb.win) + '</span></td></tr>';
    if (pb.loss) body += '<tr><td><span class="chip lose">敗</span></td><td class="name">' +
      esc(pb.loss) + '<span class="sub">' + recStr(srec, pb.loss) + '</span></td></tr>';
    pb.holds.forEach(h => body += '<tr><td><span class="chip hold">H</span></td><td class="name">' +
      esc(h) + '<span class="sub">' + recStr(srec, h) + '</span></td></tr>');
    pb.saves.forEach(s => body += '<tr><td><span class="chip save">S</span></td><td class="name">' +
      esc(s) + '<span class="sub">' + recStr(srec, s) + '</span></td></tr>');
    body += '</table></div>';
  }

  // 本塁打（号数はシーズン通算）
  const hrs = rows.filter(r => r.result === "4塁打");
  if (hrs.length > 0) {
    body += '<h2>本塁打</h2><div class="tbl"><table class="st">';
    hrs.forEach(hr => {
      let no = 0;
      for (let i = 0; i < seasonRows.length; i++) {
        const sr = seasonRows[i];
        if (sr.result === "4塁打" && sr.batter === hr.batter) {
          no++;
          if (sr.date === hr.date && sr.inning === hr.inning && sr.tb === hr.tb) break;
        }
      }
      const kind = hr.runs >= 4 ? "満塁" : hr.runs === 3 ? "3ラン" : hr.runs === 2 ? "2ラン" : "ソロ";
      body += '<tr><td class="name">' + esc(hr.batter) + '</td><td>' + no + '号（' +
        hr.inning + '回' + esc(hr.tb) + kind + '）</td></tr>';
    });
    body += '</table></div>';
  }

  // 戦評（試合終了後のみ。Gemini APIキー設定時に自動生成し、シートにキャッシュ）
  if (!isLive) {
    const review = ensureReview(name, rows, pb);
    if (review) {
      body += '<h2>戦評</h2><div class="card" style="line-height:1.9;font-size:.92em">' +
        esc(review).replace(/\n/g, '<br>') + '</div>';
    }
  }

  // 打者成績。打率は通算（表/裏を分けず、全打席を合算した「その試合終了時点」の打率）
  const seasonBat = batAllFrom(seasonRows);
  function batTable(title, top) {
    const st = batStats(rows, top);
    const names = Object.keys(st).sort((a, b) => st[a].order - st[b].order);
    if (names.length === 0) return '';
    let t = '<h2>' + title + ' 打者成績</h2><div class="tbl"><table class="st">' +
      '<tr><th class="name">選手名</th><th>打率</th><th>打</th><th>安</th><th>点</th><th>本</th></tr>';
    names.forEach(n => {
      const b = st[n];
      const sa = seasonBat[n] || { ab: 0, h: 0 };
      t += '<tr><td class="name">' + esc(n) + '</td><td>' + avgStr(sa.h, sa.ab) + '</td>' +
        '<td>' + b.ab + '</td><td>' + b.h + '</td><td>' + b.rbi + '</td><td>' + b.hr + '</td></tr>';
    });
    return t + '</table></div>';
  }
  body += batTable(tn.f, true);
  body += batTable(tn.s, false);

  // 投手成績
  function pitTable(title, top) {
    const st = pitStats(rows, top);
    const names = Object.keys(st).sort((a, b) => st[a].order - st[b].order);
    if (names.length === 0) return '';
    let t = '<h2>' + title + ' 投手成績</h2><div class="tbl"><table class="st">' +
      '<tr><th></th><th class="name">選手名</th>' +
      '<th>回</th><th>球</th><th>安</th><th>振</th><th>四</th><th>死</th><th>失</th><th>自責</th></tr>';
    names.forEach(n => {
      const p = st[n];
      let mark = '';
      if (pb) {
        if (pb.win === n) mark = '<span class="chip win">勝</span>';
        else if (pb.loss === n) mark = '<span class="chip lose">敗</span>';
        else if (pb.holds.indexOf(n) >= 0) mark = '<span class="chip hold">H</span>';
        else if (pb.saves.indexOf(n) >= 0) mark = '<span class="chip save">S</span>';
      }
      const rec = pb && pb.pitchers[n] ? pb.pitchers[n] : null;
      t += '<tr><td style="width:3.2em">' + mark + '</td><td class="name">' + esc(n) + '</td>' +
        '<td>' + ipStr(p.outs) + '</td><td>' + p.np + '</td><td>' + p.h + '</td>' +
        '<td>' + p.k + '</td><td>' + p.bb + '</td><td>' + p.hbp + '</td>' +
        '<td>' + (rec ? rec.runs : p.runs) + '</td><td>' + (rec ? rec.er : '-') + '</td></tr>';
    });
    return t + '</table></div>';
  }
  body += pitTable(tn.f, true);
  body += pitTable(tn.s, false);

  return page(date + ' の試合', body, isLive);
}
