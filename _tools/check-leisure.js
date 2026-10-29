// _tools/check-leisure.js - 休闲关注（休闲 App 静默统计 + 打开/后台双路径提醒）的校验
// 运行：node _tools/check-leisure.js
//
// 需求原话（2026-10-28）：
//   「让用户把休闲用的 APP 也都选中，后台静默统计……在抖音看的时间特别久、或者没有专注
//     在看 B 站，就要通过 APP 发消息给他」「类似多邻国那样能发消息通知你」「默认开启」
//
// 这个功能有三个特别容易悄悄坏掉的地方，静态守它们：
//   1) **默认开**是用户点名的，但"开 + 没选 App"必须等同关闭 —— 一旦哪天有人把
//      `pkgs: []` 改成预置清单，新装用户第一天就被陌生通知轰炸。
//   2) **两条腿**：A 打开 App 时提醒（纯 JS，稳）、B 后台原生提醒（App 关着也能推）。
//      只留 A 就做不到"刷抖音时弹"，只留 B 就依赖自定义基座 —— 必须两条都在。
//   3) **原生的编译雷区**：Number(x) / String(x) / Array.join 在生成的 Kotlin 里编不过，
//      而且只有云打包才报错（本地全绿）。这三样一旦混进去，整包打不出来。
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const SETTINGS = path.join(ROOT, 'utils', 'settings.js');
const LEISURE = path.join(ROOT, 'utils', 'leisure.js');
const PWS = path.join(ROOT, 'utils', 'pwstore.js');
const FOCUS = path.join(ROOT, 'utils', 'focus.js');
const NOTIFY = path.join(ROOT, 'utils', 'notify.js');
const FGSVC = path.join(ROOT, 'utils', 'fgsvc.js');
const APP_VUE = path.join(ROOT, 'App.vue');
const SET_VUE = path.join(ROOT, 'pkgManage', 'pages', 'settings', 'settings.vue');
const PAGES = path.join(ROOT, 'pages.json');
const IFACE = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'interface.uts');
const UTSSRC = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'index.uts');
const MANIFEST = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'AndroidManifest.xml');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

// ⚠️ Windows 工作区里这些文件可能是 CRLF（index.uts 就是）—— 正则里写 \n 会**静默落空**
//    （断言不报错但永远匹配不上，等于假绿）。跟 check-haptic / check-vue / neg-uts 同一套处理。
const R = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sett = R(SETTINGS);
const lei = R(LEISURE);
const pws = R(PWS);
const foc = R(FOCUS);
const ntf = R(NOTIFY);
const fgs = R(FGSVC);
const appv = R(APP_VUE);
const setv = R(SET_VUE);
const pages = R(PAGES);
const iface = R(IFACE);
const uts = R(UTSSRC);
const mf = R(MANIFEST);

/**
 * 切出某个函数的函数体（配大括号）。
 * ⚠️ 别用 `fn\(\)[\s\S]{0,240}` 这种有界窗口 —— 多插两行就假红（第 22 条硬约束）。
 */
