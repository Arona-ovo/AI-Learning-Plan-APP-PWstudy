// utils/focus.js - 专注计时状态机（模块级常驻：tab 页不销毁，切页计时不断）
//
// 时间来源统一用"结束时间戳 endAt"而不是倒计数：切页 / 短暂切后台回来时
// 直接用 now 与 endAt 求差，时钟永远是对的。页面只负责每秒调一次 tick()。
// 进程被杀后重启：runtime 里有现场，若 endAt 已过 → 按"完整专注"补记。
import * as pw from './pwstore.js';
import * as notify from './notify.js';
import * as settings from './settings.js';
import * as fgsvc from './fgsvc.js';
import * as ambient from './ambient.js';
import * as loc from './location.js';
import * as apptime from './apptime.js';
import * as leisure from './leisure.js';
import { t } from './i18n.js';

// phase: idle | focus | rest | paused（paused 只在 focus/rest 上叠加）
// state: null = 空闲
//
// overrun = 专注跑满预设时长之后的「正计时」段（2026-10-14 真机反馈）：
//   专注闹钟的做法是"时间到了不赶人走"——预设的 25 分钟只是这一轮的下限，
//   人还想接着学就让它继续往上数，想把这一轮合上就自己按「退出」。
//   所以到点**不收摊**：响铃照旧（让人知道目标时长到了），但 state 继续活着，
//   环上改显示"已经多坐了多久"，强制/严格模式在这一段一律罢手（不再拉回、不再判违规）。
//   落账推迟到「退出」—— 这样正计时那段能一起记进去，今日时长才对得上。
let state = null;
let onFinish = null;   // 自然结束回调（页面注册，用于响铃/跳转）
// 上一次专注的任务上下文。专注跑完时 state 已经被清空，而休息还要知道"刚才在做什么"
let lastCtx = null;

const FINISH_EVENT = 'pw:focus-finish';

// 常驻通知节流：倒计时每秒都在变，不能每秒都 notify（费电、状态栏还会闪）
// 30 秒刷一次足够，暂停/恢复这类状态变化则立即刷。
let lastNotifyText = '';
let lastNotifyAt = 0;

// 看门狗：只有首页和专注页每秒调 tick()，切到"目标/统计/我的"时没人驱动。
// 专注在那一刻到点就会一直挂在 runtime 里不结算 —— 用户回到首页才补记，
// 中间那段时间首页还显示"专注中"。这里起一个模块级定时器，到点自己结算。
// 模块级 = 切页不销毁（JS 上下文活着），App 真被杀则由 restoreIfNeeded 兜底。
let watchdog = 0;

/* ---------- 专注期拦截通知（通知使用权，番茄ToDo 同款） ----------
 *
 * 专注期间把别家 App 的通知**捕获并当场撤下**（下拉通知栏也看不到），
 * 专注结束把攒下的汇总成一条"已拦截 N 条"的通知发出来（用户截图同款）。
 *
 * notifHeld 是"我们真的开始拦了"的记账 —— 只有它为 true 时结束才发汇总。
 * 没拦过却发"已拦截 0 条"是打扰，所以这个标记不能省。
 * 原生侧的捕获 + 当场撤下在 UTS 插件的 PWNotifListener 里，JS 一律走 fgsvc。
 */
let notifHeld = false;

/** 专注开始 / 恢复：要不要开始拦截（设置开了 + 用户已授权，两者缺一都不碰系统） */
function notifEnter() {
  try {
    if (!fcfg().blockNotif) return;
    if (fgsvc.interceptStart()) notifHeld = true;
  } catch (e) {}
}

/**
 * 所有收摊 / 暂停路径都要调：停止拦截，把攒下的汇总发出去。
 * @param {boolean} announce 专注真的完成时才发汇总通知；放弃 / 暂停只默默收兵
 */
function notifLeave(announce) {
  if (!notifHeld) return;
  notifHeld = false;
  let list = [];
  try { list = fgsvc.interceptEnd(); } catch (e) { list = []; }
  if (!announce || !list.length) return;
  // 汇总一条：标题报总数，正文把每条"应用：标题"串起来（用户截图同款的信息量）
  const lines = list.map(x => ((x && x.app) || '?') + '：' + ((x && x.title) || ''));
  notify.alert(t('已拦截 {n} 条通知', { n: list.length }), lines.join('\n'));
}

