// utils/forced.js - 强制模式（默认关；开了以后，一轮番茄没跑完就走不掉）
//
// 与严格模式的分工（两个开关彼此独立，别混）：
//   · 严格模式（utils/strict.js）—— 管"记账"：
//       抓到跑偏 → 先提醒 → 给 30 秒宽限 → 还不回来就把这次番茄作废。
//   · 强制模式（本文件）      —— 管"行为"：
//       抓到跑偏 → 当场把 PWstudy 拉回前台，不给宽限；连续跑偏 3 次才作废。
//     也就是番茄闹钟那种"离开就失败/把你拽回来"的手感。
//
// 生效条件（三条全中才动）：设置里开了强制模式 + 正在"专注"阶段 + 没暂停。
// 休息阶段不拦（休息就该休息），不计时的时候一次系统都不查。
//
// 能力前提：UsageStats（「使用情况访问」权限）—— 没有它就不知道前台是谁，
// 这里选择静默退让（页面上有引导），而不是瞎弹提示。

import * as focus from './focus.js';
import * as apptime from './apptime.js';
import * as notify from './notify.js';
import * as settings from './settings.js';
import * as fgsvc from './fgsvc.js';

const CHECK_MS = 2000;     // 抓"刚划走"要快，再密就是无谓耗电
const MAX_ESCAPE = 3;      // 连续跑偏几次才作废这一轮
const PULL_GAP_MS = 3000;  // 两次"拉回"之间的最小间隔：系统切前台有延迟，连着拉会打架

let timer = 0;
let on = false;
let escapes = 0;
let lastPullAt = 0;

/** 设置里是否开了强制模式 */
export function enabled() {
  try {
    const s = settings.get();
    return !!(s && s.focus && s.focus.forced);
  } catch (e) {
    return false;
  }
}

/** 本轮已经跑偏几次（给界面显示用） */
export function escapesOf() {
  return escapes;
}

/** 监视器当前是否在工作（界面提示 + 测试用） */
export function armed() {
  return on;
}

/** 有没有"拉回"的原生能力：没有就只剩通知，别骗用户说锁得住 */
export function canPull() {
  try {
    return !!fgsvc.bringToFrontSupported();
  } catch (e) {
    return false;
  }
}

/**
 * 由页面在开始/结束/暂停番茄时调用（跟 strict.sync() 成对出现）。
 * 自带定时器，页面 onHide 也不停 —— 人切走才是它该干活的时候。
 */
export function sync() {
  const cur = focus.current();
  const should = !!(cur && !cur.paused && cur.phase === 'focus' && enabled());
  if (should === on) return;
  on = should;
  if (on) {
    escapes = 0;
    // 起表那一刻人可能还在上一个 App 里，先留一小段不追究
    lastPullAt = Date.now();
    start();
  } else {
    stop();
    escapes = 0;
  }
}

function start() {
  stop();
  timer = setInterval(check, CHECK_MS);
}

function stop() {
  if (timer) { clearInterval(timer); timer = 0; }
}

function check() {
  // 兜底：计时停了就立刻收手，绝不留下一个还在轮询的定时器
  const cur = focus.current();
  if (!cur || cur.paused || cur.phase !== 'focus' || !enabled()) { sync(); return; }
  if (!apptime.supported()) return;                // 非安卓：没有能力就别折腾
  if (!apptime.hasUsagePermission()) return;       // 没授权：静默（页面上有引导）

  const pkg = apptime.foregroundPackage(6000);
  // 拿不到 = 锁屏/桌面切换中；在学习 App = 合规 → 都不动
  if (!pkg || apptime.isAllowedPkg(pkg)) return;

  const now = Date.now();
  if (now - lastPullAt < PULL_GAP_MS) return;
  lastPullAt = now;
  escapes += 1;

  // 原生优先（前台服务持着 task，moveTaskToFront 最可靠），桥接兜底
  let pulled = false;
  try { pulled = !!fgsvc.bringToFront(); } catch (e) { pulled = false }
  if (!pulled) { try { pulled = !!apptime.bringSelfFront(); } catch (e) { pulled = false } }

  if (escapes >= MAX_ESCAPE) {
    notify.alert('本次番茄已作废', '强制模式下连续 3 次离开学习 App，这次不算')
    try { focus.giveUp(); } catch (e) {}
    escapes = 0
    on = false
    stop()
    try { uni.$emit('pw:forced-break', {}) } catch (e) {}
    return
  }
  notify.alert('强制模式', '先把这个番茄跑完，再去做别的')
}
