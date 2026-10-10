// utils/setup.js - 权限与后台保活清单
//
// PWstudy 有三件事必须靠系统放行，缺一件就会"看起来像坏了"：
//   ① 通知权限        —— 番茄结束要提醒、专注中要显示剩余时间；没有就是"点了开始没反应"
//   ② 使用情况访问    —— 统计学习 App 用时、严格模式判断你在用哪个 App；没有就是列表空白
//   ③ 电池优化白名单  —— 不进白名单，锁屏几分钟后进程被回收，计时直接断在半路
// 第 ④ 项（自启动 / 后台运行）各厂商入口不统一，只能跳到本应用详情页让用户自己开，
// 所以它是"建议"而不是"必须" —— 不完成也算过。
//
// 这里只做两件事：给出每项当前是否满足（check），以及点一下去哪修（fix）。
// 真正的"有没有提醒过"记在 settings.setup，避免每次进 App 都弹。

import * as settings from './settings.js';
import * as apptime from './apptime.js';

export const ITEMS = [
  {
    key: 'notify',
    title: '允许通知',
    why: '番茄结束时提醒你，专注期间在状态栏显示剩余时间。不给权限就是"点了开始什么都没发生"。',
    must: true,
    check: () => apptime.hasNotifyPermission(),
    fix: () => apptime.openNotifySettings()
  },
  {
    key: 'usage',
    title: '使用情况访问',
    why: '用来统计你在学习 App 上花了多久，也是严格模式判断"现在是哪个 App 在前台"的唯一依据。',
    must: true,
    check: () => apptime.hasUsagePermission(),
    fix: () => apptime.openUsageSettings()
  },
  {
    key: 'battery',
    title: '电池优化白名单',
    why: '不加白名单，锁屏几分钟后系统会回收后台进程，计时会断在半路。',
    must: true,
    // 能实查就实查（PowerManager.isIgnoringBatteryOptimizations 是普通 API）；
    // 查不了（null）的老 ROM 才退回"用户点过确认就算过"。
    check: () => {
      const v = apptime.batteryIgnored();
      if (v === true) return true;
      if (v === null) return !!flag('battery');
      return false;
    },
    fix: () => apptime.openBatterySettings()
  },
  {
    key: 'autostart',
    title: '自启动 / 后台运行（可选）',
    why: '国产 ROM（小米、华为、OPPO、vivo 等）会额外限制后台。点一下会尽量直接跳到本机的自启动管理页；打不开就到应用详情页里手动开。',
    must: false,
    check: () => !!flag('autostart'),
    fix: () => apptime.openAutostartSettings()
  }
];

function flag(key) {
  try {
    const s = settings.get();
    return s && s.setup && s.setup[key];
  } catch (e) {
    return false;
  }
}

/** 标记某一项用户已经处理过（电池/自启动这两项系统查不了，只能靠用户确认） */
export function markDone(key) {
  try {
    const s = settings.get();
    s.setup = Object.assign({ done: false, promptAt: 0 }, s.setup || {});
    s.setup[key] = true;
    settings.save();
  } catch (e) {}
}

/**
 * 这套清单只在安卓上成立：iOS / H5 / 小程序既没有 UsageStats 也没有电池白名单，
 * 拿去检查只会得到一串假的"未完成"。
 */
export function applicable() {
  try { return !!apptime.supported(); } catch (e) { return false; }
}

/** 逐项实测一次，返回 [{ ...item, ok }] */
export function status() {
  return ITEMS.map(it => {
    let ok = false;
    try { ok = !!it.check(); } catch (e) { ok = false; }
    return { key: it.key, title: it.title, why: it.why, must: it.must, ok: ok };
  });
}

/** 还没办好的必办项（非安卓一律为空 —— 不该拿安卓的清单去烦别端） */
export function pending() {
  if (!applicable()) return [];
  return status().filter(x => x.must && !x.ok);
}

export function allOk() {
  return pending().length === 0;
}

/** 点某一项的「去设置」：跳系统页并把这次操作记下来（电池/自启动靠这个记账） */
export function fixItem(key) {
  const it = ITEMS.filter(x => x.key === key)[0];
  if (!it) return false;
  let opened = false;
  try { opened = !!it.fix(); } catch (e) { opened = false; }
  markDone(key);
  return opened;
}

/** 整体跳过：以后首页不再提醒（设置页里还能重新打开） */
export function skip() {
  try {
    const s = settings.get();
    s.setup = Object.assign({ done: false, promptAt: 0 }, s.setup || {});
    s.setup.done = true;
    settings.save();
  } catch (e) {}
}

/** 还没有提醒过？一天最多弹一次，全部办好之后不再弹 */
export function shouldPrompt() {
  try {
    const s = settings.get();
    const su = s && s.setup ? s.setup : {};
    if (su.done) return false;
    if (!pending().length) return false;
    const at = Number(su.promptAt) || 0;
    if (at && Date.now() - at < 86400000) return false;
    return true;
  } catch (e) {
    return false;
  }
}

export function markPrompted() {
  try {
    const s = settings.get();
    s.setup = Object.assign({ done: false, promptAt: 0 }, s.setup || {});
    s.setup.promptAt = Date.now();
    settings.save();
  } catch (e) {}
}