function clearWatchdog() {
  if (watchdog) { clearTimeout(watchdog); watchdog = 0; }
}

function armWatchdog() {
  clearWatchdog();
  if (!state || state.paused) return;
  const delay = Math.max(1000, state.endAt - Date.now() + 500);
  // setTimeout 的延时上限是 32 位有符号毫秒（约 24.8 天）。专注不可能那么长，
  // 但万一有人把时长设成离谱的值，别让定时器溢出成"立即触发"。
  if (delay > 0x7fffffff) return;
  watchdog = setTimeout(() => {
    watchdog = 0;
    if (!state) return;
    if (state.paused) return;
    if (state.overrun) return;             // 正计时没有终点，不再需要闹钟
    // 后台可能被节流延后触发：没真到点就重新排一次，别提前结算
    if (Date.now() < state.endAt) { armWatchdog(); return; }
    onDue(isMissed(state));
  }, delay);
}

/** 是不是"人不在的时候跑完的"：差 15 秒以上才算，否则就是正常到点 */
function isMissed(s) {
  return (Date.now() - s.endAt) > 15000;
}

function fcfg() {
  try {
    return Object.assign({ notify: true, sound: true, vibe: true, wakeLock: false, strict: false, noise: '', blockNotif: false, autoRest: true, capsule: false },
      (settings.get() && settings.get().focus) || {});
  } catch (e) {
    return { notify: true, sound: true, vibe: true, wakeLock: false, strict: false, noise: '', blockNotif: false, autoRest: true, capsule: false };
  }
}

