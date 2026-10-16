// utils/haptic.js - 触感反馈（震动）
//
// 用在这三处：底部悬浮导航栏点击、首页抽屉滑出到位、设置页「试一下」。
// 方案从 AWword 的同名模块移植（用户 2026-10-16 指定参考它）。
//
// 三条硬规矩：
//   1) 跟着设置走（设置 › 触感反馈）：总开关关掉就一次都不震，连 API 都不碰。
//   2) 连点保护：MIN_GAP 之内的重复触发直接丢掉 —— 否则滑一次抽屉能震出一窝蜂，
//      而且 Android 上连续 vibrate() 会把短震叠成长震，手感全毁。
//   3) 平台能力先验再调：App 走 plus.device.vibrate(ms)（能精确到毫秒），
//      其余端退 uni.vibrateShort；都没有就安静返回 false，绝不把异常抛给用户。
//
// ⚠️ Android 需要 android.permission.VIBRATE —— manifest.json 里已声明（安装时权限，
//    不用运行时弹框）。但**老包 / 调试基座里没这个权限时震动会静默失败**，
//    失败原因记在 lastError() 里，设置页据此提示「需要重新打包」，而不是假装
//    "本设备不支持震动"。
import * as settings from './settings.js';

// 三档场景（毫秒）。Android 上 10~15ms 是"哒"的一下，30ms 往上就开始"嗡"了，
// 所以最重的 drawer 也就 26ms —— 再长就不是反馈而是骚扰。
//   tap     底部导航点击（点得频繁，最轻）
//   switch  设置里的开关 / 「试一下」
//   drawer  首页抽屉滑出到位（一次滑动只响一声，稍重）
const KIND_MS = { tap: 12, switch: 18, drawer: 26 };

const MIN_GAP = 70;   // 连点保护（毫秒）

let lastAt = 0;
let lastErr = '';

/** 总开关（设置 › 触感反馈）。读不到设置时按"开"处理（别让存档异常变成"永远不震"） */
export function isEnabled() {
  try {
    const h = settings.get().haptic;
    return !(h && h.on === false);
  } catch (e) {
    return true;
  }
}

/** 某个场景这次该震多少毫秒（脏场景名回落到 switch 档，下限 8ms 不许算出 0） */
export function msOf(kind) {
  const ms = KIND_MS[kind] || KIND_MS.switch;
  return ms < 8 ? 8 : ms;
}

/** 上一次为什么没震成（'' = 没失败过 / 已经震成功）。设置页据此提示"需要重新打包" */
export function lastError() {
  return lastErr;
}

/** 有没有可用的震动 API（只回答"能不能调"，不保证真的震得动） */
export function hasApi() {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.device && typeof plus.device.vibrate === 'function') return true;
  // #endif
  return !!(typeof uni !== 'undefined' && typeof uni.vibrateShort === 'function');
}

function fire(ms) {
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.device && typeof plus.device.vibrate === 'function') {
    plus.device.vibrate(ms);
    return true;
  }
  // #endif
  if (typeof uni !== 'undefined' && typeof uni.vibrateShort === 'function') {
    uni.vibrateShort({ type: ms <= 14 ? 'light' : (ms <= 26 ? 'medium' : 'heavy') });
    return true;
  }
  return false;
}

/**
 * 震一下。
 * @param {'tap'|'switch'|'drawer'} kind 场景（决定时长）
 * @returns {boolean} 是否真的震了（关开关 / 连点 / 平台不支持都会返回 false）
 */
export function tick(kind) {
  if (!isEnabled()) return false;
  const now = Date.now();
  if (now - lastAt < MIN_GAP) return false;
  lastAt = now;                    // 先占位：就算这次没震成，也不该在 70ms 里重试
  const ms = msOf(kind);
  try {
    const done = fire(ms);
    if (!done) {
      lastErr = 'no-api';
      return false;
    }
    lastErr = '';
    return true;
  } catch (e) {
    // 原生调用不许完全静默：真机"没震动"时控制台得有线索。
    // Android 上最常见的失败就是老包没打进 VIBRATE 权限 → SecurityException。
    lastErr = String((e && e.message) || e || 'error');
    console.warn('[haptic] vibrate failed:', e);
    return false;
  }
}

/** 总开关落盘 */
export function setOn(v) {
  try {
    settings.set({ haptic: { on: !!v } });
    return true;
  } catch (e) {
    console.warn('[haptic] setOn failed:', e);
    return false;
  }
}
