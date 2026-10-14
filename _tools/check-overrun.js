// _tools/check-overrun.js - 专注「到点转正计时」的校验
// 运行：node _tools/check-overrun.js
//
// 真机反馈（2026-10-14）：「专注模式按照用户预设的时间结束以后计时要继续（正计时），
// 只是没有强制拉回，按钮变成退出，参考专注闹钟」。
//
// 这条改动最容易被人改坏的地方**不是状态机本身**，而是它牵出来的四件事：
//   1) 到点不许收摊（tick / 看门狗 / 被人读到 current() 三条路必须同一个结论 ——
//      各写一套就会出现"在专注页到点不结束、回到首页才结束"）
//   2) 正计时段强制拉回与违规判定必须罢手（不然"不赶人走"是假的）
//   3) 落账口径：人按「退出」→ 预设 + 正计时一起记；进程被杀 → 只认预设时长
//      （把"离开的那几个小时"算成专注时长就是造假）
//   4) 界面不许停在 00:00（首页硬控屏和专注页环心都得显示 +MM:SS，
//      看着就像"计时坏了"）
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');
const { load, loadCode, ROOT } = require('./lib/load');

const FOCUS_JS = path.join(ROOT, 'utils', 'focus.js');
const FORCED = path.join(ROOT, 'utils', 'forced.js');
const STRICT = path.join(ROOT, 'utils', 'strict.js');
const FOCUS_VUE = path.join(ROOT, 'pkgPlan', 'pages', 'focus', 'focus.vue');
const HOME_VUE = path.join(ROOT, 'pages', 'home', 'home.vue');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const fj = fs.readFileSync(FOCUS_JS, 'utf8');
const fd = fs.readFileSync(FORCED, 'utf8');
const st = fs.readFileSync(STRICT, 'utf8');
const fv = fs.readFileSync(FOCUS_VUE, 'utf8');
const hv = fs.readFileSync(HOME_VUE, 'utf8');

/** 先剥注释再扫 —— 自己的正则会命中注释（第 12 条硬约束） */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

/**
 * 切出函数体（配大括号）。
 * ⚠️ 别写有界窗口 `/fn\(\)\{[\s\S]{0,N}x/`（第 22 条硬约束，多插两行就假红）。
 * ⚠️ 两种形态顺序不能反（第 25 条）：先 `export function name(`，再缩进 `    name() {`。
 */
