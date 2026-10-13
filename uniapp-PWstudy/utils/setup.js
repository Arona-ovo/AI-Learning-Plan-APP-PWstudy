// utils/setup.js - 权限与后台保活清单
//
// PWstudy 有四件事必须靠系统放行，缺一件就会"看起来像坏了"：
//   ① 通知权限        —— 番茄结束要提醒、专注中要显示剩余时间；没有就是"点了开始没反应"
//   ② 使用情况访问    —— 统计学习 App 用时、严格模式判断你在用哪个 App；没有就是列表空白
//   ③ 电池优化白名单  —— 不进白名单，锁屏几分钟后进程被回收，计时直接断在半路
//   ④ 无障碍（强制模式）—— 安卓 10 起限制"后台启动 Activity"，
//      只有"由系统绑定的服务"（无障碍 / 通知监听 / VPN / 输入法）能拿到那份豁免；
//      没开它，切走之后大概率拉不回来。**开了它还能顶替 ②**：前台是哪个应用
//      由系统事件直接推过来，不必再单独授「使用情况访问」。
//      这一项只在用户开了强制模式时才是"必办"（must 写成函数的原因），
//      不开强制模式的人不该被它打扰。
// 第 ⑤ 项（自启动 / 后台运行）各厂商入口不统一，只能跳到本应用详情页让用户自己开，
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
    key: 'a11y',
    title: '无障碍（强制模式：把你拉回来）',
    why: '强制模式的核心能力。安卓 10 起系统限制"后台启动 Activity"，只有无障碍服务能拿到那份豁免 —— ' +
      '没开它，切到别的 App 之后大概率拉不回来，只能事后盖一层悬浮窗遮罩。' +
      '开了它还能顺带替代「使用情况访问」：前台是哪个应用由系统事件直接告知，更快也更省电。',
    // 必办与否取决于用户有没有开强制模式：不开的人根本用不到，别拿它去烦人。
    // （这也是这一项 must 写成函数而其它项是字面量的唯一原因）
    //
    // 保险丝跳过闸的话这一项直接算"过了"：服务起不来是这台机子的问题，
    // 再引导用户去开只会让他又卡一次（服务崩 → 系统重 bind → 进程重启循环）。
    must: () => forcedOn() && apptime.a11ySafe(),
    check: () => !apptime.a11ySafe() || apptime.hasA11yPermission(),
    fix: () => {
      // 已跳闸：先把刹车松开再去，否则那次 bind 大概率又是同样的循环
      if (!apptime.a11ySafe()) apptime.resetA11y();
      return apptime.openA11ySettings();
    }
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

/** 设置里是否开了强制模式（决定"无障碍"这一项是不是必办） */
function forcedOn() {
  try {
    const f = settings.get().focus || {};
    return !!f.forced;
  } catch (e) {
    return false;
  }
}

/** must 允许写成函数（随设置变化），这里是唯一的求值处 */
function mustOf(it) {
  try {
    return typeof it.must === 'function' ? !!it.must() : !!it.must;
  } catch (e) {
    return false;
  }
}

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

/**
 * 逐项实测一次，返回 [{ key, title, why, must, ok }]（must 已求值成布尔）
 *
 * ⚠️ 「实测」两个字靠这一行成立：无障碍那一项在原生侧是**缓存**的
 * （每查一次都要问 AccessibilityManager，所以 fgsvc 存了上次的结果）。
 * 用户从系统设置页勾完开关回来，缓存还是旧值 —— 界面显示"没开"、红点不消失，
 * 用户以为自己白开了。所以每次实测前先让它失效。
 *
 * 放在这里而不是各个页面里：调用方有权限页、首页的待办卡、还要不要弹窗的判定，
 * 漏一处就又是"开了却没反应"（这坑踩过 —— 只有专注页记得清缓存）。
 */
export function status() {
  try { apptime.refreshA11y(); } catch (e) {}
  return ITEMS.map(it => {
    let ok = false;
    try { ok = !!it.check(); } catch (e) { ok = false; }
    return { key: it.key, title: it.title, why: it.why, must: mustOf(it), ok: ok };
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
