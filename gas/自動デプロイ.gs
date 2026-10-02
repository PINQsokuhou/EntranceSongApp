/**
 * GitHubのmainブランチを監視して、サイト本体のGASプロジェクトを自動で差し替える係。
 *
 * これまでは gas/コード.gs を直したあと、人がGASエディタに貼って保存して
 * デプロイし直す必要があった。この係を10分おきに動かしておけば、
 * GitHubにpush（またはPRをマージ）するだけで本番に反映される。
 * 外出先からスマホで指示して直す、という使い方ができるようになる。
 *
 * ■ これは本体とは「別のプロジェクト」に入れること
 *   本体と同じプロジェクトに入れると、構文エラーのあるコードを反映した瞬間に
 *   この係自身も動かなくなり、元に戻す手段がなくなる。
 *
 * ■ 準備（初回だけ。順番どおりに）
 *
 *   1. Apps Script API を有効にする
 *      https://script.google.com/home/usersettings を開き
 *      「Google Apps Script API」をオンにする（アカウントごとの設定。1回だけ）
 *
 *   2. 新しいスタンドアロンのプロジェクトを作る
 *      https://script.google.com/home → 「新しいプロジェクト」
 *      名前は「自動デプロイ係」など。このファイルの中身をそこに貼る
 *
 *   3. その新プロジェクトの appsscript.json に権限を書く
 *      左の歯車（プロジェクトの設定）→「appsscript.json マニフェスト ファイルを
 *      エディタで表示する」にチェック → appsscript.json を開いて
 *      oauthScopes に次の2つを入れる:
 *        "https://www.googleapis.com/auth/script.projects"
 *        "https://www.googleapis.com/auth/script.external_request"
 *      （送信通知もほしい場合は "https://www.googleapis.com/auth/script.send_mail" も）
 *
 *   4. 本体のIDを2つ調べて、下の setUp() に書いて1回実行する
 *      ・スクリプトID … 本体のGASエディタ →「プロジェクトの設定」→ スクリプトID
 *      ・デプロイID  … 本体のGASエディタ →「デプロイを管理」→ 現在のデプロイの
 *                      「デプロイID」。サイトURL
 *                      https://script.google.com/macros/s/AKfycb.../exec
 *                      の AKfycb... の部分と同じ
 *
 *   5. dryRun() を実行して、本体のファイル一覧が読めることを確認する
 *      （ここが通れば残りも通る。通らなければ 1 か 3 の設定漏れ）
 *
 *   6. installTrigger() を実行する。以降10分おきに自動で反映される
 *
 * ■ 安全のためにやっていること
 *   ・反映前に構文チェックする（壊れたコードは反映せずメールで知らせる）
 *   ・対象のファイル名が本体に無ければ何もしない（名前のずれで新規作成しない）
 *   ・内容が変わっていないときは何もしない（無駄なバージョンを作らない）
 *   ・appsscript.json と、ここに挙げていないファイルはそのまま残す
 */

// 監視するGitHubリポジトリとブランチ
var REPO = "PINQsokuhou/EntranceSongApp";
var BRANCH = "main";

// 同期するファイル。左がGitHub上のパス、右が本体プロジェクトでのファイル名
// （GASのファイル名に拡張子 .gs は含まれない）
var SYNC = [
  { path: "gas/コード.gs",     name: "コード" },
  { path: "gas/record.js.gs",  name: "record.js" }
];

// 反映したときに知らせるメールアドレス。空のままにすると自分のアドレスを使う。
// 送らなくていい場合は notify_ の中の送信をコメントアウトする
var NOTIFY = "";

var P = PropertiesService.getScriptProperties();


/** 準備4: 本体のIDを登録する。値を書き換えてから1回実行する */
function setUp() {
  var SCRIPT_ID = "";      // ← 本体のスクリプトID
  var DEPLOYMENT_ID = "";  // ← 本体のデプロイID（AKfycb... で始まる）

  if (!SCRIPT_ID || !DEPLOYMENT_ID) {
    throw new Error("SCRIPT_ID と DEPLOYMENT_ID を書いてから実行してください");
  }
  if (SCRIPT_ID === ScriptApp.getScriptId()) {
    throw new Error("この係自身のIDが指定されています。本体のスクリプトIDを入れてください");
  }
  P.setProperty("targetScriptId", SCRIPT_ID);
  P.setProperty("targetDeploymentId", DEPLOYMENT_ID);
  Logger.log("登録しました。次に dryRun() を実行してください");
}

