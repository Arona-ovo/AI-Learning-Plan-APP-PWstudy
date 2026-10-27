// utils/fgsvc.js - 专注前台服务包装（UTS 插件 pwstudy-focus 的唯一调用方）
//
// 分层：
//   · 真正的前台 Service 必须走 UTS 插件（Service 要在 AndroidManifest 里声明，
//     plus.android 桥做不到），插件在 uni_modules/pwstudy-focus；
//   · 页面和 focus.js 永远只 import 本模块 —— 插件有没有、调用炸不炸，都在这里兜住：
//     标准基座（没打自定义基座）里 UTS 原生代码不存在，调用会失败 → 全部静默降级回
//     notify.js 的"常驻通知 + endAt 补账"老路，功能不缺、只是保活弱一档。
//
// 开关：settings.focus.fgservice（默认 true）。专注开关"通知提醒"关掉时也不启用
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

/**
 * 设置层面允不允许起前台服务（后台保活开关开 + 通知开）。
 *
 * ⚠️ 强制模式完全依赖它：看门狗就长在前台服务里。用户把「后台保活」或「通知提醒」
 * 关掉，服务根本起不来，强制模式形同虚设 —— 所以这个开关要暴露给界面，
 * 好在开强制模式时如实提示"你关掉了 XX，拉回功能起不来"。
 */
export function serviceAllowed() {
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

/** 专注开始 / 恢复现场：起前台服务。失败（不可用/标准基座）返回 false，调用方走老路 */
export function start(title, text) {
  if (!serviceAllowed() || !available()) return false;
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

/** 专注结束 / 放弃：停服务、撤常驻通知（看门狗跟着服务一起收摊，见 onDestroy） */
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

/**
 * 前台服务现在是否真的活着（不是"我们起过"的记账）。
 *
 * 为什么要这个：服务被系统回收后，`active` 还是 true —— JS 侧据此认为"原生在盯"，
 * 于是自己的兜底轮询也让位（utils/forced.js 的 nativeActive），结果两头没人管。
 * 这是"强制模式开着却完全没反应"里最容易漏掉的一种。
 */
export function serviceAlive() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.serviceAlive === 'function') return !!fgs.serviceAlive();
    return active;    // 老基座没这个探测：退回记账值
  } catch (e) {}
  // #endif
  return false;
}

/**
 * 把前台服务重新拉起来（自愈用）。
 * 只有"本该在跑却没在跑"时才调 —— 平时乱起会给用户甩一条莫名其妙的常驻通知。
 */
export function ensureStarted(title, text) {
  if (!available()) return false;
  if (serviceAlive()) { active = true; return true; }
  return start(title, text);
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

/* ==================== 无障碍护卫（强制模式的"眼睛"） ====================
 *
 * ⚠️ 2026-10-14 纠正掉一条**错误结论**，别再照它改回去：
 *   旧注释写的是"官方豁免清单里列了'由系统绑定的服务（无障碍…）'，所以无障碍服务
 *   startActivity 才拉得动"。**这是错的**，而且它是强制模式连着好几轮"完全没反应"
 *   的根源 —— 每一轮都基于它去加固，越加固越错。
 *
 *   官方《Activity security》后台启动的豁免是：
 *     有可见窗口 / 是输入法 / **有 SYSTEM_ALERT_WINDOW** / 有系统特权 /
 *     **被"另一个可见应用"的服务绑定** / 系统发的 PendingIntent。
 *   无障碍服务是**我们自己这个 App** 的组件，不是"另一个可见应用"，
 *   所以它内部 startActivity 在安卓 10+ 一样被 AMS 静默拦掉（**不抛异常**，
 *   于是 pullSelf 永远返回 true、界面永远显示"已就绪"，实际一动不动）。
 *
 * 纠正后的定位：
 *   ① 无障碍服务的价值只剩一条 —— **它是"眼睛"**：窗口事件由系统直推，
 *      比轮询 UsageStats 快得多也准得多，而且**不再需要**用户单独授「使用情况访问」。
 *   ② 真正能"拉回来"的只有悬浮窗（SYSTEM_ALERT_WINDOW）：它既能直接盖住那个 App，
 *      又顺带让上面豁免清单里的那条成立，于是 startActivity 才真的被放行。
 *      所以悬浮窗是强制模式的**准入条件**，不是"可选兜底"。
 *
 * 查询有成本（要问 AccessibilityManager），所以缓存 —— 但缓存必须能被"主动失效"：
 * 用户刚从设置页回来时，界面立刻要知道新状态（见 invalidateA11y）。
 */
let a11yCached = null;   // null = 没查过；true/false = 上次查到的结果

/** 无障碍护卫是否已在系统里开启 */
export function a11yEnabled() {
  if (a11yCached !== null) return a11yCached;
  let r = false;
  // #ifdef APP-PLUS
  try {
    if (available() && typeof fgs.a11yEnabled === 'function') r = !!fgs.a11yEnabled();
  } catch (e) {
    r = false;
  }
  // #endif
  a11yCached = r;
  return r;
}

/** 丢掉缓存的授权状态（从系统设置页回来时调一次，否则会一直显示旧值） */
export function invalidateA11y() {
  a11yCached = null;
}

/** 护卫是否已连上 + 收了多少窗口事件（界面显示"它确实在干活"） */
export function a11yStats() {
  let on = false, events = 0, pkg = '';
  // #ifdef APP-PLUS
  try {
    if (available()) {
      if (typeof fgs.a11yActive === 'function') on = !!fgs.a11yActive();
      if (typeof fgs.a11yEvents === 'function') events = Number(fgs.a11yEvents()) || 0;
      if (typeof fgs.a11yPkg === 'function') pkg = String(fgs.a11yPkg() || '');
    }
  } catch (e) {}
  // #endif
  return { on: on, events: events, pkg: pkg };
}

/**
 * 无障碍护卫的保险丝有没有跳过闸。
 *
 * 服务是**系统**绑的：绑定过程中抛异常 → 系统杀进程 → 重 bind → 再崩，
 * 循环起来的表现就是"APP 和整机一起卡死"。插件内部数着窗口期内的 bind 次数，
 * 超了就把自己变成空壳（不再碰任何状态、不再收事件）。
 * 返回 false = 已经躺平，界面必须如实说"这个 ROM 上起不来"，
 * 别再引导用户去开一个开了也没用（而且可能又卡）的开关。
 */
export function a11ySafe() {
  if (!available()) return true;      // 插件不在 → 谈不上跳闸
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.a11ySafe === 'function') return fgs.a11ySafe() !== false;
  } catch (e) {}
  // #endif
  return true;
}

