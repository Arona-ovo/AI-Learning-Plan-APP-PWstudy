// utils/forced.js - 强制模式（默认关；开了以后，一轮专注没跑完就走不掉）
//
// 与严格模式的分工（两个开关彼此独立，别混）：
//   · 严格模式（utils/strict.js）—— 管"记账"：
//       抓到跑偏 → 先提醒 → 给 30 秒宽限 → 还不回来就把这次专注作废。
//   · 强制模式（本文件）      —— 管"行为"：
//       抓到跑偏 → 当场把 PWstudy 拉回前台，不给宽限；连续跑偏 3 次才作废。
//     也就是专注闹钟那种"离开就失败/把你拽回来"的手感。
//
// 生效条件（三条全中才动）：设置里开了强制模式 + 正在"专注"阶段 + 没暂停。
// 休息阶段不拦（休息就该休息），不计时的时候一次系统都不查。
//
// ⚠️ 分工的关键（2026-10-11 修）：
//   真正"盯着前台是谁、把 App 拽回来"的活儿在**原生**（UTS 前台服务里的看门狗线程，
//   见 utils/fgsvc.js 的 setWatch），因为这个模块原来用 setInterval 轮询 ——
//   而人一旦切出 App，WebView 的定时器就被系统挂起，于是"人走了却一直没被拉回"，
//   这就是强制模式失效的直接原因。
//   本文件现在只做两件事：
//     ① 把策略（白名单 / 到点收手时间）下发给原生，并且定期对账；
//     ② 当插件不可用（标准基座、H5）时退化成 JS 轮询，并且负责"连续 3 次 → 作废"这条策略
//        （原生不做作废：它随时可能在后台被冻结，落账这种要写库的事交给回到前台的 JS）。
//
// 能力前提：UsageStats（「使用情况访问」权限）—— 没有它就不知道前台是谁，
// 这里选择静默退让（页面上有引导），而不是瞎弹提示。

import * as focus from './focus.js';
import * as apptime from './apptime.js';
import * as notify from './notify.js';
import * as settings from './settings.js';
import * as fgsvc from './fgsvc.js';
import * as i18n from './i18n.js';

const CHECK_MS = 2000;      // JS 侧轮询间隔（原生看门狗在跑时它只做低频对账）
const MAX_ESCAPE = 3;       // 累计几次"逃逸"才作废这一轮
const PULL_GAP_MS = 2000;   // 两次"拉回"之间的最小间隔：系统切前台有延迟，连着拉会打架
const LOOKBACK_MS = 8000;   // 查"现在前台是谁"的回溯窗口（比轮询间隔略宽，抗抖动）
const REPUSH_MS = 60000;    // 给原生重新对账的间隔：它不是"一直盯"，而是按"还剩多少秒"自己掐表

let timer = 0;
let on = false;
let escapes = 0;            // 本次专注累计"逃逸"次数（JS 侧记的）
let escapeArmed = true;     // 回到合规状态后重新武装：同一次离开只记一笔（抗抖动）
let lastPullAt = 0;
let nativeSeen = { pulls: 0, escapes: 0 };
let alertedAt = 0;          // 上次弹"先把这段专注跑完"的时间（同一次逃逸别刷屏）

// ---- 原生看门狗："我认为它在跑"的三件套 ----
// 光记住"推成功过"不够：原生按 untilSec 自己掐表，到点会自己收手。
// 这里必须能发现"它已经停了"，否则会误以为有人盯着、于是 JS 兜底也不跑。
let pushedOn = false;
let pushedEndAt = 0;        // 推送那一刻的 endAt（endAt 变了必须重推：暂停后恢复会重算）
let pushedUntilMs = 0;      // 原生自己掐表的到点时刻
let lastPushAt = 0;

/** 设置里是否开了强制模式 */
export function enabled() {
  try {
    const s = settings.get();
    return !!(s && s.focus && s.focus.forced);
  } catch (e) {
    return false;
  }
}

/** 本轮已经跑偏几次（给界面显示用；原生在后台逮到的也算） */
export function escapesOf() {
  return Math.max(escapes, nativeSeen.escapes);
}

