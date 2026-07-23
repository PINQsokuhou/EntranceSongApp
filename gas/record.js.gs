// ============================================================
// スコアブック記録ページ（ブラウザ版）  ?view=record
//  試合前セットアップ〜試合中の1球速報〜試合終了保存までをブラウザ完結で行う。
//  Android版 GameEngine / Scorebook / SheetMapper のロジックを JS に移植したもの。
//  この関数は完全な HTML 文字列を返す（page() を経由せず htmlOut() へ直接渡す）。
// ============================================================

function renderRecord() {
  var url = ScriptApp.getService().getUrl();

  var html = `<!DOCTYPE html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<base target="_top">
<title>スコアブック記録</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{margin:0;background:#0d0d10;color:#e9e9ec;
font-family:-apple-system,BlinkMacSystemFont,"Hiragino Kaku Gothic ProN","Noto Sans JP",sans-serif;
-webkit-font-smoothing:antialiased}
.wrap{max-width:560px;margin:0 auto;padding:10px 12px 60px}
.top{margin-bottom:6px}
.top a{color:#9fa3ad;font-size:.9em;text-decoration:none}
h1{font-size:1.12em;margin:8px 2px 12px;line-height:1.4}
h2{font-size:.92em;margin:20px 2px 8px;padding-left:9px;border-left:4px solid #f5a623;color:#fff}
a{color:inherit}
.card{background:#17181d;border:1px solid #26272e;border-radius:14px;padding:13px 16px;margin:10px 0}
.sub{color:#9fa3ad;font-size:.82em;margin:6px 2px}
.err{color:#e5484d;font-size:.85em;margin:6px 2px}
.foot{color:#63666e;font-size:.75em;text-align:center;margin-top:34px}
button{font-family:inherit}
input,select{font-family:inherit;background:#17181d;color:#e9e9ec;border:1px solid #33343c;
border-radius:10px;padding:10px 12px;font-size:.95em}
input::placeholder{color:#6a6d76}
.btn{display:inline-flex;align-items:center;justify-content:center;border:none;border-radius:10px;
padding:11px 14px;font-size:.92em;font-weight:700;cursor:pointer;color:#fff;background:#2f6fdd;
user-select:none}
.btn:disabled{opacity:.35;cursor:default}
.btn.gray{background:#3a3d46}
.btn.outline{background:transparent;border:1px solid #33343c;color:#cfd2da}
.btn.red{background:#e5484d}
.btn.green{background:#18b56a}
.btn.orange{background:#f5a623;color:#1a1a1a}
.btn.block{display:flex;width:100%}
.row{display:flex;gap:8px}
.row.wrap{flex-wrap:wrap}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px}
.grid4{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px}
.spacer8{height:8px}
.spacer12{height:12px}
.spacer16{height:16px}
/* タブ */
.tabs{display:flex;background:#17181d;border:1px solid #26272e;border-radius:12px;overflow:hidden;margin:10px 0}
.tabs .tab{flex:1;text-align:center;padding:11px 4px;font-weight:700;font-size:.92em;color:#9fa3ad;cursor:pointer}
.tabs .tab.on{background:#2f6fdd;color:#fff}
/* 打順リスト */
.orderlist{background:#17181d;border:1px solid #26272e;border-radius:14px;overflow:hidden;margin:10px 0}
.orderlist .oi{display:flex;align-items:center;gap:8px;padding:10px 12px;border-top:1px solid #24252b}
.orderlist .oi:first-child{border-top:none}
.orderlist .oi .no{width:2em;color:#9fa3ad;font-weight:700;font-size:.85em}
.orderlist .oi .nm{flex:1;font-weight:600}
.orderlist .oi .nm .furi{color:#9fa3ad;font-size:.75em;margin-left:6px;font-weight:400}
.orderlist .oi .cur{color:#f5a623;font-size:.72em;font-weight:700;margin-left:6px}
.orderlist .oi .del{background:#3a3d46;color:#e5484d;border:none;border-radius:8px;width:30px;height:30px;
font-size:1em;font-weight:700;cursor:pointer}
.orderlist .addrow{padding:10px 12px;text-align:center;color:#2f6fdd;font-weight:700;cursor:pointer;
border-top:1px solid #24252b}
/* 試合中ステータス */
.statusbar{background:#17181d;border:1px solid #26272e;border-radius:14px;padding:14px 16px;margin:10px 0}
.statusbar .inning{font-size:1.3em;font-weight:800;text-align:center;letter-spacing:.02em}
.statusbar .stadium{color:#9fa3ad;font-size:.78em;text-align:center;margin-top:2px}
.statusbar .gtime{color:#f5a623;font-size:.82em;font-weight:700;text-align:center;margin-top:4px}
.score{display:flex;justify-content:center;align-items:baseline;gap:14px;margin:10px 0 4px;font-size:1.5em;font-weight:800}
.score .vs{color:#63666e;font-size:.6em}
.score .fteam,.score .steam{min-width:2.2em;text-align:center}
.score .fteam.atk,.score .steam.atk{color:#f5a623}
.midrow{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:12px 0 4px}
.outs{display:flex;align-items:center;gap:6px}
.outs .lb{color:#9fa3ad;font-weight:700;font-size:.8em}
.pip{width:13px;height:13px;border-radius:50%;background:#3a3d46;display:inline-block}
.pip.b{background:#18b56a}.pip.s{background:#f5c518}.pip.o{background:#e5484d}
.dia{position:relative;width:46px;height:46px}
.dia i{position:absolute;width:17px;height:17px;background:#3a3d46;transform:rotate(45deg);border-radius:2px}
.dia i.on{background:#f5a623}
.dia .b1{right:0;top:14px}.dia .b2{left:14px;top:0}.dia .b3{left:0;top:14px}
.whorow{display:flex;gap:10px;margin:14px 0 2px}
.who{flex:1;background:#1e2026;border-radius:10px;padding:8px 10px}
.who .lab{color:#9fa3ad;font-size:.7em;font-weight:700}
.who .nm{font-size:1.02em;font-weight:700;margin-top:1px}
.countrow{display:flex;gap:14px;align-items:center;justify-content:center;margin:14px 0 2px}
.countrow .g{display:flex;align-items:center;gap:4px}
.countrow .lb{color:#9fa3ad;font-weight:700;font-size:.8em;margin-right:2px}
.pitchcount{text-align:center;color:#9fa3ad;font-size:.78em;margin-top:6px}
/* カウントボタン */
.countbtns{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:14px 0}
.countbtns .btn{height:56px;font-size:1.02em}
.btn.ball{background:#1565C0}
.btn.strike{background:#F9A825;color:#212121}
.btn.foul{background:#D7C9A0;color:#5D4037}
/* 結果ボタン */
.resultbtns{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin:6px 0}
.resultbtns2{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:6px 0}
.resultbtns .btn{height:54px;font-size:.98em}
/* アプリ(MainScreen.kt)と同じ配色: ヒット=緑 アウト=赤 その他=アウトライン スクイズ=橙 */
.btn.res-hit{background:#2E7D32}
.btn.res-out{background:#C62828}
.btn.res-outline{background:transparent;border:1px solid #4a4d57;color:#cfd2da}
.btn.res-squeeze{background:#E65100}
.subbtnrow{display:flex;gap:8px;margin:4px 0 14px}
/* モーダル */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;
justify-content:center;z-index:50}
.overlay.center{align-items:center;padding:16px}
.sheet{background:#17181d;border:1px solid #26272e;border-radius:16px 16px 0 0;width:100%;max-width:560px;
max-height:88vh;overflow-y:auto;padding:16px 16px 20px}
.overlay.center .sheet{border-radius:16px;max-height:82vh}
.sheet h3{margin:0 0 4px;font-size:1.05em}
.sheet .meta{color:#9fa3ad;font-size:.8em;margin-bottom:10px}
.sectionlabel{color:#cfd2da;font-size:.78em;font-weight:700;margin:14px 0 6px}
.sectionlabel:first-of-type{margin-top:4px}
.selbox{display:flex;align-items:center;justify-content:center;text-align:center;padding:10px 4px;
border-radius:9px;background:#23252d;color:#cfd2da;font-size:.88em;font-weight:600;cursor:pointer;
border:2px solid transparent}
.selbox.on{background:#2f6fdd;color:#fff}
.selbox.small{padding:8px 2px;font-size:.8em}
.batbox{display:flex;align-items:center;justify-content:center;padding:10px 2px;border-radius:9px;
font-weight:700;font-size:.82em;cursor:pointer;border:2px solid transparent}
.batbox.on{border-color:#f5a623}
.preview{background:#1e2026;border-radius:10px;padding:10px 12px;margin-top:12px;font-size:.9em}
.preview b{color:#f5a623}
.warn{color:#e5484d;font-size:.82em;margin-top:8px;font-weight:700}
.autostart{color:#f5a623;font-size:.8em;margin-top:8px}
.sheet .footbtns{display:flex;gap:8px;margin-top:16px}
.searchbox{width:100%;margin-bottom:10px}
.searchlist{max-height:44vh;overflow-y:auto;border-top:1px solid #24252b}
.searchlist .si{padding:11px 6px;border-bottom:1px solid #24252b;cursor:pointer}
.searchlist .si .nm{font-weight:600}
.searchlist .si .furi{color:#9fa3ad;font-size:.78em;margin-left:6px}
.searchlist .empty{color:#9fa3ad;text-align:center;padding:20px;font-size:.85em}
.pending-banner{position:fixed;left:0;right:0;bottom:0;background:#1b1c22;border-top:1px solid #33343c;
padding:10px 14px;text-align:center;font-size:.85em;color:#f5a623;z-index:40}
.loading{text-align:center;color:#9fa3ad;padding:40px 0}
.statline{display:flex;justify-content:space-between;padding:8px 2px;border-top:1px solid #24252b;font-size:.9em}
.statline:first-child{border-top:none}
.chip{display:inline-block;min-width:1.6em;text-align:center;border-radius:5px;padding:2px 6px;
font-size:.72em;font-weight:700;color:#fff;margin-left:4px}
.chip.win{background:#2f6fdd}.chip.lose{background:#c04343}.chip.hold{background:#3aa06b}.chip.save{background:#b8862f}
.toast{position:fixed;left:50%;bottom:70px;transform:translateX(-50%);background:#23252d;color:#e9e9ec;
padding:9px 16px;border-radius:20px;font-size:.85em;z-index:80;box-shadow:0 4px 16px rgba(0,0,0,.4)}
.toplinks{display:flex;gap:14px}
.badge-live{display:inline-block;background:#e5484d;color:#fff;border-radius:5px;padding:1px 8px;
font-size:.68em;margin-left:8px;vertical-align:2px}
</style></head><body>
<div class="wrap">
  <div class="top toplinks"><a href="${url}">← 一覧へ</a><a href="${url}?view=game&sheet=LIVE">速報を見る</a></div>
  <h1>⚾ スコアブック記録</h1>
  <div id="app"><div class="loading">読み込み中…</div></div>
</div>
<script>
(function(){
'use strict';
var GAS_URL = ${JSON.stringify(url)};

// ================= ユーティリティ =================
function esc(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
// JSON.stringify した上で、二重引用符属性(onclick="...")内に安全に埋め込めるようHTMLエスケープする
function jsStr(s){
  var j = JSON.stringify(String(s == null ? '' : s));
  return j.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function pad2(n){ return (n < 10 ? '0' : '') + n; }
function todayStr(){
  var d = new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
function uniq(arr){
  var seen = {}, out = [];
  arr.forEach(function(v){ if(!seen[v]){ seen[v]=true; out.push(v); } });
  return out;
}
function byId(id){ return document.getElementById(id); }

// ================= Scorebook（Kotlin Scorebook.kt の移植） =================
var RESULT_HIT = 'ヒット', RESULT_OUT = 'アウト', RESULT_ERROR = 'エラー', RESULT_NHNE = 'nHnE',
    RESULT_SAC = '犠牲', RESULT_SQUEEZE = 'スクイズ', RESULT_HBP = '死球', RESULT_INTERFERE = '妨害',
    RESULT_BB = '四球', RESULT_K_SWING = '空三振', RESULT_K_LOOK = '見三振';
var SITUATION_ALL = ['併殺', '三塁走者アウト'];

function isSqueezeSituation(bases, outs){
  return bases[2] && !(bases[0] && bases[1]) && outs < 2;
}
function hasBattedBall(result){
  return [RESULT_HIT, RESULT_OUT, RESULT_ERROR, RESULT_NHNE, RESULT_SAC, RESULT_SQUEEZE].indexOf(result) >= 0;
}
function immediateOuts(result){
  return [RESULT_OUT, RESULT_SAC, RESULT_SQUEEZE, RESULT_K_SWING, RESULT_K_LOOK].indexOf(result) >= 0 ? 1 : 0;
}
function isForced(bases, i){
  for (var j = 0; j < i; j++) if (!bases[j]) return false;
  return true;
}
function advanceHit(bases, n, autoStart){
  var next = [false, false, false], runs = 0;
  for (var i = 2; i >= 0; i--) {
    if (!bases[i]) continue;
    var extra = (autoStart && isForced(bases, i)) ? 1 : 0;
    var dest = i + n + extra;
    if (dest >= 3) runs++; else next[dest] = true;
  }
  return { bases: next, runs: runs };
}
function groundAdvance(bases, fumble){
  var next = bases.slice(), runs = 0;
  if (next[2] && fumble) { next[2] = false; runs++; }
  if (next[1] && !next[2]) { next[1] = false; next[2] = true; }
  if (next[0] && !next[1]) { next[0] = false; next[1] = true; }
  return { bases: next, runs: runs };
}
function tagUp(bases, tagThird, tagSecond){
  var next = bases.slice(), runs = 0;
  if (tagThird && next[2]) { next[2] = false; runs++; }
  if (tagSecond && next[1] && !next[2]) { next[1] = false; next[2] = true; }
  return { bases: next, runs: runs };
}
/** 走者進塁の自動計算。Kotlin版 Scorebook.compute と同じ挙動。 */
function compute(result, basesBefore, basesGained, situations, playResult, opts){
  opts = opts || {};
  var autoStart = !!opts.autoStart, tagThird = !!opts.tagThird, tagSecond = !!opts.tagSecond,
      fumble = !!opts.fumble, outsBefore = opts.outsBefore || 0;
  situations = situations || [];
  var bases = basesBefore.slice(), outsAdded = 0, runs = 0;

  if (result === RESULT_BB || result === RESULT_HBP || result === RESULT_INTERFERE) {
    if (bases[0]) {
      if (bases[1]) { if (bases[2]) runs++; else bases[2] = true; } else bases[1] = true;
    }
    bases[0] = true;
  } else if (result === RESULT_K_SWING || result === RESULT_K_LOOK) {
    outsAdded = 1;
  } else if (result === RESULT_OUT) {
    outsAdded = 1;
    if (situations.indexOf('併殺') >= 0) {
      outsAdded = 2;
      if (bases[0] && bases[2] && !bases[1]) {
        bases[0] = false; bases[2] = false;
        if (outsBefore + 2 < 3) runs++;
      } else {
        var lead = -1;
        for (var i = 2; i >= 0; i--) { if (bases[i]) { lead = i; break; } }
        if (lead >= 0) bases[lead] = false;
        var g = groundAdvance(bases, false);
        bases = g.bases; runs += g.runs;
      }
    } else if (situations.indexOf('三塁走者アウト') >= 0) {
      bases[2] = false;
      if (bases[1]) { bases[1] = false; bases[2] = true; }
      if (bases[0]) { bases[0] = false; bases[1] = true; }
      bases[0] = true;
    } else if (playResult === 'ゴロ') {
      var g2 = groundAdvance(bases, fumble);
      bases = g2.bases; runs += g2.runs;
    } else if (playResult === 'フライ') {
      var t2 = tagUp(bases, tagThird, tagSecond);
      bases = t2.bases; runs += t2.runs;
    }
  } else if (result === RESULT_SAC) {
    outsAdded = 1;
    if (playResult === 'フライ') {
      var t3 = tagUp(bases, tagThird, tagSecond);
      bases = t3.bases; runs += t3.runs;
    } else {
      var g3 = groundAdvance(bases, false);
      bases = g3.bases; runs += g3.runs;
    }
  } else if (result === RESULT_SQUEEZE) {
    outsAdded = 1;
    if (situations.indexOf('スクイズ失敗') >= 0) {
      bases[2] = false;
      if (bases[1]) { bases[1] = false; bases[2] = true; }
      if (bases[0]) { bases[0] = false; bases[1] = true; }
      bases[0] = true;
    } else {
      var g4 = groundAdvance(bases, true);
      bases = g4.bases; runs += g4.runs;
    }
  } else {
    // ヒット / エラー / nHnE
    var n = Math.max(1, Math.min(4, basesGained));
    var h = advanceHit(bases, n, autoStart);
    bases = h.bases; runs += h.runs;
    if (n >= 4) runs++; else bases[n - 1] = true;
  }
  var rbi = (result === RESULT_ERROR) ? 0 : runs;
  return { bases: bases, outsAdded: outsAdded, runs: runs, rbi: rbi };
}

// ================= SheetMapper（Kotlin SheetMapper.kt の移植） =================
function basesLabel(bases){
  var f = bases[0], s = bases[1], t = bases[2];
  if (!f && !s && !t) return '無塁';
  if (f && !s && !t) return '一塁';
  if (!f && s && !t) return '二塁';
  if (!f && !s && t) return '三塁';
  if (f && s && !t) return '一二塁';
  if (f && !s && t) return '一三塁';
  if (!f && s && t) return '二三塁';
  return '満塁';
}
function basesStrOf(bases){ return bases.map(function(b){ return b ? '1' : '0'; }).join(''); }
function basesFromStr(s){ return [s.charAt(0) === '1', s.charAt(1) === '1', s.charAt(2) === '1']; }
function basesLabelFromStr(s){ return basesLabel(basesFromStr(s)); }
function totalBasesOf(log){
  if (log.resultType === RESULT_HIT) return log.basesGained;
  if (log.resultType === RESULT_NHNE) return Math.max(0, log.basesGained - log.errors);
  return 0;
}
function resultCell(log){
  switch (log.resultType) {
    case RESULT_HIT: return Math.min(4, Math.max(1, log.basesGained)) + '塁打';
    case RESULT_NHNE: return Math.min(4, Math.max(1, log.basesGained - log.errors)) + '塁打';
    case RESULT_OUT: return (log.situations.indexOf('併殺') >= 0) ? '併殺' : (log.playResult || 'ゴロ');
    case RESULT_ERROR: return '失策';
    case RESULT_SAC: return '犠飛';
    case RESULT_SQUEEZE: return 'スクイズ';
    case RESULT_HBP: return '死球';
    case RESULT_INTERFERE: return '妨害';
    case RESULT_BB: return '四球';
    case RESULT_K_SWING: return '空三振';
    case RESULT_K_LOOK: return '見三振';
    default: return log.result;
  }
}
function batTypeCell(code){ if (!code) return ''; return code === 'i' ? 'i2' : code; }
function countCell(count){ return "'" + count; }
/** 1打席 = A〜AB（28列）の値配列 */
function playRow(log){
  return [
    log.date, log.stadium, String(log.inning), log.topBottom, String(log.outs),
    basesLabelFromStr(log.bases), String(log.scoreFirst), String(log.scoreSecond),
    log.batterName, log.batSide, log.pitcherName, log.pitchSide, String(log.pitchCount),
    countCell(log.count), resultCell(log),
    (log.direction != null ? String(log.direction) : ''),
    log.ballType || '', batTypeCell(log.batType),
    String(totalBasesOf(log)), String(log.errors),
    String(log.nextInning), log.nextTopBottom, String(log.nextOuts), basesLabelFromStr(log.nextBases),
    String(log.nextScoreFirst), String(log.nextScoreSecond),
    String(log.runs), String(log.rbi)
  ];
}

// ================= 投手成績自動計算（Kotlin Scorebook.pitcherStats の簡易移植） =================
function pitcherStats(logs, finalFirst, finalSecond){
  if (!logs.length) return [];
  function defTeam(tb){ return tb === '表' ? '後攻' : '先攻'; }

  var acc = {}, orderCounter = 0;
  function accOf(name, team){
    if (!acc[name]) {
      var isFirstOfTeam = true;
      for (var k in acc) { if (acc[k].team === team) { isFirstOfTeam = false; break; } }
      acc[name] = { team: team, order: orderCounter++, runs: 0, earned: 0, starter: isFirstOfTeam,
        outs: 0, firstIdx: -1, lastIdx: -1, leadKept: true };
    }
    return acc[name];
  }

  var runEvents = [];
  var curInning = -1, curTB = '', runners = [null, null, null], reconOuts = 0;

  logs.forEach(function(log, idx){
    var pitcher = log.pitcherName;
    if (!pitcher) return;
    var team = defTeam(log.topBottom);
    var attackTeam = log.topBottom === '表' ? '先攻' : '後攻';
    var a = accOf(pitcher, team);
    if (a.firstIdx < 0) a.firstIdx = idx;
    a.lastIdx = idx;

    if (log.inning !== curInning || log.topBottom !== curTB) {
      curInning = log.inning; curTB = log.topBottom;
      runners = [null, null, null]; reconOuts = 0;
      for (var b = 0; b < 3; b++) { if (log.bases.charAt(b) === '1') runners[b] = { pitcher: pitcher, viaError: false }; }
    }

    var inningEnded = log.nextTopBottom !== log.topBottom || log.nextInning !== log.inning;
    var outsAdded = inningEnded ? Math.max(0, 3 - log.outs) : Math.max(0, log.nextOuts - log.outs);
    a.outs += outsAdded;

    var hitPortion = Math.max(0, log.basesGained - log.errors);
    function wouldScoreWithoutError(base){
      if (log.errors === 0) return true;
      if (log.resultType === RESULT_ERROR) return false;
      if (log.resultType === RESULT_NHNE) return (base + hitPortion) >= 3;
      return true;
    }
    var toScore = log.runs;
    for (var bb = 2; bb >= 0 && toScore > 0; bb--) {
      var r = runners[bb];
      if (!r) continue;
      runners[bb] = null; toScore--;
      var ra = accOf(r.pitcher, team);
      ra.runs++;
      var earned = !r.viaError && reconOuts < 3 && wouldScoreWithoutError(bb);
      if (earned) ra.earned++;
      runEvents.push({ logIndex: idx, team: attackTeam, pitcher: r.pitcher });
    }
    if (toScore > 0) {
      var earnedB = reconOuts < 3 && (log.errors === 0 || (log.resultType === RESULT_NHNE && hitPortion >= 4));
      a.runs += toScore;
      if (earnedB) a.earned += toScore;
      for (var t = 0; t < toScore; t++) runEvents.push({ logIndex: idx, team: attackTeam, pitcher: pitcher });
    }

    reconOuts += outsAdded;
    if (log.resultType === RESULT_ERROR) reconOuts += 1;

    if (inningEnded) {
      runners = [null, null, null];
    } else {
      var batterOnBase;
      switch (log.resultType) {
        case RESULT_HIT: case RESULT_ERROR: case RESULT_NHNE:
        case RESULT_BB: case RESULT_HBP: case RESULT_INTERFERE:
          batterOnBase = log.basesGained < 4; break;
        case RESULT_SQUEEZE:
          batterOnBase = log.situations.indexOf('スクイズ失敗') >= 0; break;
        case RESULT_OUT:
          batterOnBase = log.situations.indexOf('三塁走者アウト') >= 0; break;
        default:
          batterOnBase = false;
      }
      var next = [null, null, null];
      var placed = [];
      for (var pbi = 2; pbi >= 0; pbi--) { if (log.nextBases.charAt(pbi) === '1') placed.push(pbi); }
      var survivors = [];
      for (var svi = 2; svi >= 0; svi--) { if (runners[svi]) survivors.push(runners[svi]); }
      var runnerSlots = placed.length - (batterOnBase ? 1 : 0);
      var si = 0;
      placed.forEach(function(base, pi){
        if (pi < runnerSlots) {
          next[base] = survivors[si] || { pitcher: pitcher, viaError: false };
          si++;
        } else {
          next[base] = { pitcher: pitcher, viaError: (log.resultType === RESULT_ERROR || log.resultType === RESULT_INTERFERE) };
        }
      });
      runners = next;
    }

    var leadAfter = (team === '先攻') ? (log.nextScoreFirst - log.nextScoreSecond) : (log.nextScoreSecond - log.nextScoreFirst);
    if (leadAfter <= 0) a.leadKept = false;
  });

  var winnerTeam = finalFirst > finalSecond ? '先攻' : (finalSecond > finalFirst ? '後攻' : '');
  var winName = null, lossName = null;
  if (winnerTeam) {
    var sf = 0, ss = 0, prevLead = '', decisiveIdx = -1;
    runEvents.forEach(function(ev){
      if (ev.team === '先攻') sf++; else ss++;
      var lead = sf > ss ? '先攻' : (ss > sf ? '後攻' : '');
      if (lead === winnerTeam && prevLead !== winnerTeam) { lossName = ev.pitcher; decisiveIdx = ev.logIndex; }
      prevLead = lead;
    });
    if (decisiveIdx >= 0) {
      for (var di = decisiveIdx; di >= 0; di--) {
        if (defTeam(logs[di].topBottom) === winnerTeam && logs[di].pitcherName) { winName = logs[di].pitcherName; break; }
      }
    }
    if (!winName) {
      for (var k2 in acc) { if (acc[k2].team === winnerTeam && acc[k2].starter) { winName = k2; break; } }
    }
  }

  function entryLead(a){
    var log = logs[a.firstIdx];
    return a.team === '先攻' ? (log.scoreFirst - log.scoreSecond) : (log.scoreSecond - log.scoreFirst);
  }
  function saveSituation(a){
    var lead = entryLead(a);
    if (lead < 1) return false;
    var log = logs[a.firstIdx], runnersOn = 0;
    for (var c = 0; c < 3; c++) if (log.bases.charAt(c) === '1') runnersOn++;
    return lead <= 3 || lead <= (runnersOn + 2) || a.outs >= 9;
  }

  var saveName = null, bestLastIdx = -1;
  for (var k3 in acc) {
    if (acc[k3].team === winnerTeam && acc[k3].lastIdx > bestLastIdx) { bestLastIdx = acc[k3].lastIdx; saveName = k3; }
  }
  if (saveName) {
    var sa = acc[saveName];
    if (!(winnerTeam && saveName !== winName && !sa.starter && sa.outs >= 1 && saveSituation(sa))) saveName = null;
  }

  var result = [];
  for (var k4 in acc) {
    var a4 = acc[k4];
    result.push({
      name: k4, team: a4.team, runs: a4.runs, earnedRuns: a4.earned, starter: a4.starter,
      win: k4 === winName,
      loss: (k4 === lossName && a4.team !== winnerTeam),
      hold: (a4.team === winnerTeam && !a4.starter && k4 !== winName && k4 !== saveName &&
        a4.outs >= 1 && saveSituation(a4) && a4.leadKept),
      save: (k4 === saveName)
    });
  }
  return result;
}

// ================= アプリ状態 =================
var roster = [];
var undoStack = [];
var state = null;
var modal = null; // 現在表示中のモーダル種別 ({type:'...', ...})
var toastTimer = null;

function rosterByName(name){
  for (var i = 0; i < roster.length; i++) if (roster[i].name === name) return roster[i];
  return null;
}
function defaultState(){
  return {
    started: false, ended: false,
    startedAt: null, durationMs: 0, paStartMs: null,
    dateLabel: '', stadium: '', stadiumConfirmed: false,
    inning: 1, attacking: 'first',
    firstOrder: [], secondOrder: [],
    firstIndex: -1, secondIndex: -1,
    outs: 0, bases: [false, false, false],
    scoreFirst: 0, scoreSecond: 0,
    pitcherOfFirst: null, pitcherOfSecond: null,
    balls: 0, strikes: 0, pitchCount: 0, curPitches: [],
    awaitingStrikeoutChoice: false,
    needPitcherPrompt: false,
    pending: null,
    detailLogs: [],
    atBatCounts: {},
    finalStats: null
  };
}
function orderOf(team){ return team === 'first' ? state.firstOrder : state.secondOrder; }
function indexOf(team){ return team === 'first' ? state.firstIndex : state.secondIndex; }
function setIndex(team, v){ if (team === 'first') state.firstIndex = v; else state.secondIndex = v; }
function defendingTeam(){ return state.attacking === 'first' ? 'second' : 'first'; }
function topBottomLabel(){ return state.attacking === 'first' ? '表' : '裏'; }
function currentBatter(){
  var order = orderOf(state.attacking), i = indexOf(state.attacking);
  return (i >= 0 && i < order.length) ? order[i] : null;
}
function currentPitcherName(){
  var def = defendingTeam();
  return def === 'first' ? state.pitcherOfFirst : state.pitcherOfSecond;
}

// ================= 試合時間タイマー =================
function timerLabel(ms){
  var t = Math.floor(ms / 1000), h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  function p(n){ return (n < 10 ? '0' : '') + n; }
  return h ? h + ':' + p(m) + ':' + p(s) : m + ':' + p(s);
}
function durLabel(ms){
  var m = Math.round(ms / 60000), h = Math.floor(m / 60);
  return h ? h + '時間' + (m % 60) + '分' : m + '分';
}
// 試合履歴（直近3試合）: 試合時間とYouTube概要欄用タイムスタンプの元データを保存
function loadYtGames(){
  try { var s = localStorage.getItem('ppYtGames'); if (s) return JSON.parse(s); } catch (e) {}
  return [];
}
function saveYtGames(a){
  try { localStorage.setItem('ppYtGames', JSON.stringify(a)); } catch (e) {}
}
function pushYtGame(rec){
  var a = loadYtGames();
  a.unshift(rec);
  a = a.slice(0, 3); // 直近3試合まで保持
  saveYtGames(a);
}
// 試合中は1秒ごとに経過時間の表示だけを更新する（全体は再描画しない）
setInterval(function(){
  var el = byId('gameTimer');
  if (el && state && state.started && !state.ended && state.startedAt) {
    el.textContent = timerLabel(Date.now() - state.startedAt);
  }
}, 1000);

// ================= YouTube概要欄用タイムスタンプ（Kotlin YoutubeTimestamps.kt の移植） =================
function ytFormat(sec){
  var s = Math.max(0, sec), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), ss = s % 60;
  function p(n){ return (n < 10 ? '0' : '') + n; }
  return h > 0 ? h + ':' + p(m) + ':' + p(ss) : m + ':' + p(ss);
}
function ytFormatOffset(sec){
  var sign = sec < 0 ? '−' : '+', s = Math.abs(sec);
  return sign + Math.floor(s / 60) + ':' + ((s % 60 < 10 ? '0' : '') + (s % 60));
}
function ytTimely(log, base){
  if (log.rbi >= 2) return log.rbi + '点タイムリー' + base;
  if (log.rbi === 1) return 'タイムリー' + base;
  return base;
}
function ytRbiSuffix(log){ return log.rbi > 0 ? '（打点' + log.rbi + '）' : ''; }
function ytHas(log, s){ return (log.situations || []).indexOf(s) >= 0; }
function ytLabel(log){
  var t = log.resultType;
  if (t === RESULT_HIT) {
    if (log.basesGained === 4) {
      if (log.runs === 1) return 'ソロホームラン';
      if (log.runs === 2) return '2ランホームラン';
      if (log.runs === 3) return '3ランホームラン';
      return '満塁ホームラン';
    }
    if (log.basesGained === 3) return ytTimely(log, '3塁打');
    if (log.basesGained === 2) return ytTimely(log, '2塁打');
    return ytTimely(log, 'ヒット');
  }
  if (t === RESULT_OUT) return ytHas(log, '併殺') ? '併殺' : ((log.playResult || 'ゴロ') + 'アウト');
  if (t === RESULT_ERROR) return 'エラー出塁' + (log.runs > 0 ? '（' + log.runs + '点）' : '');
  if (t === RESULT_NHNE) return ytTimely(log, log.result);
  if (t === RESULT_SAC) return (ytHas(log, 'タッチアップ') ? '犠飛' : '犠打') + ytRbiSuffix(log);
  if (t === RESULT_SQUEEZE) return ytHas(log, 'スクイズ失敗') ? 'スクイズ失敗' : 'スクイズ成功';
  if (t === RESULT_BB) return '四球' + ytRbiSuffix(log);
  if (t === RESULT_HBP) return '死球' + ytRbiSuffix(log);
  if (t === RESULT_INTERFERE) return '妨害出塁' + ytRbiSuffix(log);
  if (t === RESULT_K_SWING || t === RESULT_K_LOOK) return '三振';
  return log.result;
}
// ハイライト行の時刻: 結果ボタン押下の10秒前（打点を生んだ1球が映る位置）
function ytHighlightSec(log){
  var press = log.resultPressSec > 0 ? log.resultPressSec : (log.paStartSec || 0);
  return press - 10;
}
function ytBuild(game){
  var off = game.tsOffsetSec || 0;
  var out = [];
  out.push('ハイライト');
  var hs = (game.logs || []).filter(function(l){ return l.runs > 0; });
  if (!hs.length) out.push('（得点シーンなし）');
  else hs.forEach(function(l){
    out.push(ytFormat(ytHighlightSec(l) + off) + ' ' + l.inning + '回' + l.topBottom + ' ' + l.batterName + ytLabel(l));
  });
  out.push('');
  out.push('各選手の打席');
  function teamBlock(title, names){
    out.push(title);
    var seen = {};
    var uniqNames = [];
    (names || []).forEach(function(n){ if (!seen[n]) { seen[n] = true; uniqNames.push(n); } });
    uniqNames.forEach(function(name, i){
      out.push((i + 1) + '.' + name);
      var j = 0;
      (game.logs || []).forEach(function(l){
        if (l.batterName !== name) return;
        j++;
        out.push(ytFormat((l.paStartSec || 0) + off) + ' 第' + j + '打席 ' + ytLabel(l));
      });
      out.push('');
    });
  }
  teamBlock('先攻チーム', game.firstOrder);
  teamBlock('後攻チーム', game.secondOrder);
  while (out.length && out[out.length - 1] === '') out.pop();
  // 注意: このファイルはGASのテンプレート文字列内にあるため改行エスケープを直接書けない
  return out.join(String.fromCharCode(10));
}

// ================= 永続化（ブラウザ再読込対策） =================
function saveState(){
  try { localStorage.setItem('ppRecordState', JSON.stringify(state)); } catch (e) {}
}
function loadState(){
  try {
    var s = localStorage.getItem('ppRecordState');
    if (s) return JSON.parse(s);
  } catch (e) {}
  return null;
}

// ================= サーバー通信 =================
// google.script.run があればそれを使い、無ければ fetch にフォールバックする。
// どちらの経路でも一定時間応答が無ければ reject してエラー表示に進む。
function hasGSR(){
  try { return !!(window.google && google.script && google.script.run); } catch (e) { return false; }
}
function withTimeout(promise, ms, label){
  return new Promise(function(resolve, reject){
    var done = false;
    var timer = setTimeout(function(){
      if (!done) { done = true; reject(new Error(label + ' がタイムアウトしました（' + (ms/1000) + '秒）')); }
    }, ms);
    promise.then(function(v){ if (!done) { done = true; clearTimeout(timer); resolve(v); } },
                 function(e){ if (!done) { done = true; clearTimeout(timer); reject(e); } });
  });
}
function gsrCall(fnName, arg){
  return new Promise(function(resolve, reject){
    var runner = google.script.run
      .withSuccessHandler(function(result){ resolve(result); })
      .withFailureHandler(function(err){ reject(err); });
    if (arg === undefined) runner[fnName](); else runner[fnName](arg);
  });
}
var gsrBroken = false; // google.script.run が応答しなかった場合 true → 以後 fetch を使う
function fetchPost(obj){
  return fetch(GAS_URL, {
    method: 'POST', redirect: 'follow',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(obj)
  }).then(function(res){ return res.text(); }).then(function(text){
    try { return JSON.parse(text); } catch (e) { return null; }
  });
}
function postJson(url, obj){
  var p;
  if (hasGSR() && !gsrBroken) {
    p = withTimeout(gsrCall('recordAction', obj), 30000, '保存通信(script.run)')
      .catch(function(err){
        gsrBroken = true;
        return withTimeout(fetchPost(obj), 30000, '保存通信(fetch)');
      });
  } else {
    p = withTimeout(fetchPost(obj), 30000, '保存通信(fetch)');
  }
  return p.then(function(result){
    if (result && result.ok === false) throw new Error(result.error || 'GAS error');
    return result;
  });
}
function fetchGetRoster(){
  return fetch(GAS_URL + '?action=roster', { redirect: 'follow' })
    .then(function(res){ return res.json(); });
}
function fetchRoster(){
  if (hasGSR() && !gsrBroken) {
    // まず google.script.run、応答が無ければ fetch に自動フォールバック
    return withTimeout(gsrCall('getRoster'), 15000, '名簿取得(script.run)')
      .catch(function(err){
        gsrBroken = true;
        return withTimeout(fetchGetRoster(), 15000, '名簿取得(fetch)');
      });
  }
  return withTimeout(fetchGetRoster(), 15000, '名簿取得(fetch)');
}
function postLiveStart(){
  postJson(GAS_URL, { action: 'liveStart', date: state.dateLabel, stadium: state.stadium }).catch(function(){});
}
function postLivePA(entry){
  postJson(GAS_URL, { action: 'livePA', row: playRow(entry) }).catch(function(){});
}
function postLiveUndo(){ postJson(GAS_URL, { action: 'liveUndo' }).catch(function(){}); }
function postLiveEnd(){ postJson(GAS_URL, { action: 'liveEnd' }).catch(function(){}); }
function postLiveState(){
  var b = currentBatter(), p = currentPitcherName();
  var bm = b ? rosterByName(b) : null, pm = p ? rosterByName(p) : null;
  postJson(GAS_URL, {
    action: 'liveState',
    inning: state.inning, tb: topBottomLabel(), outs: state.outs,
    balls: state.balls, strikes: state.strikes, bases: basesStrOf(state.bases),
    scoreF: state.scoreFirst, scoreS: state.scoreSecond,
    batter: b || '', batSide: bm ? bm.bat : '', batNum: b ? (state.atBatCounts[b] || 0) : 0,
    pitcher: p || '', pitchSide: pm ? pm.throw : '',
    pitches: state.curPitches, pending: !!state.pending
  }).catch(function(){});
}

function showToast(msg){
  var t = byId('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast'; t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.display = 'block';
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(function(){ t.style.display = 'none'; }, 2600);
}

// ================= Undo（前の球） =================
function pushUndo(){
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 200) undoStack.shift();
}
function undoLast(){
  if (!state.started || !undoStack.length) return;
  var beforePAs = state.detailLogs.length;
  var snap = undoStack.pop();
  state = JSON.parse(snap);
  var removedPA = state.detailLogs.length < beforePAs;
  // modal（ポップアップの入力途中状態）は state と別管理のため undo では復元できない。
  // 戻した先が詳細入力待ち(pending)なら、入力し直せるようポップアップを新規に開き直す
  if (state.pending) openResultPopup(); else closeModal();
  saveState(); render();
  if (removedPA) postLiveUndo();
  postLiveState();
}

// ================= 打順編集（試合前・試合中共通） =================
function removeFromOrder(team, pos){
  var order = orderOf(team);
  if (pos < 0 || pos >= order.length) return;
  order.splice(pos, 1);
  var idx = indexOf(team);
  if (pos <= idx) setIndex(team, idx - 1);
  if (!state.started) state.stadiumConfirmed = false;
  saveState(); render();
}
function insertIntoOrder(team, pos, name){
  var order = orderOf(team);
  var p = Math.max(0, Math.min(pos, order.length));
  order.splice(p, 0, name);
  var idx = indexOf(team);
  if (idx >= 0 && p <= idx) setIndex(team, idx + 1);
  if (state.atBatCounts[name] == null) state.atBatCounts[name] = 0;
  if (!state.started) state.stadiumConfirmed = false;
  saveState(); render();
}
function swapOrders(){
  if (state.started) { showToast('試合中は先攻・後攻を入れ替えられません'); return; }
  var tmpO = state.firstOrder, tmpI = state.firstIndex;
  state.firstOrder = state.secondOrder; state.firstIndex = state.secondIndex;
  state.secondOrder = tmpO; state.secondIndex = tmpI;
  var tmpP = state.pitcherOfFirst; state.pitcherOfFirst = state.pitcherOfSecond; state.pitcherOfSecond = tmpP;
  saveState(); render();
}

// ================= 試合開始 =================
function startGame(){
  if (state.started) return;
  if (state.firstOrder.length < 3 || state.secondOrder.length < 3) {
    showToast('先攻・後攻それぞれ3人以上の打順を設定してください'); return;
  }
  if (!state.pitcherOfSecond) { showToast('後攻チームの先発投手を設定してください'); return; }
  if (!state.stadium.trim()) { showToast('球場を設定してください'); return; }
  state.started = true;
  state.startedAt = Date.now(); // 試合時間タイマー開始
  state.paStartMs = state.startedAt; // 1人目の打席開始 = 試合開始
  undoStack = [];
  state.dateLabel = todayStr();
  state.inning = 1; state.attacking = 'first';
  state.firstIndex = 0; state.secondIndex = -1;
  state.atBatCounts[state.firstOrder[0]] = 1;
  maybePromptPitcher();
  saveState(); render();
  postLiveStart(); postLiveState();
}

function maybePromptPitcher(){
  var def = defendingTeam();
  var name = def === 'first' ? state.pitcherOfFirst : state.pitcherOfSecond;
  state.needPitcherPrompt = !name;
}

// ================= カウント進行 =================
function addBall(){
  if (!state.started || state.pending || state.needPitcherPrompt) return;
  pushUndo();
  state.pitchCount++; state.balls++; state.curPitches.push('ボール');
  if (state.balls >= 4) { beginResult(RESULT_BB, { snapshot: false }); return; }
  saveState(); render();
}
function addStrike(){
  if (!state.started || state.pending || state.awaitingStrikeoutChoice || state.needPitcherPrompt) return;
  pushUndo();
  state.pitchCount++; state.strikes++; state.curPitches.push('ストライク');
  if (state.strikes >= 3) state.awaitingStrikeoutChoice = true;
  saveState(); render();
}
function addFoul(){
  if (!state.started || state.pending || state.needPitcherPrompt) return;
  pushUndo();
  state.pitchCount++;
  if (state.strikes < 2) state.strikes++;
  state.curPitches.push('ファール');
  saveState(); render();
}
function confirmStrikeoutChoice(swing){
  if (!state.started || state.pending || !state.awaitingStrikeoutChoice) return;
  state.awaitingStrikeoutChoice = false;
  beginResult(swing ? RESULT_K_SWING : RESULT_K_LOOK, { snapshot: false });
}
function undoThirdStrike(){
  if (!state.awaitingStrikeoutChoice || state.pending) return;
  state.awaitingStrikeoutChoice = false;
  state.strikes = 2;
  state.pitchCount = Math.max(0, state.pitchCount - 1);
  saveState(); render();
}

// ================= 結果入力 =================
function beginResult(type, opts){
  opts = opts || {};
  if (!state.started || state.pending) return;
  var batterName = currentBatter();
  if (!batterName) return;
  if (opts.snapshot !== false) pushUndo();
  var bm = rosterByName(batterName);
  var pitcherName = currentPitcherName();
  var pm = pitcherName ? rosterByName(pitcherName) : null;
  var autoChange = (state.outs + immediateOuts(type)) >= 3;
  state.pending = {
    resultType: type,
    batterName: batterName,
    batSide: bm ? bm.bat : '右',
    atBatNumber: state.atBatCounts[batterName] || 0,
    inning: state.inning,
    topBottom: topBottomLabel(),
    outsBefore: state.outs,
    basesBefore: state.bases.slice(),
    scoreFirstBefore: state.scoreFirst,
    scoreSecondBefore: state.scoreSecond,
    pitcherName: pitcherName || '',
    pitchSide: pm ? pm.throw : '',
    balls: state.balls,
    strikes: state.strikes,
    pitchCount: state.pitchCount,
    autoChange: autoChange,
    pressMs: Date.now() // YouTubeタイムスタンプ用: 結果ボタン押下時刻
  };
  openResultPopup();
  saveState(); render();
}
function cancelResult(){
  var p = state.pending;
  if (!p) return;
  if (p.resultType === RESULT_BB) { state.balls = 3; state.pitchCount = Math.max(0, state.pitchCount - 1); }
  else if (p.resultType === RESULT_K_SWING || p.resultType === RESULT_K_LOOK) {
    state.strikes = 2; state.pitchCount = Math.max(0, state.pitchCount - 1);
  }
  state.pending = null;
  closeModal();
  saveState(); render();
}
function confirmResult(payload){
  var p = state.pending;
  if (!p) return;
  pushUndo();

  var lateChange = !p.autoChange && payload.outsAfter >= 3;
  var willChange = p.autoChange || lateChange;

  if (p.topBottom === '表') state.scoreFirst += payload.runs; else state.scoreSecond += payload.runs;

  if (willChange) {
    state.attacking = (state.attacking === 'first') ? 'second' : 'first';
    if (state.attacking === 'first') state.inning++;
    state.outs = 0; state.bases = [false, false, false];
  } else {
    state.outs = Math.min(3, Math.max(0, payload.outsAfter));
    state.bases = payload.finalBases.slice();
  }

  var countStr;
  if (p.resultType === RESULT_BB) countStr = Math.max(0, p.balls - 1) + '-' + p.strikes;
  else if (p.resultType === RESULT_K_SWING || p.resultType === RESULT_K_LOOK) countStr = p.balls + '-' + Math.max(0, p.strikes - 1);
  else countStr = p.balls + '-' + p.strikes;
  var resultLabel = (p.resultType === RESULT_NHNE) ? (payload.hits + 'H' + payload.errors + 'E') : p.resultType;

  var entry = {
    date: state.dateLabel, stadium: state.stadium, inning: p.inning, topBottom: p.topBottom,
    outs: p.outsBefore, bases: basesStrOf(p.basesBefore),
    scoreFirst: p.scoreFirstBefore, scoreSecond: p.scoreSecondBefore,
    batterName: p.batterName, batSide: payload.batSideOverride || p.batSide,
    pitcherName: p.pitcherName, pitchSide: p.pitchSide, pitchCount: p.pitchCount, count: countStr,
    result: resultLabel, resultType: p.resultType,
    direction: payload.direction, playResult: payload.playResult, ballType: payload.ballType, batType: payload.batType,
    situations: payload.situations, basesGained: payload.basesGained, errors: payload.errors,
    nextInning: state.inning, nextTopBottom: topBottomLabel(),
    nextOuts: willChange ? 0 : state.outs, nextBases: basesStrOf(state.bases),
    nextScoreFirst: state.scoreFirst, nextScoreSecond: state.scoreSecond,
    runs: payload.runs, rbi: payload.rbi,
    // YouTubeタイムスタンプ用（試合開始からの経過秒）
    paStartSec: (state.startedAt && state.paStartMs) ? Math.max(0, Math.floor((state.paStartMs - state.startedAt) / 1000)) : 0,
    resultPressSec: (state.startedAt && p.pressMs) ? Math.max(0, Math.floor((p.pressMs - state.startedAt) / 1000)) : 0
  };
  state.detailLogs.push(entry);

  var team = state.attacking, order = orderOf(team);
  if (order.length) {
    var ni = (indexOf(team) + 1) % order.length;
    setIndex(team, ni);
    var nm = order[ni];
    state.atBatCounts[nm] = (state.atBatCounts[nm] || 0) + 1;
  }
  state.paStartMs = Date.now(); // 次打者の打席開始時刻

  state.balls = 0; state.strikes = 0; state.pitchCount = 0; state.curPitches = [];
  state.pending = null;
  if (willChange) maybePromptPitcher();
  closeModal();
  saveState(); render();
  postLivePA(entry);
  postLiveState();
}

// ================= 手動チェンジ / 投手交代 =================
function changeSides(){
  if (!state.started || state.pending) return;
  pushUndo();
  state.attacking = (state.attacking === 'first') ? 'second' : 'first';
  if (state.attacking === 'first') state.inning++;
  state.outs = 0; state.bases = [false, false, false];
  state.balls = 0; state.strikes = 0; state.pitchCount = 0; state.curPitches = [];
  var order = orderOf(state.attacking);
  if (order.length) {
    var ni = (indexOf(state.attacking) + 1) % order.length;
    setIndex(state.attacking, ni);
    var nm = order[ni];
    state.atBatCounts[nm] = (state.atBatCounts[nm] || 0) + 1;
  }
  state.paStartMs = Date.now(); // 次打者の打席開始時刻
  maybePromptPitcher();
  saveState(); render(); postLiveState();
}
function changePitcher(team, name){
  if (team === 'first') state.pitcherOfFirst = name; else state.pitcherOfSecond = name;
  state.needPitcherPrompt = false;
  closeModal();
  saveState(); render(); postLiveState();
}

// ================= 試合終了 =================
function endGame(){
  if (!confirm('試合を終了して保存します。よろしいですか？')) return;
  var stats = pitcherStats(state.detailLogs, state.scoreFirst, state.scoreSecond);
  var payload = {
    date: state.dateLabel || todayStr(),
    stadium: state.stadium,
    scoreFirst: state.scoreFirst,
    scoreSecond: state.scoreSecond,
    playRows: state.detailLogs.map(playRow),
    roster: uniq(state.firstOrder.concat(state.secondOrder)),
    pitchers: stats.map(function(s){ return { name: s.name, runs: s.runs, earned: s.earnedRuns }; }),
    starters: stats.filter(function(s){ return s.starter; }).map(function(s){ return s.name; }),
    win: (stats.filter(function(s){ return s.win; })[0] || {}).name || '',
    loss: (stats.filter(function(s){ return s.loss; })[0] || {}).name || '',
    holds: stats.filter(function(s){ return s.hold; }).map(function(s){ return s.name; }),
    saves: stats.filter(function(s){ return s.save; }).map(function(s){ return s.name; })
  };
  var durMs = state.startedAt ? (Date.now() - state.startedAt) : 0;
  // YouTube用タイムスタンプの元データ（端末にも直近3試合ぶん保存）
  var ytGame = {
    date: state.dateLabel, stadium: state.stadium,
    scoreF: state.scoreFirst, scoreS: state.scoreSecond,
    ms: durMs, tsOffsetSec: 0, serverSheet: '',
    firstOrder: state.firstOrder.slice(), secondOrder: state.secondOrder.slice(),
    logs: state.detailLogs.map(function(l){
      return { inning: l.inning, topBottom: l.topBottom, batterName: l.batterName,
        resultType: l.resultType, result: l.result, basesGained: l.basesGained,
        runs: l.runs, rbi: l.rbi, situations: l.situations || [],
        playResult: l.playResult, paStartSec: l.paStartSec || 0, resultPressSec: l.resultPressSec || 0 };
    })
  };
  // サーバー（サイト）にもタイムスタンプ本文を保存 → 複数端末で閲覧できる
  payload.ytText = ytBuild(ytGame);
  showToast('保存中…');
  postJson(GAS_URL, payload).then(function(res){
    postLiveEnd();
    state.ended = true;
    state.finalStats = stats;
    state.durationMs = durMs;
    ytGame.serverSheet = (res && res.sheet) ? res.sheet : ''; // サイト更新用に試合シート名を控える
    pushYtGame(ytGame);
    try { localStorage.removeItem('ppRecordState'); } catch (e) {}
    render();
    showToast('保存しました');
  }).catch(function(err){
    showToast('保存に失敗しました: ' + err.message);
  });
}
function newGameAfterEnd(){
  var keepFirst = state.firstOrder.slice(), keepSecond = state.secondOrder.slice(), stadium = state.stadium;
  state = defaultState();
  state.firstOrder = keepFirst; state.secondOrder = keepSecond;
  state.stadium = stadium; state.stadiumConfirmed = !!stadium;
  undoStack = [];
  saveState(); render();
}

// ================= モーダル制御 =================
function closeModal(){ modal = null; renderModal(); }
function openMemberPicker(opts){ modal = Object.assign({ type: 'picker', query: '' }, opts); renderModal(); }
function openPitcherPicker(opts){ modal = Object.assign({ type: 'pitcher', query: '' }, opts); renderModal(); }
function openResultPopup(){
  modal = {
    type: 'result',
    direction: null, playResult: null, ballType: null, batType: null,
    basesGained: null, hits: 1, errs: 1,
    situations: [], squeezeSuccess: null, batSide: null,
    tagThird: null, tagSecond: null, fumble: null,
    manualOverride: false, ovBases: null, ovOuts: null, ovRuns: null, ovRbi: null
  };
  renderModal();
}
function openPitcherPromptModal(){ modal = { type: 'pitcherPrompt' }; renderModal(); }

// ================= レンダリング: ルート =================
function render(){
  var app = byId('app');
  if (!state) { app.innerHTML = '<div class="loading">読み込み中…</div>'; return; }
  if (!state.started) app.innerHTML = renderSetup();
  else if (state.ended) app.innerHTML = renderEnded();
  else app.innerHTML = renderGame();
  renderModal();
  renderExtraModal();
}

/** 3ストライク到達時の空振り/見逃し選択、投手未設定プロンプトを表示する（通常モーダルとは別レイヤー） */
function renderExtraModal(){
  var extra = byId('extraModalRoot');
  var showStrikeout = !!(state && state.started && !state.ended && state.awaitingStrikeoutChoice);
  var showPitcherPrompt = !!(state && state.started && !state.ended && !showStrikeout && state.needPitcherPrompt && !state.pending);
  if (!showStrikeout && !showPitcherPrompt) { if (extra) extra.remove(); return; }
  if (!extra) { extra = document.createElement('div'); extra.id = 'extraModalRoot'; document.body.appendChild(extra); }
  if (showStrikeout) {
    extra.innerHTML = '<div class="overlay center"><div class="sheet">' +
      '<h3>3ストライク</h3><div class="meta">空振りか見逃しかを選択してください</div>' +
      '<button class="btn red block" style="height:56px;margin-bottom:10px" onclick="RB.confirmStrikeoutChoice(true)">空　振　り</button>' +
      '<button class="btn block" style="height:56px;background:#1565C0" onclick="RB.confirmStrikeoutChoice(false)">見　逃　し</button>' +
      '<div class="footbtns"><button class="btn outline block" onclick="RB.undoThirdStrike()">入力ミス（戻す）</button></div>' +
      '</div></div>';
  } else {
    extra.innerHTML = renderPitcherPromptModal();
  }
}

// ================= セットアップ画面 =================
var setupTab = 'first';
function switchSetupTab(t){ setupTab = t; render(); }

function orderListHtml(team){
  var order = orderOf(team);
  var rows = order.map(function(name, i){
    var m = rosterByName(name);
    var furi = m ? m.furigana : '';
    return '<div class="oi">' +
      '<div class="no">' + (i + 1) + '</div>' +
      '<div class="nm">' + esc(name) + (furi ? '<span class="furi">' + esc(furi) + '</span>' : '') + '</div>' +
      '<button class="del" onclick="RB.removeFromOrder(' + jsStr(team) + ',' + i + ')">×</button>' +
      '</div>';
  }).join('');
  var empty = order.length === 0 ? '<div class="oi"><div class="nm sub" style="color:#6a6d76">まだメンバーがいません</div></div>' : '';
  return '<div class="orderlist">' + rows + empty +
    '<div class="addrow" onclick="RB.openAddMember(' + jsStr(team) + ')">＋ メンバーを追加</div>' +
    '</div>';
}

function renderSetup(){
  var h = '';
  h += '<div class="card"><div class="sectionlabel" style="margin-top:0">球場</div>' +
    '<input id="stadiumInput" type="text" placeholder="例: ○○小学校" style="width:100%" value="' + esc(state.stadium) + '" ' +
    'oninput="RB.onStadiumInput(this.value)"></div>';

  h += '<div class="row">' +
    '<button class="btn outline block" onclick="RB.swapOrders()">先攻⇔後攻 入替</button>' +
    '</div>';

  h += '<div class="tabs">' +
    '<div class="tab' + (setupTab === 'first' ? ' on' : '') + '" onclick="RB.switchSetupTab(\\'first\\')">先攻（' + state.firstOrder.length + '人）</div>' +
    '<div class="tab' + (setupTab === 'second' ? ' on' : '') + '" onclick="RB.switchSetupTab(\\'second\\')">後攻（' + state.secondOrder.length + '人）</div>' +
    '</div>';

  h += orderListHtml(setupTab);

  if (setupTab === 'second') {
    h += '<div class="card"><div class="sectionlabel" style="margin-top:0">後攻 先発投手（必須）</div>';
    if (state.secondOrder.length === 0) {
      h += '<div class="sub">先に後攻の打順を組んでください</div>';
    } else {
      h += '<select id="pitcherSecondSel" style="width:100%" onchange="RB.setStartPitcher(\\'second\\',this.value)">' +
        '<option value="">未選択</option>' +
        state.secondOrder.map(function(n){
          return '<option value="' + esc(n) + '"' + (state.pitcherOfSecond === n ? ' selected' : '') + '>' + esc(n) + '</option>';
        }).join('') + '</select>';
    }
    h += '</div>';
  }

  var order1ok = state.firstOrder.length >= 3, order2ok = state.secondOrder.length >= 3;
  var pitcherOk = !!state.pitcherOfSecond, stadiumOk = !!state.stadium.trim();
  var canStart = order1ok && order2ok && pitcherOk && stadiumOk;

  h += '<div class="card">';
  if (!order1ok) h += '<div class="err">・先攻は3人以上必要です（現在 ' + state.firstOrder.length + ' 人）</div>';
  if (!order2ok) h += '<div class="err">・後攻は3人以上必要です（現在 ' + state.secondOrder.length + ' 人）</div>';
  if (!pitcherOk) h += '<div class="err">・後攻の先発投手が未選択です</div>';
  if (!stadiumOk) h += '<div class="err">・球場が未入力です</div>';
  h += '<button class="btn green block" style="height:52px;font-size:1.05em;margin-top:8px" ' +
    (canStart ? '' : 'disabled') + ' onclick="RB.startGame()">試合開始</button>' +
    '</div>';

  // 過去の試合（直近3試合）: 試合時間とYouTube用タイムスタンプ
  var past = loadYtGames();
  if (past.length) {
    h += '<h2>終了した試合（直近' + past.length + '試合）</h2><div class="card" style="padding:0">' +
      past.map(function(g, i){
        return '<div class="statline" style="cursor:pointer" onclick="RB.openYt(' + i + ')">' +
          '<span>' + esc(g.date) + ' ' + esc(g.stadium) + '（' + g.scoreF + '－' + g.scoreS + '）</span>' +
          '<span>' + (g.ms ? durLabel(g.ms) : '') + '　📋</span></div>';
      }).join('') + '</div>' +
      '<div class="sub">タップするとYouTube概要欄用のタイムスタンプが開きます</div>';
  }

  return h;
}

// ================= 試合中画面 =================
function pipsHtml(cls, n, max){
  var h = '';
  for (var i = 0; i < max; i++) h += '<span class="pip' + (i < n ? ' ' + cls : '') + '"></span>';
  return h;
}
function diaHtml(bases){
  return '<div class="dia">' +
    '<i class="b2' + (bases[1] ? ' on' : '') + '"></i>' +
    '<i class="b3' + (bases[2] ? ' on' : '') + '"></i>' +
    '<i class="b1' + (bases[0] ? ' on' : '') + '"></i></div>';
}

function renderGame(){
  var batter = currentBatter(), pitcher = currentPitcherName();
  var bm = batter ? rosterByName(batter) : null, pm = pitcher ? rosterByName(pitcher) : null;
  var batNum = batter ? (state.atBatCounts[batter] || 0) : 0;

  var h = '';
  h += '<div class="statusbar">' +
    '<div class="inning">' + state.inning + '回' + topBottomLabel() + '</div>' +
    (state.stadium ? '<div class="stadium">' + esc(state.stadium) + '　' + esc(state.dateLabel) + '</div>' : '') +
    (state.startedAt ? '<div class="gtime">⏱ <span id="gameTimer">' + timerLabel(Date.now() - state.startedAt) + '</span></div>' : '') +
    '<div class="score">' +
    '<span class="fteam' + (state.attacking === 'first' ? ' atk' : '') + '">' + state.scoreFirst + '</span>' +
    '<span class="vs">先攻－後攻</span>' +
    '<span class="steam' + (state.attacking === 'second' ? ' atk' : '') + '">' + state.scoreSecond + '</span>' +
    '</div>' +
    '<div class="midrow">' +
    '<div class="outs"><span class="lb">OUT</span>' + pipsHtml('o', state.outs, 2) + '</div>' +
    diaHtml(state.bases) +
    '</div>' +
    '<div class="whorow">' +
    '<div class="who"><div class="lab">投手（' + (defendingTeam() === 'first' ? '先攻' : '後攻') + '）</div>' +
    '<div class="nm">' + esc(pitcher || '未設定') + (pm ? '（' + esc(pm.throw) + '投）' : '') + '</div></div>' +
    '<div class="who" style="text-align:right"><div class="lab">打者' + (batNum ? ' 第' + batNum + '打席' : '') + '</div>' +
    '<div class="nm">' + esc(batter || '-') + (bm ? '（' + esc(bm.bat) + '打）' : '') + '</div></div>' +
    '</div>' +
    '<div class="countrow">' +
    '<div class="g"><span class="lb">B</span>' + pipsHtml('b', state.balls, 3) + '</div>' +
    '<div class="g"><span class="lb">S</span>' + pipsHtml('s', state.strikes, 2) + '</div>' +
    '</div>' +
    '<div class="pitchcount">打席中 ' + state.pitchCount + ' 球</div>' +
    '</div>';

  var disabled = !!state.pending || state.awaitingStrikeoutChoice || state.needPitcherPrompt;

  h += '<div class="countbtns">' +
    '<button class="btn ball" ' + (disabled ? 'disabled' : '') + ' onclick="RB.addBall()">ボール</button>' +
    '<button class="btn strike" ' + (disabled ? 'disabled' : '') + ' onclick="RB.addStrike()">ストライク</button>' +
    '<button class="btn foul" ' + (disabled ? 'disabled' : '') + ' onclick="RB.addFoul()">ファール</button>' +
    '</div>';

  // アプリ(MainScreen.kt)と同じ並び: 1段目 ヒット/アウト/エラー/nHnE、2段目 死球/妨害/(スクイズ)
  h += '<div class="resultbtns">' +
    '<button class="btn res-hit" ' + (disabled ? 'disabled' : '') + ' onclick="RB.beginResult(' + jsStr(RESULT_HIT) + ')">ヒット</button>' +
    '<button class="btn res-out" ' + (disabled ? 'disabled' : '') + ' onclick="RB.beginResult(' + jsStr(RESULT_OUT) + ')">アウト</button>' +
    '<button class="btn res-outline" ' + (disabled ? 'disabled' : '') + ' onclick="RB.beginResult(' + jsStr(RESULT_ERROR) + ')">エラー</button>' +
    '<button class="btn res-outline" ' + (disabled ? 'disabled' : '') + ' onclick="RB.beginResult(' + jsStr(RESULT_NHNE) + ')">nHnE</button>' +
    '</div>';
  h += '<div class="resultbtns2">' +
    '<button class="btn res-outline" ' + (disabled ? 'disabled' : '') + ' onclick="RB.beginResult(' + jsStr(RESULT_HBP) + ')">死球</button>' +
    '<button class="btn res-outline" ' + (disabled ? 'disabled' : '') + ' onclick="RB.beginResult(' + jsStr(RESULT_INTERFERE) + ')">妨害</button>' +
    (isSqueezeSituation(state.bases, state.outs)
      ? '<button class="btn res-squeeze" ' + (disabled ? 'disabled' : '') + ' onclick="RB.beginResult(' + jsStr(RESULT_SQUEEZE) + ')">スクイズ</button>'
      : '<span></span>') +
    '</div>';

  h += '<div class="row" style="margin-top:10px">' +
    '<button class="btn outline" style="flex:1" ' + (state.pending ? 'disabled' : '') + ' onclick="RB.openChangePitcher()">投手交代</button>' +
    '<button class="btn outline" style="flex:1" ' + (state.pending ? 'disabled' : '') + ' onclick="RB.openOrderEdit()">メンバー変更</button>' +
    '</div>';
  h += '<div class="row" style="margin-top:8px">' +
    '<button class="btn gray" style="flex:1" ' + (!undoStack.length ? 'disabled' : '') + ' onclick="RB.undoLast()">前の球</button>' +
    '<button class="btn red" style="flex:1" onclick="RB.endGame()">試合終了</button>' +
    '</div>';

  if (state.detailLogs.length) {
    h += '<h2>直近の記録</h2><div class="card" style="padding:0">' +
      state.detailLogs.slice(-5).reverse().map(function(l){
        return '<div class="statline"><span>' + l.inning + '回' + l.topBottom + ' ' + esc(l.batterName) + '</span>' +
          '<span>' + esc(resultCell(l)) + (l.runs ? '（+' + l.runs + '点）' : '') + '</span></div>';
      }).join('') + '</div>';
  }

  return h;
}

function renderEnded(){
  var h = '<div class="card"><h2 style="margin-top:0">試合終了</h2>' +
    '<div class="score"><span class="fteam">' + state.scoreFirst + '</span><span class="vs">先攻－後攻</span>' +
    '<span class="steam">' + state.scoreSecond + '</span></div>' +
    '<div class="sub" style="text-align:center">' + esc(state.stadium) + '　' + esc(state.dateLabel) + '</div>' +
    (state.durationMs ? '<div class="sub" style="text-align:center">⏱ 試合時間 ' + durLabel(state.durationMs) + '</div>' : '') +
    '</div>';
  if (state.finalStats && state.finalStats.length) {
    h += '<h2>投手成績</h2><div class="card" style="padding:0">' +
      state.finalStats.map(function(s){
        var chips = '';
        if (s.win) chips += '<span class="chip win">勝</span>';
        if (s.loss) chips += '<span class="chip lose">敗</span>';
        if (s.hold) chips += '<span class="chip hold">H</span>';
        if (s.save) chips += '<span class="chip save">S</span>';
        return '<div class="statline"><span>' + esc(s.name) + '（' + esc(s.team) + '）' + chips + '</span>' +
          '<span>' + s.runs + '失点（自責' + s.earnedRuns + '）</span></div>';
      }).join('') + '</div>';
  }
  if (loadYtGames().length) {
    h += '<div class="card"><button class="btn orange block" onclick="RB.openYt(0)">📋 YouTube用タイムスタンプ</button></div>';
  }
  h += '<div class="card"><button class="btn green block" style="height:50px" onclick="RB.newGameAfterEnd()">新しい試合を始める</button></div>';
  return h;
}

// ================= モーダル: 描画 =================
function renderModal(){
  var root = byId('modalRoot');
  if (!modal) { if (root) root.remove(); return; }
  if (!root) { root = document.createElement('div'); root.id = 'modalRoot'; document.body.appendChild(root); }
  var html = '';
  if (modal.type === 'picker') html = renderPickerModal();
  else if (modal.type === 'pitcher') html = renderPitcherModal();
  else if (modal.type === 'result') html = renderResultModal();
  else if (modal.type === 'pitcherPrompt') html = renderPitcherPromptModal();
  else if (modal.type === 'yt') html = renderYtModal();
  else if (modal.type === 'orderEdit') html = renderOrderEditModal();
  root.innerHTML = html;
}

function memberMatches(m, q){
  if (!q) return true;
  return m.name.indexOf(q) >= 0 || (m.furigana && m.furigana.indexOf(q) >= 0);
}

function renderPickerModal(){
  var list = roster.filter(function(m){ return memberMatches(m, modal.query); });
  var items = list.map(function(m){
    return '<div class="si" onclick="RB.pickMember(' + jsStr(m.name) + ')"><span class="nm">' + esc(m.name) + '</span>' +
      (m.furigana ? '<span class="furi">' + esc(m.furigana) + '</span>' : '') + '</div>';
  }).join('') || '<div class="empty">該当するメンバーがいません</div>';
  // 名簿に無い名前でも検索欄の入力をそのまま追加できる（名簿取得失敗時・助っ人対応）
  var q = (modal.query || '').trim();
  if (q && !roster.some(function(m){ return m.name === q; })) {
    items += '<div class="si" onclick="RB.pickMember(' + jsStr(q) + ')"><span class="nm">「' + esc(q) + '」をこの名前で追加</span></div>';
  }
  return '<div class="overlay" onclick="RB.closeModalIfBg(event)"><div class="sheet" onclick="event.stopPropagation()">' +
    '<h3>' + esc(modal.title || 'メンバー選択') + '</h3>' +
    '<input class="searchbox" type="text" placeholder="名前・フリガナで検索" value="' + esc(modal.query) + '" ' +
    'oninput="RB.updatePickerQuery(this.value)" autofocus>' +
    '<div class="searchlist">' + items + '</div>' +
    '<div class="footbtns"><button class="btn outline block" onclick="RB.closeModal()">キャンセル</button></div>' +
    '</div></div>';
}
function renderPitcherModal(){
  var order = orderOf(modal.team);
  var items = order.map(function(n){
    var m = rosterByName(n);
    return '<div class="si" onclick="RB.pickPitcher(' + jsStr(n) + ')"><span class="nm">' + esc(n) + '</span>' +
      (m ? '<span class="furi">' + esc(m.throw) + '投</span>' : '') + '</div>';
  }).join('') || '<div class="empty">打順が空です</div>';
  return '<div class="overlay" onclick="RB.closeModalIfBg(event)"><div class="sheet" onclick="event.stopPropagation()">' +
    '<h3>' + esc(modal.title || '投手選択') + '</h3>' +
    '<div class="searchlist">' + items + '</div>' +
    '<div class="footbtns"><button class="btn outline block" onclick="RB.closeModal()">キャンセル</button></div>' +
    '</div></div>';
}
// 試合中のメンバー変更（挿入・削除。打順インデックスは insertIntoOrder/removeFromOrder が自動補正）
function renderOrderEditModal(){
  var team = modal.team;
  var order = orderOf(team);
  var cur = indexOf(team);
  var rows = order.map(function(name, i){
    var isCur = (state.attacking === team && i === cur);
    return '<div class="oi">' +
      '<div class="no">' + (i + 1) + '</div>' +
      '<div class="nm">' + esc(name) + (isCur ? '<span class="cur">← 現打者</span>' : '') + '</div>' +
      '<button class="del" style="color:#2f6fdd" title="この下に挿入" onclick="RB.orderEditInsert(' + (i + 1) + ')">＋</button>' +
      '<button class="del" onclick="RB.orderEditRemove(' + i + ')">×</button>' +
      '</div>';
  }).join('');
  return '<div class="overlay" onclick="RB.closeModalIfBg(event)"><div class="sheet" onclick="event.stopPropagation()">' +
    '<h3>メンバー変更</h3>' +
    '<div class="tabs" style="margin-top:0">' +
    '<div class="tab' + (team === 'first' ? ' on' : '') + '" onclick="RB.orderEditTeam(\\'first\\')">先攻（' + state.firstOrder.length + '人）</div>' +
    '<div class="tab' + (team === 'second' ? ' on' : '') + '" onclick="RB.orderEditTeam(\\'second\\')">後攻（' + state.secondOrder.length + '人）</div>' +
    '</div>' +
    '<div class="orderlist" style="max-height:300px;overflow-y:auto">' +
    '<div class="addrow" onclick="RB.orderEditInsert(0)">＋ 先頭に挿入</div>' +
    rows +
    '<div class="addrow" onclick="RB.orderEditInsert(' + order.length + ')">＋ 最後尾に追加</div>' +
    '</div>' +
    '<div class="sub">＋で挿入位置を選べます。×で打順から外します（途中参加・途中退場に対応）</div>' +
    '<div class="footbtns"><button class="btn outline block" onclick="RB.closeModal()">閉じる</button></div>' +
    '</div></div>';
}
function openOrderEdit(team){
  modal = { type: 'orderEdit', team: team || state.attacking || 'first' };
  renderModal();
}

function renderYtModal(){
  var games = loadYtGames();
  var g = games[modal.gameIndex];
  if (!g) return '';
  var text = ytBuild(g);
  var off = g.tsOffsetSec || 0;
  return '<div class="overlay" onclick="RB.closeModalIfBg(event)"><div class="sheet" onclick="event.stopPropagation()">' +
    '<h3>YouTube用タイムスタンプ</h3>' +
    '<div class="sub">' + esc(g.date) + ' ' + esc(g.stadium) + '（' + g.scoreF + '－' + g.scoreS + '）' +
    (g.ms ? '　試合時間 ' + durLabel(g.ms) : '') + '</div>' +
    '<div class="sub">動画のズレ補正: <b>' + ytFormatOffset(off) + '</b>（動画内で試合開始が 0:00 より後なら＋で合わせる）</div>' +
    '<div class="row" style="margin:6px 0">' +
    '<button class="btn gray" style="flex:1" onclick="RB.ytOffset(-10)">−10秒</button>' +
    '<button class="btn gray" style="flex:1" onclick="RB.ytOffset(-1)">−1秒</button>' +
    '<button class="btn gray" style="flex:1" onclick="RB.ytOffset(1)">＋1秒</button>' +
    '<button class="btn gray" style="flex:1" onclick="RB.ytOffset(10)">＋10秒</button>' +
    '</div>' +
    '<textarea id="ytText" readonly style="width:100%;height:240px;background:#0d0d10;color:#e9e9ec;' +
    'border:1px solid #33343c;border-radius:10px;padding:10px;font-size:.82em;line-height:1.5">' + esc(text) + '</textarea>' +
    (g.serverSheet
      ? '<button class="btn green block" style="margin-top:8px" onclick="RB.ytSaveToSite()">サイトに保存（他の端末でも見られる）</button>' +
        '<div class="sub">ズレ補正を変えたら、もう一度これを押すとサイトの内容も更新されます</div>'
      : '<div class="sub">※ この試合は自動でサイト保存済みです（補正変更ぶんは反映されません）</div>') +
    '<div class="footbtns">' +
    '<button class="btn block" onclick="RB.ytCopy()">全文コピー</button>' +
    '<button class="btn outline block" onclick="RB.closeModal()">閉じる</button>' +
    '</div>' +
    '</div></div>';
}
function ytSaveToSite(){
  var games = loadYtGames();
  var g = games[modal.gameIndex];
  if (!g || !g.serverSheet) { showToast('この試合はサイト保存に対応していません'); return; }
  showToast('サイトに保存中…');
  postJson(GAS_URL, { action: 'saveTs', sheet: g.serverSheet, text: ytBuild(g) })
    .then(function(){ showToast('サイトに保存しました。どの端末からでも見られます'); })
    .catch(function(err){ showToast('保存に失敗しました: ' + (err && err.message ? err.message : err)); });
}
function openYt(i){ modal = { type: 'yt', gameIndex: i }; renderModal(); }
function ytOffset(delta){
  var games = loadYtGames();
  var g = games[modal.gameIndex];
  if (!g) return;
  g.tsOffsetSec = (g.tsOffsetSec || 0) + delta;
  saveYtGames(games);
  renderModal();
}
function ytCopy(){
  var ta = byId('ytText');
  if (!ta) return;
  var done = function(){ showToast('コピーしました。YouTubeの概要欄に貼り付けてください'); };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(done, function(){
      ta.select(); document.execCommand('copy'); done();
    });
  } else {
    ta.select(); document.execCommand('copy'); done();
  }
}

function renderPitcherPromptModal(){
  var def = defendingTeam();
  return '<div class="overlay center"><div class="sheet">' +
    '<h3>' + (def === 'first' ? '先攻' : '後攻') + 'の投手を選んでください</h3>' +
    '<div class="meta">この回の守備投手が未設定です</div>' +
    '<div class="searchlist">' + orderOf(def).map(function(n){
      var m = rosterByName(n);
      return '<div class="si" onclick="RB.pickInitialPitcher(' + jsStr(def) + ',' + jsStr(n) + ')"><span class="nm">' + esc(n) + '</span>' +
        (m ? '<span class="furi">' + esc(m.throw) + '投</span>' : '') + '</div>';
    }).join('') + '</div>' +
    '</div></div>';
}

// ---- 結果詳細ポップアップ ----
var DIR_FIELD = [[1, '左'], [2, '左中'], [3, '中'], [4, '右中'], [5, '右']];
var DIR_OTHER = [[0, '投'], [6, 'ファール']];
var PLAY_RESULTS = ['ゴロ', 'フライ', 'ライナー'];
var BALL_TYPES = ['ゴロ', 'ライナー', 'フライ'];
var BAT_DEFS = [
  { code: 'r', label: 'r 赤', bg: '#D32F2F', fg: '#fff' },
  { code: 'd', label: 'd 竜', bg: '#1565C0', fg: '#fff' },
  { code: 'y', label: 'y 黄', bg: '#FDD835', fg: '#000' },
  { code: 't', label: 't 虎', bg: 'linear-gradient(90deg,#FDD835 50%,#212121 50%)', fg: '#fff' },
  { code: 'i', label: 'i 違反', bg: '#F57C00', fg: '#fff' },
  { code: 'w', label: 'w 白', bg: '#fff', fg: '#000', border: '#9E9E9E' },
  { code: 'b', label: 'b 黒', bg: '#212121', fg: '#fff' },
  { code: 'o', label: 'o 他', bg: '#757575', fg: '#fff' }
];

function selBox(label, on, onclick, small){
  return '<div class="selbox' + (on ? ' on' : '') + (small ? ' small' : '') + '" onclick="' + onclick + '">' + esc(label) + '</div>';
}
function batBox(def, on){
  var style = 'background:' + def.bg + ';color:' + def.fg + (def.border ? ';border-color:' + def.border : '');
  return '<div class="batbox' + (on ? ' on' : '') + '" style="' + style + '" onclick="RB.setBatType(' + jsStr(def.code) + ')">' + esc(def.label) + '</div>';
}

function renderResultModal(){
  var p = state.pending;
  if (!p) return '';
  var m = modal;
  var type = p.resultType;
  var batted = hasBattedBall(type);
  var isNhne = type === RESULT_NHNE;
  var isSqueeze = type === RESULT_SQUEEZE;
  var needBasesGained = type === RESULT_HIT || type === RESULT_ERROR;
  var isStrikeout = false;
  var needPlayResult = type === RESULT_OUT || type === RESULT_SAC;
  var isSwitch = p.batSide === '両';

  var hasSecond = p.basesBefore[1], hasThird = p.basesBefore[2];
  var notDpOut = m.situations.indexOf('併殺') < 0 && m.situations.indexOf('三塁走者アウト') < 0;
  var askFly = needPlayResult && m.playResult === 'フライ' && notDpOut && !p.autoChange;
  var askTagThird = askFly && hasThird;
  var askTagSecond = askFly && hasSecond;
  var askFumble = needPlayResult && m.playResult === 'ゴロ' && hasThird && p.outsBefore <= 1 && notDpOut && !p.autoChange;

  var effBases = isNhne ? Math.min(4, Math.max(1, m.hits + m.errs)) : (needBasesGained ? (m.basesGained || 1) : 0);
  var effSituations = m.situations.slice();
  if (isSqueeze && m.squeezeSuccess != null) effSituations.push(m.squeezeSuccess ? 'スクイズ成功' : 'スクイズ失敗');
  if (m.tagThird === true || m.tagSecond === true) effSituations.push('タッチアップ');
  if (m.fumble === true) effSituations.push('ワンファンブル');

  var basesForced = p.basesBefore[0];
  var autoStart = p.outsBefore === 2 && p.balls === 3 && p.strikes === 2 && basesForced;
  var auto = compute(type, p.basesBefore, effBases, effSituations, m.playResult, {
    autoStart: autoStart, tagThird: m.tagThird === true, tagSecond: m.tagSecond === true,
    fumble: m.fumble === true, outsBefore: p.outsBefore
  });

  var shownBases = m.manualOverride && m.ovBases ? m.ovBases : auto.bases;
  var shownOuts = m.manualOverride && m.ovOuts != null ? m.ovOuts : (p.outsBefore + auto.outsAdded);
  var shownRuns = m.manualOverride && m.ovRuns != null ? m.ovRuns : auto.runs;
  var shownRbi = m.manualOverride && m.ovRbi != null ? m.ovRbi : auto.rbi;

  var errorCount = type === RESULT_ERROR ? effBases : (type === RESULT_NHNE ? m.errs : 0);

  var canConfirm =
    (!batted || (m.direction != null && m.ballType != null)) &&
    (m.batType != null) &&
    (!needBasesGained || m.basesGained != null) &&
    (!needPlayResult || m.playResult != null) &&
    (!askTagThird || m.tagThird != null) &&
    (!askTagSecond || m.tagSecond != null) &&
    (!askFumble || m.fumble != null) &&
    (!isSqueeze || m.squeezeSuccess != null) &&
    (!isSwitch || m.batSide != null);

  var h = '<div class="overlay" onclick="event.stopPropagation()"><div class="sheet" onclick="event.stopPropagation()">';
  h += '<h3>' + esc(p.batterName) + '：' + esc(type) + '</h3>';
  h += '<div class="meta">' + p.inning + '回' + p.topBottom + ' ' + p.outsBefore + 'アウト　B' + p.balls + ' S' + p.strikes + ' ' + p.pitchCount + '球</div>';

  if (isSwitch) {
    h += '<div class="sectionlabel">この打席の左右（必須）</div><div class="grid2">' +
      selBox('右打ち', m.batSide === '右', 'RB.setPopup(\\'batSide\\',\\'右\\')') +
      selBox('左打ち', m.batSide === '左', 'RB.setPopup(\\'batSide\\',\\'左\\')') + '</div>';
  }
  if (isSqueeze) {
    h += '<div class="sectionlabel">スクイズの結果（必須）</div><div class="grid2">' +
      selBox('成功（三塁走者 生還）', m.squeezeSuccess === true, 'RB.setPopupBool(\\'squeezeSuccess\\',true)') +
      selBox('失敗（三塁走者 アウト）', m.squeezeSuccess === false, 'RB.setPopupBool(\\'squeezeSuccess\\',false)') + '</div>';
  }
  if (isNhne) {
    h += '<div class="sectionlabel">ヒット数 / エラー数（合計が進塁数）</div><div class="row" style="align-items:center">' +
      '<span>H:</span><button class="btn gray" onclick="RB.stepHits(-1)">−</button><b style="margin:0 8px">' + m.hits + '</b>' +
      '<button class="btn gray" onclick="RB.stepHits(1)">＋</button>' +
      '<span style="margin-left:14px">E:</span><button class="btn gray" onclick="RB.stepErrs(-1)">−</button><b style="margin:0 8px">' + m.errs + '</b>' +
      '<button class="btn gray" onclick="RB.stepErrs(1)">＋</button>' +
      '<span class="sub" style="margin-left:10px">計 ' + effBases + ' 進塁</span></div>';
  }
  if (needBasesGained) {
    var labels = type === RESULT_HIT ? ['単打', '二塁打', '三塁打', '本塁打'] : ['1', '2', '3', '4'];
    h += '<div class="sectionlabel">' + (type === RESULT_HIT ? '塁打数' : '進塁数（=失策数）') + '</div><div class="grid4">' +
      labels.map(function(l, i){ return selBox(l, m.basesGained === i + 1, 'RB.setPopup(\\'basesGained\\',' + (i + 1) + ')'); }).join('') + '</div>';
  }
  if (needPlayResult) {
    h += '<div class="sectionlabel">打球結果（進塁の判定に使用。フライを1バウンド捕球ならゴロ）</div><div class="grid3">' +
      PLAY_RESULTS.map(function(r){ return selBox(r, m.playResult === r, 'RB.setPopup(\\'playResult\\',' + jsStr(r) + ')'); }).join('') + '</div>';
  }
  if (batted) {
    h += '<div class="sectionlabel">打球方向</div><div class="grid" style="display:grid;grid-template-columns:repeat(5,1fr);gap:6px">' +
      DIR_FIELD.map(function(d){ return selBox(d[1], m.direction === d[0], 'RB.setPopup(\\'direction\\',' + d[0] + ')', true); }).join('') + '</div>' +
      '<div class="spacer8"></div><div class="grid2">' +
      DIR_OTHER.map(function(d){ return selBox(d[1], m.direction === d[0], 'RB.setPopup(\\'direction\\',' + d[0] + ')', true); }).join('') + '</div>';
    h += '<div class="sectionlabel">打球性質（記録用）</div><div class="grid3">' +
      BALL_TYPES.map(function(t){ return selBox(t, m.ballType === t, 'RB.setPopup(\\'ballType\\',' + jsStr(t) + ')'); }).join('') + '</div>';
  }
  h += '<div class="sectionlabel">バット種類</div><div class="grid4">' +
    BAT_DEFS.slice(0, 4).map(function(b){ return batBox(b, m.batType === b.code); }).join('') + '</div>' +
    '<div class="spacer8"></div><div class="grid4">' +
    BAT_DEFS.slice(4).map(function(b){ return batBox(b, m.batType === b.code); }).join('') + '</div>';

  if (batted && !isSqueeze) {
    h += '<div class="sectionlabel">個別状況</div><div class="grid2">' +
      SITUATION_ALL.map(function(s){ return selBox(s, m.situations.indexOf(s) >= 0, 'RB.toggleSituation(' + jsStr(s) + ')'); }).join('') + '</div>';
  }
  if (askTagThird) {
    h += '<div class="sectionlabel">三塁走者のタッチアップ（必須）</div><div class="grid2">' +
      selBox('生還した', m.tagThird === true, 'RB.setPopupBool(\\'tagThird\\',true)') +
      selBox('進まない', m.tagThird === false, 'RB.setPopupBool(\\'tagThird\\',false)') + '</div>';
  }
  if (askTagSecond) {
    h += '<div class="sectionlabel">二塁走者のタッチアップ（必須）</div><div class="grid2">' +
      selBox('三塁へ進んだ', m.tagSecond === true, 'RB.setPopupBool(\\'tagSecond\\',true)') +
      selBox('進まない', m.tagSecond === false, 'RB.setPopupBool(\\'tagSecond\\',false)') + '</div>';
  }
  if (askFumble) {
    h += '<div class="sectionlabel">ワンファンブル（三塁走者の生還／必須）</div><div class="grid2">' +
      selBox('あった（生還）', m.fumble === true, 'RB.setPopupBool(\\'fumble\\',true)') +
      selBox('なし', m.fumble === false, 'RB.setPopupBool(\\'fumble\\',false)') + '</div>';
  }
  if (autoStart) h += '<div class="autostart">⚡ 2アウト フルカウント: 自動スタート適用（フォースされた走者が+1進塁）</div>';

  var baseLabel = ['一', '二', '三'].filter(function(_, i){ return shownBases[i]; }).join('・') || '走者なし';
  h += '<div class="preview"><b>結果後（自動計算・タップで補正可）</b><br>' +
    'アウト ' + shownOuts + ' / 塁: ' + esc(baseLabel) + ' / 得点 +' + shownRuns + ' / 打点 ' + shownRbi + '</div>';

  h += '<div class="sectionlabel"><label><input type="checkbox" ' + (m.manualOverride ? 'checked' : '') +
    ' onchange="RB.toggleManualOverride(this.checked)"> 手動で補正する</label></div>';
  if (m.manualOverride) {
    h += '<div class="grid3">' +
      selBox('一塁', shownBases[0], 'RB.toggleOvBase(0)') +
      selBox('二塁', shownBases[1], 'RB.toggleOvBase(1)') +
      selBox('三塁', shownBases[2], 'RB.toggleOvBase(2)') + '</div>' +
      '<div class="row" style="margin-top:8px;align-items:center">' +
      '<span class="sub">アウト</span><input type="number" min="0" max="3" style="width:56px" value="' + shownOuts + '" onchange="RB.setOv(\\'ovOuts\\',this.value)">' +
      '<span class="sub">得点</span><input type="number" min="0" style="width:56px" value="' + shownRuns + '" onchange="RB.setOv(\\'ovRuns\\',this.value)">' +
      '<span class="sub">打点</span><input type="number" min="0" style="width:56px" value="' + shownRbi + '" onchange="RB.setOv(\\'ovRbi\\',this.value)">' +
      '</div>';
  }

  if (willChangeNow(p, shownOuts)) h += '<div class="warn">⚠ 3アウト目 → 確定と同時にチェンジします</div>';

  h += '<div class="footbtns">' +
    '<button class="btn outline" style="flex:1" onclick="RB.cancelResult()">' + (type === RESULT_BB || type === RESULT_K_SWING || type === RESULT_K_LOOK ? '入力ミス（戻す）' : 'キャンセル') + '</button>' +
    '<button class="btn green" style="flex:2" ' + (canConfirm ? '' : 'disabled') + ' onclick="RB.doConfirmResult(' +
    jsStr(JSON.stringify({
      direction: m.direction, playResult: m.playResult, ballType: m.ballType, batType: m.batType,
      situations: effSituations, basesGained: effBases,
      hits: isNhne ? m.hits : (type === RESULT_HIT ? 1 : 0), errors: errorCount,
      finalBases: shownBases, outsAfter: shownOuts, runs: shownRuns, rbi: shownRbi, batSideOverride: m.batSide
    })) + ')">' + (canConfirm ? '確定' : '未入力あり') + '</button>' +
    '</div>';

  h += '</div></div>';
  return h;
}
function willChangeNow(p, shownOuts){ return p.autoChange || shownOuts >= 3; }

// ================= イベントハンドラ（グローバル公開） =================
var RB = {
  switchSetupTab: switchSetupTab,
  onStadiumInput: function(v){ state.stadium = v; state.stadiumConfirmed = !!v.trim(); saveState(); },
  removeFromOrder: function(team, i){ removeFromOrder(team, i); },
  openAddMember: function(team){
    openMemberPicker({ title: (team === 'first' ? '先攻' : '後攻') + 'に追加', team: team });
  },
  updatePickerQuery: function(v){ modal.query = v; renderModal(); },
  pickMember: function(name){
    var team = modal.team;
    var pos = (modal.insertPos != null) ? modal.insertPos : orderOf(team).length;
    var back = modal.backToOrderEdit;
    insertIntoOrder(team, pos, name);
    if (back) openOrderEdit(team); else closeModal();
  },
  swapOrders: swapOrders,
  setStartPitcher: function(team, name){
    if (team === 'first') state.pitcherOfFirst = name || null; else state.pitcherOfSecond = name || null;
    saveState(); render();
  },
  startGame: startGame,
  addBall: addBall, addStrike: addStrike, addFoul: addFoul,
  confirmStrikeoutChoice: confirmStrikeoutChoice, undoThirdStrike: undoThirdStrike,
  beginResult: beginResult, cancelResult: cancelResult,
  changeSides: changeSides,
  openChangePitcher: function(){
    var def = defendingTeam();
    openPitcherPicker({ title: '投手交代（' + (def === 'first' ? '先攻' : '後攻') + '）', team: def });
  },
  pickPitcher: function(name){ changePitcher(modal.team, name); },
  pickInitialPitcher: function(team, name){ changePitcher(team, name); },
  undoLast: undoLast,
  endGame: endGame,
  newGameAfterEnd: newGameAfterEnd,
  openYt: openYt,
  ytOffset: ytOffset,
  ytCopy: ytCopy,
  ytSaveToSite: ytSaveToSite,
  openOrderEdit: function(){ openOrderEdit(); },
  orderEditTeam: function(t){ modal.team = t; renderModal(); },
  orderEditInsert: function(pos){
    openMemberPicker({ title: '打順 ' + (pos + 1) + ' 番に挿入',
      team: modal.team, insertPos: pos, backToOrderEdit: true });
  },
  orderEditRemove: function(i){
    var team = modal.team;
    var name = orderOf(team)[i];
    if (!window.confirm(name + ' を打順から外します。よろしいですか？')) return;
    removeFromOrder(team, i);
    renderModal();
  },
  closeModal: closeModal,
  closeModalIfBg: function(ev){ if (ev.target.classList.contains('overlay')) closeModal(); },
  setPopup: function(key, val){ modal[key] = val; renderModal(); },
  setPopupBool: function(key, val){ modal[key] = val; renderModal(); },
  setBatType: function(code){ modal.batType = code; renderModal(); },
  toggleSituation: function(s){
    var i = modal.situations.indexOf(s);
    if (i >= 0) modal.situations.splice(i, 1); else modal.situations.push(s);
    renderModal();
  },
  stepHits: function(d){ modal.hits = Math.max(0, Math.min(3, modal.hits + d)); renderModal(); },
  stepErrs: function(d){ modal.errs = Math.max(0, Math.min(3, modal.errs + d)); renderModal(); },
  toggleManualOverride: function(v){
    if (v) { modal.ovBases = null; modal.ovOuts = null; modal.ovRuns = null; modal.ovRbi = null; }
    modal.manualOverride = v; renderModal();
  },
  toggleOvBase: function(i){
    var cur = modal.ovBases || state.bases.slice();
    cur = cur.slice(); cur[i] = !cur[i];
    modal.ovBases = cur; renderModal();
  },
  setOv: function(key, v){ modal[key] = Math.max(0, parseInt(v, 10) || 0); renderModal(); },
  doConfirmResult: function(jsonStr){ confirmResult(JSON.parse(jsonStr)); }
};
window.RB = RB;

// ================= 起動 =================
function boot(){
  fetchRoster().then(function(res){
    if (res && res.ok) roster = res.members || [];
    var saved = loadState();
    state = saved || defaultState();
    if (!state.dateLabel) state.dateLabel = todayStr();
    if (state.started && !state.ended) maybePromptPitcher();
    render();
  }).catch(function(err){
    state = defaultState();
    var diag = '通信方式: ' + (hasGSR() ? 'google.script.run' : 'fetch') + ' / URL: ' + GAS_URL.slice(0, 60) + '…';
    byId('app').innerHTML = '<div class="card"><div class="err">名簿の取得に失敗しました: ' + esc(String(err && err.message ? err.message : err)) + '</div>' +
      '<div class="sub">' + esc(diag) + '</div>' +
      '<button class="btn outline block" style="margin-top:10px" onclick="location.reload()">再読み込み</button>' +
      '<button class="btn gray block" style="margin-top:8px" onclick="RB.bootNoRoster()">名簿なしで開く（手入力）</button></div>';
  });
}
RB.bootNoRoster = function(){
  roster = [];
  var saved = loadState();
  state = saved || defaultState();
  if (!state.dateLabel) state.dateLabel = todayStr();
  render();
};
boot();

})();
</script>
</body></html>`;

  return html;
}