/** 重置保险丝（设置页"再试一次"）：清掉计数，下次被系统 bind 时重新正常初始化 */
export function resetA11y() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.resetA11y === 'function') return !!fgs.resetA11y();
  } catch (e) {}
  // #endif
  return false;
}

/** 跳系统「无障碍」设置页；失败（插件不在）返回 false，调用方退到应用详情页 */
export function openA11ySettings() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.openA11ySettings === 'function') return !!fgs.openA11ySettings();
  } catch (e) {}
  // #endif
  return false;
}

/** 有没有"能用无障碍"的原生能力（标准基座 = false，界面上要如实说明） */
export function a11ySupported() {
  return available();
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
 *        untilSec 是兜底的自动收手倒计时（= 这段专注还剩多少秒）。
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

/**
 * 强制模式自检快照。
 *
 * 为什么要有：这条链有十几环（前台服务 → 看门狗 → 探测前台 → 判定跑偏 → 拉回 → 遮罩），
 * 任何一环断掉都表现成同一个"没反应"。与其每轮猜一次再发个包，不如让界面把
 * 每一环的实测值直接列出来 —— 用户一眼就能说出断在哪。
 *
 * @returns {{svc:boolean, watch:boolean, fg:string, src:string, episode:boolean,
 *            tries:number, blind:number, allowN:number, pulls:number, escapes:number,
 *            ovGrant:boolean, ovWanted:boolean, ovOn:boolean, a11y:boolean,
 *            a11yEv:number, tripped:boolean}}
 */
export function watchDiag() {
  const empty = {
    svc: false, watch: false, fg: '', src: '', episode: false, tries: 0, blind: 0,
    allowN: 0, pulls: 0, escapes: 0, ovGrant: false, ovWanted: false, ovOn: false,
    a11y: false, a11yEv: 0, tripped: false
  };
  // #ifdef APP-PLUS
  try {
    if (!available() || typeof fgs.watchDiag !== 'function') return empty;
    const raw = String(fgs.watchDiag() || '');
    if (!raw) return empty;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object') return empty;
    const b = (v) => v === 1 || v === '1' || v === true;
    const n = (v) => Number(v) || 0;
    return {
      svc: b(o.svc), watch: b(o.watch), fg: String(o.fg || ''), src: String(o.src || ''),
      episode: b(o.episode), tries: n(o.tries), blind: n(o.blind), allowN: n(o.allowN),
      pulls: n(o.pulls), escapes: n(o.escapes), ovGrant: b(o.ovGrant),
      ovWanted: b(o.ovWanted), ovOn: b(o.ovOn), a11y: b(o.a11y),
      a11yEv: n(o.a11yEv), tripped: b(o.tripped)
    };
  } catch (e) {}
  // #endif
  return empty;
}

/** 原生侧实测的悬浮窗权限（遮罩是原生挂的，判定以原生这份为准） */
export function overlayGranted() {
  // #ifdef APP-PLUS
  try {
    if (available() && typeof fgs.overlayGranted === 'function') return !!fgs.overlayGranted();
  } catch (e) {}
  // #endif
  return false;
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

/** 清零战绩（每轮专注开始时调一次，不然上一轮的数字会滚进来） */
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

/* ==================== 专注期拦截通知（通知使用权） ====================
 *
 * 番茄ToDo 的做法（2026-10-15 视频 + 用户截图实测）：
 *   专注期间把别家 App 的通知**捕获并当场撤下**（下拉通知栏也看不到），
 *   专注结束再把攒下的汇总成一条"已拦截(应用)的通知"发出来。
 *
 * 为什么不用免打扰（setInterruptionFilter）：它只能压掉通知，**拿不到内容**，
 * 结束时想汇总就做不了 —— 所以必须走 NotificationListenerService（通知使用权）。
 *
 * 开关与授权：
 *   · 必须有开关，而且默认关 —— 替用户收起通知这种事不能默认就做；
 *   · 权限是运行时授权：用户在「设置 → 通知使用权」里亲手给；
 *   · 没授权就如实返回 false，绝不假称"已经帮你挡住了"。
 *
 * 为什么仍然放在本文件：插件只能有这一个调用方（见文件头），
 * 通知监听不是前台服务，但它是同一个 UTS 插件导出的能力。
 */

/** 用户有没有把「通知使用权」给 PWstudy */
export function notifGranted() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.notifGranted === 'function') return !!fgs.notifGranted();
  } catch (e) {}
  // #endif
  return false;
}