function fnBody(src, name) {
  let m = new RegExp('^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(', 'm').exec(src);
  if (!m) m = new RegExp('^[ \\t]{2,6}' + name + '\\s*\\(', 'm').exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

/* ---------- 1. 状态机：到点不许收摊 ---------- */
console.log('== 1. focus.js 到点转「正计时」==');
const fjS = strip(fj);
assert(/export function stopOverrun\s*\(/.test(fjS), '导出 stopOverrun（正计时的收摊入口）');

const onDue = fnBody(fjS, 'onDue');
assert(/enterOverrun\(/.test(onDue) && /finishExpired\(/.test(onDue),
  'onDue 统一派发：专注 → 正计时，其余 → 收摊');
assert(/state\.phase === 'focus' && !state\.overrun/.test(onDue),
  'onDue 判据带 !state.overrun（已在正计时的不许再进一次）');

const tick = fnBody(fjS, 'tick');
assert(/justOverrun: true/.test(tick), 'tick 返回 justOverrun');
assert(/enterOverrun\(state, false\)/.test(tick), 'tick 到点走 enterOverrun（不是 finishFocus + 清 state）');
assert(!/justFinished: kind/.test(fnBody(fjS, 'tick').split('if (kind === \'focus\')')[0] || ''),
  'tick 里专注分支不再走"到点即收摊"那条老路');

const cur = fnBody(fjS, 'current');
assert(/!state\.overrun/.test(cur) && /onDue\(/.test(cur),
  'current() 也走 onDue（被人读到时不许挂着"剩 0"当没看见）');

const wd = fnBody(fjS, 'armWatchdog');
assert(/state\.overrun/.test(wd) && /onDue\(/.test(wd),
  '看门狗同样走 onDue（切到别的 tab 也推进，不会挂死）');

const eo = fnBody(fjS, 'enterOverrun');
assert(/s\.overrun = true/.test(eo), 'enterOverrun 打 overrun 标记');
assert(/clearWatchdog\(\)/.test(eo), '进正计时就撤掉闹钟（没有终点了，留着只会白响）');
assert(/dueAlert\('focus'/.test(eo), '进正计时照旧响一声（人得知道目标时长到了）');
assert(!/state = null/.test(eo), 'enterOverrun 不清 state（清了就是"到点赶人走"）');

/* ---------- 2. 暂停 / 恢复不许把正计时清零 ---------- */
console.log('== 2. 正计时的读数不被 pause/resume 抹掉 ==');
const pause = fnBody(fjS, 'pause');
assert(/if \(state\.overrun\)/.test(pause) && /state\.overrunMs = overSecOf\(state\)/.test(pause),
  'pause 先把正计时的读数冻结进 overrunMs');
const resume = fnBody(fjS, 'resume');
assert(/if \(state\.overrun\) state\.overrunAt = Date\.now\(\)/.test(resume),
  'resume 给正计时换一个新锚点（否则 endAt 被重算成 now，+08:12 会一夜回到 00:00）');
const snap = fnBody(fjS, 'snapshot');
assert(/overrun: !!state\.overrun/.test(snap) && /overSec: overSecOf\(state\)/.test(snap),
  'snapshot 暴露 overrun / overSec（界面靠它显示 +MM:SS）');
const osec = fnBody(fjS, 'overSecOf');
assert(/s\.paused \? 0 :/.test(osec), 'overSec 在暂停期间冻结（不接着数）');

/* ---------- 3. 落账口径 ---------- */
console.log('== 3. 落账口径 ==');
const so = fnBody(fjS, 'stopOverrun');
assert(/settle\(s, true, Date\.now\(\)\)/.test(so),
  '按「退出」落账 = 完整专注，endAt 取当下（正计时那段一起记进去）');
assert(/bumpRound\(\)/.test(so), '退出时才 bumpRound（专注数与长休轮次都等这一刻）');
const settle = fnBody(fjS, 'settle');
assert(/endAtOverride \|\| \(completed \? s\.endAt : Date\.now\(\)\)/.test(settle),
  'settle 支持显式 endAt（恢复路径只认预设时长的口子）');
const restore = fnBody(fjS, 'restoreIfNeeded');
assert(/finishFocus\(rt, rt\.endAt\)/.test(restore),
  '进程被杀恢复：只按预设时长落账（证明不了人还坐了多久，就不许算）');
const gu = fnBody(fjS, 'giveUp');
assert(/if \(s\.overrun\)[\s\S]*?settle\(s, true, Date\.now\(\)\)/.test(gu),
  '放弃正计时也按"跑满过的专注"记（记成中断会让今日专注数平白少一个）');

/* ---------- 4. 强制 / 严格模式在正计时段罢手 ---------- */
console.log('== 4. 正计时段不再拉回、不再判违规 ==');
const fdS = strip(fd);
assert(/!cur\.overrun/.test(fnBody(fdS, 'sync')), 'forced.sync() 判据带 !cur.overrun');
assert(/cur\.overrun/.test(fnBody(fdS, 'pushConfig')), 'forced.pushConfig() 不下发看门狗');
assert(/cur\.overrun/.test(fnBody(fdS, 'check')), 'forced.check() 见到 overrun 立刻收手');
const stS = strip(st);
assert(/!cur\.overrun/.test(fnBody(stS, 'sync')), 'strict.sync() 判据带 !cur.overrun');
assert(/cur\.overrun/.test(fnBody(stS, 'check')), 'strict.check() 见到 overrun 立刻收手');

/* ---------- 5. 专注页 UI ---------- */
console.log('== 5. 专注页：环心 +MM:SS、按钮变「退出」 ==');
assert(/timeText\(\)\s*\{/.test(fv), '有 timeText 读数（环心那个大号数字）');
assert(/overrun\(\)\s*\{/.test(fv), '有 overrun 计算属性');
assert(/this\.overrun \? 1 :/.test(fnBody(fv, 'ringStyle')), '正计时段环恒为满环（目标已达成）');
assert(/@tap="exitOverrun"/.test(fv), '有「退出」按钮');
assert(/\$t\('退出'\)/.test(fv), '「退出」走了 i18n（不新增裸中文，阈值正卡满）');
// ⚠️ 必须把"条件"和"按钮"锚在同一个块里：只测 `/v-if="active && overrun"/` 的话，
//    按钮被换成别的、或者条件挪到别处，这条照样绿（反向测试抓到过）
assert(/v-if="active && overrun"[^>]*>\s*<button[^>]*@tap="exitOverrun"/.test(fv),
  '正计时段单独一屏：只给退出，不给暂停/放弃');
assert(/over-hint/.test(fv), '有一行说明（不然用户只当"倒计时卡在 00:00"）');
assert(/focus\.stopOverrun\(\)/.test(fnBody(fv, 'exitOverrun')), 'exitOverrun 走状态机的唯一出口');
assert(/cur\.overrun/.test(fnBody(fv, 'onBackPress')), '正计时段返回键放行（不能再把人按在页面里）');
assert(/justOverrun/.test(fnBody(fv, 'tick')), '页面 tick 认得 justOverrun');
assert(/this\.\$t\('已跑满预设时长，不再拉回'\)/.test(fnBody(fv, 'forceLine')),
  '状态条在正计时段改口（不许再说"已就绪 · 离开立刻拉回"）');

/* ---------- 6. 首页硬控屏 ---------- */
console.log('== 6. 首页硬控屏不许停在 00:00 ==');
assert(/lockTime\(\)\s*\{/.test(hv), '有 lockTime 读数');
assert(/\{\{ lockTime \}\}/.test(hv), '硬控屏用 lockTime（不再直接吃 remainSec）');
assert(/v-if="cur\.overrun"[^>]*>\s*<button[^>]*@tap="exitOverrun"/.test(hv),
  '硬控屏在正计时段换成「退出」按钮');
assert(/focus\.stopOverrun\(\)/.test(fnBody(hv, 'exitOverrun')), 'exitOverrun 走状态机的唯一出口');
assert(/cur\.overrun/.test(fnBody(hv, 'onBackPress')), '首页返回键在正计时段放行');
assert(/justOverrun/.test(fnBody(hv, 'tick')), '首页 tick 认得 justOverrun');
assert(!/\{\{ fmtMMSS\(cur\.remainSec\) \}\}/.test(hv), '不再直接渲染 remainSec（正计时时它会恒为 0）');

/* ---------- 7. 真跑：读数 ---------- */
console.log('== 7. 真跑读数（timeText / lockTime）==');

/**
 * 把 .vue 的 <script> 抠出来造一个"能真跑 computed"的实例（第 34 条硬约束的做法）。
 * 比在源码上正则强得多：正则只能证明"有那行代码"，这里能证明
 * overrun → timeText → fmtMMSS 这一整条链真的算出 +08:12。
 */
// ⚠️ 目标必须是**函数**不是 {} —— `mixins: [tabSlideMixin('home')]` 这种
// "默认导入 + 当场调用"的写法，拿普通对象当 Proxy 目标会直接 "is not a function"。
const anyStub = () => new Proxy(function () { return {}; }, {
  get: (t, k) => {
    if (k === 'then' || typeof k === 'symbol') return undefined;
    if (!(k in t)) t[k] = () => ({});
    return t[k];
  }
});
function stubsFor(src) {
  const deps = {};
  const re = /^[ \t]*import\s+([^;]*?)\s+from\s+['"][^'"]+['"];?[ \t]*$/gm;
  let m;
  while ((m = re.exec(src))) {
    const clause = m[1].trim();
    const ns = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(clause);
    if (ns) { deps[ns[1]] = anyStub(); continue; }
    const named = /^\{([^}]*)\}$/.exec(clause);
    if (named) {
      named[1].split(',').map(s => s.trim()).filter(Boolean).forEach(s => {
        const p = s.split(/\s+as\s+/);
        // t() 用恒等函数：t('确定') 原样返回，够这里用
        deps[(p[1] || p[0]).trim()] = (x) => x;
      });
      continue;
    }
    const def = /^([A-Za-z_$][\w$]*)$/.exec(clause);
    if (def) deps[def[1]] = anyStub();
  }
  return deps;
}
function inst(scriptSrc, patch) {
  const mod = loadCode(scriptSrc, stubsFor(scriptSrc), 'inline.vue.js');
  const opt = mod.default || mod;
  const vm = Object.assign({}, typeof opt.data === 'function' ? opt.data() : {}, patch);
  Object.keys(opt.computed || {}).forEach(k =>
    Object.defineProperty(vm, k, { get: () => opt.computed[k].call(vm), configurable: true }));
  Object.keys(opt.methods || {}).forEach(k => { vm[k] = opt.methods[k].bind(vm); });
  return vm;
}
const vueScript = (raw) => {
  const a = raw.indexOf('<script>');
  const b = raw.indexOf('</script>');
  return a < 0 || b < 0 ? '' : raw.slice(a + 8, b);
};

try {
  const a = inst(vueScript(fv), { cur: { overrun: true, overSec: 492, remainSec: 0 } });
  assert(a.timeText === '+08:12', '专注页环心正计时读数 = ' + JSON.stringify(a.timeText));
  const b = inst(vueScript(fv), { cur: { overrun: false, overSec: 0, remainSec: 1500 } });
  assert(b.timeText === '25:00', '专注页环心倒计时刻度 = ' + JSON.stringify(b.timeText));
  const c = inst(vueScript(hv), { cur: { overrun: true, overSec: 61, remainSec: 0 } });
  assert(c.lockTime === '+01:01', '首页硬控屏正计时读数 = ' + JSON.stringify(c.lockTime));
  const d = inst(vueScript(hv), { cur: { overrun: false, overSec: 0, remainSec: 900 } });
  assert(d.lockTime === '15:00', '首页硬控屏倒计时读数 = ' + JSON.stringify(d.lockTime));
  const e = inst(vueScript(hv), { cur: null });
  assert(e.lockTime === '00:00', '没在计时时不炸（= ' + JSON.stringify(e.lockTime) + '）');
} catch (err) {
  bad('造 .vue 实例抛错：' + (err && err.message));
  console.error(err && err.stack);
}

/* ---------- 8. 真跑：状态机 ---------- */
console.log('== 8. 真跑状态机（注入假依赖 + 拨表）==');
// ⚠️ 这一段**故意写成同步的**（没有 await）：async IIFE 里的 throw 会变成 promise
// rejection，反向测试的 require() 接不到退出码、只能读到空的退出码 0（第 27 条硬约束）。
{
  const realNow = Date.now;
  let off = 0;
  Date.now = function () { return realNow.call(Date) + off; };

  const pad = (n) => (n < 10 ? '0' + n : '' + n);
  const dateStr = (d) => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  // ⚠️ 每个用例一份 store：recordPomo 的闭包如果写死指向第一份 store，
  //    第二个用例的断言会静默落空（session 根本没进去，看着像"没落账"）
  const mkDeps = (store) => ({
    pw: {
      get: () => store,
      touch: () => {},
      flush: () => {},
      today: () => dateStr(new Date()),
      dateStr: dateStr,
      recordPomo: (s) => { store.sessions.push(s); },
      addPomoToTask: () => {}
    },
    notify: {
      alert: () => {}, beep: () => {}, vibrate: () => {}, cancelOngoing: () => {},
      requestPermission: () => {}, acquireWake: () => {}, releaseWake: () => {}, showOngoing: () => {}
    },
    settings: { get: () => ({ focus: { notify: false, sound: false, vibe: false, noise: '' } }) },
    fgsvc: { start: () => false, update: () => {}, stop: () => {}, pauseWatch: () => {}, resumeWatch: () => {}, isActive: () => false },
    ambient: { start: () => {}, stop: () => {}, pause: () => {}, resume: () => {} }
  });
  const mkStore = () => ({
    sessions: [], daily: {}, pomoRound: null, pomoCfg: { focus: 25, rest: 5, long: 15, every: 4 }, runtime: null
  });
  global.uni = Object.assign(global.uni || {}, { $emit: () => {}, $on: () => {} });

  try {
    // ① 到点不收摊，退出才落账；落账含正计时那段
    const store = mkStore();
    const f = load('utils/focus.js', mkDeps(store));
    f.current();                                  // 先让 restoreIfNeeded 跑完（App 冷启动那一次）
    off = 0;
    f.startFocus({ minutes: 25, taskTitle: '正计时' });
    off = 25 * 60000;
    const r = f.tick();
    assert(r.justOverrun === true && r.justFinished === null, '到点 → justOverrun=true（不弹"完成"面板）');
    let c = f.current();
    assert(c && c.overrun === true && c.phase === 'focus', '到点后 state 还在（人还在继续）');
    assert(store.sessions.length === 0, '正计时期间还没落账');
    off = 25 * 60000 + 8 * 60000;                 // 又多坐了 8 分钟
    c = f.current();
    assert(c && c.overSec === 480, '正计时读数 = 8 分钟（overSec=' + (c && c.overSec) + '）');
    const s = f.stopOverrun();
    assert(s && s.min === 33 && s.done === true, '退出落账 = 25 + 8 = 33 分钟，done=true');
    assert(f.current() === null, '退出后清场');
    assert(store.pomoRound && store.pomoRound.count === 1, '退出时才 bumpRound（长休轮次靠它）');

    // ② 暂停 / 恢复不许把正计时清零
    const store2 = mkStore();
    const f2 = load('utils/focus.js', mkDeps(store2));
    f2.current();
    const base = off;
    f2.startFocus({ minutes: 25, taskTitle: '暂停保读数' });
    off = base + 25 * 60000;
    f2.tick();                                    // 进正计时
    off = base + 25 * 60000 + 300 * 1000;         // 多坐 5 分钟
    f2.pause();
    const p1 = f2.current();
    off = base + 25 * 60000 + 300 * 1000 + 600 * 1000;   // 暂停了 10 分钟
    const p2 = f2.current();
    assert(p1 && p2 && p2.overSec === p1.overSec && p1.overSec === 300,
      '暂停期间读数冻结（' + (p1 && p1.overSec) + ' = ' + (p2 && p2.overSec) + '）');
    f2.resume();
    off = base + 25 * 60000 + 300 * 1000 + 600 * 1000 + 120 * 1000;
    const p3 = f2.current();
    assert(p3 && p3.overSec === 420, '恢复后接着往上数（300 + 120 = 420 秒，实际 ' + (p3 && p3.overSec) + '）');
    const s2 = f2.stopOverrun();
    assert(s2 && s2.min === 32, '落账 = 25 + 5 + 2 = 32 分钟（暂停那 10 分钟被扣掉，实际 ' + (s2 && s2.min) + '）');

    // ③ 进程被杀恢复：只认预设时长，不把缺席的时间算成专注
    const T0 = realNow.call(Date);
    const store3 = mkStore();
    store3.runtime = {
      phase: 'focus', taskId: '', goalId: '', taskTitle: '被杀了',
      startAt: T0, endAt: T0 + 25 * 60000,
      totalSec: 1500, remainSec: 0, paused: false, pausedMs: 0, pausedAt: 0,
      overrun: true, overrunMs: 0, overrunAt: T0 + 25 * 60000, count: 0
    };
    const f3 = load('utils/focus.js', mkDeps(store3));
    const restored = f3.current();
    assert(restored === null, '恢复后不留现场');
    const s3 = store3.sessions[store3.sessions.length - 1];
    assert(s3 && s3.min === 25, '被杀恢复只落 25 分钟（没把缺席那 30 分钟算进专注时长，实际 ' + (s3 && s3.min) + '）');
  } catch (e) {
    bad('真跑抛错：' + (e && e.message));
    console.error(e && e.stack);
  } finally {
    Date.now = realNow;
  }
}

console.log('');
console.log(fail === 0 ? '正计时校验全部通过 ✓' : '失败 ' + fail + ' 项 ✗');
process.exit(fail === 0 ? 0 : 1);
