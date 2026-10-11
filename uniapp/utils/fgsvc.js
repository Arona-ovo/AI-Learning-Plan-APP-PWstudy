// utils/fgsvc.js - 番茄前台服务包装（UTS 插件 pwstudy-focus 的唯一调用方）
//
// 分层：
//   · 真正的前台 Service 必须走 UTS 插件（Service 要在 AndroidManifest 里声明，
//     plus.android 桥做不到），插件在 uni_modules/pwstudy-focus；
//   · 页面和 focus.js 永远只 import 本模块 —— 插件有没有、调用炸不炸，都在这里兜住：
//     标准基座（没打自定义基座）里 UTS 原生代码不存在，调用会失败 → 全部静默降级回
//     notify.js 的"常驻通知 + endAt 补账"老路，功能不缺、只是保活弱一档。
//
// 开关：settings.focus.fgservice（默认 true）。番茄开关"通知提醒"关掉时也不启用
// —— 前台服务必然带一条常驻通知，用户已明确说不要通知，就别硬塞。

// #ifdef APP-PLUS
import * as fgs from '@/uni_modules/pwstudy-focus';
// #endif
import * as settings from './settings.js';

let probed = null;    // null = 没探测过；true/false = 插件可用与否（进程内缓存）
let active = false;   // 本进程内服务是否已由我们启动

/** 插件原生代码是否可用（标准基座下 = false） */
export function available() {
  if (probed === null) {
    let r = false;
    // #ifdef APP-PLUS
    try {
      r = !!(fgs && typeof fgs.isAvailable === 'function' && fgs.isAvailable());
    } catch (e) {
      r = false;
    }
    // #endif
    probed = r;
  }
  return probed;
}

/** 设置层面允不允许用（开关开 + 通知开） */
function allowed() {
  try {
    const f = settings.get().focus || {};
    return f.fgservice !== false && f.notify !== false;
  } catch (e) {
    return false;
  }
}

/** 服务是否处于"我们启动的运行态"（true 时倒计时刷新走 update 而不是重建通知） */
export function isActive() {
  return active;
}

/** 番茄开始 / 恢复现场：起前台服务。失败（不可用/标准基座）返回 false，调用方走老路 */
export function start(title, text) {
  if (!allowed() || !available()) return false;
  // #ifdef APP-PLUS
  try {
    active = !!fgs.startFocusService(String(title || 'PWstudy 专注中'), String(text || ''));
  } catch (e) {
    active = false;
  }
  // #endif
  // 服务（重）起来了 → 把缓存的看门狗配置补推一次。
  // 进程被杀后恢复现场走的就是这条路，不然强制模式会"看着像开着其实没盯"。
  if (active) pushWatch();
  return active;
}

/** 刷新常驻通知文案（focus.js 的 30 秒节流在调用方，这里不做） */
export function update(title, text) {
  if (!active) return false;
  // #ifdef APP-PLUS
  try {
    return !!fgs.updateFocusNotification(String(title || ''), String(text || ''));
  } catch (e) {}
  // #endif
  return false;
}

/** 番茄结束 / 放弃：停服务、撤常驻通知（看门狗跟着服务一起收摊，见 onDestroy） */
export function stop() {
  if (!active) return false;
  active = false;
  watchPushed = false;
  // #ifdef APP-PLUS
  try { fgs.stopFocusService(); } catch (e) {}
  // #endif
  return true;
}

/**
 * 强制模式：把 PWstudy 拉回前台。
 * 返回 false = 没拉成（插件不在 / 被 ROM 拦了 / 非安卓），调用方会退回 plus.android
 * 桥再试一次，都不行就只发通知 —— 不用"锁了但没完全锁"骗用户。
 */
export function bringToFront() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.bringToFront === 'function') return !!fgs.bringToFront();
  } catch (e) {}
  // #endif
  return false;
}