/** 跳系统「通知使用权」设置页；失败返回 false，调用方退到应用详情页 */
export function openNotifSettings() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.openNotifSettings === 'function') return !!fgs.openNotifSettings();
  } catch (e) {}
  // #endif
  return false;
}

/**
 * 开始拦截（此后别家通知：记内容 + 当场撤下，下拉通知栏看不到）。
 * 返回 true 才表示"真的开始了" —— 没授权 / 插件不在都是 false，
 * 调用方据此决定结束时能不能说"已拦截 N 条"。
 */
export function interceptStart() {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.interceptStart === 'function') return !!fgs.interceptStart();
  } catch (e) {}
  // #endif
  return false;
}

/**
 * 结束拦截：返回拦截到的列表 [{ app, title, text }]（最多 30 条，单条截断 60 字）。
 * JS 层拿它拼"已拦截"汇总通知（用户截图同款）。没拦到就返回 []。
 */
export function interceptEnd() {
  if (!available()) return [];
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.interceptEnd === 'function') {
      const raw = String(fgs.interceptEnd() || '[]');
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.filter(x => x && typeof x === 'object') : [];
    }
  } catch (e) {}
  // #endif
  return [];
}

/** 这段专注已经拦了几条（实时显示用） */
export function interceptCount() {
  if (!available()) return 0;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.interceptCount === 'function') return Number(fgs.interceptCount()) || 0;
  } catch (e) {}
  // #endif
  return 0;
}

/* ==================== 把系统级 Service 类钉进编译产物 ====================
 *
 * ⚠️ 这是「消息拦截还是不生效」的根因：UTS 编译器会剪掉"代码里没人引用"的声明，
 *   而 PFGuardService（强制模式无障碍护卫）/ PWNotifListener（专注期拦截通知）都是
 *   **系统按清单创建**的服务，源码里从不被 new —— 若这两个 keep 函数不被真正调用，
 *   整个类（连同只被它用到的私有方法）就被整块剪掉，打出的 dex 里没有这个类，
 *   但清单里却声明了它 → 用户在系统设置里打开开关只会拿到 ClassNotFoundException，
 *   表现为"开关开了、权限也给了，通知照样弹 / 强制模式拉不回来"。
 *
 * 判据见 _tools/check-uts.js §9.2（源码里必须有 new <Cls>(）。本函数两个 new 都在，
 * 但只有被调用，才会进入可达代码路径，防止被 DCE 剪掉。App 启动调一次即可
 * （见 App.vue onLaunch），重入安全（插件不可用 / 标准基座下静默跳过）。 */