function mmss(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/** 正计时已经多坐了多久（秒）。暂停期间冻结在 overrunMs 上，恢复时换个锚点接着数 */
function overSecOf(s) {
  if (!s || !s.overrun) return 0;
  const live = s.paused ? 0 : Math.max(0, Math.round((Date.now() - (s.overrunAt || s.endAt)) / 1000));
  return (Number(s.overrunMs) || 0) + live;
}

/** 当前常驻通知该显示什么（专注/休息共用一套文案） */
function ongoingPair() {
  const title = state.phase === 'focus' ? '专注中' : '休息中';
  const head = state.paused ? '已暂停 · ' : '';
  const tail = state.overrun
    ? ' · 超时 ' + mmss(overSecOf(state))
    : ' · 剩 ' + mmss(state.paused ? state.remainSec : (state.endAt - Date.now()) / 1000);
  const text = head + (state.taskTitle || (state.phase === 'focus' ? '自由专注' : '休息一下')) + tail;
  return { title, text };
}

/* ---------- 悬浮灵动岛倒计时胶囊 ----------
 *
 * 与强制模式遮罩**完全独立**：用户授了悬浮窗权限 + 打开「灵动岛」开关，且本 App 退到后台时，
 * 就挂出一条倒计时胶囊；点一下胶囊 = 把 PWstudy 拉回前台（复用强制模式的 PullNowTask 拉回链路）。
 * 本 App 在前台时立刻撤掉（前台已有圆盘倒计时，不重复显示）。
 *
 * 文案现算：倒计时永远在，阶段标签（专注中/休息中/已暂停/超时）按长度动态取舍；
 * 胶囊装不下就只留倒计时（+超时后缀），不硬塞。
 * 但 App 退到后台后 WebView 的 JS 计时器被系统挂起、tick 不跑了，所以**倒计时交给原生自转**：
 * 把终点 endAt 与阶段前缀 label 交给原生，原生每秒拼 "label + mmss(剩余)"。
 * 暂停 / 正计时这类 JS 才动得了的状态，endAt 传 0 —— 原生不自转，只显示 JS 算好的静态文案。
 */

let capsuleShown = false;   // 上次实际想要的状态：避免每秒都重挂 / 重撤

/**
 * 算出胶囊该显示的 { txt, label, endAt }：
 *   txt    —— 即时兜底文案（首帧 / 静态态直接显示）
 *   label  —— 阶段前缀（"专注中 " / "休息中 "），原生自转时拼在剩余时间前
 *   endAt  —— 倒计时终点（ms）；0 表示不让原生自转（暂停 / 正计时段由 JS 静态显示）
 */
function capsuleContent() {
  if (!state) return { txt: '', label: '', endAt: 0 };
  const focusWord = t('专注中');
  const restWord = t('休息中');
  const pauseWord = t('已暂停');
  const overWord = t('超时');
  const phaseWord = state.phase === 'focus' ? focusWord : restWord;
  let timeStr;
  let endAt = 0;
  if (state.overrun) {
    timeStr = mmss(overSecOf(state));   // 正计时：JS 不在后台也数不动，静态显示
  } else if (state.paused) {
    timeStr = mmss(state.remainSec);    // 暂停冻结：endAt=0，不自转
  } else {
    endAt = state.endAt;                 // 正常倒计时：交给原生自己数秒
    timeStr = mmss(Math.max(0, Math.round((state.endAt - Date.now()) / 1000)));
  }
  const overSuffix = state.overrun ? (' · ' + overWord) : '';
  const head = state.paused ? (pauseWord + ' · ' + phaseWord + ' ') : (phaseWord + ' ');
  const full = head + timeStr + overSuffix;
  const txt = full.length <= 16 ? full : (timeStr + overSuffix);  // 太长就退化为只留倒计时
  return { txt, label: head, endAt };
}

/**
 * 把胶囊该不该显示对齐到当前状态（幂等）。四个闸门全开才显示：
 *   ① 设置里「灵动岛」开关打开；② 有专注 / 休息在进行；
 *   ③ 本 App 此刻在后台（前台有圆盘，不重复）；④ 用户授了悬浮窗权限。
 * 任何一处不满足都撤掉。App.vue 的 onShow / onHide 与每秒 tick 都会调它。
 */
export function syncCapsule() {
  let want = false;
  let txt = '', label = '', endAt = 0;
  try {
    want = !!fcfg().capsule
      && !!state
      && (state.phase === 'focus' || state.phase === 'rest')
      && !apptime.isAppForeground()
      && fgsvc.capsuleGranted();
  } catch (e) { want = false; }
  if (want) {
    const r = capsuleContent();
    txt = r.txt; label = r.label; endAt = r.endAt;
  }
  if (want) {
    if (capsuleShown) fgsvc.capsuleUpdate(txt, endAt, label);
    else { fgsvc.capsuleShow(txt, endAt, label); capsuleShown = true; }
  } else if (capsuleShown) {
    fgsvc.capsuleHide();
    capsuleShown = false;
  }
}

/**
 * 挂出常驻通知（专注开始时）：
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

/**
 * 到点的那一声：发提醒 + 响铃 + 震动。
 * ⚠️ 只出声，不动前台服务与常驻通知 —— 正计时那一段还要接着显示"超时多久"。
 */
function dueAlert(kind, missed, overrun) {
  const c = fcfg();
  if (!c.notify) return;
  if (kind === 'focus') {
    if (overrun) {
      notify.alert('专注时间到', '已跑满设定时长，还想接着学就继续，想收就点「退出」');
    } else {
      notify.alert(missed ? '专注已完成（刚才不在，已补记）' : '专注完成！', '休息一下再继续');
    }
  } else {
    notify.alert('休息结束', '回到专注吧');
  }
  if (c.sound) notify.beep();
  if (c.vibe) notify.vibrate();
}

/** 真收摊：停前台服务 + 撤常驻通知 + 停白噪音 + 到点的那一声 */
function finishAlert(kind, missed) {
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  dueAlert(kind, missed, false);
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
  // 读到就顺手推进：专注早就到点了（人切到别的应用 / 停在别的 tab，没人调 tick）
  // 时若原样返回"专注中 + 剩 0"，严格/强制模式会一直以为还在计时 ——
  // 强制模式就会持续把 App 拉回前台并累加违规，第 3 次自动作废还会按超长时长落一条账。
  // 专注同理不能一直挂着"剩 0"：要么进正计时（overrun），要么（休息）直接收摊。
  if (state && !state.paused && !state.overrun && Date.now() >= state.endAt) onDue(isMissed(state));
  syncCapsule();
  return state ? snapshot() : null;
}

/**
 * 到点：专注 → 转「正计时」继续跑；休息 → 直接收摊。
 * 三个驱动源（页面 tick / 看门狗 / 被人读到）都走这里，保证行为一致 ——
 * 各写一套必然出现"在专注页到点不结束、回到首页才结束"这种分裂。
 */
function onDue(missed) {
  if (!state) return;
  if (state.phase === 'focus' && !state.overrun) {
    enterOverrun(state, missed);
    return;
  }
  finishExpired(missed);
}

/**
 * 进入正计时：预设时长跑满，但不赶人走。
 *
 * 落账故意推迟到「退出」—— 这样正计时那段能跟预设段合成一条完整会话，
 * 今日专注分钟数才对得上人真实坐下来的时间（不然"多坐 10 分钟"在统计里凭空消失）。
 * 代价是这一刻**不能**算"已完成"：专注数、任务专注进度、长休轮次都要等退出才记。
 */
function enterOverrun(s, missed) {
  if (!s || s.overrun) return;
  s.overrun = true;
  s.overrunMs = 0;
  s.overrunAt = Date.now();
  persist();
  clearWatchdog();          // 正计时没有终点，闹钟留着只会白响
  lastNotifyText = '';
  dueAlert('focus', !!missed, true);
  syncCapsule();
  try { uni.$emit(FINISH_EVENT, { kind: 'focus', missed: !!missed, overrun: true }); } catch (e) {}
}

/**
 * 正计时收摊：专注早就跑满了，所以按「完整专注」落账，
 * 并把正计时那段一起算进去（endAt 用当下而不是 s.endAt）。
 */
export function stopOverrun() {
  if (!state || !state.overrun) return null;
  const s = state;
  state = null;
  syncCapsule();
  persist();
  clearWatchdog();
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  notify.releaseWake();
  if (s.phase !== 'focus') return null;
  bumpRound();
  const r = settle(s, true, Date.now());
  notifLeave(true);
  return r;
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
  syncCapsule();
  persist();
  lastNotifyText = '';
  notifLeave(kind === 'focus');
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
    overrun: !!state.overrun,
    overSec: overSecOf(state),
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
    overrun: false,     // 预设时长已跑满、正在正计时
    overrunMs: 0,       // 正计时的累计秒数（暂停期间冻结在这里）
    overrunAt: 0,       // 本段正计时的起点（恢复时换锚点）
    count: 0   // 本轮已完成的专注数（含长休后的累计）
  };
  // 记下这次在做什么：专注跑完 state 会被清空，休息还得知道"刚才在忙哪件事"
  lastCtx = { taskId: state.taskId, goalId: state.goalId, taskTitle: state.taskTitle };
  persist();
  lastNotifyText = '';
  if (fcfg().notify) notify.requestPermission();
  if (fcfg().wakeLock) notify.acquireWake(min);
  startOngoing();
  if (fcfg().noise) ambient.start(fcfg().noise);
  notifEnter();
  armWatchdog();
  rangeMark();
  syncCapsule();
  return snapshot();
}

