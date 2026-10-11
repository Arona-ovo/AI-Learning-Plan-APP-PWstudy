// utils/apptime.js - 学习 App 的快捷访问与时长统计
//
// 计时两条腿：
//   A 前台计时（无需任何权限）：从 AppDock 点图标拉起别的 App 开始计时，
//     本 App 回到前台（onAppShow）时结算 → 精确、且能归因到"这次是去干嘛的"。
//   B 系统统计（需"使用情况访问"权限）：Android UsageStatsManager 事件流，
//     汇出当日各包前台时长 → 覆盖所有打开路径，用来校准当日总量。
// 展示口径：当日该 App 分钟 = max(B, A)。任务归因只用 A。
//
// App 端直接走 plus.android 桥（HBuilderX 支持 importClass，不需要 UTS 插件）；
// H5 / 小程序端所有函数安全降级为"不支持"。

import * as pw from './pwstore.js';

let launchMark = null;   // { pkg, at }  从 AppDock 拉起别的 App 的现场

export function supported() {
  // #ifdef APP-PLUS
  try {
    const sys = uni.getSystemInfoSync();
    return (sys.platform || sys.osName) === 'android';
  } catch (e) {}
  // #endif
  return false;
}

function main() {
  // #ifdef APP-PLUS
  return plus.android.runtimeMainActivity();
  // #endif
  return null;
}

// ---------- 权限 ----------
export function hasUsagePermission() {
  if (!supported()) return false;
  try {
    const activity = main();
    const Context = plus.android.importClass('android.content.Context');
    plus.android.importClass('android.app.AppOpsManager');
    const Process = plus.android.importClass('android.os.Process');
    const appOps = activity.getSystemService(Context.APP_OPS_SERVICE);
    const uid = Process.myUid();
    // AppOpsManager.OP_USAGE_STATS = 43；checkOpNoThrow 没有公开常量入口，用数值
    const mode = appOps.checkOpNoThrow(43, uid, activity.getPackageName());
    return mode === 0;   // MODE_ALLOWED
  } catch (e) {
    console.warn('[apptime] 权限检查失败', e);
    return false;
  }
}

export function openUsageSettings() {
  if (!supported()) return false;
  try {
    const activity = main();
    const Intent = plus.android.importClass('android.content.Intent');
    const Settings = plus.android.importClass('android.provider.Settings');
    const intent = new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS);
    activity.startActivity(intent);
    return true;
  } catch (e) {
    console.warn('[apptime] 打开权限页失败', e);
    return false;
  }
}

/** 电池优化白名单列表：番茄在后台不被杀的关键一步（无需权限，只是跳设置页） */
export function openBatterySettings() {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    const activity = main();
    const Intent = plus.android.importClass('android.content.Intent');
    // ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS
    const intent = new Intent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
    intent.addFlags(0x10000000);   // FLAG_ACTIVITY_NEW_TASK
    activity.startActivity(intent);
    return true;
  } catch (e) {
    console.warn('[apptime] 打开电池优化设置失败', e);
  }
  // #endif
  return false;
}

/**
 * 本 App 是否已在电池优化白名单里（PowerManager.isIgnoringBatteryOptimizations 是普通 API，
 * 无需权限）。true/false = 查到了；null = 查不了（老 ROM / 桥异常），交给用户自己确认。
 */
export function batteryIgnored() {
  if (!supported()) return null;
  // #ifdef APP-PLUS
  try {
    const activity = main();
    const Context = plus.android.importClass('android.content.Context');
    plus.android.importClass('android.os.PowerManager');
    const pm = activity.getSystemService(Context.POWER_SERVICE);
    return !!pm.isIgnoringBatteryOptimizations(String(activity.getPackageName()));
  } catch (e) {}
  // #endif
  return null;
}

