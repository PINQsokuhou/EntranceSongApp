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
const TS_SHEET = "タイムスタンプ"; // YouTube用タイムスタンプの本文を試合ごとに保存（複数端末で閲覧用）
// 新しい月の「N月間成績」を作るときに複製するテンプレシート名。
// A1に経過シート名を入れると全数式が追従する作りのシートを指定する。
const SEISEKI_TEMPLATE = "シーズン通算成績";

// サイトの表示バージョン（デプロイ反映確認用。ページ最下部に表示される）
const SITE_VER = "site v38";

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

  // シーズン選択（?season=ID）。登録済みで現行以外のIDのときだけアーカイブ表示に切り替える
  if (p.season && playableSeasons().some(function (s) { return s.id === p.season && !s.current; })) {
    _seasonId = p.season;
  }
  // 成績・選手ページは期間セレクタ（"s:<ID>"）でもシーズンを切り替える
  if ((p.view === "stats" || p.view === "player") && p.period) applyPeriodSeason(p.period);

  const cache = CacheService.getScriptCache();
  const sk = "S" + String(activeSeasonId()).slice(-10) + ":"; // シーズン別キャッシュ接頭辞
  let h;
  // 試合ページ（ライブは毎回最新、終了試合はキャッシュ）
  if (p.view === "game") {
    // 終了した試合の内容はもう変わらないので長めにキャッシュする（ライブは毎回最新）
    h = (p.sheet === LIVE_SHEET) ? renderGame(p.sheet)
      : cached(cache, sk + "g:" + p.sheet, 1800, function () { return renderGame(p.sheet); });
  } else if (p.view === "stats") {
    // 個人成績（種目・期間ごとにキャッシュ）
    const key = sk + "s:" + (p.type || "") + ":" + (p.period || "") + ":" + (p.stat || "");
    h = cached(cache, key, 90, function () {
      return renderStats(p.type || "bat", p.stat || "", p.period || "");
    });
  } else if (p.view === "music") {
    h = cached(cache, sk + "music", 600, function () { return renderMusic(); });
  } else if (p.view === "player") {
    // 選手個人ページ（選手名・期間ごとにキャッシュ）
    h = cached(cache, sk + "pl:" + (p.name || "") + ":" + (p.period || ""), 120,
      function () { return renderPlayer(p.name, p.period); });
  } else if (p.view === "ts") {
    if (p.dir) {
      // サイト上でのズレ補正: 分秒ぶん全時刻をずらして保存し、最新を表示（キャッシュしない）
      var sec = (parseInt(p.mm, 10) || 0) * 60 + (parseInt(p.ss, 10) || 0);
      h = renderTsShift(p.sheet, p.dir === "minus" ? -sec : sec);
    } else {
      // 開いたときだけ専用シートを1行読む
      h = cached(cache, sk + "ts:" + p.sheet, 1800, function () { return renderTs(p.sheet); });
    }
  } else {
    // 試合一覧（全シートを読むので特にキャッシュが効く）
    h = cached(cache, sk + "index", 60, function () { return renderIndex(); });
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
    if (d.action === "saveTs") return json(saveTsText(d.sheet, d.text));
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
  if (d.action === "saveTs") return saveTsText(d.sheet, d.text);
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
// ---------------- シーズン管理（複数スプレッドシート対応） ----------------
// ロースター（楽曲登録）のスプレッドシートに「シーズン」シートを作り、1行ずつ追記していく:
//   A: シーズン名   B: スプレッドシートURL   C: 現行（TRUE/○ のとき今シーズン）
// 新シーズンは1行足して現行にするだけ。GAS・サイト・アプリのURLは変わらない。
const SEASON_SHEET = "シーズン";
var _seasonId = "";   // リクエストで選択中のシーズンID（"" = 現行）
var _bookCache = {};  // id -> Spreadsheet（同一リクエスト内の再オープンを防ぐ）

function boundBook() { return SpreadsheetApp.getActiveSpreadsheet(); }
function rosterBook() {
  try { return ROSTER_SS_ID ? SpreadsheetApp.openById(ROSTER_SS_ID) : boundBook(); }
  catch (e) { return boundBook(); }
}

// シーズン一覧 [{label,id,current}]。登録が無ければ現行（=バインド先）のみ。10分キャッシュ
function seasonList() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get("seasonList2");
  if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  let out = [];
  try {
    const sh = rosterBook().getSheetByName(SEASON_SHEET);
    if (sh && sh.getLastRow() >= 2) {
      const v = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
      v.forEach(function (r) {
        const label = String(r[0] || "").trim();
        const url = String(r[1] || "").trim();
        if (!label || !url) return;
        const id = fileId(url) || url;
        const c = r[2];
        const cur = c === true || /^(true|○|◯|現行|current)$/i.test(String(c).trim());
        // D列に成績シート名があれば「成績のみシーズン」。試合データが無く、通算にだけ加算する
        const statsSheet = String(r[3] || "").trim();
        out.push({ label: label, id: id, current: cur, statsSheet: statsSheet });
      });
    }
  } catch (e) { out = []; }
  if (out.length === 0) out = [{ label: "今シーズン", id: boundBook().getId(), current: true, statsSheet: "" }];
  else if (!out.some(function (s) { return s.current; })) {
    const firstNormal = out.filter(function (s) { return !s.statsSheet; })[0];
    (firstNormal || out[0]).current = true;
  }
  try { cache.put("seasonList2", JSON.stringify(out), 600); } catch (e) {}
  return out;
}
// 試合データを持つシーズン（試合一覧・シーズン切り替えに出すもの）
function playableSeasons() {
  return seasonList().filter(function (s) { return !s.statsSheet; });
}
function currentSeasonId() {
  const c = seasonList().filter(function (s) { return s.current; })[0];
  return c ? c.id : boundBook().getId();
}
function activeSeasonId() { return _seasonId || currentSeasonId(); }
function seasonQ() { return _seasonId ? "&season=" + encodeURIComponent(_seasonId) : ""; }
function seasonParam() { return _seasonId ? "season=" + encodeURIComponent(_seasonId) : ""; }
// フォームに入れる隠しフィールド（選択シーズンを維持）
function seasonHidden() { return _seasonId ? '<input type="hidden" name="season" value="' + esc(_seasonId) + '">' : ""; }

function bookById(id) {
  if (_bookCache[id]) return _bookCache[id];
  let b;
  try { b = SpreadsheetApp.openById(id); } catch (e) { b = boundBook(); }
  _bookCache[id] = b;
  return b;
}
// すべての読み書きの入口。選択中シーズン（既定=現行）のスプレッドシートを返す
function ss() { return bookById(activeSeasonId()); }

// ---------------- 選手名の正規化（表記ゆれ・フルネームの統一） ----------------
// 別名はロースター（楽曲登録）のスプレッドシートの「選手別名」シートで管理する:
//   A: 正式名   B: 別名（この名前を見つけたら正式名に読み替える）
// 例) 冨髙 / 冨高、谷遼 / 谷。行を足すだけで今後の表記ゆれにも対応できる。
// シートの列は見出し名で探す: 正式名 / フルネーム / 別名
const ALIAS_SHEET = "選手別名";
var _aliasData = null;  // { alias: {別名->正式名}, full: {正式名->フルネーム} }
var _knownNames = null; // 正式名の集合（名簿のA列）