/** 準備5: 読み取りだけ試す。本体のファイル一覧が出れば設定は正しい */
function dryRun() {
  var id = targetId_();
  var cur = getContent_(id);
  Logger.log("本体のファイル: " + cur.files.map(function (f) {
    return f.name + "(" + f.type + ", " + f.source.length + "文字)";
  }).join(", "));

  SYNC.forEach(function (s) {
    var found = cur.files.some(function (f) { return f.name === s.name; });
    Logger.log((found ? "OK   " : "見つからない ") + s.name + " ← " + s.path);
  });

  SYNC.forEach(function (s) {
    var src = fetchFromGitHub_(s.path);
    Logger.log(s.path + " をGitHubから取得: " + src.length + "文字");
  });
  Logger.log("ここまで通れば autoDeploy() も動きます");
}

/**
 * 本体とGitHubで中身が違うとき、どこがどう違うのかを出す。
 * GASエディタで直接直してリポジトリに入れ忘れた変更が無いか、
 * 自動反映を仕掛ける前に確かめるためのもの
 */
function showDiff() {
  var cur = getContent_(targetId_());
  var byName = {};
  cur.files.forEach(function (f) { byName[f.name] = f; });

  SYNC.forEach(function (s) {
    var a = byName[s.name] ? byName[s.name].source : "";
    var b = fetchFromGitHub_(s.path);
    Logger.log("── " + s.name + " ──");
    if (a === b) { Logger.log("同じ内容です"); return; }

    // 先頭と末尾の一致している部分を外して、食い違う範囲だけ取り出す
    var p = 0;
    while (p < a.length && p < b.length && a.charAt(p) === b.charAt(p)) p++;
    var q = 0;
    while (q < a.length - p && q < b.length - p &&
           a.charAt(a.length - 1 - q) === b.charAt(b.length - 1 - q)) q++;

    Logger.log("本体 " + a.length + "文字 / GitHub " + b.length + "文字。" +
      p + "文字目（" + lineOf_(a, p) + "行目あたり）から食い違う");
    Logger.log("【直前の文脈】\n" + a.slice(Math.max(0, p - 200), p));
    Logger.log("【本体にあってGitHubに無い " + (a.length - q - p) + "文字】\n" + clip_(a.slice(p, a.length - q)));
    Logger.log("【GitHubにあって本体に無い " + (b.length - q - p) + "文字】\n" + clip_(b.slice(p, b.length - q)));
  });
}

function clip_(s) {
  var MAX = 2000;
  return s.length > MAX ? s.slice(0, MAX) + "\n…（残り " + (s.length - MAX) + "文字は省略）" : s;
}
function lineOf_(s, pos) {
  return s.slice(0, pos).split("\n").length;
}

/** 準備6: 10分おきの自動実行を仕掛ける */
function installTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "autoDeploy") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("autoDeploy").timeBased().everyMinutes(10).create();
  Logger.log("10分おきの自動反映を仕掛けました");
}

/** 自動実行を止める */
function removeTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "autoDeploy") ScriptApp.deleteTrigger(t);
  });
  Logger.log("自動反映を止めました");
}