// 国产 ROM 的「自启动 / 后台运行」管理页（包名/类名）。
// 各家入口不统一且随版本漂移 —— 这里列的是常见组合，逐个试，全都打不开就退回应用详情页
// （详情页里通常也有"电池/自启动"入口，用户多点一步而已）。
const AUTOSTART_INTENTS = {
  xiaomi: [
    'com.miui.securitycenter/com.miui.permcenter.autostart.AutoStartManagementActivity'
  ],
  huawei: [
    'com.huawei.systemmanager/com.huawei.systemmanager.startupmgr.ui.StartupNormalAppListActivity',
    'com.huawei.systemmanager/com.huawei.systemmanager.optimize.process.ProtectActivity'
  ],
  honor: [
    'com.hihonor.systemmanager/com.hihonor.systemmanager.startupmgr.ui.StartupNormalAppListActivity'
  ],
  oppo: [
    'com.coloros.safecenter/com.coloros.safecenter.permission.startup.StartupAppListActivity',
    'com.oppo.safe/com.oppo.safe.permission.startup.StartupAppListActivity'
  ],
  vivo: [
    'com.vivo.permissionmanager/com.vivo.permissionmanager.activity.BgStartUpManagerActivity',
    'com.iqoo.secure/com.iqoo.secure.ui.phoneoptimize.BgStartUpManager',
    'com.iqoo.secure/com.iqoo.secure.safeguard.PurviewTabActivity'
  ],
  meizu: [
    'com.meizu.safe/com.meizu.safe.security.SHOW_APPSEC'
  ]
};

/**
 * 跳本机的「自启动 / 后台运行」管理页（借鉴 DCloud 插件 hans-keepalive 的思路自己实现，
 * 不引插件）：按厂商逐个试已知入口，打不开退回应用详情页。永远返回 true（至少详情页能开）。
 */
export function openAutostartSettings() {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  let cands = [];
  try {
    const Build = plus.android.importClass('android.os.Build');
    // MANUFACTURER 是公开静态字段，直接读
    const man = String(Build.MANUFACTURER || '').toLowerCase();
    Object.keys(AUTOSTART_INTENTS).forEach(k => {
      if (man.indexOf(k) >= 0) cands = cands.concat(AUTOSTART_INTENTS[k]);
    });
  } catch (e) {}
  const activity = main();
  for (let i = 0; i < cands.length; i++) {
    try {
      const Intent = plus.android.importClass('android.content.Intent');
      const ComponentName = plus.android.importClass('android.content.ComponentName');
      const parts = cands[i].split('/');
      const intent = new Intent();
      intent.setComponent(new ComponentName(parts[0], parts[1]));
      intent.addFlags(0x10000000);   // FLAG_ACTIVITY_NEW_TASK
      activity.startActivity(intent);
      return true;
    } catch (e) { /* 这个厂商入口不存在，试下一个 */ }
  }
  // #endif
  // 兜底：应用详情页（各家都有，里面能找到电池/自启动相关入口）
  return openAppDetails();
}

/** 本应用的系统详情页：厂商的「自启动 / 后台运行 / 省电策略」都藏在这一页里 */
export function openAppDetails() {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    const activity = main();
    const Intent = plus.android.importClass('android.content.Intent');
    const Settings = plus.android.importClass('android.provider.Settings');
    const Uri = plus.android.importClass('android.net.Uri');
    const intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
    intent.setData(Uri.parse('package:' + String(activity.getPackageName())));
    intent.addFlags(0x10000000);   // FLAG_ACTIVITY_NEW_TASK
    activity.startActivity(intent);
    return true;
  } catch (e) {
    console.warn('[apptime] 打开应用详情失败', e);
  }
  // #endif
  return false;
}

/** 通知设置页（用户拒绝了运行时授权时的兜底入口，Android 8+） */
export function openNotifySettings() {
  if (!supported()) return false;
  // #ifdef APP-PLUS
  try {
    const activity = main();
    const Intent = plus.android.importClass('android.content.Intent');
    const Settings = plus.android.importClass('android.provider.Settings');
    const intent = new Intent('android.settings.APP_NOTIFICATION_SETTINGS');
    intent.putExtra('android.provider.extra.APP_PACKAGE', String(activity.getPackageName()));
    intent.addFlags(0x10000000);
    activity.startActivity(intent);
    return true;
  } catch (e) {
    console.warn('[apptime] 打开通知设置失败', e);
  }
  // #endif
  return false;
}

