// utils/notify.js - App 端系统通知（番茄钟常驻倒计时 / 结束提醒 / 严格模式提醒）
//
// 为什么单独一个模块：番茄钟切后台、息屏后页面定时器会被系统限制，
// 只有系统通知能在状态栏把"还剩多久"持续露出来，结束时也靠它把人叫回来。
//
// 三条硬规矩：
//   1) 全是 App(Android) 端能力，H5 / 小程序一律安全返回 false，绝不报错。
//   2) 每一步都 try/catch：拿不到图标、建不了渠道、没通知权限，都退化成"没通知"，
//      绝不能因为通知失败把番茄钟搞崩。
//   3) 常驻通知用固定 id 反复 notify 同一个 id 来"刷新文案"，不要反复新建。
//
// 关于"真正的前台服务"：JS 层起不了 Service（需要原生插件 / UTS + 自定义基座）。
// 这里退而求其次：常驻通知 + 可选的 WakeLock + 按 endAt 补账（focus.js 已经会补），
// 息屏期间倒计时可能不准，但回到前台/解锁后一定是对的。要 100% 后台精度需上原生插件。

import * as sfx from './sfx.js';

const ID_ONGOING = 8801;
const ID_ALERT = 8802;
const ID_REMIND = 8810;                  // 每日提醒：一目标一条，id 从这里往后排
const ID_SLOT = 8860;                    // 时段提醒：目标×时段，排在每日提醒后面
const CH_ONGOING = 'pw_focus_ongoing';   // 常驻：低打扰，不出声
const CH_ALERT = 'pw_focus_alert';       // 结束提醒：高打扰，出声
const CH_REMIND = 'pw_daily_remind';     // 每日提醒：中打扰，到点催一句

// PendingIntent 标志位（plus.android 读不到静态常量，用数值）
const FLAG_UPDATE_CURRENT = 134217728;   // 0x08000000
const FLAG_IMMUTABLE = 67108864;         // 0x04000000
const FLAG_CLEAR_TOP = 67108864;         // 0x04000000
const FLAG_SINGLE_TOP = 536870912;       // 0x20000000

let wake = null;

export function supported() {
  // #ifdef APP-PLUS
  try {
    const sys = uni.getSystemInfoSync();
    return (sys.platform || sys.osName) === 'android';
  } catch (e) {}
  // #endif
  return false;
}

function activity() {
  // #ifdef APP-PLUS
  try { return plus.android.runtimeMainActivity(); } catch (e) {}
  // #endif
  return null;
}

/** 读 Java 对象的字段（plus.android 下 public 字段有时要 plusGetAttribute） */
function field(obj, name, dft) {
  if (!obj) return dft;
  try {
    if (typeof obj.plusGetAttribute === 'function') return obj.plusGetAttribute(name);
  } catch (e) {}
  try { return obj[name]; } catch (e) {}
  return dft;
}

function ctx() {
  const a = activity();
  if (!a) return null;
  return a;
}

function manager() {
  // #ifdef APP-PLUS
  try {
    const a = activity();
    const Context = plus.android.importClass('android.content.Context');
    return a.getSystemService(Context.NOTIFICATION_SERVICE);
  } catch (e) {}
  // #endif
  return null;
}

/** 申请通知权限（Android 13+ 必须；用户拒绝只是没通知，不影响别的） */
export function requestPermission() {
  if (!supported()) return;
  // #ifdef APP-PLUS
  try {
    plus.android.requestPermissions(
      ['android.permission.POST_NOTIFICATIONS'],
      () => {},
      () => {}
    );
  } catch (e) {}
  // #endif
}

/** 建通知渠道（Android 8+）。importance: 2 = LOW，4 = HIGH */
function ensureChannel(id, name, importance, desc) {
  // #ifdef APP-PLUS
  try {
    const a = activity();
    const Context = plus.android.importClass('android.content.Context');
    const NotificationManager = plus.android.importClass('android.app.NotificationManager');
    const NotificationChannel = plus.android.importClass('android.app.NotificationChannel');
    const nm = a.getSystemService(Context.NOTIFICATION_SERVICE);
    if (!nm) return null;
    // 已存在就直接用（重复 create 无害，但省一次调用）
    const ch = new NotificationChannel(id, name, importance);
    ch.setDescription(desc || '');
    // 不调 setSound/enableVibration：plus.android 传 null 参数容易炸，
    // 而 LOW(2) 重要级渠道本来就不出声，省事又稳。
    nm.createNotificationChannel(ch);
    return id;
  } catch (e) {
    return null;
  }
  // #endif
  return null;
}

function smallIconId() {
  // #ifdef APP-PLUS
  try {
    const a = activity();
    const ai = a.getApplicationInfo();
    const id = field(ai, 'icon', 0);
    return Number(id) || 0;
  } catch (e) {}
  // #endif
  return 0;
}

/** 点通知回到本 App */
function contentIntent() {
  // #ifdef APP-PLUS
  try {
    const a = activity();
    const pm = a.getPackageManager();
    plus.android.importClass(pm);
    const intent = pm.getLaunchIntentForPackage(String(a.getPackageName()));
    if (!intent) return null;
    plus.android.importClass(intent);
    intent.addFlags(FLAG_CLEAR_TOP | FLAG_SINGLE_TOP);
    const PendingIntent = plus.android.importClass('android.app.PendingIntent');
    const pi = PendingIntent.getActivity(a, 0, intent, FLAG_UPDATE_CURRENT | FLAG_IMMUTABLE);
    return pi;
  } catch (e) {}
  // #endif
  return null;
}