/** 本体: GitHubの内容と本体プロジェクトを見比べて、違っていれば反映してデプロイする */
function autoDeploy() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;   // 前回の実行が長引いているときは見送る
  try {
    var id = targetId_();
    var cur = getContent_(id);
    var byName = {};
    cur.files.forEach(function (f) { byName[f.name] = f; });

    var changed = [];
    for (var i = 0; i < SYNC.length; i++) {
      var s = SYNC[i];
      var target = byName[s.name];
      if (!target) {
        // 名前がずれていると新規ファイルを作ってしまい、本体に二重定義ができる。
        // 作らずに知らせて止める
        notify_("自動反映を中止しました",
          "本体に「" + s.name + "」というファイルが見つかりません。\n" +
          "本体のファイル名: " + cur.files.map(function (f) { return f.name; }).join(", ") + "\n" +
          "自動デプロイ.gs の SYNC の名前を直してください。");
        return;
      }
      var src = fetchFromGitHub_(s.path);
      if (src === target.source) continue;   // 変わっていない

      var err = syntaxError_(src, s.name);
      if (err) {
        // 壊れたコードを入れるとサイト全体が落ちる。反映せずに知らせる
        notify_("自動反映を中止しました（構文エラー）",
          s.path + " に構文エラーがあるため反映しませんでした。\n\n" + err +
          "\n\n直してpushすれば次回の実行で反映されます。");
        return;
      }
      target.source = src;
      changed.push(s.name);
    }

    if (!changed.length) return;   // 何も変わっていない

    putContent_(id, cur.files);

    var sha = headSha_();
    var label = "GitHub " + BRANCH + (sha ? " " + sha.slice(0, 7) : "") + " を自動反映";
    var ver = createVersion_(id, label);
    updateDeployment_(id, targetDeployId_(), ver, label);

    P.setProperty("lastDeployedSha", sha || "");
    P.setProperty("lastDeployedAt", new Date().toISOString());

    notify_("サイトを更新しました（v" + ver + "）",
      "反映したファイル: " + changed.join(", ") + "\n" +
      "コミット: " + (sha || "不明") + "\n" +
      "バージョン: " + ver + "（デプロイIDは変えていないのでURLは同じです）\n\n" +
      "※ ページの見た目や中身の作り方を変えた修正の場合は、書き出し済みの\n" +
      "   静的ページが古いままです。本体で publishReset → publishSite を\n" +
      "   実行してください。試合の記録だけなら不要です。");
  } catch (e) {
    notify_("自動反映が失敗しました", String(e && e.stack || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}


// ---- 以下は補助 ----

function targetId_() {
  var id = P.getProperty("targetScriptId");
  if (!id) throw new Error("先に setUp() を実行してください");
  return id;
}
function targetDeployId_() {
  var id = P.getProperty("targetDeploymentId");
  if (!id) throw new Error("先に setUp() を実行してください");
  return id;
}

/**
 * 構文チェック。new Function は中身を実行せずに解析だけするので、
 * 貼り付けの途中切れや括弧の対応ずれを反映前に捕まえられる
 * （トップレベルの重複宣言までは見つけられない点は承知のうえ）
 */
function syntaxError_(src, name) {
  try {
    new Function(src);
    return null;
  } catch (e) {
    return name + ": " + (e && e.message || e);
  }
}

/** GitHubの生ファイルを取る。CDNに古い内容が残らないよう毎回違う値を付ける */
function fetchFromGitHub_(path) {
  var url = "https://raw.githubusercontent.com/" + REPO + "/" + BRANCH + "/" +
    path.split("/").map(encodeURIComponent).join("/") +
    "?t=" + Date.now();
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    throw new Error("GitHubから " + path + " を取得できません (" + res.getResponseCode() + ")");
  }
  return res.getContentText();
}

/** mainの最新コミットのSHA。通知に出すだけなので取れなくても続行する */
function headSha_() {
  try {
    var res = UrlFetchApp.fetch(
      "https://api.github.com/repos/" + REPO + "/commits/" + BRANCH,
      { muteHttpExceptions: true, headers: { Accept: "application/vnd.github+json" } });
    if (res.getResponseCode() !== 200) return "";
    return JSON.parse(res.getContentText()).sha || "";
  } catch (e) { return ""; }
}

function scriptApi_(method, path, body) {
  var res = UrlFetchApp.fetch("https://script.googleapis.com/v1/projects/" + path, {
    method: method,
    contentType: "application/json",
    headers: { Authorization: "Bearer " + ScriptApp.getOAuthToken() },
    payload: body ? JSON.stringify(body) : undefined,
    muteHttpExceptions: true
  });
  var code = res.getResponseCode(), text = res.getContentText();
  if (code < 200 || code >= 300) {
    // 権限不足はここに出る。Apps Script APIの有効化と oauthScopes を確認する
    throw new Error("Apps Script API " + method + " " + path + " が " + code + ": " + text);
  }
  return JSON.parse(text);
}

function getContent_(scriptId) {
  return scriptApi_("get", scriptId + "/content");
}
function putContent_(scriptId, files) {
  return scriptApi_("put", scriptId + "/content", { files: files });
}
function createVersion_(scriptId, description) {
  return scriptApi_("post", scriptId + "/versions", { description: description }).versionNumber;
}
/** デプロイIDを変えずに中身だけ差し替えるので、サイトのURLは変わらない */
function updateDeployment_(scriptId, deploymentId, versionNumber, description) {
  return scriptApi_("put", scriptId + "/deployments/" + deploymentId, {
    deploymentConfig: {
      scriptId: scriptId,
      versionNumber: versionNumber,
      manifestFileName: "appsscript",
      description: description
    }
  });
}

function notify_(subject, body) {
  Logger.log(subject + "\n" + body);
  // 宛先の取得やメール送信で失敗しても、反映そのものは成功しているので握りつぶす
  try {
    var to = NOTIFY || Session.getEffectiveUser().getEmail();
    if (to) MailApp.sendEmail(to, "[ピンポン野球] " + subject, body);
  } catch (e) {
    Logger.log("メール送信に失敗: " + e);
  }
}