export function keepNativeClasses() {
  if (!available()) return;
  // #ifdef APP-PLUS
  try { if (typeof fgs.keepGuardClass === 'function') fgs.keepGuardClass(); } catch (e) {}
  try { if (typeof fgs.keepNotifClass === 'function') fgs.keepNotifClass(); } catch (e) {}
  // #endif
}

/* ==================== 白噪音原生播放（后台不中断）====================
 *
 * 原生 android.media.MediaPlayer 播循环白噪音，替代 WebView 系的
 * uni.createInnerAudioContext（后者在 App 退后台时音频上下文被回收，报 -5）。
 * 仅自定义基座（available() = true）下走原生；否则 ambient.js 自动回退 InnerAudioContext。
 * 所有调用都 try 兜住 —— 插件不可用 / 调用炸了就当作"不支持原生"，让 ambient.js 走兜底。 */

/** 开始/切换循环播放。absPath 本地 wav 绝对路径；vol 0~1；loop 是否循环。返回 true=发起成功 */
export function ambientStart(absPath, vol, loop) {
  if (!available()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.ambientStart === 'function') {
      const r = Number(fgs.ambientStart(absPath, vol, !!loop)) || 0;
      return r === 0;
    }
  } catch (e) {}
  // #endif
  return false;
}

export function ambientPause() {
  if (!available()) return;
  // #ifdef APP-PLUS
  try { if (typeof fgs.ambientPause === 'function') fgs.ambientPause(); } catch (e) {}
  // #endif
}

export function ambientResume() {
  if (!available()) return;
  // #ifdef APP-PLUS
  try { if (typeof fgs.ambientResume === 'function') fgs.ambientResume(); } catch (e) {}
  // #endif
}

export function ambientStop() {
  if (!available()) return;
  // #ifdef APP-PLUS
  try { if (typeof fgs.ambientStop === 'function') fgs.ambientStop(); } catch (e) {}
  // #endif
}

/** 最近一次错误描述（'' = 无错误） */
export function ambientError() {
  if (!available()) return '';
  // #ifdef APP-PLUS
  try { if (typeof fgs.ambientError === 'function') return String(fgs.ambientError() || ''); } catch (e) {}
  // #endif
  return '';
}

/* ==================== 悬浮灵动岛倒计时胶囊 ====================
 *
 * 一条**独立**的悬浮窗（与强制模式遮罩解耦）。用户授了悬浮窗权限 + 打开「灵动岛」开关、
 * 且本 App 退到后台时，就挂出专注倒计时胶囊；点一下胶囊 = 把 PWstudy 拉回前台
 * （复用强制模式的 PullNowTask 拉回链路）。
 *
 * 权限：和强制模式遮罩共用 SYSTEM_ALERT_WINDOW，这里直接复用 overlayGranted() 探，
 * 不另引 apptime（apptime 已反过来依赖本模块，避免成环 —— 见 utils/apptime.js 头部）。
 * 真正的挂/撤/权限自检在原生侧（applyCapsule 里还会再核一次 canDrawOverlays）。
 */

/** 用户是否授权了"显示在其他应用上层"（胶囊的准入条件） */
export function capsuleGranted() {
  return overlayGranted();
}

/**
 * 挂出胶囊（已是挂出态则刷新文案）。
 * @param {string} text   JS 侧算好的即时文案（兜底 / 首帧）
 * @param {number} endAt  倒计时终点 ms；0 = 不让原生自转（暂停 / 正计时段由 JS 静态显示）
 * @param {string} label  阶段前缀（"专注中 " / "休息中 "），原生每秒拼上剩余时间
 */
export function capsuleShow(text, endAt, label) {
  if (!capsuleGranted()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.showCapsule === 'function') return !!fgs.showCapsule(String(text || ''), Number(endAt) || 0, String(label || ''));
  } catch (e) {}
  // #endif
  return false;
}

/**
 * 刷新胶囊文案与终点（已挂则改字，未挂则按 show 处理）。
 * @param {string} text
 * @param {number} endAt
 * @param {string} label
 */
export function capsuleUpdate(text, endAt, label) {
  if (!capsuleGranted()) return false;
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.updateCapsule === 'function') return !!fgs.updateCapsule(String(text || ''), Number(endAt) || 0, String(label || ''));
  } catch (e) {}
  // #endif
  return false;
}

/** 撤掉胶囊（本 App 回到前台 / 专注结束 / 开关关掉时调） */
export function capsuleHide() {
  // #ifdef APP-PLUS
  try {
    if (typeof fgs.hideCapsule === 'function') return !!fgs.hideCapsule();
  } catch (e) {}
  // #endif
  return false;
}

function pushWatch() {
  // 服务没在跑就别去推：随便 startService 会把它又拽起来（放弃专注后重启前台服务，
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
