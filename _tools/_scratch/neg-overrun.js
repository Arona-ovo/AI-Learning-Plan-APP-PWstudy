// 反向测试：故意把「专注到点转正计时」改坏，确认 check-overrun.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ process.exit() 与 process.exitCode 两条退出口径都要收（有的守卫只写后者）。
// ⚠️ 别跟 run-all 并发跑：本脚本会临时改坏源码（第 23 条硬约束）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-overrun.js');
const U = path.join(ROOT, 'uniapp-PWstudy');
const FJ = path.join(U, 'utils', 'focus.js');
const FORCED = path.join(U, 'utils', 'forced.js');
const STRICT = path.join(U, 'utils', 'strict.js');
const FV = path.join(U, 'pkgPlan', 'pages', 'focus', 'focus.vue');
const HV = path.join(U, 'pages', 'home', 'home.vue');

const FILES = [FJ, FORCED, STRICT, FV, HV];
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

/** 改坏 → 跑 → 断言"被抓到"。红条数必须 > 0：一条都没有说明是脚本崩了，不是断言命中 */
function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    // 锚点失效（源码改过了）必须当成失败 —— 只当警告的话会出现"什么都没测还打通过"（已踩）
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  let r;
  try {
    r = runCheck();
  } finally {
    restore();   // 无论如何都还原，别把改坏的源码留在工作区
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

/**
 * 锚点替换：换了必须真的生效，否则抛错。
 * ⚠️ 必须按目标文件自动转 CRLF（第 33 条）：仓库里有的文件 CRLF、有的 LF，
 *    同一个 harness 会各踩一半，而且"注入失败"会被误读成"没被抓到"。
 */
function swap(cur, file, from, to) {
  const before = cur[file];
  const crlf = before.indexOf('\r\n') >= 0;
  const f = crlf ? from.split('\n').join('\r\n') : from;
  const t = crlf ? to.split('\n').join('\r\n') : to;
  const next = before.replace(f, t);
  if (next === before) throw new Error('锚点没命中：' + from.slice(0, 70));
  cur[file] = next;
}

console.log('反向测试：check-overrun.js 应该抓到下面这些坏法');
console.log('');

// ---- 0. 元测试：基线必须是绿的（不然下面的"红"可能是别的东西弄红的）----
{
  restore();
  const r = runCheck();
  if (r.code === 0) ok('基线：没改坏时 check-overrun.js 全绿');
  else bad('基线就不是绿的（code=' + r.code + '），下面的结果不可信：' +
    r.buf.filter(l => l.indexOf('✗') >= 0).slice(0, 5).join(' | '));
}

// ---- 1. 回到"到点即收摊"的老路 ----
shouldCatch('tick 到点不再转「正计时」（回到 finishExpired）', (c) => {
  swap(c, FJ, '      enterOverrun(state, false);', '      finishExpired(false);');
}, 'tick 到点走 enterOverrun');

shouldCatch('current() 不再推进正计时（挂着"剩 0"装没看见）', (c) => {
  swap(c, FJ, 'if (state && !state.paused && !state.overrun && Date.now() >= state.endAt) onDue(isMissed(state));',
    'if (state && !state.paused && !state.overrun && false) finishExpired(isMissed(state));');
}, 'current() 也走 onDue');

shouldCatch('看门狗不再走 onDue（切到别的 tab 就挂死）', (c) => {
  swap(c, FJ, '    onDue(isMissed(state));\n  }, delay);', '    finishExpired(isMissed(state));\n  }, delay);');
}, '看门狗同样走 onDue');

// ---- 2. 正计时的读数被抹掉 ----
shouldCatch('pause 忘了冻结正计时读数', (c) => {
  swap(c, FJ, '  if (state.overrun) {\n    state.overrunMs = overSecOf(state);', '  if (false) {\n    state.overrunMs = 0;');
}, 'pause 先把正计时的读数冻结');

shouldCatch('resume 忘了换锚点（+08:12 一夜回到 00:00）', (c) => {
  swap(c, FJ, '  if (state.overrun) state.overrunAt = Date.now();\n', '');
}, 'resume 给正计时换一个新锚点');

shouldCatch('snapshot 不再暴露 overSec', (c) => {
  swap(c, FJ, '    overSec: overSecOf(state),', '');
}, 'snapshot 暴露 overrun / overSec');

shouldCatch('overSec 在暂停期间还接着数', (c) => {
  swap(c, FJ, '  const live = s.paused ? 0 :', '  const live = ');
}, 'overSec 在暂停期间冻结');

// ---- 3. 落账口径 ----
shouldCatch('退出时不带上正计时那段（只落预设时长）', (c) => {
  swap(c, FJ, '  return settle(s, true, Date.now());\n}', '  return settle(s, true);\n}');
}, '按「退出」落账');

shouldCatch('退出时忘了 bumpRound（长休永远轮不到）', (c) => {
  swap(c, FJ, '  if (s.phase !== \'focus\') return null;\n  bumpRound();',
    '  if (s.phase !== \'focus\') return null;');
}, '退出时才 bumpRound');

shouldCatch('被杀恢复改成按当下落账（把缺席的时间算成专注）', (c) => {
  swap(c, FJ, 'finishFocus(rt, rt.endAt);', 'finishFocus(rt);');
}, '进程被杀恢复');

shouldCatch('放弃正计时被记成中断会话', (c) => {
  swap(c, FJ, '  if (s.overrun) {\n    bumpRound();\n    return settle(s, true, Date.now());\n  }\n  return settle(s, false);',
    '  return settle(s, false);');
}, '放弃正计时也按');

// ---- 4. 强制 / 严格模式没罢手 ----
shouldCatch('forced.sync() 忘了判 overrun（还在拉回）', (c) => {
  swap(c, FORCED, 'cur && !cur.paused && !cur.overrun && cur.phase === \'focus\'',
    'cur && !cur.paused && cur.phase === \'focus\'');
}, 'forced.sync() 判据带 !cur.overrun');

shouldCatch('forced.check() 见到 overrun 不收手', (c) => {
  swap(c, FORCED, '!cur || cur.paused || cur.overrun || cur.phase !== \'focus\'',
    '!cur || cur.paused || cur.phase !== \'focus\'');
}, 'forced.check() 见到 overrun 立刻收手');

shouldCatch('strict.sync() 忘了判 overrun（还在判违规）', (c) => {
  swap(c, STRICT, 'cur && !cur.paused && !cur.overrun && cur.phase === \'focus\'',
    'cur && !cur.paused && cur.phase === \'focus\'');
}, 'strict.sync() 判据带 !cur.overrun');

// ---- 5. 界面停在 00:00 / 按钮没换 ----
shouldCatch('专注页环心回到 remainSec（正计时显示 00:00）', (c) => {
  swap(c, FV, '      return this.overrun ? \'+\' + this.fmtMMSS(this.overSec) : this.fmtMMSS(this.remainSec)',
    '      return this.fmtMMSS(this.remainSec)');
}, '专注页环心正计时读数');

shouldCatch('首页硬控屏回到 remainSec（正计时显示 00:00）', (c) => {
  swap(c, HV, '      return c.overrun ? \'+\' + this.fmtMMSS(Number(c.overSec) || 0) : this.fmtMMSS(c.remainSec)',
    '      return this.fmtMMSS(c.remainSec)');
}, '首页硬控屏正计时读数');

shouldCatch('首页硬控屏没有「退出」按钮', (c) => {
  swap(c, HV, '        <view v-if="cur.overrun" class="lock-ctrl">', '        <view v-if="false" class="lock-ctrl">');
}, '硬控屏在正计时段换成「退出」按钮');

shouldCatch('首页退出不走状态机（专注白跑）', (c) => {
  swap(c, HV, '      focus.stopOverrun()', '      focus.abort()');
}, 'exitOverrun 走状态机的唯一出口');

shouldCatch('专注页返回键在正计时段仍拦人', (c) => {
  swap(c, FV, 'if (!this.cur || this.cur.paused || this.cur.overrun || this.cur.phase !== \'focus\') return false',
    'if (!this.cur || this.cur.paused || this.cur.phase !== \'focus\') return false');
}, '正计时段返回键放行');

shouldCatch('状态条在正计时段仍说"已就绪 · 离开立刻拉回"', (c) => {
  swap(c, FV, '      if (this.overrun) s = this.$t(\'已跑满预设时长，不再拉回\')\n', '');
}, '状态条在正计时段改口');

shouldCatch('满环判定丢了（正计时环是空的）', (c) => {
  swap(c, FV, 'const pct = this.overrun ? 1 : (total > 0 ? Math.max(0, Math.min(1, 1 - remain / total)) : 0)',
    'const pct = total > 0 ? Math.max(0, Math.min(1, 1 - remain / total)) : 0');
}, '正计时段环恒为满环');

console.log('');
console.log(fail === 0 ? '反向测试全部通过 ✓（每条坏法都被抓到了）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