function aliasData() {
  if (_aliasData) return _aliasData;
  const cache = CacheService.getScriptCache();
  const hit = cache.get("aliasData");
  if (hit) { try { _aliasData = JSON.parse(hit); return _aliasData; } catch (e) {} }
  const alias = {}, full = {};
  try {
    const sh = rosterBook().getSheetByName(ALIAS_SHEET);
    if (sh && sh.getLastRow() >= 2) {
      const v = sh.getDataRange().getValues();
      const hdr = (v[0] || []).map(function (x) { return stripSpace(x); });
      function col(label, fallback) {
        for (let i = 0; i < hdr.length; i++) if (hdr[i].indexOf(label) === 0) return i;
        return fallback;
      }
      const cOff = col("正式名", 0);
      const cFull = col("フルネーム", -1);
      const cAlias = col("別名", cFull >= 0 ? 2 : 1);
      for (let r = 1; r < v.length; r++) {
        const official = stripSpace(v[r][cOff]);
        if (!official) continue;
        if (cFull >= 0) {
          // フルネームは表示専用。「橋本 大輝」の区切りを残すため前後だけ整える
          const f = String(v[r][cFull] == null ? "" : v[r][cFull]).replace(/[\s　]+/g, " ").trim();
          if (f) full[official] = f;
        }
        if (cAlias >= 0) {
          // 別名は「,」「、」区切りで複数書ける
          stripSpace(v[r][cAlias]).split(/[,、]/).forEach(function (a) {
            if (a && a !== official) alias[a] = official;
          });
        }
      }
    }
  } catch (e) {}
  _aliasData = { alias: alias, full: full };
  try { cache.put("aliasData", JSON.stringify(_aliasData), 600); } catch (e) {}
  return _aliasData;
}
function aliasMap() { return aliasData().alias; }

// 画面表示用の名前（フルネームが登録されていればそれを使う）
function displayName(name) {
  const n = stripSpace(name);
  if (!n) return "";
  return aliasData().full[n] || n;
}

// 名簿（楽曲登録シート）のA列 = 正式名の一覧
function knownNames() {
  if (_knownNames) return _knownNames;
  const cache = CacheService.getScriptCache();
  const hit = cache.get("knownNames");
  if (hit) { try { _knownNames = JSON.parse(hit); return _knownNames; } catch (e) {} }
  const k = {};
  try {
    const sh = rosterBook().getSheetByName(ROSTER_SHEET);
    if (sh && sh.getLastRow() >= 2) {
      const v = sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues();
      v.forEach(function (r) { const n = stripSpace(r[0]); if (n) k[n] = 1; });
    }
  } catch (e) {}
  // 別名シートの「正式名」も正式名として扱う。
  // これで「原田奏」のような別人のフルネームが「原田」に丸められるのを防げる
  try {
    const f = aliasData().full;
    Object.keys(f).forEach(function (n) { k[n] = 1; });
    const sh2 = rosterBook().getSheetByName(ALIAS_SHEET);
    if (sh2 && sh2.getLastRow() >= 2) {
      const v2 = sh2.getRange(2, 1, sh2.getLastRow() - 1, 1).getValues();
      v2.forEach(function (r) { const n = stripSpace(r[0]); if (n) k[n] = 1; });
    }
  } catch (e) {}
  _knownNames = k;
  try { cache.put("knownNames", JSON.stringify(k), 600); } catch (e) {}
  return k;
}

function stripSpace(s) {
  return String(s == null ? "" : s).replace(/[\s　]+/g, "").trim();
}

// 選手名の正規化。空白除去 → 別名表 → フルネームなら既知の苗字に丸める
function normName(raw) {
  const s = stripSpace(raw);
  if (!s) return "";
  const A = aliasMap();
  if (A[s]) return A[s];
  const K = knownNames();
  if (K[s]) return s; // すでに正式名
  // 「橋本大輝」のようなフルネームは、名簿にある苗字（2文字以上）に丸める
  if (s.length >= 3) {
    let best = "";
    for (const k in K) {
      if (k.length >= 2 && s.indexOf(k) === 0 && k.length > best.length) best = k;
    }
    if (best) return best;
  }
  return s;
}

// 一度だけ実行: ロースターのスプレッドシートに「選手別名」シートを作り、判明分を埋める。
// 空欄のフルネームは後から手で埋めればOK（サイトはフルネームがあればそちらを表示する）。
function setupAliasSheet() {
  const book = rosterBook();
  let sh = book.getSheetByName(ALIAS_SHEET);
  if (!sh) sh = book.insertSheet(ALIAS_SHEET);
  sh.clear();
  sh.getRange(1, 1, 1, 3).setValues([["正式名", "フルネーム（苗字 名前）", "別名（カンマ区切り）"]]);

  // 自己紹介PDF（2026）と過去のスプレッドシートから判明しているフルネーム・表記ゆれ
  const seed = [
    // ---- 現役メンバー（自己紹介2026より） ----
    ["上坂", "上坂 知弘", ""],
    ["上野", "上野 悠仁", "上野悠仁"],
    ["中根", "中根 拓海", ""],
    ["中山", "中山 和輝", ""],
    ["仙田", "仙田 晴真", ""],
    ["俣野", "俣野 亜知", ""],
    ["冨髙", "冨髙 晃生", "冨高"],
    ["原田", "原田 幸紀", ""],
    ["吉田", "吉田 実紘", ""],
    ["堀江", "堀江 祥吾", "堀江祥吾"],
    ["大嶋", "大嶋 寿弥", ""],
    ["大庭", "大庭 稜平", ""],
    ["山村", "山村 隆太", "山村隆太"],
    ["川勝", "川勝 太智", ""],
    ["布目", "布目 大貴", ""],
    ["新井", "新井 望斗", ""],
    ["杉江", "杉江 海飛", ""],
    ["林", "林 康平", ""],
    ["梅谷", "梅谷 修平", ""],
    ["橋本", "橋本 大輝", "橋本大輝"],
    ["湯浅", "湯浅 遼", ""],
    ["玉木", "玉木 翔大", ""],
    ["田中", "田中 蓮", ""],
    ["石田", "石田 晃己", ""],
    ["藤田", "藤田 裕輝", "藤田裕輝"],
    ["谷遼", "谷 遼", "谷"],
    ["野平", "野平 悠太朗", ""],
    ["金田", "金田 康希", ""],
    ["鵜飼", "鵜飼 泰佑", ""],
    ["練石", "錬石 悠太郎", "錬石"],
    // ---- PDFに無いが過去データから判明 ----
    ["清水川", "清水川 摩紘", "清水川摩紘"],
    ["西村", "西村 匡矢", "西村匡矢"],
    // ---- 過去メンバー（2022〜2023） ----
    ["中村", "中村 颯冴", "中村颯冴"],
    ["伊藤", "伊藤 諒", "伊藤諒"],
    ["八木", "八木 俊介", "八木俊介"],
    ["兼坂", "兼坂 太陽", "兼坂太陽"],
    ["加藤", "加藤 弘之", "加藤弘之"],
    ["小林", "小林 晃一良", "小林晃一良"],
    ["山本", "山本 将人", "山本将人"],
    ["川人", "川人 祐太", "川人祐太"],
    ["幡谷", "幡谷 健斗", "幡谷健斗"],
    ["栁田", "栁田 遥仁", "栁田遥仁"],
    // 2022年の「原田奏」は現在の「原田幸紀」とは別人。同姓で混ざらないよう別行にする
    ["原田奏", "原田 奏", ""],
    ["井上哲", "井上 哲", ""],
    ["山崎真治", "山崎 真治", ""],
    ["澤江優太朗", "澤江 優太朗", ""],
    ["石堀朝陽", "石堀 朝陽", ""],
    ["石山和暉", "石山 和暉", ""],
    ["石黒遥大", "石黒 遥大", ""],
    ["秋吉悠希", "秋吉 悠希", ""],
    ["ﾊﾞﾙﾃﾞｽﾌﾗﾝｼｽｺ", "ﾊﾞﾙﾃﾞｽ ﾌﾗﾝｼｽｺ", ""]
  ];
  // 名簿にいるがフルネームが分からない人は、正式名だけ入れて空欄で用意しておく
  const have = {};
  seed.forEach(function (r) { have[r[0]] = 1; });
  const K = knownNames();
  Object.keys(K).sort().forEach(function (n) {
    if (!have[n]) seed.push([n, "", ""]);
  });

  sh.getRange(2, 1, seed.length, 3).setValues(seed);
  sh.setFrozenRows(1);
  try { CacheService.getScriptCache().removeAll(["aliasData", "knownNames"]); } catch (e) {}
  return "「" + ALIAS_SHEET + "」シートを用意しました（" + seed.length +
    "行）。フルネーム欄が空の人は「苗字 名前」の形（半角スペース区切り）で埋めてください。";
}