/** 原生看门狗一共把 App 拉回来几次（界面显示"已拉回 N 次"） */
export function pullsOf() {
  return nativeSeen.pulls;
}

/** 连续离开几次作废（界面上显示"离开 x/3"用，别在页面里写死数字） */
export function maxEscapes() {
  return MAX_ESCAPE;
}

/**
 * 自检快照（转发原生）。
 *
 * 为什么要有：这条链十几环（前台服务 → 看门狗 → 探测前台 → 判定跑偏 → 拉回 → 遮罩），
 * 任何一环断掉都长成同一个"没反应"。与其每轮猜一次再打个包，不如把每一环的
 * 实测值一次摊开 —— 用户截个图就能说出断在哪。
 */
export function diag() {
  try {
    return fgsvc.watchDiag();
  } catch (e) {
    return null;
  }
}

/** 监视器当前是否在工作（界面提示 + 测试用） */
export function armed() {
  return on;
}

/* ==================== App 内部的"离开"也是逃逸 ====================
 * 强制模式原来只盯"前台是不是别的 App"，于是人在 PWstudy 里从专注页切回
 * 首页 / 统计 / 我的，前台还是自己 → 判定合规 → 一动不动。
 * 强制模式的定义是"离开学习这件事就把人拽回来"，在自家 App 里逛
 * 跟切去刷视频没区别 —— 所以这条也要管（2026-10-24 补）。
 *
 * ⚠️ 名单里必须留出去开权限的入口：盖住设置页 = 用户永远开不了悬浮窗，
 *    跟原生侧 NEUTRAL_CSV 是同一条理由。
 */
const FOCUS_ROUTE = '/pkgPlan/pages/focus/focus';
const INSIDE_FREE = [
  FOCUS_ROUTE,
  '/pkgManage/pages/settings/settings',
  '/pkgManage/pages/setup/setup'
];

/** 这一页在强制模式下是"自由"的吗（页面别自己抄这份名单） */
export function insideFree(route) {
  const r = '/' + String(route || '').replace(/^\/+/, '');
  return INSIDE_FREE.indexOf(r) >= 0;
}

/**
 * 内部守卫：专注正跑着 + 强制模式开着 + 当前不在自由页 → 该把人送回专注页。
 * 页面在 onShow 开头问一句就行，判定只此一份。
 *
 * 与 onBackPress 的分工：那个拦"按返回键"，这个拦"点底部导航 / 别处跳过来"。
 */
export function insideBlocked(route) {
  if (!enabled()) return false;
  const cur = focus.current();
  // 与 sync() 同一口径：暂停 / 正计时 / 休息阶段一律罢手
  if (!cur || cur.paused || cur.overrun || cur.phase !== 'focus') return false;
  return !insideFree(route);
}

/**
 * 送回专注页。
 * 栈里已经有专注页就 navigateBack 回去（不然 navigateTo 会叠第二层，
 * 返回键先退回这一页、再被拦一次，来回打架）；没有才新建。
 */