/** 通知权限（Android 13+ 需要运行时申请，13 以下永远返回 true） */
export function hasNotifyPermission() {
  if (!supported()) return true;
  // #ifdef APP-PLUS
  try {
    const Build = plus.android.importClass('android.os.Build');
    if (Number(Build.VERSION.SDK_INT) < 33) return true;   // 13 = API 33
    const activity = main();
    return Number(activity.checkSelfPermission('android.permission.POST_NOTIFICATIONS')) === 0;
  } catch (e) {}
  // #endif
  return true;
}

// ---------- 系统统计（B 腿） ----------
/**
 * 汇总 [startMs, endMs] 内各包前台毫秒。
 *
 * 主路用 queryUsageStats(INTERVAL_DAILY) + getTotalTimeInForeground()：
 * 系统直接把聚合结果给我们，比自己数事件准得多——不用处理跨天、异常退出、
 * 系统事件干扰这些边界（改这个的原因见 docs：Flutter usage_stats 与 Google 官方
 * sample 都走的这条路）。
 * 老的事件流配对法保留做降级：某些 ROM 上 queryUsageStats 会返回空。
 *
 * 返回 { 'com.xxx': minutes }；无权限 / 彻底失败返回 null。
 */
export function usageByPackage(startMs, endMs) {
  if (!supported() || !hasUsagePermission()) return null;
  const agg = usageByStats(startMs, endMs);
  if (agg && Object.keys(agg).length) return agg;
  return usageByEvents(startMs, endMs);
}

/** 主路：UsageStatsManager.queryUsageStats —— 系统聚合好的前台时长 */
function usageByStats(startMs, endMs) {
  try {
    const activity = main();
    plus.android.importClass('android.app.usage.UsageStatsManager');
    const usm = activity.getSystemService('usagestats');   // Context.USAGE_STATS_SERVICE
    // INTERVAL_DAILY = 0
    const list = usm.queryUsageStats(0, Number(startMs), Number(endMs));
    if (!list) return null;
    plus.android.importClass(list);
    const out = {};
    for (let i = 0; i < list.size(); i++) {
      const st = list.get(i);
      plus.android.importClass(st);
      const pkg = String(st.getPackageName() || '');
      // 部分 ROM 上 getTotalTimeInForeground 需要先 importClass 才调得到
      const ms = Number(st.getTotalTimeInForeground ? st.getTotalTimeInForeground() : 0);
      const m = Math.round(ms / 60000);
      if (pkg && m > 0) out[pkg] = Math.max(out[pkg] || 0, m);
    }
    return out;
  } catch (e) {
    console.warn('[apptime] queryUsageStats 失败，退回事件流', e);
    return null;
  }
}

/** 降级路：UsageEvents 事件流，手工配对前后台 */
function usageByEvents(startMs, endMs) {
  if (!supported() || !hasUsagePermission()) return null;
  try {
    const activity = main();
    const Context = plus.android.importClass('android.content.Context');
    plus.android.importClass('android.app.usage.UsageStatsManager');
    plus.android.importClass('android.app.usage.UsageEvents');
    const Event = plus.android.importClass('android.app.usage.UsageEvents$Event');
    const usm = activity.getSystemService('usagestats');   // Context.USAGE_STATS_SERVICE
    const events = usm.queryEvents(Number(startMs), Number(endMs));
    // 事件类型：1 = ACTIVITY_RESUMED（进前台），2 = ACTIVITY_PAUSED（离前台）
    const map = {};
    let lastPkg = null, lastTs = 0;
    const e = new Event();
    while (events.hasNextEvent()) {
      if (!events.getNextEvent(e)) break;
      const pkg = String(e.getPackageName() || '');
      const ts = Number(e.getTimeStamp());
      const type = Number(e.getEventType());
      if (type === 1) {
        lastPkg = pkg; lastTs = ts;
      } else if (type === 2 && lastPkg === pkg && ts > lastTs) {
        map[pkg] = (map[pkg] || 0) + (ts - lastTs);
        lastPkg = null;
      }
    }
    const out = {};
    Object.keys(map).forEach(pkg => {
      const m = Math.round(map[pkg] / 60000);
      if (m > 0) out[pkg] = m;
    });
    return out;
  } catch (e) {
    console.warn('[apptime] 读取使用统计失败', e);
    return null;
  }
}