/**
 * 记一次"这会儿在不在学习范围"。
 *
 * 只在**专注开始**和**专注结束**（见 finishFocus）这两个点强制取样 ——
 * force，不受 5 分钟节流限制：这才是"人到底在不在"最该记的时刻。
 * 开始在这儿、结束也在这儿，那这一整段大概率都在；中间出去过的话，
 * 出去时 App 通常已经不在前台，靠 App.vue onShow 那条线补上。
 *
 * 全程 try/catch：定位是锦上添花的功能，它出任何问题都不该影响专注计时 ——
 * 计时是这 App 的主业，一个可选的统计不该有能力把它拖挂。
 */
function rangeMark() {
  try { loc.checkNow(true); } catch (e) {}
}

/* ---------- 本轮专注计数（长休的依据） ---------- */

/**
 * 今天已经跑完几段专注。
 *
 * 为什么存在库里而不是 state.count：专注一结束 state 就被清空，
 * 而"第几个了"必须活到休息开始之后 —— 这正是以前长休永远不触发的根因
 * （startRest 读 state.count，而它恒为 0）。
 * 换天重新数：跨天的"连续专注"没有意义。
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

/** 专注跑完后的休息：每 every 段专注给一次长休，其余短休 */
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

/** 本轮进度：第几段专注 / 几个一次长休 / 下一段是不是长休 */
export function roundInfo() {
  const n = roundCount();
  const e = everyN();
  return { count: n, every: e, longNext: n > 0 && n % e === 0 };
}

