// utils/focus.js - 番茄钟状态机（模块级常驻：tab 页不销毁，切页计时不断）
//
// 时间来源统一用"结束时间戳 endAt"而不是倒计数：切页 / 短暂切后台回来时
// 直接用 now 与 endAt 求差，时钟永远是对的。页面只负责每秒调一次 tick()。
// 进程被杀后重启：runtime 里有现场，若 endAt 已过 → 按"完整番茄"补记。
import * as pw from './pwstore.js';
import * as notify from './notify.js';
import * as settings from './settings.js';
import * as fgsvc from './fgsvc.js';
import * as ambient from './ambient.js';

// phase: idle | focus | rest | paused（paused 只在 focus/rest 上叠加）
// state: null = 空闲
let state = null;
let onFinish = null;   // 自然结束回调（页面注册，用于响铃/跳转）
// 上一次专注的任务上下文。番茄跑完时 state 已经被清空，而休息还要知道"刚才在做什么"
let lastCtx = null;

const FINISH_EVENT = 'pw:focus-finish';

// 常驻通知节流：倒计时每秒都在变，不能每秒都 notify（费电、状态栏还会闪）
// 30 秒刷一次足够，暂停/恢复这类状态变化则立即刷。
let lastNotifyText = '';
let lastNotifyAt = 0;

// 看门狗：只有首页和专注页每秒调 tick()，切到"目标/统计/我的"时没人驱动。
// 番茄在那一刻到点就会一直挂在 runtime 里不结算 —— 用户回到首页才补记，
// 中间那段时间首页还显示"专注中"。这里起一个模块级定时器，到点自己结算。
// 模块级 = 切页不销毁（JS 上下文活着），App 真被杀则由 restoreIfNeeded 兜底。
let watchdog = 0;

function clearWatchdog() {
  if (watchdog) { clearTimeout(watchdog); watchdog = 0; }
}

function armWatchdog() {
  clearWatchdog();
  if (!state || state.paused) return;
  const delay = Math.max(1000, state.endAt - Date.now() + 500);
  // setTimeout 的延时上限是 32 位有符号毫秒（约 24.8 天）。番茄不可能那么长，
  // 但万一有人把时长设成离谱的值，别让定时器溢出成"立即触发"。
  if (delay > 0x7fffffff) return;
  watchdog = setTimeout(() => {
    watchdog = 0;
    if (!state) return;
    if (state.paused) return;
    // 后台可能被节流延后触发：没真到点就重新排一次，别提前结算
    if (Date.now() < state.endAt) { armWatchdog(); return; }
    finishExpired(isMissed(state));
  }, delay);
}

/** 是不是"人不在的时候跑完的"：差 15 秒以上才算，否则就是正常到点 */
function isMissed(s) {
  return (Date.now() - s.endAt) > 15000;
}

function fcfg() {
  try {
    return Object.assign({ notify: true, sound: true, vibe: true, wakeLock: false, strict: false, noise: '' },
      (settings.get() && settings.get().focus) || {});
  } catch (e) {
    return { notify: true, sound: true, vibe: true, wakeLock: false, strict: false, noise: '' };
  }
}