/** 拉平当日总量：把 UsageStats 的结果写进每日统计（只覆盖 dock 登记过的包） */
export function syncToday() {
  if (!supported()) return false;
  try {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const byApp = usageByPackage(start, now.getTime());
    if (!byApp) return false;
    pw.setAppMinutes(pw.today(), byApp);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 已安装应用 ----------
// 三条路，按序兜底（打包后的正式包也可能列表不全 —— 通常是 QUERY_ALL_PACKAGES 没进 APK）：
//   路 1  getInstalledPackages：需要包可见性（QUERY_ALL_PACKAGES 或 <queries>）
//   路 2  queryIntentActivities：枚举带启动入口的应用，同样受可见性限制
//   路 3  最近使用过的 App：从 UsageStats 反查（用户授权"使用情况访问"后必可用）
//         —— 可见性再紧，"你最近用过什么"系统也是肯给的，对"挑学习 App"这个场景正好够用。
// lastAppsError 给页面一句可读的原因；queryAllPkgsGranted() 能查出权限到底进没进 APK。
export let lastAppsError = '';
export let usedUsageFallback = false;   // 路 3 兜底成功时置 true（页面可提示"列表来自最近使用"）

/** 查「查询所有应用」权限有没有真的打进 APK（null = 查不了） */
export function queryAllPkgsGranted() {
  if (!supported()) return null;
  try {
    const activity = main();
    // PackageManager.PERMISSION_GRANTED = 0
    return Number(activity.checkSelfPermission('android.permission.QUERY_ALL_PACKAGES')) === 0;
  } catch (e) {
    return null;
  }
}

/**
 * 读 Java 对象的**公开字段**。
 *
 * plus.android 的桥只保证「方法可直呼」，字段没有 getter —— 而 Android 这几个类
 * 恰恰全是公开字段：PackageInfo.packageName、ApplicationInfo.packageName / flags、
 * ResolveInfo.activityInfo、ActivityInfo.packageName。
 * 之前直接写 info.getPackageName() / ri.activityInfo：前者在 PackageInfo 上根本不存在，
 * 一调用就抛，整条路被 catch 掉 → 列表永远是空（真机"搜不到本机应用"的直接原因）。
 * 三种取法都试一遍，取到非空即返回：
 *   ① plus.android.getAttribute(obj, name) —— 官方静态入口
 *   ② obj.plusGetAttribute(name)           —— 实例入口
 *   ③ obj[name]                            —— 新版桥直接暴露字段
 */
function jattr(obj, name, dflt) {
  if (obj == null) return dflt;
  try {
    const v = plus.android.getAttribute(obj, name);
    if (v !== undefined && v !== null && typeof v !== 'function') return v;
  } catch (e) {}
  try {
    const v = obj.plusGetAttribute(name);
    if (v !== undefined && v !== null && typeof v !== 'function') return v;
  } catch (e) {}
  try {
    const v = obj[name];
    if (v !== undefined && v !== null && typeof v !== 'function') return v;
  } catch (e) {}
  return dflt;
}

/** 应用名兜底：可见性受限时拿不到 label，就用包名展示 */
function labelOf(pm, pkg) {
  try {
    const info = pm.getApplicationInfo(pkg, 0);
    plus.android.importClass(info);
    return String(pm.getApplicationLabel(info));
  } catch (e) {
    return pkg;
  }
}

export function installedApps() {
  lastAppsError = '';
  usedUsageFallback = false;
  if (!supported()) return [];
  const activity = main();
  const self = String(activity.getPackageName());
  const out = [];
  const seen = {};
  const errs = [];

  const push = (pkg, name) => {
    pkg = String(pkg || '');
    if (!pkg || pkg === self || seen[pkg]) return;
    seen[pkg] = 1;
    out.push({ pkg, name: String(name || pkg) });
  };

  try {
    const pm = activity.getPackageManager();
    plus.android.importClass(pm);
    plus.android.importClass('android.content.pm.ApplicationInfo');
    plus.android.importClass('android.content.Intent');

    // 路 1：装了哪些 App。
    // 用 getInstalledApplications → List<ApplicationInfo>：这个对象上包名（packageName）
    // 和系统标记（flags）都是公开字段，取到就能直接用 pm.getApplicationLabel 拿名字，
    // 不必再多绕一次 PackageInfo。getInstalledPackages 留作二选（个别 ROM 只认它）。
    let path1 = false;
    const sweep = (kind, flags) => {
      try {
        const list = kind === 'apps' ? pm.getInstalledApplications(flags) : pm.getInstalledPackages(flags);
        if (!list) return false;
        plus.android.importClass(list);
        for (let i = 0; i < list.size(); i++) {
          const info = list.get(i);
          plus.android.importClass(info);
          const pkg = String(jattr(info, 'packageName', '') || '');
          if (!pkg) continue;
          // ApplicationInfo.FLAG_SYSTEM = 1：系统内置应用不进"学习 App"候选
          const f = Number(jattr(info, 'flags', 0)) || 0;
          if ((f & 1) !== 0) continue;
          let name = pkg;
          try { name = String(pm.getApplicationLabel(info)); } catch (e) {}
          push(pkg, name);
        }
        return out.length > 0;
      } catch (e) {
        errs.push((kind === 'apps' ? 'getInstalledApplications' : 'getInstalledPackages') +
          '(' + flags + '): ' + (e && e.message ? String(e.message).slice(0, 80) : '失败'));
        return false;
      }
    };
    path1 = sweep('apps', 0) || sweep('apps', 128) || sweep('pkgs', 0) || sweep('pkgs', 128);

    // 路 2：枚举启动器入口（有桌面图标的才是有可能拿来学的 App）
    // ResolveInfo.activityInfo / ActivityInfo.packageName 同样是字段，走 jattr 取。
    try {
      const intent = new Intent(Intent.ACTION_MAIN);
      intent.addCategory(Intent.CATEGORY_LAUNCHER);
      const acts = pm.queryIntentActivities(intent, 0);
      plus.android.importClass(acts);
      for (let i = 0; i < acts.size(); i++) {
        const ri = acts.get(i);
        plus.android.importClass(ri);
        const ai = jattr(ri, 'activityInfo', null);
        const pkg = String(jattr(ai, 'packageName', '') || '');
        if (!pkg) continue;
        // 系统应用同样跳过：flags 在 ActivityInfo 上，取不到就退回 applicationInfo
        const f = Number(jattr(ai, 'flags', jattr(jattr(ai, 'applicationInfo', null), 'flags', 0))) || 0;
        if ((f & 1) !== 0) continue;
        let name = pkg;
        try { name = String(ri.loadLabel(pm)); } catch (e) {}
        push(pkg, name);
      }
    } catch (e) {
      errs.push('queryIntentActivities: ' + (e && e.message ? String(e.message).slice(0, 80) : '失败'));
    }

    // 路 3：最近用过的 App（UsageStats 反查）—— 前两路被可见性卡死时的保底
    if (out.length < 5 && hasUsagePermission()) {
      try {
        const used = recentPackages(60);
        used.forEach(pkg => {
          if (push(pkg, labelOf(pm, pkg)) && !usedUsageFallback) usedUsageFallback = true;
        });
        if (usedUsageFallback) {
          lastAppsError = '完整应用列表读不到（打包时「查询所有应用」权限可能没生效）。下面列出的是你最近用过的 App，够挑学习 App 用了；也可以用手动添加。';
        }
      } catch (e) {
        errs.push('usageStats: ' + (e && e.message ? String(e.message).slice(0, 80) : '失败'));
      }
    }

    out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    if (!out.length) {
      lastAppsError = '读不到应用列表。' +
        (queryAllPkgsGranted() === false
          ? '打包时「查询所有应用」权限没进 APK：请在 HBuilderX manifest 的 App 权限列表里确认 QUERY_ALL_PACKAGES 后重新打包。'
          : (errs.length ? '原因：' + errs.join('；') : '未知原因，可以试试下面的手动添加。'));
    }
    return out;
  } catch (e) {
    console.warn('[apptime] 读取应用列表失败', e);
    lastAppsError = '读取应用列表失败：' + (e && e.message ? e.message : '未知错误');
    return [];
  }
}

// ---------- 应用图标 ----------
/**
 * 获取指定包名的应用图标，返回 PNG base64（不含 data URL 前缀）。
 * 失败或拿不到时返回空字符串，由调用方用首字母兜底。
 *
 * 实现把 Drawable 画到等比缩放的 Bitmap 上再压缩为 PNG，兼容普通图标、
 * 自适应图标和矢量图标；尺寸上限 160px，避免 base64 过大。
 */
export function appIconBase64(pkg) {
  if (!supported() || !pkg) return '';
  // #ifdef APP-PLUS
  try {
    const activity = main();
    const pm = activity.getPackageManager();
    plus.android.importClass(pm);
    plus.android.importClass('android.content.pm.ApplicationInfo');
    const info = pm.getApplicationInfo(pkg, 0);
    plus.android.importClass(info);
    const drawable = pm.getApplicationIcon(info);
    if (!drawable) return '';
    plus.android.importClass(drawable);
    return drawableToBase64(drawable);
  } catch (e) {
    console.warn('[apptime] 图标获取失败', pkg, e && e.message);
    return '';
  }
  // #endif
  return '';
}

function drawableToBase64(drawable) {
  const Bitmap = plus.android.importClass('android.graphics.Bitmap');
  const BitmapConfig = plus.android.importClass('android.graphics.Bitmap$Config');
  const Canvas = plus.android.importClass('android.graphics.Canvas');
  const ByteArrayOutputStream = plus.android.importClass('java.io.ByteArrayOutputStream');
  const CompressFormat = plus.android.importClass('android.graphics.Bitmap$CompressFormat');
  const Base64 = plus.android.importClass('android.util.Base64');

  const rawW = drawable.getIntrinsicWidth ? drawable.getIntrinsicWidth() : 0;
  const rawH = drawable.getIntrinsicHeight ? drawable.getIntrinsicHeight() : 0;
  const w = Math.min(Number(rawW) || 96, 160);
  const h = Math.min(Number(rawH) || 96, 160);
  const cfg = BitmapConfig.ARGB_8888;
  const bitmap = Bitmap.createBitmap(w, h, cfg);
  const canvas = new Canvas(bitmap);
  drawable.setBounds(0, 0, w, h);
  drawable.draw(canvas);

  const os = new ByteArrayOutputStream();
  bitmap.compress(CompressFormat.PNG, 100, os);
  const bytes = os.toByteArray();
  return String(Base64.encodeToString(bytes, Base64.NO_WRAP));
}

/** 包装成 <image> 可直接显示的 data URL */
export function appIconDataUrl(pkg) {
  const b64 = appIconBase64(pkg);
  return b64 ? 'data:image/png;base64,' + b64 : '';
}

/** 近 days 天里用过（前台时长 > 0）的包名，按用时降序 */
export function recentPackages(days) {
  if (!supported() || !hasUsagePermission()) return [];
  try {
    const activity = main();
    plus.android.importClass('android.app.usage.UsageStatsManager');
    const usm = activity.getSystemService('usagestats');
    const now = Date.now();
    const list = usm.queryUsageStats(0, now - (Number(days) || 30) * 86400000, now);
    if (!list) return [];
    plus.android.importClass(list);
    const acc = {};
    for (let i = 0; i < list.size(); i++) {
      const st = list.get(i);
      plus.android.importClass(st);
      const pkg = String(st.getPackageName() || '');
      const ms = Number(st.getTotalTimeInForeground ? st.getTotalTimeInForeground() : 0);
      if (pkg && ms > 0) acc[pkg] = (acc[pkg] || 0) + ms;
    }
    return Object.keys(acc).sort((a, b) => acc[b] - acc[a]);
  } catch (e) {
    return [];
  }
}

// ---------- 快捷访问 + 前台计时（A 腿） ----------
/** 从 AppDock 拉起目标 App；记下出发时刻，回来时结算 */
export function launchApp(pkg) {
  if (!supported()) return false;
  try {
    const pm = main().getPackageManager();
    plus.android.importClass(pm);
    const intent = pm.getLaunchIntentForPackage(pkg);
    if (!intent) {
      uni.showToast({ title: '未安装或无法打开', icon: 'none' });
      return false;
    }
    plus.android.importClass(intent);
    intent.addFlags(0x10000000);   // FLAG_ACTIVITY_NEW_TASK
    main().startActivity(intent);
    launchMark = { pkg, at: Date.now() };
    return true;
  } catch (e) {
    console.warn('[apptime] 拉起失败', e);
    uni.showToast({ title: '打开失败', icon: 'none' });
    return false;
  }
}

/**
 * 强制模式用：把自己拉回前台。
 * 刻意不复用 launchApp()—— 那条路会记 AppDock 的出发时刻（launchMark），
 * 而把自己拉起来不属于"去用学习 App"，不该混进用时统计里。
 */
export function bringSelfFront() {
  if (!supported()) return false;
  try {
    const pm = main().getPackageManager();
    plus.android.importClass(pm);
    const intent = pm.getLaunchIntentForPackage(selfPkg());
    if (!intent) return false;
    plus.android.importClass(intent);
    // NEW_TASK | REORDER_TO_FRONT | SINGLE_TOP：能复用已有的专注页，不重建
    intent.addFlags(0x10000000 | 0x00020000 | 0x20000000);
    main().startActivity(intent);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- 严格模式用：现在前台是谁 ----------
/** 本 App 自己的包名 */
export function selfPkg() {
  if (!supported()) return '';
  try { return String(main().getPackageName() || ''); } catch (e) { return ''; }
}

/**
 * 最近 windowMs 毫秒内最后进入前台的包名；拿不到返回 ''。
 * 严格模式只认"确实有个 App 在前台"，拿不到就当没看见（不误伤）。
 */
export function foregroundPackage(windowMs) {
  if (!supported() || !hasUsagePermission()) return '';
  try {
    const activity = main();
    plus.android.importClass('android.app.usage.UsageEvents');
    const Event = plus.android.importClass('android.app.usage.UsageEvents$Event');
    const usm = activity.getSystemService('usagestats');
    const end = Date.now();
    const events = usm.queryEvents(end - Math.max(2000, Number(windowMs) || 15000), end);
    const e = new Event();
    let fg = '';
    while (events.hasNextEvent()) {
      if (!events.getNextEvent(e)) break;
      const type = Number(e.getEventType());
      const pkg = String(e.getPackageName() || '');
      if (type === 1) fg = pkg;            // 进前台
      else if (type === 2 && pkg === fg) fg = '';  // 离前台
    }
    return fg;
  } catch (e) {
    return '';
  }
}

// 系统里"不算跑偏"的包：桌面、状态栏、设置、电话、输入法、安装器……
// 用精确名单而不是关键词匹配——关键词里的 "android" 会把抖音之类一起放行。
const NEUTRAL = [
  'android',
  'com.android.launcher', 'com.android.launcher2', 'com.android.launcher3',
  'com.android.systemui', 'com.android.settings', 'com.android.dialer',
  'com.android.incallui', 'com.android.permissioncontroller',
  'com.android.packageinstaller', 'com.android.documentsui',
  'com.google.android.inputmethod.latin', 'com.android.inputmethod.latin',
  'com.android.keyguard', 'com.android.systemui.recents'
];

/**
 * 严格模式判定：这个包算不算"还在学"。
 * 规则：本 App + 用户登记为「学习」的 App + 系统中性包 → 放行；
 *       登记为「休息」的、没登记过的 → 算跑偏。拿不到包名一律放行（不误伤）。
 */
export function isAllowedPkg(pkg) {
  const p = String(pkg || '');
  if (!p) return true;
  if (p === selfPkg()) return true;
  if (NEUTRAL.indexOf(p) >= 0) return true;
  try {
    const hit = pw.dock().filter(a => a.pkg === p)[0];
    if (!hit) return false;
    return hit.purpose !== 'rest';
  } catch (e) {
    return true;
  }
}

/** App 回到前台时由 App.vue onShow 调用：结算刚才从 AppDock 出去的那段时长 */
export function onAppShow() {
  if (!launchMark) return;
  const mark = launchMark;
  launchMark = null;
  const min = Math.round((Date.now() - mark.at) / 60000);
  if (min >= 1) {
    try {
      const isDock = pw.dock().some(a => a.pkg === mark.pkg);
      if (isDock) pw.addAppMinutes(pw.today(), mark.pkg, min);
    } catch (e) {}
  }
}
