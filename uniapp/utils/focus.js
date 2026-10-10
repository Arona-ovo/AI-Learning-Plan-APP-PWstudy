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

const FINISH_EVENT = 'pw:focus-finish';

// 常驻通知节流：倒计时每秒都在变，不能每秒都 notify（费电、状态栏还会闪）
// 30 秒刷一次足够，暂停/恢复这类状态变化则立即刷。
let lastNotifyText = '';
let lastNotifyAt = 0;

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
  return state ? snapshot() : null;
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
    count: 0   // 本轮已完成的专注番茄数（含长休后的累计）
  };
  persist();
  lastNotifyText = '';
  if (fcfg().notify) notify.requestPermission();
  if (fcfg().wakeLock) notify.acquireWake(min);
  startOngoing();
  if (fcfg().noise) ambient.start(fcfg().noise);
  return snapshot();
}

export function startRest() {
  if (!state) return null;
  const c = cfg();
  const n = (state.count || 0) + 1;
  const min = (n % (c.every || 4) === 0) ? c.long : c.rest;
  return startBreak(min, state.taskId, state.goalId, state.taskTitle, n);
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
    count: count || 0
  };
  persist();
  lastNotifyText = '';
  if (fcfg().wakeLock) notify.acquireWake(minutes);
  ambient.stop();          // 白噪音只陪专注，休息就停
  startOngoing();
  return snapshot();
}

export function pause() {
  if (!state || state.paused) return;
  state.remainSec = Math.max(0, Math.round((state.endAt - Date.now()) / 1000));
  state.paused = true;
  persist();
  ambient.pause();
  pushOngoing();
}

export function resume() {
  if (!state || !state.paused) return;
  state.endAt = Date.now() + state.remainSec * 1000;
  state.paused = false;
  persist();
  ambient.resume();
  pushOngoing();
}

/** 手动放弃：满 1 分钟按实际分钟记一条中断会话，不足 1 分钟不记 */
export function giveUp() {
  if (!state) return null;
  const s = state;
  state = null;
  persist();
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
    const kind = state.phase;
    const s = state;
    if (kind === 'focus') {
      settle(s, true);
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

/** 落账一个番茄（完整或提前放弃满 1 分钟） */
function settle(s, completed) {
  const endAt = completed ? s.endAt : Date.now();
  const min = Math.floor((endAt - s.startAt) / 60000);
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
  if (s.taskId && s.goalId) pw.addPomoToTask(s.goalId, s.taskId);
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
    settle(rt, true);
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
  }
}

export function registerFinish(fn) { onFinish = fn; }