// 一度だけ実行: ロースターのスプレッドシートに「シーズン」シートを作り、現行シーズンを1行入れる
function setupSeasonSheet() {
  const book = rosterBook();
  let sh = book.getSheetByName(SEASON_SHEET);
  if (!sh) sh = book.insertSheet(SEASON_SHEET);
  if (sh.getLastRow() < 1) {
    // D列（成績シート名）を入れた行は「成績のみの年度」＝通算にだけ加算し、試合一覧には出さない
    sh.getRange(1, 1, 1, 4).setValues([["シーズン名", "スプレッドシートURL", "現行", "成績シート名（成績のみの年度）"]]);
  }
  if (sh.getLastRow() < 2) {
    const url = "https://docs.google.com/spreadsheets/d/" + boundBook().getId() + "/edit";
    sh.getRange(2, 1, 1, 4).setValues([["今シーズン", url, true, ""]]);
  }
  try { CacheService.getScriptCache().remove("seasonList2"); } catch (e) {}
  return "「" + SEASON_SHEET + "」シートを用意しました。行を足してシーズンを増やせます。";
}

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

  // YouTube用タイムスタンプ本文（ブラウザ版スコアブックが送ってくる）を保存
  if (d.ytText) { try { saveTsText(name, d.ytText); } catch (e) {} }

  SpreadsheetApp.flush();
  // 一覧キャッシュを消して、終わった試合をすぐ反映
  try { CacheService.getScriptCache().remove("index"); } catch (e) {}
  return { ok: true, sheet: name, allGames: !!allSheet, monthly: monthly ? monthly.getName() : null };
}