/** 独立休息：不依赖"刚跑完一段专注"，休息本身不落账 */
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
    overrun: false,     // 休息到点就结束，不做正计时（字段留着是让 snapshot 形状稳定）
    overrunMs: 0,
    overrunAt: 0,
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
  // 正计时的读数必须自己冻结：下面 resume() 会把 endAt 重算成 now + remainSec（= now），
  // 若只靠 endAt 推，暂停再恢复会把"已经多坐了多久"清零 —— 环上的 +08:12 一夜回到 00:00。
  if (state.overrun) {
    state.overrunMs = overSecOf(state);
    state.overrunAt = Date.now();
  }
  state.paused = true;
  state.pausedAt = Date.now();     // 从这里开始不算专注时长
  persist();
  clearWatchdog();                 // 暂停期间不该结算，恢复时再排
  ambient.pause();
  // 暂停是"我主动想歇会儿"，这时候还替人挡着通知就没道理了
  notifLeave(false);
  pushOngoing();
  // 强制模式看门狗也要跟着停：暂停是"我主动想歇会儿"，这时候还把人从别的 App
  // 拽回来就太不讲道理了。恢复时 resume() 会再打开。
  fgsvc.pauseWatch();
  syncCapsule();
}

export function resume() {
  if (!state || !state.paused) return;
  if (state.pausedAt) state.pausedMs = (state.pausedMs || 0) + (Date.now() - state.pausedAt);
  state.pausedAt = 0;
  state.endAt = Date.now() + state.remainSec * 1000;
  if (state.overrun) state.overrunAt = Date.now();
  state.paused = false;
  persist();
  armWatchdog();
  ambient.resume();
  // 免打扰只陪专注：休息阶段本来就该让人看到通知
  if (state.phase === 'focus') notifEnter();
  pushOngoing();
  fgsvc.resumeWatch();
  syncCapsule();
}

/** 手动放弃：满 1 分钟按实际分钟记一条中断会话，不足 1 分钟不记 */
export function giveUp() {
  if (!state) return null;
  const s = state;
  state = null;
  syncCapsule();
  persist();
  clearWatchdog();
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  notify.releaseWake();
  if (s.phase !== 'focus') return null;
  // 正计时段被放弃也是"跑满过的专注"：专注早就达标了，不能记成中断会话
  //（记成中断的话，任务专注进度与今日专注数都会少一个，而人明明坐满了）。
  if (s.overrun) {
    bumpRound();
    const r = settle(s, true, Date.now());
    notifLeave(true);
    return r;
  }
  const r = settle(s, false);
  notifLeave(false);
  return r;
}

/**
 * 「提前完成计时」：没跑满预设时长，但按**已学时长正常落账**（done = true）。
 *
 * 与 giveUp() 的区别正是番茄ToDo 那个二选一要表达的东西：
 *   giveUp    = "这次不算完成任务量"（done=false）—— 分钟照记，任务进度不记
 *   提前完成  = "这一段我确实学完了"（done=true）—— 时长按实际，任务进度照记
 * 严格/强制模式下「放弃」要被配额挡住，但「提前完成」始终留着：
 *   真有事要走也该让人保住已经坐出来的时间，否则强制模式就是在惩罚诚实。
 */
export function finishEarly() {
  if (!state) return null;
  const s = state;
  state = null;
  syncCapsule();
  persist();
  clearWatchdog();
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  notify.releaseWake();
  if (s.phase !== 'focus') return null;
  // 先落账再计数：不足 1 分钟 settle 会返回 null（规则同其它路径），
  // 这时候不该算"完成了一段"，否则本轮计数与长休节奏会凭空多一格
  const r = settle(s, true, Date.now());
  if (r) bumpRound();
  notifLeave(true);
  return r;
}

/**
 * 外部收摊（清数据 / 导入 replace 备份前调用）：不落账，直接停。
 * 与 giveUp() 的区别：giveUp 是人按了「放弃」，满 1 分钟要记一条中断会话；
 * abort 是"这些记录马上就要没了"，记了也是白记。
 */
export function abort() {
  const had = !!state;
  state = null;
  syncCapsule();
  persist();
  clearWatchdog();
  lastNotifyText = '';
  fgsvc.stop();
  ambient.stop();
  notify.cancelOngoing();
  notify.releaseWake();
  notifLeave(false);
  return had;
}