function fnBody(src, name) {
  // 两种形态：`export function name(` 与 vue 里的缩进方法 `  name() {`
  // 顺序不能反：先试缩进形态会命中调用处，切出几十个字符的假函数体（已踩）
  let m = new RegExp('^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(', 'm').exec(src);
  // 缩进形态里可能带修饰符（`  override onReceive(`），要一并放行
  if (!m) m = new RegExp('^[ \\t]{2,6}(?:override\\s+|public\\s+|private\\s+)?' + name + '\\s*\\(', 'm').exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

/* ---------- 1. 出厂默认：默认开，但默认不选任何 App ---------- */
console.log('== 1. 出厂默认（settings.js）==');
const lBlock = (/leisure:\s*\{([\s\S]*?)\n\s{4}\}/.exec(sett) || [])[1] || '';
assert(lBlock.length > 0, 'settings.js 里有 leisure 出厂默认块');
const field = (k) => {
  const m = new RegExp('(?:^|[\\s{,])' + k + ':\\s*([^,\\n]+)').exec(lBlock);
  return m ? m[1].trim() : '';
};
assert(field('on') === 'true', '★ leisure.on 出厂为 true（用户明确要求"默认开启"）');
assert(field('pkgs') === '[]',
  '★ pkgs 出厂是空数组（默认开 + 没选 App = 等同关闭，新装用户零打扰）');

const num = (k) => {
  const v = Number(field(k));
  return Number.isFinite(v) ? v : NaN;
};
const dwell = num('dwellMin'), daily = num('dailyMin'), maxN = num('maxPerDay');
assert(dwell >= 10 && dwell <= 60, 'dwellMin=' + dwell + ' 落在 10~60 分钟（太小天天弹、太大没用）');
assert(daily >= 60 && daily <= 300, 'dailyMin=' + daily + ' 落在 60~300 分钟');
assert(maxN >= 1 && maxN <= 6, 'maxPerDay=' + maxN + ' 落在 1~6 条（防轰炸）');
const qf = num('quietFrom'), qt = num('quietTo');
assert(qf >= 0 && qf <= 23 && qt >= 0 && qt <= 23, '静默时段 quietFrom/quietTo 是合法小时（' + qf + '→' + qt + '）');
assert(qf !== qt, '静默时段起止不相等（相等就是空区间，等于没设）');
assert(field('digest') === 'true', 'digest 复盘提醒出厂为 true');
assert(/^\d{1,2}:\d{2}$/.test(field('digestTime').replace(/^['"]|['"]$/g, '')),
  'digestTime 是 HH:MM 形态（' + field('digestTime') + '）');

/* ---------- 2. 权限口径：不新增敏感权限 ---------- */
console.log('== 2. 权限口径（AndroidManifest.xml）==');
assert(/RECEIVE_BOOT_COMPLETED/.test(mf), '声明了 RECEIVE_BOOT_COMPLETED（重启后自动重挂闹钟）');
// ⚠️ XML 属性是 `android:name`（冒号），别写成 `android\.name` —— 后者是"点"，
//    永远匹配不上（这条自己踩过：断言假红，还以为是清单没跟上）
assert(/android:name="uts\.sdk\.modules\.pwstudyFocus\.LeisureGuard"/.test(mf),
  '清单注册了 LeisureGuard 接收器');
const recv = (/<receiver[\s\S]*?LeisureGuard[\s\S]*?<\/receiver>/.exec(mf) || [])[0] || '';
assert(recv.length > 0, 'LeisureGuard 的 <receiver> 段能切出来');
assert(/android:exported="false"/.test(recv),
  '接收器 exported=false（只收系统广播和自己的闹钟）');
assert(/android\.intent\.action\.BOOT_COMPLETED/.test(recv), 'intent-filter 含 BOOT_COMPLETED');
assert(/android\.intent\.action\.MY_PACKAGE_REPLACED/.test(recv), 'intent-filter 含 MY_PACKAGE_REPLACED');
assert(/LEISURE_ALARM/.test(recv), 'intent-filter 含自己的周期闹钟 action（自续约靠它）');
assert(!/QUERY_ALL_PACKAGES/.test(mf),
  '★ 没有 QUERY_ALL_PACKAGES（上架敏感权限，读时长根本用不到）');
assert(!/READ_EXTERNAL_STORAGE|WRITE_EXTERNAL_STORAGE|MANAGE_EXTERNAL_STORAGE/.test(mf),
  '没有存储类权限（休闲统计只读 UsageStats，不碰文件）');
assert(!/android:name="android\.permission\.INTERNET"/.test(mf),
  '没有新增 INTERNET（统计与提醒全在本地，不上传）');
assert(!/BIND_ACCESSIBILITY_SERVICE[\s\S]{0,200}LeisureGuard/.test(mf),
  'LeisureGuard 不是无障碍服务（不需要用户再授一次无障碍）');

/* ---------- 3. 两条腿都在 ---------- */
console.log('== 3. 两条下发路径 ==');
['maybeNudgeOnOpen', 'armGuard', 'disarmGuard', 'markFocusDone',
 'captureToday', 'decide', 'inQuietHours', 'leisureSummaryForAI', 'leisurePkgs']
  .forEach((f) => {
    assert(new RegExp('export\\s+function\\s+' + f + '\\s*\\(').test(lei), 'leisure.js 导出 ' + f + '()');
  });

const onShow = fnBody(appv, 'onShow');
assert(/leisure\.maybeNudgeOnOpen\(\)/.test(onShow),
  '★ App.vue onShow 调 maybeNudgeOnOpen（A 路径：打开时提醒，兜底永远工作）');
assert(/leisure\.armGuard\(\)/.test(onShow),
  '★ App.vue onShow 调 armGuard（B 路径：交给原生，App 关着也能推）');
assert(/setTimeout/.test(onShow), '两条调用都延后执行（不跟首页首屏抢主线程）');

const arm = fnBody(lei, 'armGuard');
assert(arm.length > 0, 'armGuard 函数体切得出来');
assert(/fgsvc\.leisureArm\(/.test(arm), 'armGuard 把配置交给 fgsvc.leisureArm');
assert(/!c\.on\s*\|\|\s*!leisurePkgs\(\)\.length/.test(arm) && /disarmGuard\(\)/.test(arm),
  '★ 关功能 / 清空清单时主动 disarmGuard（别留个还在后台跑的闹钟）');

/* ---------- 4. 通知不跟已有提醒打架 ---------- */
console.log('== 4. 通知 id / 渠道不冲突 ==');
const chLeisure = (/const CHANNEL_LEISURE\s*=\s*'([^']+)'/.exec(uts) || [])[1] || '';
const idLeisure = Number((/const LEISURE_NOTIFY_ID:\s*Int\s*=\s*(\d+)/.exec(uts) || [])[1] || 0);
assert(chLeisure.length > 0, '原生定义了 CHANNEL_LEISURE（' + chLeisure + '）');
const otherCh = [];
[/const CH_REMIND\s*=\s*'([^']+)'/g, /const CHANNEL_ID\s*=\s*'([^']+)'/g,
 /const CHANNEL_PULL\s*=\s*'([^']+)'/g, /const CHANNEL_GUARD\s*=\s*'([^']+)'/g].forEach((re) => {
  let m; const src = re.source.indexOf('CH_REMIND') >= 0 ? ntf : uts;
  while ((m = re.exec(src))) otherCh.push(m[1]);
});
assert(chLeisure.length > 0 && otherCh.indexOf(chLeisure) < 0,
  '休闲渠道不跟已有渠道重名（避免串到"专注进行中"那条静默渠道上）');
assert(idLeisure > 0, '原生定义了 LEISURE_NOTIFY_ID（' + idLeisure + '）');
const usedIds = [8801, 8802, 8803, 8804, 8810, 8860];
assert(usedIds.indexOf(idLeisure) < 0, 'NotifyId 不占用已有 id（8801/8802/8803/8804/8810/8860）');
assert(/IMPORTANCE_HIGH/.test(uts), '休闲渠道是 IMPORTANCE_HIGH（不然锁屏不亮、不叫人）');

/* ---------- 4b. 闹钟：不许用精确闹钟（安卓 12+ 没权限会静默死） ---------- */
console.log('== 4b. 周期闹钟不踩精确闹钟权限 ==');
const sched = fnBody(uts, 'scheduleLeisureAlarm');
assert(sched.length > 0, 'scheduleLeisureAlarm 函数体切得出来');
assert(!/setExactAndAllowWhileIdle|setExact\b|setAlarmClock/.test(sched.replace(/\/\/[^\n]*/g, '')),
  '★ 不用 setExact*/setAlarmClock（安卓 12+ 要 SCHEDULE_EXACT_ALARM，缺了抛异常被吞 → 后台整条静默死）');
assert(/setAndAllowWhileIdle/.test(sched),
  '★ 走 setAndAllowWhileIdle（不需要任何权限，Doze 下也能唤醒）');
assert(!/SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/.test(mf),
  '清单没有 SCHEDULE_EXACT_ALARM / USE_EXACT_ALARM（上架敏感，别为几分钟精度去要）');
// 必须是"各自独立 try"而不是包在同一个 try 里 —— 检测里一处越界就会把续约那句跳过，
// 闹钟链断在这一次、之后再也不醒（这类"看着开了其实没干活"最难受）。
// 只查两个调用存在会被 BOOT 分支那句 scheduleLeisureAlarm 骗过（反向测试抓到过假绿）。
const onRecv = fnBody(uts, 'onReceive');
assert(/try\s*\{\s*leisureGuardCheck\(ctx!\)\s*\}\s*catch/.test(onRecv)
  && /try\s*\{\s*scheduleLeisureAlarm\(ctx!\)\s*\}\s*catch/.test(onRecv),
  '★ 检测与续约各自独立 try（检测炸了也必须把下一次排上，否则闹钟链永久断掉）');
// 每次回前台都无脑重排的话，用户一频繁切进 App 闹钟就被一路往后推，永远等不到它到点。
// ⚠️ 要按**函数体**判：BOOT 分支里也有一句 !leisureAlarmFresh()，
//    全文件扫会让"arm 里偷偷改回无脑重排"照样绿（反向测试抓到过）。
assert(/function leisureAlarmFresh\s*\(/.test(uts) && /!leisureAlarmFresh\(\)/.test(fnBody(uts, 'leisureArm')),
  '★ leisureArm 里有排期新鲜度判断，回前台不无脑重排闹钟');
assert(/leisure_alarm_at/.test(uts), '排期时点落 SP（进程被杀后重进也知道还要不要排）');
assert(/notifAllowed\(ctx\)/.test(fnBody(uts, 'leisureGuardCheck')),
  '★ 通知被关掉时直接收手（安卓 13+ notify 静默无效，别白烧节流配额）');
assert(/areNotificationsEnabled/.test(uts), '用 NotificationManager.areNotificationsEnabled 判通知开关');

/* ---------- 5. 原生编译雷区（只查 LeisureGuard 段） ---------- */
console.log('== 5. 原生编译雷区（LeisureGuard 段）==');
// 从段首标记切到文件尾：LeisureGuard 是 index.uts 的最后一段
const gi = uts.indexOf('休闲提醒后台检测（LeisureGuard）');
const seg = gi >= 0 ? uts.slice(gi) : '';
assert(seg.length > 200, 'LeisureGuard 段能定位（' + seg.length + ' 字符）');
const strip = (s) => s.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const code = strip(seg);
assert(!/[^.\w]Number\s*\(/.test(code),
  '★ 段内没有 Number(x)（java.lang.Number 是抽象类，云打包直接编不过）');
assert(!/[^.\w]String\s*\(/.test(code),
  '★ 段内没有 String(x)（Kotlin 的 String 不接受 CharSequence）');
assert(!/\.join\s*\(/.test(code),
  '★ 段内没有 Array.join（UTS 的 Array 没有 join，换成手工拼接）');
assert(/function leisureFill\s*\(/.test(seg), '有 leisureFill（手工拼接替代 join）');
assert(/c\.digestHm/.test(seg), '★ 复盘时点用 digestHm 整数比（不解析 "20:00" 字符串）');
assert(!/isNaN|parseInt|parseFloat/.test(code), '段内没有 isNaN/parseInt/parseFloat（UTS 上不可靠）');
assert(/as Number\)\.toInt\(\)/.test(seg),
  'long 转分钟走 (x as Number).toInt()（本文件既有口径）');
assert(/digestHm/.test(arm), '★ armGuard 的 payload 里带了 digestHm（原生才有得比）');
const hmLine = (/(?:^|[\s{])digestHm:\s*([^,\n}]+)/.exec(arm) || [])[1] || '';
assert(/digestHm/.test(hmLine) && /dh\s*\*\s*60|60\s*\*\s*dh/.test(arm),
  'payload 的 digestHm 是小时*60+分钟真算出来的（不是写死的 1200）');

/* ---------- 6. 零专注判定：JS 写、原生读 ---------- */
console.log('== 6. 零专注判定（跨进程握手）==');
assert(/export\s+function\s+leisureMarkFocus\s*\(\s*\)/.test(uts), '原生导出 leisureMarkFocus()');
assert(/leisure_focus_date/.test(uts), '原生把"今天专注过"写进 SP 的 leisure_focus_date');
const focusToday = fnBody(uts, 'leisureFocusToday');
assert(/leisure_focus_date/.test(focusToday) && /leisureDateStr\(\)/.test(focusToday),
  'leisureFocusToday 拿 SP 日期跟今天比（跨进程也读得到）');
assert(/leisure\.markFocusDone\(\)/.test(foc),
  '★ focus.js 在一段专注完成时调 markFocusDone（否则 daily 规则永远以为你没专注）');
assert(/export\s+function\s+markFocusDone/.test(lei), 'leisure.js 导出 markFocusDone()');
assert(/export\s+function\s+hasFocusToday/.test(pws), 'pwstore 有 hasFocusToday()（JS 侧同口径）');
assert(/export\s+function\s+remainingFocusTasksToday/.test(pws), 'pwstore 有 remainingFocusTasksToday()');

/* ---------- 7. 静默时段：两边都支持跨午夜 ---------- */
console.log('== 7. 静默时段跨午夜 ==');
const quiet = fnBody(lei, 'inQuietHours');
assert(/mins\s*>=\s*a\s*\|\|\s*mins\s*<\s*b/.test(quiet),
  '★ JS 侧跨午夜形态（22→08 靠 hm>=a || hm<b，不是简单的 a<b）');
const nQuiet = fnBody(uts, 'leisureInQuiet');
assert(/hm\s*>=\s*a\s*\|\|\s*hm\s*<\s*b/.test(nQuiet),
  '★ 原生侧跨午夜形态（跟 JS 同口径，不然一边静音一边响）');
// JS 写的是 `if (a === b)`，原生 UTS 写的是 `if (a == b)` —— 所以 `={2,3}`
assert(/a\s*={2,3}\s*b/.test(quiet) && /a\s*={2,3}\s*b/.test(nQuiet),
  '两边都处理了"起止相等 = 不静默"');

/* ---------- 8. 节流：不会变成骚扰 ---------- */
console.log('== 8. 节流（防轰炸）==');
const nudge = fnBody(lei, 'maybeNudgeOnOpen');
assert(/maxPerDay/.test(nudge), 'JS 侧读 maxPerDay 上限');
assert(/st\.kinds\[cd\.kind\]/.test(nudge), 'JS 侧按 kind 去重（同一种一天只发一条）');
assert(/inQuietHours\(now\)/.test(nudge), 'JS 侧先判静默时段再发');
const guardCheck = fnBody(uts, 'leisureGuardCheck');
assert(/maxPerDay/.test(guardCheck), '原生侧也读 maxPerDay');
assert(/indexOf\('dwell'\)\s*<\s*0/.test(guardCheck) && /indexOf\('daily'\)\s*<\s*0/.test(guardCheck),
  '原生侧按 kind 去重（dwell/daily 各一条）');
assert(/leisureInQuiet\(/.test(guardCheck), '原生侧先判静默时段');
assert(/saveLeisureThrottle/.test(uts), '节流状态落 SP（跨进程/跨唤醒保留）');
const throttle = fnBody(uts, 'loadLeisureThrottle');
assert(/leisureDateStr\(\)/.test(throttle) && /st\.count\s*=\s*0/.test(throttle),
  '节流按天自动重置（隔天不该还记着昨天的账）');

/* ---------- 9. 没权限就不提醒 ---------- */
console.log('== 9. 没「使用情况访问」就不瞎提醒 ==');
assert(/hasUsagePermission\(\)/.test(nudge) && nudge.indexOf('hasUsagePermission') < nudge.indexOf('captureToday'),
  'JS 侧先判 hasUsagePermission 再采集（没权限就别读）');
assert(/usageGranted\(ctx\)/.test(guardCheck), '原生侧也判 usageGranted');
assert(/pkgs\.length\s*==\s*0/.test(guardCheck), '原生侧清单为空直接收手');
assert(/fgsvc\.available\(\)/.test(arm), 'armGuard 先判插件可用（没自定义基座就静默降级到 A 路径）');

/* ---------- 10. 用户能找到入口 ---------- */
console.log('== 10. 入口与路由 ==');
assert(/pages\/apps\/apps/.test(pages), 'pages.json 注册了学习 App 页（休闲 App 选择已并入此页）');
// 光看 `goLeisure()` 存在不够 —— 方法在、@tap 绑错也能过（反向测试抓到过这个假绿），
// 所以直接盯模板里的绑定 + 跳转目标。
assert(/@tap="goLeisure"/.test(setv) && /\/pkgPlan\/pages\/apps\/apps\?leisure=1/.test(setv),
  '设置页「选择休闲 App」跳转学习 App 页并带 leisure=1 锚点（选 App 就在那页做）');
assert(/开放|休闲提醒|secHint/.test(setv), '设置页有休闲提醒分区');
const secHint = fnBody(setv, 'secHint');
assert(/leisure/.test(secHint), '设置页分区副标题会报休闲提醒状态');
assert(/v-if="leisure\.on\s*&&\s*!\(leisure\.pkgs\s*\|\|\s*\[\]\)\.length"/.test(setv),
  '没选 App 时界面有提示（"先选几个 App 才会生效"）');
assert(/setLeisure\('on'/.test(setv) && /disarmGuard/.test(setv),
  '关总开关时同时撤掉后台闹钟（不留幽灵任务）');

/* ---------- 11. i18n 双字典对齐 ---------- */
console.log('== 11. i18n 双字典 ==');
const keysOf = (name) => {
  const m = new RegExp('const\\s+' + name + '\\s*=\\s*\\{([\\s\\S]*?)\\n\\};').exec(lei);
  if (!m) return [];
  const out = [];
  const re = /^\s{2}([a-z_0-9]+):/gm;
  let x;
  while ((x = re.exec(m[1]))) out.push(x[1]);
  return out;
};
const zhK = keysOf('ZH'), enK = keysOf('EN');
assert(zhK.length >= 6, 'ZH 休闲文案有 ' + zhK.length + ' 条');
assert(enK.length === zhK.length,
  'EN 与 ZH 条数一致（' + enK.length + ' / ' + zhK.length + '，少一条就漏英文）');
assert(zhK.filter((k) => enK.indexOf(k) < 0).length === 0,
  'EN 没有缺键：' + (zhK.filter((k) => enK.indexOf(k) < 0).join(',') || '无'));
assert(zhK.every((k) => /^leisure_/.test(k)), '文案键统一前缀 leisure_（便于搜）');
assert(/leisure_dwell_text/.test(lei) && /\{app\}/.test(lei) && /\{min\}/.test(lei),
  'dwell 文案带 {app}/{min} 占位（原生要按真实读数重填）');
assert(/leisure_task_tail/.test(lei) && /\{n\}/.test(lei),
  '尾部文案带 {n}（今日还剩几个任务）');

/* ---------- 12. 与 AI 复盘的串接 ---------- */
console.log('== 12. 喂给 AI 复盘 ==');
const sum = fnBody(lei, 'leisureSummaryForAI');
assert(sum.length > 0, 'leisureSummaryForAI 有实现');
assert(/休闲 App 使用时长|无使用记录/.test(sum), '小结是中文可读句（直接塞 prompt）');
assert(/hasFocusToday/.test(sum) && /remainingFocusTasksToday/.test(sum),
  '小结同时报"专注有无"与"还剩几个任务"');
assert(/!c\.on\s*\|\|\s*!leisurePkgs\(\)\.length/.test(sum),
  '关着 / 没选 App 时返回空串（不污染 prompt）');

console.log('');
console.log(fail === 0 ? '休闲关注校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