// ---- YouTube用タイムスタンプ本文の保存/取得（試合ごと・複数端末で閲覧するため） ----
// 専用シート「タイムスタンプ」に [試合シート名, 本文, 更新日時] を1試合1行で持つ。
// このシートは ?view=ts を開いたときだけ読むので、試合一覧など他ページの速度には影響しない。
function getTsText(name) {
  const sh = ss().getSheetByName(TS_SHEET);
  if (!sh || sh.getLastRow() < 2) return "";
  const v = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  for (let r = 1; r < v.length; r++) {
    if (String(v[r][0]) === String(name)) return String(v[r][1] || "");
  }
  return "";
}
function saveTsText(name, text) {
  const book = ss();
  let sh = book.getSheetByName(TS_SHEET);
  if (!sh) {
    sh = book.insertSheet(TS_SHEET, book.getNumSheets());
    sh.getRange(1, 1, 1, 3).setValues([["試合シート名", "本文", "更新日時"]]);
  }
  const last = sh.getLastRow();
  const keys = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues() : [];
  let row = -1;
  for (let r = 0; r < keys.length; r++) {
    if (String(keys[r][0]) === String(name)) { row = r + 2; break; }
  }
  if (row < 0) row = last + 1;
  sh.getRange(row, 1, 1, 3).setValues([[name, text, new Date()]]);
  try { CacheService.getScriptCache().remove("ts:" + name); } catch (e) {}
  return { ok: true };
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

function rowsOf(name, book) {
  const sh = (book || ss()).getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  // 打席記録は A〜AB(28列)だけ。getDataRange() だと右側の投手成績ブロック(AD列〜)まで
  // 読んでしまい、全試合経過のような大きいシートで無駄に遅くなる
  const L = layoutOf(book || ss());
  const cols = Math.min(28, Math.max(1, sh.getMaxColumns()));
  const v = sh.getRange(1, 1, sh.getLastRow(), cols).getValues();
  const rows = [];
  for (let r = 1; r < v.length; r++) {
    if (!v[r][0] && v[r][0] !== 0) continue;
    if (String(v[r][L.batter] || "") === "") continue; // 打者名が無い行は打席行でない
    rows.push(rowObj(v[r], L));
  }
  return rows;
}

// 試合一覧カード用の要約（球場・チーム名・スコア）をまとめて返す。
// 終了した試合の内容は変わらないので ScriptProperties に永続保存し、
// 一覧を開くたびに全試合シート（数十枚）を読み直さないようにする。
// これが無いとシート1枚ごとにスプレッドシートへ問い合わせが飛び、一覧の表示に十数秒かかる。
function gameSummaries(names) {
  const props = PropertiesService.getScriptProperties();
  const pre = "gs:" + String(activeSeasonId()).slice(-10) + ":"; // シーズン別（試合名の重複対策）
  let all = {};
  try { all = props.getProperties(); } catch (e) { all = {}; } // 1回の呼び出しで全部読む
  const map = {}, add = {};
  names.forEach(function (n) {
    const raw = all[pre + n];
    if (raw) {
      try { map[n] = JSON.parse(raw); return; } catch (e) { /* 壊れていたら作り直す */ }
    }
    const rows = rowsOf(n);
    if (rows.length === 0) return;
    const l = lineScore(rows), tn = teamNames(rows);
    const o = { st: rows[0].stadium, f: tn.f, s: tn.s, a: l.scoreF, b: l.scoreS };
    map[n] = o;
    add[pre + n] = JSON.stringify(o);
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
  try {
    CacheService.getScriptCache().removeAll(["index", "music", "seasonList2", "aliasData", "knownNames"]);
  } catch (e) {}
  const msg = "試合要約 " + n + " 件と一覧キャッシュ・シーズン一覧・名前対応表を削除しました";
  Logger.log(msg);
  return msg;
}

// 全試合経過の列レイアウト（0始まりの列番号）。過去シーズンは球場・打左右・投左右・バット種類が無く左にズレる
const LAYOUT_NEW = { stadium:1, inning:2, tb:3, outs:4, bases:5, batter:8, pitcher:10,
  pitches:12, result:14, tbases:18, errs:19, nInning:20, nTb:21, nOuts:22, nSf:24, nSs:25,
  runs:26, rbi:27, pblockName:30 };
const LAYOUT_OLD = { stadium:-1, inning:1, tb:2, outs:3, bases:4, batter:7, pitcher:8,
  pitches:9, result:11, tbases:14, errs:15, nInning:16, nTb:17, nOuts:18, nSf:20, nSs:21,
  runs:22, rbi:23, pblockName:26 };
var _layoutCache = {};
// スプレッドシートの形式を「全試合経過」B1見出しで判別（球場=新, 回=旧）。ブック単位でキャッシュ
function layoutOf(book) {
  const bk = book || ss();
  const id = bk.getId();
  if (_layoutCache[id]) return _layoutCache[id];
  let L = LAYOUT_NEW;
  try {
    const sh = bk.getSheetByName(ALL_GAMES);
    const b1 = sh ? String(sh.getRange(1, 2).getValue()).trim() : "";
    if (b1 === "回") L = LAYOUT_OLD;
    else if (b1 === "球場") L = LAYOUT_NEW;
    // 見出しが空のシーズンは成績シートの種類で推定（旧テンプレ=「全指標」／新テンプレ=「シーズン通算成績」）
    else if (bk.getSheetByName("全指標") && !bk.getSheetByName("シーズン通算成績")) L = LAYOUT_OLD;
  } catch (e) {}
  _layoutCache[id] = L;
  return L;
}

function rowObj(a, L) {
  L = L || LAYOUT_NEW;
  function s(i) { return i >= 0 ? String(a[i] || "") : ""; }
  function n(i) { return i >= 0 ? (+a[i] || 0) : 0; }
  return {
    date: String(a[0]), stadium: s(L.stadium),
    inning: n(L.inning), tb: s(L.tb), outs: n(L.outs), bases: s(L.bases),
    // 選手名はシーズンごとの表記ゆれ（冨高/冨髙、フルネーム等）を正規化して揃える
    batter: normName(s(L.batter)), pitcher: normName(s(L.pitcher)),
    pitches: n(L.pitches), result: s(L.result),
    tbases: n(L.tbases), errs: n(L.errs),
    nInning: n(L.nInning), nTb: s(L.nTb), nOuts: n(L.nOuts),
    nSf: n(L.nSf), nSs: n(L.nSs),
    runs: n(L.runs), rbi: n(L.rbi)
  };
}

// 出場者・投手成績ブロック（AD〜AL）を読む
function pblockOf(name) {
  const sh = ss().getSheetByName(name);
  if (!sh) return null;
  const PB = layoutOf(ss()).pblockName; // 投手名の列（新=30 / 旧=26）
  const v = sh.getDataRange().getValues();
  const out = { pitchers: {}, starters: [], win: "", loss: "", holds: [], saves: [] };
  for (let r = 1; r < v.length; r++) {
    if (v[r].length < PB + 8) continue;
    const pn = normName(v[r][PB]);            // 投手名
    if (pn) out.pitchers[pn] = { runs: +v[r][PB + 1] || 0, er: +v[r][PB + 2] || 0 };
    const st = normName(v[r][PB + 3]);        // 先発
    if (st) out.starters.push(st);
    if (r === 1) {
      out.win = normName(v[r][PB + 4]);       // 勝
      out.loss = normName(v[r][PB + 5]);      // 敗
    }
    const h = normName(v[r][PB + 6]);
    if (h) out.holds.push(h);
    const sv = normName(v[r][PB + 7]);
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
    const n = normName(name);
    if (!n) return;
    if (!rec[n]) rec[n] = { w: 0, l: 0, h: 0, s: 0 };
    rec[n][key]++;
  }
  const PB = layoutOf(ss()).pblockName;
  for (let r = 1; r < end; r++) {
    if (v[r].length < PB + 8) continue;
    add(v[r][PB + 4], "w"); // 勝
    add(v[r][PB + 5], "l"); // 敗
    add(v[r][PB + 6], "h"); // ホールド
    add(v[r][PB + 7], "s"); // セーブ
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

  let body = '<div class="top"><a href="' + url + '?' + seasonParam() + '">← 一覧へ</a></div>' +
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
  // チーム名は「チーム苗字」（正式名のまま。フルネームにはしない）
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
function pitAllFrom(rows, blockSheet, book) {
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
  // 失点・自責・勝敗HSは投手成績ブロックから（投手名の列は新=30 / 旧=26）
  const bk = book || ss();
  const sh = bk.getSheetByName(blockSheet);
  if (sh) {
    const PB = layoutOf(bk).pblockName;
    const v = sh.getDataRange().getValues();
    for (let r = 1; r < v.length; r++) {
      if (v[r].length < PB + 8) continue;
      const pn = normName(v[r][PB]);
      if (pn) {
        const p = ent(pn);
        p.runs += +v[r][PB + 1] || 0;
        p.er += +v[r][PB + 2] || 0;
      }
      const w = normName(v[r][PB + 4]); if (w) ent(w).w++;
      const l = normName(v[r][PB + 5]); if (l) ent(l).l++;
      const h = normName(v[r][PB + 6]); if (h) ent(h).hld++;
      const s = normName(v[r][PB + 7]); if (s) ent(s).sv++;
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
const CAREER_PERIOD = "__career__";     // 全シーズン合算（成績ページの期間セレクタ用）
const STATSONLY_PERIOD = "__statsonly__"; // 成績のみの年度（試合データ無し）
// 期間セレクタ（シーズンと期間を1つにまとめた選択肢）。上から順に:
//   今シーズン通算 → 今シーズンn月 → 全シーズン通算 → 過去シーズン（各シーズン通算のみ）
// 値: "" = 今シーズン通算 / 月間シート名 / CAREER_PERIOD / "s:<シーズンID>"
function periodOptions() {
  const out = [{ value: "", label: "今シーズン通算" }];
  // 今シーズンの月間（現行スプレッドシートから）
  bookById(currentSeasonId()).getSheets().forEach(function (s) {
    const n = s.getName();
    const m = n.match(/^(\d+(?:-\d+)?)月月間試合経過$/) || n.match(/^(\d+(?:-\d+)?)月試合経過$/);
    if (m) out.push({ value: n, label: "今シーズン " + m[1] + "月" });
  });
  if (seasonList().length >= 2) {
    out.push({ value: CAREER_PERIOD, label: "全シーズン通算" });
    // 試合データを持つ過去シーズン
    playableSeasons().forEach(function (s) {
      if (!s.current) out.push({ value: "s:" + s.id, label: s.label });
    });
    // 成績のみの年度（試合データ無し）。成績は見られるが試合一覧には出ない
    seasonList().forEach(function (s) {
      if (s.statsSheet) out.push({ value: "so:" + s.id, label: s.label });
    });
  }
  return out;
}

// 統一期間の値を {seasonId, sheet, statsOnly} に解く
function resolvePeriodValue(pv) {
  const v = String(pv || "");
  if (v.indexOf("so:") === 0) return { seasonId: v.slice(3), sheet: STATSONLY_PERIOD, statsOnly: true };
  if (v.indexOf("s:") === 0) return { seasonId: v.slice(2), sheet: ALL_GAMES };
  if (v === CAREER_PERIOD) return { seasonId: "", sheet: CAREER_PERIOD };
  if (v && v !== ALL_GAMES) return { seasonId: "", sheet: v }; // 今シーズンの月間
  return { seasonId: "", sheet: ALL_GAMES };
}

// 成績のみの年度の集計データ（指定シーズンの成績表を読む）
function statsOnlyDataOf(seasonId) {
  const s = seasonList().filter(function (x) { return x.id === seasonId && x.statsSheet; })[0];
  if (!s) return { bat: {}, pit: {} };
  return statsOnlySeasonData(bookById(s.id), s.statsSheet);
}
// 成績のみの年度の成績シート本体（選手ページで全項目を出すのに使う）
function statsOnlySheetOf(seasonId) {
  const s = seasonList().filter(function (x) { return x.id === seasonId && x.statsSheet; })[0];
  if (!s) return null;
  return bookById(s.id).getSheetByName(s.statsSheet);
}

// 期間パラメータに過去シーズンが指定されていれば、そのシーズンに切り替える（stats/player用）
function applyPeriodSeason(pv) {
  const r = resolvePeriodValue(pv);
  if (r.seasonId && playableSeasons().some(function (s) { return s.id === r.seasonId && !s.current; })) {
    _seasonId = r.seasonId;
  }
}

// 統一期間セレクタのHTML。現在の選択値を自動判定する
function periodSelectHtml(currentPeriodValue) {
  const opts = periodOptions();
  let cur = String(currentPeriodValue || "");
  // 過去シーズン閲覧中で期間指定が無いときは、そのシーズンを選択状態にする
  if (_seasonId && cur.indexOf("s:") !== 0 && (cur === "" || cur === ALL_GAMES)) cur = "s:" + _seasonId;
  if (cur === ALL_GAMES) cur = "";
  if (!opts.some(function (o) { return o.value === cur; })) cur = "";
  return '<select name="period" onchange="this.form.submit()">' +
    opts.map(function (o) {
      return '<option value="' + esc(o.value) + '"' + (o.value === cur ? ' selected' : '') + '>' +
        esc(o.label) + '</option>';
    }).join('') + '</select>';
}

// 通算: 全シーズンの「全試合経過」を1回だけ読んで、行・打者・投手をまとめて返す。
// 「通算」を選んだときにしか呼ばれないので、普段の表示は現行シーズンだけで軽いまま。
// 試合データが無く成績表だけ残っている年度（2022など）を、通算用のデータに変換する。
// 列は見出し名で探すので、多少レイアウトが違っても拾える。
function statsOnlySeasonData(book, sheetName) {
  const bat = {}, pit = {};
  const sh = book.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return { bat: bat, pit: pit };
  const v = sh.getDataRange().getValues();
  const hdr = (v[0] || []).map(function (x) { return stripSpace(x); });
  function col(label) {
    for (let i = 0; i < hdr.length; i++) if (hdr[i] === label) return i;
    return -1;
  }
  const c = {
    pa: col("打席"), ab: col("打数"), h: col("安打"), hr: col("本塁打"), tb: col("塁打"),
    rbi: col("打点"), bb: col("四球"), so: col("三振"), d2: col("二塁打"), d3: col("三塁打"),
    hbp: col("死球"), sf: col("犠飛"),
    ip: col("投球回"), ph: col("被安打"), pbb: col("与四球"), k: col("奪三振"),
    er: col("自責点"), runs: col("失点"), np: col("投球数"),
    w: col("勝"), l: col("敗"), hld: col("ホールド"), sv: col("セーブ")
  };
  function n(row, i) { return i >= 0 ? (+row[i] || 0) : 0; }
  for (let r = 1; r < v.length; r++) {
    const nm = normName(v[r][0]);
    if (!nm || nm === "平均" || nm === "合計") continue;
    const pa = n(v[r], c.pa), ab = n(v[r], c.ab);
    if (pa || ab) {
      bat[nm] = {
        pa: pa, ab: ab, h: n(v[r], c.h), d2: n(v[r], c.d2), d3: n(v[r], c.d3),
        hr: n(v[r], c.hr), tb: n(v[r], c.tb), bb: n(v[r], c.bb), hbp: n(v[r], c.hbp),
        sf: n(v[r], c.sf), so: n(v[r], c.so), rbi: n(v[r], c.rbi), rab: 0, rh: 0
      };
    }
    const ip = c.ip >= 0 ? (+v[r][c.ip] || 0) : 0;
    const outs = Math.round(ip * 3); // 投球回は小数（20.333=20回1/3）なので3倍してアウト数に
    const w = n(v[r], c.w), l = n(v[r], c.l), hld = n(v[r], c.hld), sv = n(v[r], c.sv);
    if (outs || w || l || hld || sv) {
      pit[nm] = {
        outs: outs, np: n(v[r], c.np), ab: 0, h: n(v[r], c.ph), k: n(v[r], c.k),
        bb: n(v[r], c.pbb), hbp: 0, runs: n(v[r], c.runs), er: n(v[r], c.er),
        w: w, l: l, hld: hld, sv: sv
      };
    }
  }
  return { bat: bat, pit: pit };
}

var _careerCache = null;
function careerData() {
  if (_careerCache) return _careerCache;
  const rows = [];
  const bat = {}, pit = {};
  const pitFields = ["outs","np","ab","h","k","bb","hbp","runs","er","w","l","hld","sv"];
  function mergeBat(m) {
    Object.keys(m).forEach(function (nm) {
      const a = bat[nm] || (bat[nm] = { pa:0,ab:0,h:0,d2:0,d3:0,hr:0,tb:0,bb:0,hbp:0,sf:0,so:0,rbi:0,rab:0,rh:0 });
      const x = m[nm];
      Object.keys(x).forEach(function (f) { a[f] = (a[f] || 0) + (x[f] || 0); });
    });
  }
  function mergePit(m) {
    Object.keys(m).forEach(function (nm) {
      const a = pit[nm] || (pit[nm] = { outs:0,np:0,ab:0,h:0,k:0,bb:0,hbp:0,runs:0,er:0,w:0,l:0,hld:0,sv:0 });
      pitFields.forEach(function (f) { a[f] += m[nm][f] || 0; });
    });
  }
  seasonList().forEach(function (s) {
    const book = bookById(s.id);
    // 成績のみの年度（試合データ無し）は成績表から読み込む
    if (s.statsSheet) {
      const d = statsOnlySeasonData(book, s.statsSheet);
      mergeBat(d.bat); mergePit(d.pit);
      return;
    }
    const r = rowsOf(ALL_GAMES, book); // 各シーズン1回だけ読む
    if (!r.length) return;
    rows.push.apply(rows, r);
    mergeBat(batAllFrom(r));
    mergePit(pitAllFrom(r, ALL_GAMES, book));
  });
  _careerCache = { rows: rows, bat: bat, pit: pit };
  return _careerCache;
}
function careerBatData() { return careerData().bat; }
function careerPitData() { return careerData().pit; }

// ---------------- 選手個人ページ ----------------

// 選手名を個人ページへのリンクにする（rawモードでは url が除去され相対リンクになる）
function plink(url, name) {
  if (!name) return "";
  // リンク先は正式名、表示はフルネーム（登録があれば）
  return '<a target="_top" href="' + url + '?view=player&name=' +
    encodeURIComponent(name) + seasonQ() + '">' + esc(displayName(name)) + '</a>';
}

// 全試合経過の行を試合ごとに分割（イニングが戻る＝次の試合、日付が変わる＝次の試合）
function splitGames(rows) {
  const games = [];
  let cur = null, prev = null;
  rows.forEach(function (r) {
    if (!prev || r.date !== prev.date || r.inning < prev.inning) { cur = []; games.push(cur); }
    cur.push(r); prev = r;
  });
  return games;
}

// 経過シート名に対応する成績シート（〜成績。A1に集計元の経過シート名が入っている）を返す
function seisekiSheetFor(keikaName) {
  const book = ss();
  const sheets = book.getSheets();
  // 現行: 成績シートのA1に集計元の経過シート名が入っている
  for (let i = 0; i < sheets.length; i++) {
    if (!/成績$/.test(sheets[i].getName())) continue;
    if (String(sheets[i].getRange("A1").getValue()) === keikaName) return sheets[i];
  }
  // 過去シーズン: A1が一致しない。全期間なら「全指標」または「シーズン通算成績」を使う
  if (keikaName === ALL_GAMES) {
    return book.getSheetByName("全指標") || book.getSheetByName("シーズン通算成績") || null;
  }
  return null;
}

// 成績シートの数値を見やすく整える（整数はそのまま、小数は3桁に丸める）
function fmtStat(v) {
  if (v === "" || v === null || v === undefined) return "-";
  if (typeof v === "number") {
    if (!isFinite(v)) return "∞";
    if (Math.round(v) === v) return String(v);
    return String(Math.round(v * 1000) / 1000);
  }
  return String(v);
}

// 成績シートの1行から、列 from〜to を「項目 / 値」表にする（見出しが空の列は飛ばす）
function seisekiTable(headers, row, from, to) {
  let t = '<div class="tbl"><table class="st"><tr><th class="name">項目</th><th>値</th></tr>';
  let any = false;
  for (let c = from; c <= to; c++) {
    const label = String(headers[c] || "").trim();
    if (!label) continue;
    any = true;
    t += '<tr><td class="name">' + esc(label) + '</td><td><b>' + esc(fmtStat(row[c])) + '</b></td></tr>';
  }
  return any ? (t + '</table></div>') : '';
}

// 対戦成績（相性）の表。map = { 相手名: {ab,h,hr} }。対戦打数の多い順
function matchupTable(url, map, oppHeader, hrHeader, avgHeader) {
  const arr = Object.keys(map).map(function (k) {
    const o = map[k];
    return { opp: k, ab: o.ab, h: o.h, hr: o.hr };
  }).filter(function (x) { return x.ab > 0 || x.h > 0 || x.hr > 0; });
  if (!arr.length) return '';
  // 打率（安打/打数）の高い順。打数0（四球のみ等）は末尾へ。同率は対戦打数の多い順
  arr.sort(function (a, b) {
    const aa = a.ab ? a.h / a.ab : -1, bb = b.ab ? b.h / b.ab : -1;
    return bb - aa || b.ab - a.ab;
  });
  let t = '<div class="tbl"><table class="st"><tr><th class="name">' + esc(oppHeader) + '</th>' +
    '<th>打数</th><th>安打</th><th>' + esc(hrHeader) + '</th><th>' + esc(avgHeader) + '</th></tr>';
  arr.forEach(function (x) {
    t += '<tr><td class="name">' + plink(url, x.opp) + '</td><td>' + x.ab + '</td><td>' + x.h +
      '</td><td>' + x.hr + '</td><td><b>' + avgStr(x.h, x.ab) + '</b></td></tr>';
  });
  return t + '</table></div>';
}

// 全試合経過の日付セル（Dateオブジェクト等）を "YYYY-MM-DD" に整える
function ymd(dval) {
  if (!dval && dval !== 0) return "";
  const d = (dval instanceof Date) ? dval : new Date(dval);
  if (isNaN(d.getTime())) return String(dval);
  return Utilities.formatDate(d, "Asia/Tokyo", "yyyy-MM-dd");
}

// 日付 → その日の試合シート名（D, D-2, … の順）
function gamesByDate() {
  const map = {};
  gameSheetNames().forEach(function (n) {
    const m = n.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/);
    if (!m) return;
    (map[m[1]] = map[m[1]] || []).push({ n: n, k: m[2] ? parseInt(m[2], 10) : 1 });
  });
  Object.keys(map).forEach(function (d) { map[d].sort(function (a, b) { return a.k - b.k; }); });
  return map;
}

// 指標 def における name の順位（rate種目は規定到達者のみ）。{rank, total}
function statRankOf(dataMap, def, isBat, name) {
  const arr = [];
  Object.keys(dataMap).forEach(function (nm) {
    const d = dataMap[nm];
    if (def.rate) {
      if (isBat && d.pa < BAT_MIN_PA) return;
      if (!isBat && d.outs < PIT_MIN_OUTS) return;
    }
    const v = def.val(d);
    if (v === null || v === undefined || (typeof v === "number" && isNaN(v) && v !== Infinity)) return;
    arr.push({ nm: nm, v: v });
  });
  arr.sort(function (a, b) { return def.asc ? a.v - b.v : b.v - a.v; });
  let rank = 0, shown = 0, prev = null, mine = null;
  for (let i = 0; i < arr.length; i++) {
    shown++;
    if (prev === null || arr[i].v !== prev) rank = shown;
    prev = arr[i].v;
    if (arr[i].nm === name) mine = rank;
  }
  return { rank: mine, total: arr.length };
}

function findDef(defs, id) { return defs.filter(function (d) { return d.id === id; })[0]; }

// 1選手の指標一覧を「項目 / 値 / 順位」の表にする
function metricTable(dataMap, displayDefs, isBat, name) {
  const d = dataMap[name];
  let t = '<div class="tbl"><table class="st"><tr><th class="name">項目</th><th>値</th><th>順位</th></tr>';
  displayDefs.forEach(function (def) {
    if (!def) return;
    const v = def.val(d);
    if (v === null || v === undefined || (typeof v === "number" && isNaN(v) && v !== Infinity)) {
      t += '<tr><td class="name">' + esc(def.label) + '</td><td>-</td><td>-</td></tr>';
      return;
    }
    const disp = def.fmt ? def.fmt(v) : String(v);
    let rkStr = "-";
    if (!def.noRank) {
      const rk = statRankOf(dataMap, def, isBat, name);
      rkStr = rk.rank ? (rk.rank + '位 / ' + rk.total + '人') : (def.rate ? '規定未満' : '-');
    }
    t += '<tr><td class="name">' + esc(def.label) + '</td><td><b>' + esc(disp) +
      '</b></td><td class="sub" style="text-align:center">' + rkStr + '</td></tr>';
  });
  return t + '</table></div>';
}

// 通算ページで出す基本指標（ランキング定義を再利用）
function careerBatDefs() {
  return [
    findDef(BAT_RANK, "pa"),
    { label: "打数", val: function (x) { return x.ab; }, noRank: true },
    findDef(BAT_RANK, "hits"),
    findDef(BAT_RANK, "d2"),
    findDef(BAT_RANK, "d3"),
    findDef(BAT_RANK, "hr"),
    findDef(BAT_RANK, "rbi"),
    findDef(BAT_RANK, "bb"),
    { label: "死球", val: function (x) { return x.hbp; }, noRank: true },
    findDef(BAT_RANK, "so"),
    findDef(BAT_RANK, "tb"),
    findDef(BAT_RANK, "avg"),
    findDef(BAT_RANK, "obp"),
    findDef(BAT_RANK, "slg"),
    findDef(BAT_RANK, "ops"),
    findDef(BAT_RANK, "risp"),
    findDef(BAT_RANK, "wrcplus")
  ];
}
function careerPitDefs() {
  return [
    findDef(PIT_RANK, "ip"),
    findDef(PIT_RANK, "w"),
    findDef(PIT_RANK, "l"),
    findDef(PIT_RANK, "hld"),
    findDef(PIT_RANK, "sv"),
    findDef(PIT_RANK, "k"),
    { label: "与四球", val: function (x) { return x.bb; }, noRank: true },
    { label: "与死球", val: function (x) { return x.hbp; }, noRank: true },
    { label: "被安打", val: function (x) { return x.h; }, noRank: true },
    findDef(PIT_RANK, "r"),
    findDef(PIT_RANK, "er"),
    { label: "球数", val: function (x) { return x.np; }, noRank: true },
    findDef(PIT_RANK, "era"),
    findDef(PIT_RANK, "whip"),
    findDef(PIT_RANK, "k9"),
    findDef(PIT_RANK, "bb9"),
    findDef(PIT_RANK, "kbb"),
    findDef(PIT_RANK, "oavg"),
    findDef(PIT_RANK, "ra")
  ];
}

function renderPlayer(nameRaw, period) {
  const url = ScriptApp.getService().getUrl();
  // 古い表記のリンク（冨高など）で来ても正式名のページを開けるように正規化する
  const name = normName(nameRaw);
  // 期間（統一セレクタ: 今シーズン通算/今シーズンn月/全シーズン通算/過去シーズン）
  const rp = resolvePeriodValue(period);
  const isCareer = rp.sheet === CAREER_PERIOD;
  const isStatsOnly = !!rp.statsOnly;
  // 通算は全シーズンを1回だけ読んで合算。成績のみの年度は試合データが無いので空
  const allRows = isCareer ? careerData().rows : (isStatsOnly ? [] : rowsOf(rp.sheet));
  const games = splitGames(allRows);

  const disp = displayName(name); // タイトルはフルネーム（登録があれば）
  let body = '<div class="top"><a target="_top" href="' + url + '?view=stats' + seasonQ() + '">‹ 成績一覧へ</a></div>' +
    '<h1>' + esc(disp) + '</h1>' +
    '<form method="get" action="' + url + '" target="_top" class="selrow">' +
    '<input type="hidden" name="view" value="player">' +
    '<input type="hidden" name="name" value="' + esc(name) + '">' +
    periodSelectHtml(period) + '</form>';

  // 通算は成績シートが存在しないので、全シーズン合算した基本成績を計算して出す
  let found = false;
  if (isCareer) {
    const cd = careerData();
    const cb = cd.bat; attachWrcPlus(cb);
    const cp = cd.pit;
    if (cb[name]) {
      found = true;
      body += '<h2>打撃成績（通算・基本）</h2>' +
        metricTable(cb, careerBatDefs(), true, name);
    }
    const p = cp[name];
    if (p && (p.outs > 0 || p.w || p.l || p.hld || p.sv)) {
      found = true;
      body += '<h2>投手成績（通算・基本）</h2>' +
        metricTable(cp, careerPitDefs(), false, name);
    }
    if (!found) {
      body += '<p class="sub">通算データにこの選手の記録が見つかりませんでした。</p>';
    }
  }

  // 全指標: 期間に対応する成績シートの該当行を、列見出しつきでそのまま表示する
  const seiseki = isCareer ? null
    : (isStatsOnly ? statsOnlySheetOf(rp.seasonId) : seisekiSheetFor(rp.sheet));
  if (seiseki) {
    const sv = seiseki.getDataRange().getValues();
    const headers = sv[0];
    let prow = null;
    // 成績シート側もフルネーム等の表記ゆれがあるので正規化して突き合わせる
    for (let r = 1; r < sv.length; r++) {
      if (normName(sv[r][0]) === name) { prow = sv[r]; break; }
    }
    if (prow) {
      found = true;
      // 投手ブロックの名前列（col0以外で値が選手名と一致する最初の列）を打撃/投手の境界にする
      let j = -1;
      for (let c = 1; c < prow.length; c++) {
        if (normName(prow[c]) === name) { j = c; break; }
      }
      const batTo = (j > 1) ? j - 1 : prow.length - 1;
      // 名前が2度出ないシート（打撃と投手が1行に並ぶ形式）は分割せず一覧で出す
      body += '<h2>' + (j >= 0 ? '打撃成績（全指標）' : '成績（全指標）') + '</h2>' +
        seisekiTable(headers, prow, 1, batTo);
      if (j >= 0 && j + 1 < prow.length) {
        body += '<h2>投手成績（全指標）</h2>' + seisekiTable(headers, prow, j + 1, prow.length - 1);
      }
    }
  }
  if (!found && !isCareer) {
    body += '<p class="sub">この期間の成績にこの選手の行が見つかりませんでした' +
      (isStatsOnly ? '（この年度は未在籍の可能性）。' : '（集計対象外の助っ人などの可能性）。下に出場した試合のみ表示します。') +
      '</p>';
  }

  // 対戦成績（相性）: 全試合経過は1打席ごとに打者・投手が入っているので head-to-head を集計できる
  const batVs = {}, pitVs = {};
  allRows.forEach(function (r) {
    if (r.batter === name && r.pitcher) {
      const o = batVs[r.pitcher] || (batVs[r.pitcher] = { ab: 0, h: 0, hr: 0 });
      if (isAtBatResult(r.result)) o.ab++;
      if (isHitResult(r.result)) o.h++;
      if (r.result === "4塁打") o.hr++;
    }
    if (r.pitcher === name && r.batter) {
      const o = pitVs[r.batter] || (pitVs[r.batter] = { ab: 0, h: 0, hr: 0 });
      if (isAtBatResult(r.result)) o.ab++;
      if (isHitResult(r.result)) o.h++;
      if (r.result === "4塁打") o.hr++;
    }
  });
  if (Object.keys(batVs).length) {
    body += '<h2>対戦成績　VS投手</h2>' +
      matchupTable(url, batVs, "投手", "本", "対戦打率");
  }
  if (Object.keys(pitVs).length) {
    body += '<h2>対戦成績　VS打者</h2>' +
      matchupTable(url, pitVs, "打者", "被本", "被打率");
  }

  // 試合ごとの成績（打撃・投球の1試合ぶん。試合ページへリンク）
  // 通算は試合シートが別スプレッドシートに散らばるため、試合ページへのリンクは付けない
  const gmap = isCareer ? {} : gamesByDate();
  const dateSeen = {};
  let log = '';
  games.forEach(function (g) {
    if (!g.length) return;
    // 全試合経過の日付セルはDateオブジェクト。試合シート名(YYYY-MM-DD)と照合するため変換する
    const date = ymd(g[0].date);
    const idx = (dateSeen[date] = (dateSeen[date] || 0));
    dateSeen[date] = idx + 1;
    const sheetName = (gmap[date] && gmap[date][idx]) ? gmap[date][idx].n : null;

    let ab = 0, h = 0, hr = 0, rbi = 0, batted = false;
    let outs = 0, ph = 0, pk = 0, pbb = 0, pruns = 0, pitched = false;
    g.forEach(function (r) {
      if (r.batter === name) {
        batted = true;
        if (isAtBatResult(r.result)) ab++;
        if (isHitResult(r.result)) h++;
        if (r.result === "4塁打") hr++;
        rbi += r.rbi;
      }
      if (r.pitcher === name) {
        pitched = true;
        outs += outsAddedOf(r);
        if (isHitResult(r.result)) ph++;
        if (r.result === "空三振" || r.result === "見三振") pk++;
        if (r.result === "四球") pbb++;
        pruns += r.runs;
      }
    });
    if (!batted && !pitched) return;

    let line = '';
    if (batted) line += '打 ' + ab + '-' + h + (hr ? ' 本' + hr : '') + (rbi ? ' 点' + rbi : '');
    if (pitched) line += (line ? '　' : '') + '投 ' + ipStr(outs) + '回 被' + ph + ' 奪' + pk + ' 四' + pbb + ' 失' + pruns;
    const label = esc(date) + '　' + esc(g[0].stadium || '');
    if (sheetName) {
      log += '<a class="card" target="_top" href="' + url + '?view=game&sheet=' + encodeURIComponent(sheetName) + seasonQ() + '">' +
        '<div class="d">' + label + '</div><div style="margin-top:2px">' + esc(line) + '</div></a>';
    } else {
      log += '<div class="card"><div class="d">' + label + '</div><div style="margin-top:2px">' + esc(line) + '</div></div>';
    }
  });
  if (log) body += '<h2>試合ごとの成績</h2>' + log;

  return page(disp + " の成績", body, false);
}

function renderStats(type, statId, period) {
  const url = ScriptApp.getService().getUrl();
  const isBat = type !== "pit";
  const defs = isBat ? BAT_RANK : PIT_RANK;
  const def = defs.filter(d => d.id === statId)[0] || defs[0];

  // 期間（統一セレクタ: 今シーズン通算/今シーズンn月/全シーズン通算/過去シーズン）
  const rp = resolvePeriodValue(period);
  // 通算＝全シーズン合算、成績のみの年度＝成績表から、それ以外＝そのシーズンの経過シートから
  const isCareer = rp.sheet === CAREER_PERIOD;
  let data;
  if (isCareer) {
    data = isBat ? careerBatData() : careerPitData();
  } else if (rp.statsOnly) {
    const d = statsOnlyDataOf(rp.seasonId);
    data = isBat ? d.bat : d.pit;
  } else {
    data = isBat ? batAllFrom(rowsOf(rp.sheet)) : pitAllFrom(rowsOf(rp.sheet), rp.sheet);
  }
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
  let body = '<div class="top"><a target="_top" href="' + url + '?' + seasonParam() + '">‹ 試合一覧</a></div>' +
    '<h1>個人成績ランキング</h1>' +
    '<form method="get" action="' + url + '" target="_top" class="selrow">' +
    '<input type="hidden" name="view" value="stats">' +
    sel("type", [{ value: "bat", label: "打者成績" }, { value: "pit", label: "投手成績" }], isBat ? "bat" : "pit") +
    periodSelectHtml(period) +
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
    t += '<tr><td>' + rank + '</td><td class="name">' + plink(url, e.name) + '</td>' +
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
  // 試合一覧に出すのは試合データを持つシーズンのみ（成績のみの年度は通算専用）
  const seasons = playableSeasons();
  let body = '<h1>⚾ ピンポン野球 速報</h1>';
  // シーズン切り替え（2つ以上あるときだけ）。現行=通常、過去=アーカイブ表示
  if (seasons.length >= 2) {
    const selStyle = 'background:#17181d;color:#e9e9ec;border:1px solid #33343c;border-radius:8px;padding:8px;width:100%';
    body += '<form method="get" action="' + url + '" target="_top" style="margin:0 0 10px">' +
      '<select name="season" onchange="this.form.submit()" style="' + selStyle + '">' +
      seasons.map(function (s) {
        const cur = s.current;
        const sel = (cur && !_seasonId) || (!cur && _seasonId === s.id);
        return '<option value="' + (cur ? '' : esc(s.id)) + '"' + (sel ? ' selected' : '') + '>' +
          esc(s.label) + (cur ? '（今シーズン）' : '') + '</option>';
      }).join('') + '</select></form>';
    if (_seasonId) {
      body += '<p class="sub">📁 アーカイブ表示中: <b>' + esc((seasons.filter(function (s) { return s.id === _seasonId; })[0] || {}).label || '') + '</b></p>';
    }
  }
  body += '<a class="card" target="_top" href="' + url + '?view=stats' + seasonQ() + '">' +
    '<div class="d">📊 個人成績ランキング</div>' +
    '<div style="font-size:.85em;color:#9fa3ad;margin-top:2px">打率・本塁打・防御率など</div></a>' +
    '<a class="card" target="_top" href="' + url + '?view=music' + seasonQ() + '">' +
    '<div class="d">🎵 登場曲紹介</div>' +
    '<div style="font-size:.85em;color:#9fa3ad;margin-top:2px">メンバーの打席曲・投手曲一覧</div></a>';

  // アプリ配布リンク（APK_URL 設定時のみ表示）。Driveのプレビューページ経由が最も確実
  const apkId = fileId(APK_URL);
  if (apkId) {
    body += '<a class="card" target="_top" href="https://drive.google.com/file/d/' + apkId + '/view">' +
      '<div class="d">📲 記録アプリをダウンロード（Android）</div>' +
      '<div style="font-size:.85em;color:#9fa3ad;margin-top:2px">開いた画面の⬇ダウンロードでAPKを保存 → インストール</div></a>';
  }

  // 試合中（LIVE）。アーカイブ（過去シーズン）表示中は出さない
  const liveRows = _seasonId ? [] : rowsOf(LIVE_SHEET);
  const meta = _seasonId ? null : liveMeta();
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
    body += '<a class="card" target="_top" href="' + url + '?view=game&sheet=' + encodeURIComponent(n) + seasonQ() + '">' +
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
    return page("試合", '<p>データがありません。</p><a class="card" target="_top" href="' + url + '?' + seasonParam() + '">← 一覧へ</a>', isLive);
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
  let body = '<div class="top"><a target="_top" href="' + url + '?' + seasonParam() + '">‹ 試合一覧</a></div>' +
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
        '<td class="no">' + (ordF[i] ? (i + 1) : '') + '</td><td class="nm">' + (ordF[i] ? plink(url, ordF[i]) : '') + '</td>' +
        '<td class="no">' + (ordS[i] ? (i + 1) : '') + '</td><td class="nm">' + (ordS[i] ? plink(url, ordS[i]) : '') + '</td>' +
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
      plink(url, pb.win) + '<span class="sub">' + recStr(srec, pb.win) + '</span></td></tr>';
    if (pb.loss) body += '<tr><td><span class="chip lose">敗</span></td><td class="name">' +
      plink(url, pb.loss) + '<span class="sub">' + recStr(srec, pb.loss) + '</span></td></tr>';
    pb.holds.forEach(h => body += '<tr><td><span class="chip hold">H</span></td><td class="name">' +
      plink(url, h) + '<span class="sub">' + recStr(srec, h) + '</span></td></tr>');
    pb.saves.forEach(s => body += '<tr><td><span class="chip save">S</span></td><td class="name">' +
      plink(url, s) + '<span class="sub">' + recStr(srec, s) + '</span></td></tr>');
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
      body += '<tr><td class="name">' + plink(url, hr.batter) + '</td><td>' + no + '号（' +
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
      t += '<tr><td class="name">' + plink(url, n) + '</td><td>' + avgStr(sa.h, sa.ab) + '</td>' +
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
      t += '<tr><td style="width:3.2em">' + mark + '</td><td class="name">' + plink(url, n) + '</td>' +
        '<td>' + ipStr(p.outs) + '</td><td>' + p.np + '</td><td>' + p.h + '</td>' +
        '<td>' + p.k + '</td><td>' + p.bb + '</td><td>' + p.hbp + '</td>' +
        '<td>' + (rec ? rec.runs : p.runs) + '</td><td>' + (rec ? rec.er : '-') + '</td></tr>';
    });
    return t + '</table></div>';
  }
  body += pitTable(tn.f, true);
  body += pitTable(tn.s, false);

  // YouTube用タイムスタンプ（ブラウザ版スコアブックで記録した試合のみ。保存済みのときだけボタンを出す）
  if (!isLive && getTsText(name)) {
    body += '<a class="card" target="_top" href="' + url + '?view=ts&sheet=' + encodeURIComponent(name) + seasonQ() + '">' +
      '<div class="d">📋 YouTube用タイムスタンプ</div>' +
      '<div style="font-size:.85em;color:#9fa3ad;margin-top:2px">概要欄に貼る時刻つきの一覧を開く</div></a>';
  }

  return page(date + ' の試合', body, isLive);
}

// YouTube概要欄用タイムスタンプの閲覧ページ（どの端末からでも見られる・コピーできる）
// タイムスタンプ本文の各行頭の時刻（M:SS / H:MM:SS）を deltaSec ぶんずらす（下限0）
function shiftTsText(text, deltaSec) {
  if (!deltaSec) return text;
  function fmt(s) {
    s = Math.max(0, s);
    var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
    function p(n) { return (n < 10 ? "0" : "") + n; }
    return h > 0 ? h + ":" + p(m) + ":" + p(ss) : m + ":" + p(ss);
  }
  return text.split("\n").map(function (line) {
    // 行頭が "H:MM:SS " または "M:SS " で始まる行だけ時刻を補正
    var m = line.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?(\s)/);
    if (!m) return line;
    var sec = (m[3] != null)
      ? (parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + parseInt(m[3], 10))
      : (parseInt(m[1], 10) * 60 + parseInt(m[2], 10));
    return fmt(sec + deltaSec) + m[4] + line.slice(m[0].length);
  }).join("\n");
}

// サイト上でのズレ補正を保存してから表示
function renderTsShift(name, deltaSec) {
  var text = getTsText(name);
  if (text && deltaSec) { saveTsText(name, shiftTsText(text, deltaSec)); }
  return renderTs(name);
}

function renderTs(name) {
  const url = ScriptApp.getService().getUrl();
  const back = '<div class="top"><a target="_top" href="' + url + '?view=game&sheet=' +
    encodeURIComponent(name) + '">‹ 試合へ戻る</a></div>';
  const text = getTsText(name);
  let body = back + '<h1>📋 YouTube用タイムスタンプ</h1>';
  if (!text) {
    body += '<p class="sub">この試合はタイムスタンプが保存されていません。' +
      'ブラウザ版スコアブックで記録・保存した試合のみ表示されます。</p>';
    return page("タイムスタンプ", body, false);
  }
  // ズレ補正フォーム（全時刻を＋遅らせる / −早める。GETフォームなのでラッパー経由でも動く）
  body += '<div class="card"><div class="d">⏱ ズレ補正（動画と時刻を合わせる）</div>' +
    '<div class="sub" style="margin:4px 0 8px">動画内で試合開始が 0:00 より後なら「＋遅らせる」、前なら「−早める」。全時刻をまとめてずらします。</div>' +
    '<form method="get" action="' + url + '" target="_top" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">' +
    '<input type="hidden" name="view" value="ts">' + seasonHidden() +
    '<input type="hidden" name="sheet" value="' + esc(name) + '">' +
    '<input name="mm" type="number" value="0" min="0" style="width:4.5em" aria-label="分"> 分' +
    '<input name="ss" type="number" value="0" min="0" max="59" style="width:4.5em" aria-label="秒"> 秒' +
    '<button name="dir" value="plus" class="tsbtn">＋ 遅らせる</button>' +
    '<button name="dir" value="minus" class="tsbtn">− 早める</button>' +
    '</form>' +
    '<style>.tsbtn{border:none;border-radius:8px;padding:9px 12px;font-weight:700;color:#fff;' +
    'background:#3a3d46;cursor:pointer;font-size:.9em}</style></div>';
  body += '<p class="sub">下の枠をタップ→「すべて選択」でコピーし、YouTubeの概要欄に貼り付けてください。</p>' +
    '<button class="btn" id="tscopy" onclick="tsCopy()" ' +
    'style="width:100%;border:none;border-radius:10px;padding:12px;font-weight:700;color:#fff;background:#2f6fdd;cursor:pointer">全文コピー</button>' +
    '<textarea id="tstext" readonly onclick="this.select()" ' +
    'style="width:100%;height:60vh;margin-top:10px;background:#0d0d10;color:#e9e9ec;border:1px solid #33343c;' +
    'border-radius:10px;padding:12px;font-size:.86em;line-height:1.6">' + esc(text) + '</textarea>' +
    '<script>function tsCopy(){var t=document.getElementById("tstext");' +
    'var d=function(){var b=document.getElementById("tscopy");b.textContent="コピーしました";' +
    'setTimeout(function(){b.textContent="全文コピー"},1800)};' +
    'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t.value).then(d,' +
    'function(){t.select();document.execCommand("copy");d()})}else{t.select();document.execCommand("copy");d()}}' +
    // 補正適用後の再読み込みで二重補正にならないよう、URLから mm/ss/dir を消す
    'try{history.replaceState(null,"","?view=ts&sheet=' + encodeURIComponent(name) + seasonQ() + '")}catch(e){}<\/script>';
  return page("タイムスタンプ", body, false);
}