// ---------- 每秒驱动 ----------
// 返回 { state, justFinished: 'focus' | 'rest' | null, justOverrun: boolean }
//   justFinished = 这一轮**真的收摊了**（休息结束，或正计时被退出）
//   justOverrun  = 专注跑满预设时长、刚转入正计时（人还在继续，UI 不用弹"完成"面板）
export function tick() {
  restoreIfNeeded();
  syncCapsule();
  if (!state || state.paused) return { state: state ? snapshot() : null, justFinished: null, justOverrun: false };
  const now = Date.now();
  if (now >= state.endAt && !state.overrun) {
    clearWatchdog();
    const kind = state.phase;
    if (kind === 'focus') {
      // 专注到点：转正计时，不收摊（响铃/通知在 enterOverrun 里已经发了）
      enterOverrun(state, false);
      return { state: snapshot(), justFinished: null, justOverrun: true };
    }
    const s = state;
    state = null;
    persist();
    notifLeave(false);
    notify.releaseWake();
    finishAlert(kind, false);
    try { uni.$emit(FINISH_EVENT, { kind: kind }); } catch (e) {}
    if (onFinish) { try { onFinish(kind); } catch (e) {} }
    return { state: null, justFinished: kind, justOverrun: false };
  }
  pushOngoing();
  return { state: snapshot(), justFinished: null, justOverrun: false };
}

/**
 * 专注跑完（进程被杀后恢复这类"人没在"的路径）：
 * 先给本轮计数 +1 —— 长休是按"第几段专注"触发的，漏了这步它就永远不会来。
 * endAt 可显式指定：进程被杀时只认"确定坐过"的预设时长，正计时那段没法证明。
 */
function finishFocus(s, endAtOverride) {
  bumpRound();
  // 结束这一下也要记：开始在场、结束在场，中间那段时间才算真的"人在"。
  // 只记开始不记结束的话，"专注中途出去了"这条信息永远攒不出来。
  rangeMark();
  return settle(s, true, endAtOverride);
}

// 刚落账的那段专注的 id：休息页要靠它把「心得」挂回这一段。
// 为什么不留在 state 里：专注一结束 state 就被清空，而心得是**结束之后**才写的。
let lastSessionId = '';

/** 刚落账的那段专注（没有则返回 null）。休息页拿它显示 / 回填心得。 */
export function lastSession() {
  if (!lastSessionId) return null;
  const list = (pw.get().sessions || []);
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].id === lastSessionId) return list[i];
  }
  return null;
}

/** 给刚落账的那段专注写一句心得 */
export function setNote(text) {
  return pw.setPomoNote(lastSessionId, text);
}

/** 落账一段专注（完整或提前放弃满 1 分钟） */
function settle(s, completed, endAtOverride) {
  const endAt = endAtOverride || (completed ? s.endAt : Date.now());
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
  lastSessionId = session.id;      // 休息页的心得要挂回这一段
  // 只有真跑完才记任务专注：中途放弃的不算完成任务量（与弹窗文案一致），
  // 否则"只剩 1 颗的任务，专注满 1 分钟点放弃"会被 pwstore 判定成已完成
  if (completed && s.taskId && s.goalId) pw.addPomoToTask(s.goalId, s.taskId);
  // 落账后立刻落盘。pwstore 平时是"改内存 + 800ms 节流合并写"，
  // 但专注结算恰恰是最不能等的那一刻：用户在这一秒划掉后台 / 系统在这一秒回收进程，
  // 这 25 分钟就白坐了（整个 fj_pw_data_v1 是一次性写的，丢就一起丢）。
  // flush 是同步写，代价可以忽略 —— 一次专注只发生一次。
  try { pw.flush(); } catch (e) {}
  // 记一次"今天专注过"：原生休闲提醒的 daily 规则据此判"零专注"（它拿不到 pwstore）
  try { if (completed) leisure.markFocusDone(); } catch (e) {}
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
    // 人不在的这段时间跑完了 → 补记。
    // ⚠️ 只按预设时长落账（rt.endAt）：进程被杀之后我们证明不了人还坐了多久，
    // 把"离开的那几个小时"算进专注时长就是造假 —— 正计时的补记只有人亲自按「退出」才算数。
    finishFocus(rt, rt.endAt);
    state = null;
    notifLeave(true);
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
    // 进程被杀时免打扰可能还挂着：专注还在跑就接着挡（它只切一次，不会重复记档位），
    // 已经在休息就让它随上面的 dndLeave 自然还原
    if (state.phase === 'focus' && !state.paused) notifEnter();
    armWatchdog();      // 恢复现场后接着看时间
    syncCapsule();
  }
}

export function registerFinish(fn) { onFinish = fn; }
