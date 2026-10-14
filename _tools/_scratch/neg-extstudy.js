// 反向测试：故意把「外部学习数据落库 + 重新分析」改坏，确认 check-extstudy.js 真的会红。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ 别跟 run-all 并发跑：本脚本会临时改坏源码（第 23 条硬约束）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-extstudy.js');
const U = path.join(ROOT, 'uniapp-PWstudy');
const PW = path.join(U, 'utils', 'pwstore.js');
const LINK = path.join(U, 'utils', 'link.js');
const PARTNER = path.join(U, 'utils', 'partner.js');
const HARVEST = path.join(U, 'utils', 'harvest.js');
const COACH = path.join(U, 'utils', 'coach.js');

const FILES = [PW, LINK, PARTNER, HARVEST, COACH];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });
function restore() { Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f])); }

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  let code = 0;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  let crash = null;
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) crash = e; }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  const c = crash ? 99 : (code || process.exitCode || 0);
  process.exitCode = 0;
  return { code: c, buf: buf, crash: crash };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    bad(label + ' —— 注入失败：' + e.message);   // 锚点失效必须当失败（不能"什么都没测还打通过"）
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = runCheck();
  } finally {
    restore();
  }
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0
    && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (r.crash ? '  脚本崩了：' + r.crash.message : '')
    + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
  restore();
}

/** 锚点替换：按目标文件自动转 CRLF（第 33 条），没命中就抛错 */
function swap(cur, file, from, to) {
  const before = cur[file];
  const crlf = before.indexOf('\r\n') >= 0;
  const f = crlf ? from.split('\n').join('\r\n') : from;
  const t = crlf ? to.split('\n').join('\r\n') : to;
  const next = before.replace(f, t);
  if (next === before) throw new Error('锚点没命中：' + from.slice(0, 70));
  cur[file] = next;
}

console.log('反向测试：check-extstudy.js 应该抓到下面这些坏法');
console.log('');

// ---- 0. 元测试：基线必须是绿的 ----
{
  restore();
  const r = runCheck();
  if (r.code === 0) ok('基线：没改坏时 check-extstudy.js 全绿');
  else bad('基线就不是绿的（code=' + r.code + '），下面的结果不可信：' +
    r.buf.filter(l => l.indexOf('✗') >= 0).slice(0, 5).join(' | '));
}

// ---- 1. 只记总数，不记时间范围 ----
shouldCatch('不落明细（只剩一个分钟总数）', (c) => {
  swap(c, LINK, '    pw.addExtStudy(day, {', '    pw.__noop(day, {');
}, 'recordExternal 落明细');

shouldCatch('明细不存完成时刻（只有起点终点）', (c) => {
  swap(c, PW, '    at: to,\n', '');
}, '同时存"完成时刻 at"');

shouldCatch('不倒推起点（没给 from 时范围是空的）', (c) => {
  swap(c, PW, 'let from = Number(r.from) > 0 ? Number(r.from) : to - min * 60000;',
    'let from = Number(r.from) > 0 ? Number(r.from) : to;');
}, '由"完成时刻往前推时长"倒推');

shouldCatch('起点晚于终点也不纠正（框出离谱范围）', (c) => {
  swap(c, PW, '  if (from > to) from = to - min * 60000;\n', '');
}, '起点晚于终点时退回倒推');

// ---- 2. 重复记账 / 明细变总账 ----
shouldCatch('明细里又累加了一份 byApp（两处总数早晚对不上）', (c) => {
  swap(c, PW, '  d.ext.push(item);',
    "  const dd = dayOf(get(), key || today());\n  dd.byApp[PARTNER_KEY_HACK] = (dd.byApp[PARTNER_KEY_HACK] || 0) + min;\n  d.ext.push(item);");
}, 'addExtStudy 不碰 byApp');

// ---- 3. 出发时刻的保鲜期 ----
shouldCatch('呼出去不记出发时刻（回传时拿不到起点）', (c) => {
  swap(c, LINK, '  partner.noteLaunch(task ? (task.id || task.taskId || \'\') : \'\', m);\n', '');
}, '呼出去之前记下出发时刻');

shouldCatch('出发时刻记在 openURL 之后（进程被回收就丢了）', (c) => {
  swap(c, LINK, "  partner.noteLaunch(task ? (task.id || task.taskId || '') : '', m);\n", '');
  swap(c, LINK, '    plus.runtime.openURL(url);\n    return true;',
    "    plus.runtime.openURL(url);\n    partner.noteLaunch('', m);\n    return true;");
}, '出发时刻记在 openURL **之前**');

shouldCatch('出发时刻取走不作废（一次出发配多次回传）', (c) => {
  swap(c, PARTNER, '    if (l && l.at) write({ launch: null });\n', '');
}, '取走即作废');

shouldCatch('出发时刻没有保鲜期（半天都算成在学习）', (c) => {
  swap(c, PARTNER, '    if (Date.now() - Number(l.at) > budget) return null;\n', '');
}, '超出保鲜期就返回 null');

shouldCatch('保鲜期放宽到"当天之内"（框太大）', (c) => {
  swap(c, PARTNER, 'const budget = ((Number(l.minutes) || min || 25) + 60) * 60000;',
    'const budget = 24 * 3600 * 1000;');
}, '保鲜期 = 建议时长 + 60 分钟');

// ---- 4. 分析没接上 ----
shouldCatch('重排不带外部学习数据（存了也不分析）', (c) => {
  swap(c, HARVEST, '  const eb = externalBlock();\n  if (eb) parts.push(eb);\n', '');
}, '重排的 extraBlock 拼进了外部学习数据');

shouldCatch('给 AI 的只有总数、没有时间范围', (c) => {
  swap(c, HARVEST, "pw.spanText(sp.from, sp.to)", "String(sp.min) + ' 分钟'");
}, '给 AI 的是**时间范围**');

shouldCatch('收工对话的底稿里没有外部学习数据（"第二天"看不到）', (c) => {
  swap(c, COACH, '    const ext = pw.extStudySummary(key, 3);', '    const ext = null;');
}, '收工对话的底稿里也有');

shouldCatch('协议认不得 from / to', (c) => {
  swap(c, LINK, '      from: link.params.from,\n      to: link.params.to,\n', '');
}, 'vocab-done 认得 from / to');

console.log('');
console.log(fail === 0 ? '反向测试全部通过 ✓（每条坏法都被抓到了）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
