// utils/strict.js - 严格模式（只在番茄进行中生效，默认关）
//
// 用户定的规则（逐条对应）：
//   1. 「用户可以选择开或不开」→ settings.focus.strict，默认 false
//   2. 「跟番茄闹钟一样」→ 只有在番茄/休息计时进行中才检查；不计时的时候完全不碰系统
//   3. 「打开其他和学习软件不一样就退出」→ 检测到前台是「没登记」或「登记为休息」的 App：
//      第一次先提醒（通知 + 震动）；给了 30 秒宽限，还没回来就结束本次番茄并记为中断。
//      ——不硬"杀掉别人的 App"，那是安卓不允许也不体面的做法；用打断番茄来表达"这次不算"。
//
// 检查频率 8 秒一次：再密就是无谓耗电，再疏就抓不住"刚划走"。
import * as focus from './focus.js';
import * as apptime from './apptime.js';
import * as notify from './notify.js';
import * as settings from './settings.js';

const CHECK_MS = 8000;
const GRACE_MS = 30000;   // 提醒后给多久回来

let timer = 0;
let strikeAt = 0;         // 第一次抓到"跑偏"的时间戳
let running = false;

export function enabled() {
  try {
    return !!(settings.get() && settings.get().focus && settings.get().focus.strict);
  } catch (e) {
    return false;
  }
}

/** 由 focus 页在开始/结束番茄时调用，或页面 onShow 时调一下 */
export function sync() {
  const cur = focus.current();
  // 只在"正在专注"时干活：休息阶段不算（用户要的是跟番茄钟同步，休息就该休息）；
  // 正计时（预设时长已跑满、人在继续）也不算 —— 那一段不该再判人违规。
  const should = !!(cur && !cur.paused && !cur.overrun && cur.phase === 'focus' && enabled());
  if (should === running) return;
  running = should;
  if (running) {
    strikeAt = 0;
    startTimer();
  } else {
    stopTimer();
    strikeAt = 0;
  }
}

function startTimer() {
  stopTimer();
  timer = setInterval(check, CHECK_MS);
}

function stopTimer() {
  if (timer) { clearInterval(timer); timer = 0; }
}

function check() {
  // 兜底：计时停了就立刻收手，绝不留下一个还在轮询的定时器
  const cur = focus.current();
  if (!cur || cur.paused || cur.overrun || cur.phase !== 'focus' || !enabled()) { sync(); return; }
  if (!apptime.supported()) return;               // 非安卓：没有能力就别折腾
  if (!apptime.hasUsagePermission()) return;      // 没授权：静默（页面上有引导）

  const pkg = apptime.foregroundPackage(15000);
  if (!pkg || apptime.isAllowedPkg(pkg)) {
    strikeAt = 0;                                  // 回来了 / 在看学习 App → 清零
    return;
  }

  const now = Date.now();
  if (!strikeAt) {
    strikeAt = now;
    notify.alert('专注中，先回来', '现在打开的这个不是你登记的学习 App');
    try {
      const s = settings.get();
      if (s && s.focus && s.focus.vibe !== false) notify.vibrate();
    } catch (e) {}
    return;
  }
  if (now - strikeAt < GRACE_MS) return;

  // 宽限用尽还没回来 → 这次番茄作废，按中断记（满 1 分钟才落账，规则同 giveUp）
  notify.alert('本次番茄已中断', '离开了学习 App，这次不算有效番茄');
  try { focus.giveUp(); } catch (e) {}
  strikeAt = 0;
  running = false;
  stopTimer();
  try { uni.$emit('pw:strict-break', {}); } catch (e) {}
}