/** 是否具备"拉回前台"的原生能力（标准基座 = false，界面上要如实提示） */
export function bringToFrontSupported() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.bringToFrontSupported === 'function') return !!fgs.bringToFrontSupported();
    return true;    // 插件在但没这个探测函数：保守当成有
  } catch (e) {}
  // #endif
  return false;
}

/* ==================== 强制模式：后台看门狗 ====================
 *
 * 为什么要有这一层：强制模式原来是 JS 层 setInterval 每 2 秒查一次前台包名，
 * 但用户一旦切出 App，WebView 的定时器就被系统挂起 —— 于是"人走了却一直没被拉回"，
 * 这正是强制模式失效的直接原因。现在把看门狗下沉到原生前台服务里的真线程，
 * 服务活着它就一直盯；JS 只负责下发配置和读战绩。
 *
 * 配置缓存在模块里：进程被杀后 focus.js 恢复现场会重新 start() 服务，
 * 那时再推一次，看门狗不会因为"重启了一次 JS"就丢配置。
 */

let watchCfg = { on: false, allow: '', untilSec: 0, paused: false };
let watchPushed = false;   // 配置最后一次真的推成功了没（watchRunning 用它，避免每次调用都发 Intent）

/**
 * 下发看门狗配置。
 * @param {{on?:boolean, allow?:string, untilSec?:number}} cfg
 *        allow 是英文逗号分隔的白名单（utils/apptime.js 的 allowList() 拼）；
 *        untilSec 是兜底的自动收手倒计时（= 这个番茄还剩多少秒）。
 * @returns {boolean} 真推下去了（插件可用 + 前台服务在跑）→ 调用方据此决定
 *          还要不要跑 JS 兜底轮询
 */
export function setWatch(cfg) {
  const c = cfg || {};
  watchCfg = {
    on: !!c.on,
    allow: String(c.allow || ''),
    // 兜到 Int 范围：原生侧收的是 Int，别让一个离谱的时长把它撑爆
    untilSec: Math.max(0, Math.min(43200, Math.round(Number(c.untilSec) || 0))),
    paused: false
  };
  return pushWatch();
}

/** 暂停计时（= 用户按了暂停）：看门狗先收手，恢复时再开 */
export function pauseWatch() {
  watchCfg.paused = true;
  return pushWatch();
}

export function resumeWatch() {
  watchCfg.paused = false;
  return pushWatch();
}

/** 强制模式战绩：{ pulls, escapes } —— 拉回次数 / 逃逸（连续离开）次数 */
export function watchStats() {
  // #ifdef APP-PLUS
  try {
    const p = (typeof fgs.watchPulls === 'function') ? Number(fgs.watchPulls()) || 0 : 0;
    const e = (typeof fgs.watchEscapes === 'function') ? Number(fgs.watchEscapes()) || 0 : 0;
    return { pulls: p, escapes: e };
  } catch (e) {}
  // #endif
  return { pulls: 0, escapes: 0 };
}

/** 清零战绩（每轮番茄开始时调一次，不然上一轮的数字会滚进来） */
export function resetWatchStats() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.resetWatchStats === 'function') return !!fgs.resetWatchStats();
  } catch (e) {}
  // #endif
  return false;
}

/** 看门狗现在真的在跑吗（原生线程）—— 没有的话 forced.js 得自己轮询 */
export function watchRunning() {
  return watchPushed;
}

function pushWatch() {
  // 服务没在跑就别去推：随便 startService 会把它又拽起来（放弃番茄后重启前台服务，
  // 用户会看到一条莫名其妙的常驻通知）
  if (!available() || !active) { watchPushed = false; return false; }
  const on = watchCfg.on && !watchCfg.paused && watchCfg.untilSec > 0;
  let r = false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.setWatch === 'function') {
      r = !!fgs.setWatch(on, on ? watchCfg.allow : '', on ? watchCfg.untilSec : 0);
    }
  } catch (e) {
    r = false;
  }
  // #endif
  watchPushed = r && on;
  return watchPushed;
}