function buildNotification(title, text, opt) {
  // #ifdef APP-PLUS
  try {
    const a = activity();
    const Builder = plus.android.importClass('android.app.Notification$Builder');
    const channelId = (opt && opt.channelId) || '';
    let builder = null;
    try {
      builder = channelId ? new Builder(a, channelId) : new Builder(a);
    } catch (e) {
      builder = new Builder(a);
    }
    plus.android.importClass(builder);
    builder.setContentTitle(String(title || 'PWstudy'));
    builder.setContentText(String(text || ''));
    const icon = smallIconId();
    if (icon) builder.setSmallIcon(icon);
    builder.setWhen(Date.now());
    builder.setOnlyAlertOnce(true);          // 刷新文案时不重复响铃
    const pi = contentIntent();
    if (pi) builder.setContentIntent(pi);
    if (opt && opt.ongoing) {
      builder.setOngoing(true);
      builder.setAutoCancel(false);
    } else {
      builder.setOngoing(false);
      builder.setAutoCancel(true);
    }
    return builder.build();
  } catch (e) {
    return null;
  }
  // #endif
  return null;
}

/**
 * 常驻倒计时通知（反复调用同一个 id 就是"刷新"）。
 * @param {{title,text,phase}} o
 */
export function showOngoing(o) {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    ensureChannel(CH_ONGOING, '专注进行中', 2, '番茄钟倒计时，低打扰');
    const nm = manager();
    if (!nm) return false;
    const n = buildNotification(o && o.title, o && o.text, { channelId: CH_ONGOING, ongoing: true });
    if (!n) return false;
    nm.notify(ID_ONGOING, n);
    return true;
  } catch (e) {
    return false;
  }
  // #endif
  return false;
}

/** 只是刷新文案（不用再建渠道也能覆盖） */
export function updateOngoing(title, text) {
  return showOngoing({ title, text });
}

export function cancelOngoing() {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    const nm = manager();
    if (!nm) return false;
    nm.cancel(ID_ONGOING);
    return true;
  } catch (e) {}
  // #endif
  return false;
}

/** 一次性提醒（结束、严格模式拦截）—— 出声 + 震动，点掉就没 */
export function alert(title, text) {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    ensureChannel(CH_ALERT, '专注提醒', 4, '番茄结束与严格模式提醒');
    const nm = manager();
    if (!nm) return false;
    const n = buildNotification(title, text, { channelId: CH_ALERT, ongoing: false });
    if (!n) return false;
    nm.notify(ID_ALERT, n);
    return true;
  } catch (e) {
    return false;
  }
  // #endif
  return false;
}

/**
 * 每日提醒（目标规划里定的时间到了）。
 * @param {string} title
 * @param {string} text
 * @param {number} slot 第几个目标（0 起）：一目标一条，别互相顶掉
 */
export function remind(title, text, slot) {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    ensureChannel(CH_REMIND, '每日提醒', 3, '到点提醒今天该做的事');
    const nm = manager();
    if (!nm) return false;
    const n = buildNotification(title, text, { channelId: CH_REMIND, ongoing: false });
    if (!n) return false;
    nm.notify(ID_REMIND + (Number(slot) || 0), n);
    return true;
  } catch (e) {
    return false;
  }
  // #endif
  return false;
}

/**
 * 时段提醒：任务排在早 / 中 / 晚哪一段，那段一开始就催一句。
 * 与每日提醒用同一个渠道（都是"该开始了"），但 id 另起一段，互不覆盖。
 */
export function slotNotify(title, text, slot) {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    ensureChannel(CH_REMIND, '每日提醒', 3, '到点提醒今天该做的事');
    const nm = manager();
    if (!nm) return false;
    const n = buildNotification(title, text, { channelId: CH_REMIND, ongoing: false });
    if (!n) return false;
    nm.notify(ID_SLOT + (Number(slot) || 0), n);
    return true;
  } catch (e) {
    return false;
  }
  // #endif
  return false;
}

// ---------- 震动 / 音效 ----------
export function vibrate(ms) {
  try {
    if (typeof uni !== 'undefined' && uni.vibrateLong) {
      uni.vibrateLong({ success: () => {}, fail: () => {} });
      return true;
    }
  } catch (e) {}
  return false;
}

export function beep() {
  try {
    // 复用答题音效里的"正确"（钟琴感），不新增素材。
    // force：这个开关是 focus.sound（专注页「结束响铃」），
    // 不要再过 sfx 自己的 voice.sfx（那是设置里另一栏）判断，否则会出现
    // "响铃开关开了却没声音"（真机反馈过）。
    return !!sfx.play('correct', { force: true });
  } catch (e) {}
  return false;
}

// ---------- 可选：息屏保持 CPU（默认不开，见 settings.focus.wakeLock） ----------
export function acquireWake(minutes) {
  if (!supported() || wake) return false;
  // #ifdef APP-PLUS
  try {
    const a = activity();
    const Context = plus.android.importClass('android.content.Context');
    plus.android.importClass('android.os.PowerManager');
    const pm = a.getSystemService(Context.POWER_SERVICE);
    wake = pm.newWakeLock(1, 'pwstudy:focus');   // PARTIAL_WAKE_LOCK = 1
    plus.android.importClass(wake);
    wake.acquire(Math.max(1, Number(minutes) || 25) * 60 * 1000);
    return true;
  } catch (e) {
    wake = null;
    return false;
  }
  // #endif
  return false;
}

export function releaseWake() {
  if (!wake) return false;
  try { wake.release(); } catch (e) {}
  wake = null;
  return true;
}
