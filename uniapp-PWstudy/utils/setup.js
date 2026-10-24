// utils/setup.js - 权限与后台保活清单
//
// PWstudy 有四件事必须靠系统放行，缺一件就会"看起来像坏了"：
//   ① 通知权限        —— 专注结束要提醒、专注中要显示剩余时间；没有就是"点了开始没反应"
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
//   ⑥ 悬浮窗 / 显示在其他应用上层（强制模式）—— 安卓 10 起禁止 App 在后台自己弹界面，
//      只有拿到这个权限才命中官方那条豁免。**它是强制模式唯一的"手"，准入条件，
//      不是可选兜底**：没有它，切走之后三条拉回路全被系统静默拦掉（不抛异常，
//      所以界面会一直显示"已就绪"，实际一动不动）。同样只在开了强制模式时才必办。
//
// 这里只做三件事：给出每项当前是否满足（check）、点一下去哪修（fix）、
// 以及"哪些引导已经问过"（appsAsked）。真正的"有没有提醒过"记在 settings.setup，
// 避免每次进 App 都弹。

import * as settings from './settings.js';
import * as apptime from './apptime.js';

export const ITEMS = [
  {
    key: 'notify',
    title: '允许通知',
    why: '专注结束时提醒你，专注期间在状态栏显示剩余时间。不给权限就是"点了开始什么都没发生"。',
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
    key: 'overlay',
    title: '显示在其他应用上层（强制模式：拉你回来）',
    why: '强制模式的**准入条件**，不是可选兜底：安卓 10 起禁止 App 在后台自己弹界面，' +
      '拿到这个权限才命中官方那条豁免，切走之后才真的拉得回来；拉不回来时也能靠它盖一层' +
      '遮罩把那个 App 挡住。不开强制模式完全用不到，所以平时不会拿它来烦你。',
    // 跟「无障碍」同理：只有开了强制模式的人才必办
    must: () => forcedOn(),
    check: () => apptime.canDrawOverlays(),
    fix: () => apptime.openOverlaySettings()
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

/**
 * 第一次用 App 时那一屏「开始前的几件事」（`pkgManage/pages/start/start`）。
 *
 * 为什么单独要一屏：权限页是"事后补"，入口藏在「我的」里，等用户哪天发现
 * "锁屏后计时断了"才可能摸过去。首启这一屏把**要系统放行的**和**要不要被管着**
 * 一次摆平：用户可以选择当场全开，也可以一个都不开 —— 但至少知道有这些开关存在。
 *
 * ⚠️ 只在安卓上跳：别端没有这套清单（applicable() 已判），去了就是一屏空白。
 * ⚠️ 已经在权限页点过「先不弄」的人不再拽一次 —— 那是明确的表态。
 */
export function firstRunDone() {
  try {
    const s = settings.get();
    return !!(s && s.setup && s.setup.firstRun);
  } catch (e) {
    return true;          // 读不出来就当跑过了：宁可不跳，也不能每次开 App 都跳
  }
}

export function markFirstRun() {
  try {
    const s = settings.get();
    s.setup = Object.assign({ done: false, promptAt: 0 }, s.setup || {});
    s.setup.firstRun = true;
    settings.save();
  } catch (e) {}
}

/** 首次进首页要不要先去那一屏 */
export function shouldFirstRun() {
  if (!applicable()) return false;
  if (firstRunDone()) return false;
  try {
    const su = settings.get().setup || {};
    if (su.done) return false;
  } catch (e) {}
  return true;
}

/** 设置页的「再看一遍开始前的几件事」：清掉记账，下次进首页再放一次 */
export function resetFirstRun() {
  try {
    const s = settings.get();
    s.setup = Object.assign({ done: false, promptAt: 0 }, s.setup || {});
    s.setup.firstRun = false;
    settings.save();
  } catch (e) {}
}

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

/**
 * 首页那张「还有设置没完成」卡片里，被用户**点 × 关掉**的缺项。
 *
 * 为什么按 key 记、而不是一个"别再显示"的总开关：必办项会随使用变化 ——
 * 只有开了强制模式才会冒出无障碍 / 悬浮窗。总开关会把**以后才出现的新问题**
 * 一起沉默掉，用户以为自己关的只是当时那几项。按 key 记则"关过的安静、
 * 新冒出来的照样提醒"。
 */
export function mutedKeys() {
  try {
    const s = settings.get();
    const a = s && s.setup ? s.setup.mutedKeys : null;
    return Array.isArray(a) ? a : [];
  } catch (e) {
    return [];
  }
}

/**
 * 首页卡片该显示的缺项 —— 剔除被 × 关掉的。
 * ⚠️ 权限页 / `pending()` 仍返回**全部**缺项：卡片可以关，真实状态不许藏。
 */
export function pendingForCard() {
  const dis = mutedKeys();
  return pending().filter(x => dis.indexOf(x.key) < 0);
}

/**
 * 点首页卡片的 ×：把**此刻**这些缺项记为"别再拿它烦我"，同时让每日弹窗也闭嘴
 * （用户点 × 的意思就是"我知道，别再说了"；只关卡片、弹窗照弹等于没关）。
 *
 * 直接整份覆盖成"当前 pending 的 key"：上一次关过、这次已经办好的项自然被清掉，
 * 以后再缺一次就还会提醒。
 */
export function mutePending() {
  try {
    const s = settings.get();
    s.setup = Object.assign({ done: false, promptAt: 0, appsAsked: false, mutedKeys: [] }, s.setup || {});
    s.setup.mutedKeys = pending().map(x => x.key);
    settings.save();
    return true;
  } catch (e) {
    return false;
  }
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

/**
 * 标题的简写：去掉括号里的补充说明。
 * 「无障碍（强制模式：把你拉回来）」整句塞进 toast / 弹窗太长。
 *
 * 放在这里而不是页面里：弹窗文案、toast、待办计数三处都要用它，
 * 各写一份必然分叉（硬约束：界面文案的唯一出处）。
 */
export function shortTitle(t) {
  return String(t || '').split('（')[0].trim() || '权限';
}

/** 还没办好的必办项的名字（弹窗文案用，按实际缺项生成而不是写死一份名单） */
export function pendingNames() {
  try { return pendingForCard().map(x => shortTitle(x.title)); } catch (e) { return []; }
}

/** 还没有提醒过？一天最多弹一次，全部办好（或被用户逐项关掉）之后不再弹 */
export function shouldPrompt() {
  try {
    const s = settings.get();
    const su = s && s.setup ? s.setup : {};
    if (su.done) return false;
    if (!pendingForCard().length) return false;
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

/**
 * 「新建完目标 → 顺便去加学习 App」这个引导问过了没。
 *
 * 为什么只问一次：它是**锦上添花**，入口在首页 / 统计 / 我的 / 专注页都有，
 * 问过一次就够了。连着问（每建一个目标问一次）只会让人觉得这 App 话多。
 */
export function appsAsked() {
  try {
    const s = settings.get();
    return !!(s && s.setup && s.setup.appsAsked);
  } catch (e) {
    return true;               // 读不出来就当问过了：宁可不弹，也不能每次都弹
  }
}

export function markAppsAsked() {
  try {
    const s = settings.get();
    s.setup = Object.assign({ done: false, promptAt: 0 }, s.setup || {});
    s.setup.appsAsked = true;
    settings.save();
  } catch (e) {}
}