function mmss(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** 当前常驻通知该显示什么（专注/休息共用一套文案） */
function ongoingPair() {
  const title = state.phase === 'focus' ? '专注中' : '休息中';
  const head = state.paused ? '已暂停 · ' : '';
  const text = head + (state.taskTitle || (state.phase === 'focus' ? '自由专注' : '休息一下')) +
    ' · 剩 ' + mmss(state.paused ? state.remainSec : (state.endAt - Date.now()) / 1000);
  return { title, text };
}

/**
 * 挂出常驻通知（番茄开始时）：
 * 优先走前台服务（UTS 插件，息屏/后台进程不被杀），插件不可用就退回普通常驻通知。
 */
function startOngoing() {
  if (!state) return;
  if (!fcfg().notify) return;
  const p = ongoingPair();
  lastNotifyText = p.text;
  lastNotifyAt = Date.now();
  if (!fgsvc.start(p.title, p.text)) {
    notify.showOngoing(p);
  }
}

/** 把当前状态刷到常驻通知上（关掉通知 / 非 App 端 = 静默） */
function pushOngoing() {
  if (!state) return;
  if (!fcfg().notify) return;
  const p = ongoingPair();
  const now = Date.now();
  if (p.text === lastNotifyText && now - lastNotifyAt < 30000) return;
  lastNotifyText = p.text;
  lastNotifyAt = now;
  if (fgsvc.isActive()) {
    fgsvc.update(p.title, p.text);     // 前台服务持着同一条通知，直接刷文案
  } else {
    notify.showOngoing(p);
  }
}

/** 结束时收尾：停前台服务 + 撤常驻通知 + 发提醒 + 响铃/震动 */
function finishAlert(kind, missed) {
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  const c = fcfg();
  if (!c.notify) return;
  if (kind === 'focus') {
    notify.alert(missed ? '番茄已完成（刚才不在，已补记）' : '番茄完成！', '休息一下再继续');
  } else {
    notify.alert('休息结束', '回到专注吧');
  }
  if (c.sound) notify.beep();
  if (c.vibe) notify.vibrate();
}

export function onFinishEvent() { return FINISH_EVENT; }

function cfg() {
  return Object.assign({ focus: 25, rest: 5, long: 15, every: 4 }, (pw.get().pomoCfg || {}));
}

export function setCfg(patch) {
  const st = pw.get();
  st.pomoCfg = Object.assign(cfg(), patch || {});
  pw.touch();
}

export function current() {
  restoreIfNeeded();
  // 读到就顺手结算：番茄早就到点了（人切到别的应用 / 停在别的 tab，没人调 tick）
  // 时若原样返回"专注中 + 剩 0"，严格/强制模式会一直以为还在计时 ——
  // 强制模式就会持续把 App 拉回前台并累加违规，第 3 次自动作废还会按超长时长落一条账。
  if (state && !state.paused && Date.now() >= state.endAt) finishExpired(isMissed(state));
  return state ? snapshot() : null;
}

/** 到点了但没人驱动 tick（在别的页面 / 刚回前台 / 看门狗触发）时的结算 */
function finishExpired(missed) {
  if (!state) return;
  clearWatchdog();
  const kind = state.phase;
  const s = state;
  const late = !!missed;
  if (kind === 'focus') finishFocus(s);
  state = null;
  persist();
  lastNotifyText = '';
  notify.releaseWake();
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  finishAlert(kind, late);
  try { uni.$emit(FINISH_EVENT, { kind: kind, missed: late }); } catch (e) {}
  if (onFinish) { try { onFinish(kind); } catch (e) {} }
}

function snapshot() {
  const remain = state.paused
    ? state.remainSec
    : Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
  return {
    phase: state.phase,
    taskId: state.taskId,
    goalId: state.goalId,
    taskTitle: state.taskTitle,
    startAt: state.startAt,
    endAt: state.endAt,
    totalSec: state.totalSec,
    remainSec: remain,
    paused: !!state.paused,
    count: state.count
  };
}

// ---------- 启动 / 暂停 / 停止 ----------
export function startFocus(opt) {
  const c = cfg();
  const min = Number(opt && opt.minutes) > 0 ? Number(opt.minutes) : c.focus;
  state = {
    phase: 'focus',
    taskId: (opt && opt.taskId) || '',
    goalId: (opt && opt.goalId) || '',
    taskTitle: (opt && opt.taskTitle) || '自由专注',
    startAt: Date.now(),
    endAt: Date.now() + min * 60000,
    totalSec: min * 60,
    remainSec: 0,
    paused: false,
    pausedMs: 0,        // 累计暂停时长：落账时要扣掉，否则"停 1 小时再跑完"会被记成 85 分钟
    pausedAt: 0,
    count: 0   // 本轮已完成的专注番茄数（含长休后的累计）
  };
  // 记下这次在做什么：番茄跑完 state 会被清空，休息还得知道"刚才在忙哪件事"
  lastCtx = { taskId: state.taskId, goalId: state.goalId, taskTitle: state.taskTitle };
  persist();
  lastNotifyText = '';
  if (fcfg().notify) notify.requestPermission();
  if (fcfg().wakeLock) notify.acquireWake(min);
  startOngoing();
  if (fcfg().noise) ambient.start(fcfg().noise);
  armWatchdog();
  return snapshot();
}

/* ---------- 本轮番茄计数（长休的依据） ---------- */

/**
 * 今天已经跑完几个番茄。
 *
 * 为什么存在库里而不是 state.count：番茄一结束 state 就被清空，
 * 而"第几个了"必须活到休息开始之后 —— 这正是以前长休永远不触发的根因
 * （startRest 读 state.count，而它恒为 0）。
 * 换天重新数：跨天的"连续番茄"没有意义。
 */
function roundCount() {
  const r = pw.get().pomoRound;
  if (!r || r.date !== pw.today()) return 0;
  return Math.max(0, Math.floor(Number(r.count) || 0));
}

function bumpRound() {
  const st = pw.get();
  const t = pw.today();
  const base = (st.pomoRound && st.pomoRound.date === t)
    ? Math.max(0, Math.floor(Number(st.pomoRound.count) || 0))
    : 0;
  st.pomoRound = { count: base + 1, date: t, at: Date.now() };
  pw.touch();
  return st.pomoRound.count;
}

function everyN() {
  return Math.max(2, Math.floor(Number(cfg().every) || 4));
}

/** 番茄跑完后的休息：每 every 个番茄给一次长休，其余短休 */
export function startRest(opt) {
  const c = cfg();
  const n = roundCount();
  const long = n > 0 && n % everyN() === 0;
  const o = opt || {};
  const ctx = lastCtx || {};
  return startBreak(
    o.minutes || (long ? c.long : c.rest),
    o.taskId || ctx.taskId || '',
    o.goalId || ctx.goalId || '',
    o.taskTitle || ctx.taskTitle || '休息一下',
    n
  );
}

/** 下一段休息该休多久（长休 or 短休）—— 完成页拿它显示"这次是长休" */
export function nextRestMin() {
  const c = cfg();
  return isLongRestNext() ? (c.long || 15) : (c.rest || 5);
}

export function isLongRestNext() {
  const n = roundCount();
  return n > 0 && n % everyN() === 0;
}

/** 本轮进度：第几个番茄 / 几个一次长休 / 下一段是不是长休 */
export function roundInfo() {
  const n = roundCount();
  const e = everyN();
  return { count: n, every: e, longNext: n > 0 && n % e === 0 };
}

/** 独立休息：不依赖"刚跑完一个番茄"，休息本身不落账 */
export function startBreak(minutes, taskId, goalId, taskTitle, count) {
  state = {
    phase: 'rest',
    taskId: taskId || '',
    goalId: goalId || '',
    taskTitle: taskTitle || '休息一下',
    startAt: Date.now(),
    endAt: Date.now() + minutes * 60000,
    totalSec: minutes * 60,
    remainSec: 0,
    paused: false,
    pausedMs: 0,
    pausedAt: 0,
    count: count || 0
  };
  persist();
  lastNotifyText = '';
  if (fcfg().wakeLock) notify.acquireWake(minutes);
  ambient.stop();          // 白噪音只陪专注，休息就停
  startOngoing();
  armWatchdog();
  return snapshot();
}

export function pause() {
  if (!state || state.paused) return;
  state.remainSec = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
  state.paused = true;
  state.pausedAt = Date.now();     // 从这里开始不算专注时长
  persist();
  clearWatchdog();                 // 暂停期间不该结算，恢复时再排
  ambient.pause();
  pushOngoing();
  // 强制模式看门狗也要跟着停：暂停是"我主动想歇会儿"，这时候还把人从别的 App
  // 拽回来就太不讲道理了。恢复时 resume() 会再打开。
  fgsvc.pauseWatch();
}

export function resume() {
  if (!state || !state.paused) return;
  if (state.pausedAt) state.pausedMs = (state.pausedMs || 0) + (Date.now() - state.pausedAt);
  state.pausedAt = 0;
  state.endAt = Date.now() + state.remainSec * 1000;
  state.paused = false;
  persist();
  armWatchdog();
  ambient.resume();
  pushOngoing();
  fgsvc.resumeWatch();
}

/** 手动放弃：满 1 分钟按实际分钟记一条中断会话，不足 1 分钟不记 */
export function giveUp() {
  if (!state) return null;
  const s = state;
  state = null;
  persist();
  clearWatchdog();
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  notify.releaseWake();
  if (s.phase === 'focus') return settle(s, false);
  return null;
}

/**
 * 外部收摊（清数据 / 导入 replace 备份前调用）：不落账，直接停。
 * 与 giveUp() 的区别：giveUp 是人按了「放弃」，满 1 分钟要记一条中断会话；
 * abort 是"这些记录马上就要没了"，记了也是白记。
 */
export function abort() {
  const had = !!state;
  state = null;
  persist();
  clearWatchdog();
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  notify.releaseWake();
  return had;
}

// ---------- 每秒驱动 ----------
// 返回 { state, justFinished: 'focus' | 'rest' | null }
export function tick() {
  restoreIfNeeded();
  if (!state || state.paused) return { state: state ? snapshot() : null, justFinished: null };
  const now = Date.now();
  if (now >= state.endAt) {
    clearWatchdog();
    const kind = state.phase;
    const s = state;
    if (kind === 'focus') {
      finishFocus(s);
    }
    state = null;
    persist();
    notify.releaseWake();
    finishAlert(kind, false);
    try { uni.$emit(FINISH_EVENT, { kind: kind }); } catch (e) {}
    if (onFinish) { try { onFinish(kind); } catch (e) {} }
    return { state: null, justFinished: kind };
  }
  pushOngoing();
  return { state: snapshot(), justFinished: null };
}

/**
 * 专注跑完（自然到点 / 人不在时补记 / 进程被杀后恢复）：
 * 先给本轮计数 +1 —— 长休是按"第几个番茄"触发的，漏了这步它就永远不会来。
 */
function finishFocus(s) {
  bumpRound();
  return settle(s, true);
}

/** 落账一个番茄（完整或提前放弃满 1 分钟） */
function settle(s, completed) {
  const endAt = completed ? s.endAt : Date.now();
  // 净专注时长 = 全程 − 累计暂停。不减的话"跑 25 分钟中途停 1 小时"会被记成 85 分钟，
  // 既污染当天专注分钟数，也污染统计页的时段分布（byHour）。
  const spanMs = Math.max(0, (endAt - s.startAt) - (s.pausedMs || 0));
  const min = Math.floor(spanMs / 60000);
  if (min < 1) return null;
  const session = {
    id: Date.now().toString(36),
    goalId: s.goalId || '',
    taskId: s.taskId || '',
    startAt: s.startAt,
    endAt: endAt,
    min: min,
    done: !!completed
  };
  pw.recordPomo(session);
  // 只有真跑完才记任务番茄：中途放弃的不算完成任务量（与弹窗文案一致），
  // 否则"只剩 1 颗的任务，专注满 1 分钟点放弃"会被 pwstore 判定成已完成
  if (completed && s.taskId && s.goalId) pw.addPomoToTask(s.goalId, s.taskId);
  // 落账后立刻落盘。pwstore 平时是"改内存 + 800ms 节流合并写"，
  // 但番茄结算恰恰是最不能等的那一刻：用户在这一秒划掉后台 / 系统在这一秒回收进程，
  // 这 25 分钟就白坐了（整个 fj_pw_data_v1 是一次性写的，丢就一起丢）。
  // flush 是同步写，代价可以忽略 —— 一次番茄只发生一次。
  try { pw.flush(); } catch (e) {}
  return session;
}

// ---------- 进程被杀后的现场恢复 ----------
function persist() {
  const st = pw.get();
  st.runtime = state;
  pw.touch();
}

let restored = false;
function restoreIfNeeded() {
  if (restored) return;
  restored = true;
  const rt = pw.get().runtime;
  if (!rt || !rt.phase) return;
  if (rt.paused) {
    state = rt;                       // 暂停态原样恢复
  } else if (Date.now() < rt.endAt) {
    state = rt;                       // 还没到点，继续跑
  } else if (rt.phase === 'focus') {
    // 人不在的这段时间跑完了 → 补记
    finishFocus(rt);
    state = null;
    finishAlert('focus', true);
    try { uni.$emit(FINISH_EVENT, { kind: 'focus', missed: true }); } catch (e) {}
  } else {
    state = null;                     // 休息过了就算了
  }
  const st = pw.get();
  st.runtime = state;
  pw.touch();
  // 进程被杀后前台服务和常驻通知都没了：恢复现场时重新挂上；
  // 白噪音同理 —— 专注进行中（且没暂停）就接着放
  if (state) {
    startOngoing();
    if (state.phase === 'focus' && !state.paused && fcfg().noise) {
      ambient.start(fcfg().noise);
    }
    armWatchdog();      // 恢复现场后接着看时间
  }
}

export function registerFinish(fn) { onFinish = fn; }
