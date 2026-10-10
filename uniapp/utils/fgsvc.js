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

/** 番茄结束 / 放弃：停服务、撤常驻通知 */
export function stop() {
  if (!active) return false;
  active = false;
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