export function goFocus() {
  try {
    const pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : []) || [];
    for (let i = pages.length - 1; i >= 0; i--) {
      const p = pages[i] || {};
      // ⚠️ 页面对象的 route **不带**前导斜杠，别拿 'pkgPlan/pages/focus/focus' 去比
      if (p.route === 'pkgPlan/pages/focus/focus') {
        const delta = pages.length - 1 - i;
        if (delta > 0) uni.navigateBack({ delta: delta });
        return true;
      }
    }
  } catch (e) {}
  try {
    uni.navigateTo({ url: FOCUS_ROUTE });
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 页面在 onShow 开头调一句：该送回专注页就送，并返回 true。
 * 调用方拿到 true 就直接 return —— 马上要跳走了，再刷一遍数据是白刷。
 */
export function guardInside(route) {
  if (!insideBlocked(route)) return false;
  try {
    uni.showToast({ title: i18n.t('强制模式：先把这段专注跑完'), icon: 'none' });
  } catch (e) {}
  goFocus();
  return true;
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
 * 强制模式的能力盘点 —— 界面拿它决定"该提示用户去开哪一项"。
 *
 * 四层能力，可靠性从高到低：
 *   overlay 「显示在其他应用上层」—— **唯一的"手"**，也是强制模式的准入条件。
 *           两条理由：① 它自己就能盖住那个 App（用户点不到）；
 *           ② 拿了它才命中官方豁免清单里"有 SYSTEM_ALERT_WINDOW"那一条，
 *              startActivity / moveTaskToFront 这一串才真的被放行。
 *           没它 → 其余全废（见下面"纠正"那段）。
 *   a11y    无障碍护卫 —— **只有"眼睛"**：窗口事件由系统直推前台包名，
 *           比 UsageStats 快且准，还不用额外授权。
 *           ⚠️ 它**不能**拿来拉人：无障碍服务是我们自己的组件，
 *              不属于官方豁免里"被另一个可见应用绑定"那一类，
 *              它内部 startActivity 在安卓 10+ 一样被 AMS 静默拦掉。
 *   usage   「使用情况访问」：没有无障碍时的备用"眼睛"（轮询，慢且要单独授权）
 *   native  原生桥在不在（标准基座 = false，其余全免谈）
 *
 * ⚠️ 2026-10-14 纠正：旧判据是 `(a11y || overlay)`，等于说"开了无障碍就不用悬浮窗"，
 *    于是界面显示"已就绪"而实际上一条都拉不动 —— 强制模式连着好几轮
 *    "完全没反应"就是这么来的。现在 overlay 是**必需**，不是"或"。
 *
 * @param {{a11y?:boolean, overlay?:boolean}} ext 页面实测到的两个运行时权限
 */
export function capability(ext) {
  const e = ext || {};
  const native = canPull();
  let a11y = false;
  try { a11y = e.a11y === undefined ? !!apptime.hasA11yPermission() : !!e.a11y; } catch (err) { a11y = false; }
  let overlay = false;
  try { overlay = e.overlay === undefined ? !!apptime.canDrawOverlays() : !!e.overlay; } catch (err) { overlay = false; }
  let usage = false;
  try { usage = !!apptime.hasUsagePermission(); } catch (err) { usage = false; }
  // 看门狗长在前台服务里：服务起不来，前面三条能力全是空谈
  let svc = false;        // 现在活着吗（诊断用：专注跑着的时候才应该为 true）
  try { svc = !!fgsvc.serviceAlive(); } catch (err) { svc = false; }
  let svcAllowed = false; // 设置层让不让它起（「后台保活」/「通知提醒」任一关掉 = false）
  try { svcAllowed = !!fgsvc.serviceAllowed(); } catch (err) { svcAllowed = false; }

  const canDetect = a11y || usage;
  // 缺哪一项（按"该先补哪个"排序，界面直接照着这个顺序引导）
  const missing = [];
  if (!native) missing.push('native');
  if (!svcAllowed) missing.push('svcAllowed');
  if (!overlay) missing.push('overlay');
  if (!canDetect) missing.push('detect');

  return {
    native: native,
    a11y: a11y,
    overlay: overlay,
    usage: usage,
    svc: svc,
    svcAllowed: svcAllowed,
    // 有能力把界面在我们不在前台时拉回来 —— **只有悬浮窗这一条**
    canPullBack: native && overlay,
    // 有能力判断"你现在在不在学习 App 里"
    canDetect: canDetect,
    // 真正能拦住的条件：载体在 + 看得见 + **有悬浮窗**（没它安卓 10+ 拉不动）
    effective: native && svcAllowed && overlay && canDetect,
    // 缺啥补啥：界面按这个顺序挑最要紧的一条说
    missing: missing
  };
}

/** 缺的那一项的引导文案（界面别自己写，两处写必然分叉） */
export function missingHint(cap) {
  const c = cap || {};
  const m = c.missing || [];
  if (m.indexOf('native') >= 0) return '当前是标准基座，强制模式需要自定义基座（打 APK 后才有效）';
  if (m.indexOf('svcAllowed') >= 0) return '要先打开「后台保活」和「通知提醒」—— 看门狗长在前台服务里';
  if (m.indexOf('overlay') >= 0) return '还差「显示在其他应用上层」—— 安卓 10 起不给这个权限就拉不回来';
  if (m.indexOf('detect') >= 0) return '还差「无障碍」或「使用情况访问」—— 不然不知道你现在在哪个 App';
  return '';
}

/**
 * 原生看门狗现在真的在替我们盯着吗。
 * 判"到点"是为了不漏一种情况：原生到 untilSec 会自己收手，如果我们还当它在跑，
 * JS 兜底轮询就被让位掉了 —— 结果两头没人管（这个是"暂停很久再恢复"最容易踩的坑）。
 */
export function nativeActive() {
  if (!pushedOn) return false;
  if (Date.now() >= pushedUntilMs) return false;
  // 服务被系统回收 / 进程重启过之后 pushedOn 还记着 true，看门狗却早没了。
  // 必须再问一次"它真的活着吗"，否则 JS 兜底会让位给一个不存在的人，两头都不盯。
  return !!fgsvc.serviceAlive();
}

/**
 * 由页面在开始/结束/暂停专注时调用（跟 strict.sync() 成对出现）。
 * 自带定时器，页面 onHide 也不停 —— 人切走才是它该干活的时候
 *（真正常驻后台的是原生看门狗，这里的定时器只在本进程活着时跑）。
 */
export function sync() {
  const cur = focus.current();
  // ⚠️ 正计时段一律罢手：预设时长跑满之后是"人自己还想接着学"，
  // 这时候还把人从别的 App 拽回来 / 记违规，就是把"不赶人走"做成假的。
  const should = !!(cur && !cur.paused && !cur.overrun && cur.phase === 'focus' && enabled());
  if (should === on) {
    // 状态没变也要对一次账：暂停→恢复会重算 endAt，而原生是按"还剩多少秒"掐表的，
    // 不更新就会比专注早收手（等于恢复之后其实没人盯着）。
    if (on) pushConfig(false);
    return;
  }
  on = should;
  if (on) {
    escapes = 0;
    escapeArmed = true;
    alertedAt = 0;
    lastPullAt = Date.now();
    // 战绩清零：不然上一轮专注的"逃逸 3 次"会把这轮直接判死
    try { fgsvc.resetWatchStats(); } catch (e) {}
    nativeSeen = { pulls: 0, escapes: 0 };
    pushedOn = false;
    pushedEndAt = 0;
    pushedUntilMs = 0;
    lastPushAt = 0;
    pushConfig(true);
    start();
  } else {
    stop();
  }
}

function start() {
  stop();
  timer = setInterval(check, CHECK_MS);
}

function stop() {
  if (timer) { clearInterval(timer); timer = 0; }
  escapes = 0;
  escapeArmed = true;
  nativeSeen = { pulls: 0, escapes: 0 };
  pushedOn = false;
  pushedEndAt = 0;
  pushedUntilMs = 0;
  try { fgsvc.setWatch({ on: false }); } catch (e) {}
}

/**
 * 把当前策略下发给原生看门狗。
 *
 * force=false 时按 REPUSH_MS 节流：原生是"给自己定个闹钟"而不是被 JS 每秒驱动的，
 * 定期对一次账就够，真每秒发一次 Intent 会白折腾前台服务（它每次都要重挂通知）。
 */
function pushConfig(force) {
  const cur = focus.current();
  if (!on || !cur || cur.paused || cur.overrun || cur.phase !== 'focus') {
    pushedOn = false;
    pushedEndAt = 0;
    pushedUntilMs = 0;
    try { fgsvc.setWatch({ on: false }); } catch (e) {}
    return false;
  }
  const now = Date.now();
  if (!force && pushedOn && pushedEndAt === cur.endAt && now - lastPushAt < REPUSH_MS) return true;

  let allow = '';
  try { allow = apptime.allowList().join(','); } catch (e) { allow = ''; }
  // 自愈：本该在跑、前台服务却没了（被系统回收 / 进程重启过）→ 先把它拉起来再下发。
  // 不做这一步的话，setWatch 会因为"服务不在"直接失败，而这之后 JS 兜底轮询
  // 又因为 pushedOn 是旧值而让位 —— 人切走以后彻底没人管。
  try { fgsvc.ensureStarted('PWstudy 专注中', '专注进行中'); } catch (e) {}
  // +5 秒余量：原生按"还剩多少秒"自己掐表，两边时钟差一点也不会提前松手
  const sec = Math.max(1, Math.round((cur.endAt - now) / 1000) + 5);
  let ok = false;
  try { ok = !!fgsvc.setWatch({ on: true, allow, untilSec: sec }); } catch (e) { ok = false; }
  lastPushAt = now;
  pushedEndAt = cur.endAt;
  pushedOn = ok;
  pushedUntilMs = ok ? now + sec * 1000 : 0;
  return ok;
}

function check() {
  // 兜底：计时停了就立刻收手，绝不留下一个还在轮询的定时器
  const cur = focus.current();
  if (!cur || cur.paused || cur.overrun || cur.phase !== 'focus' || !enabled()) { sync(); return; }

  // ① 定期和原生对账（内部节流），保证"还剩多少秒"跟着暂停/恢复实时更新
  pushConfig(false);

  // ② 先把原生看门狗在后台逮到的战绩并进来（人切走的那段时间全靠它）
  mergeNative();

  // ③ JS 兜底检测：插件不在 / 前台服务没起来 / 原生已经自己收手了，才真的指望它
  if (!nativeActive()) detectJs();

  if (escapesOf() >= MAX_ESCAPE) breakNow();
}

/** 读原生战绩：逃逸数涨了就提醒一次，拉回数用来显示 */
function mergeNative() {
  let st;
  try { st = fgsvc.watchStats(); } catch (e) { return; }
  if (!st) return;
  if (st.escapes > nativeSeen.escapes) {
    nativeSeen.escapes = st.escapes;
    if (nativeSeen.escapes < MAX_ESCAPE) warn();
  }
  nativeSeen.pulls = st.pulls;
}

/** JS 兜底：自己查前台是谁。规则与原生一致（白名单来自 apptime.allowList） */
function detectJs() {
  if (!apptime.supported() || !apptime.hasUsagePermission()) return;
  const pkg = apptime.foregroundPackage(LOOKBACK_MS);
  // 拿不到 = 锁屏/桌面切换中；在学习 App = 合规 → 都不动
  if (!pkg || apptime.isAllowedPkg(pkg)) { escapeArmed = true; return; }

  // 分屏兜底（2026-10-27）：平板上的强制多窗口可能仍把 PWstudy 丢进分屏，
  // 这时"前台是别的 App"会反复命中、连着 3 次把专注作废（"触发三次然后退出"）。
  // 分屏里只把 PWstudy 拉回前台、不记违规 —— 手机上已被 resizeableActivity=false 杜绝，
  // 这里是平板的保险。原生看门狗在后台也会拉，但记不记违规只在 JS 侧裁决，所以够了。
  if (apptime.isInMultiWindow()) {
    pullNow();
    return;
  }

  if (escapeArmed) {
    // 新的一次逃逸：记一笔，提醒一句
    escapeArmed = false;
    escapes += 1;
    if (escapes >= MAX_ESCAPE) return;
    warn();
  }
  pullNow();
}

function pullNow() {
  const now = Date.now();
  if (now - lastPullAt < PULL_GAP_MS) return false;
  lastPullAt = now;
  // 原生优先（前台服务持着 task，moveTaskToFront 最可靠），桥接兜底
  let pulled = false;
  try { pulled = !!fgsvc.bringToFront(); } catch (e) { pulled = false; }
  if (!pulled) { try { pulled = !!apptime.bringSelfFront(); } catch (e) { pulled = false; } }
  return pulled;
}

function warn() {
  const now = Date.now();
  if (now - alertedAt < 4000) return;   // 同一次离开别反复弹
  alertedAt = now;
  notify.alert('强制模式', '先把这段专注跑完，再去做别的');
}

/** 连续跑偏满 3 次：这次专注作废，按中断记（满 1 分钟才落账，规则同 giveUp） */
function breakNow() {
  const n = MAX_ESCAPE;
  notify.alert('本次专注已作废', '强制模式下连续 ' + n + ' 次离开学习 App，这次不算');
  try { focus.giveUp(); } catch (e) {}
  on = false;
  stop();
  try { uni.$emit('pw:forced-break', {}); } catch (e) {}
}
