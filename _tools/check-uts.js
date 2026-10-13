// _tools/check-uts.js - UTS 插件（pwstudy-focus 前台服务）静态校验
// 只做静态扫描：UTS 的 kotlin 编译要云打包/自定义基座才跑得起来，本地编译一次几分钟，
// 所以"整数字面量被推成 Number、Android API 要 Int"这类问题最好在这里拦住。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const PLUGIN = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android');
const UTS = path.join(PLUGIN, 'index.uts');
const MANIFEST = path.join(PLUGIN, 'AndroidManifest.xml');

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function read(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }

console.log('== 1. 插件文件齐全 ==');
const uts = read(UTS);
const mfRaw = read(MANIFEST);
// ⚠️ 扫之前先剥注释：清单里会写"以后要加 android:foregroundServiceType"这类说明，
// 不剥就会被自己的注释误判成"已经声明了"（和 7.2 那段 XML 注释是同一个坑）。
const mf = mfRaw.replace(/<!--[\s\S]*?-->/g, '');
if (uts) ok('index.uts 存在（' + uts.split('\n').length + ' 行）');
else bad('缺 index.uts');
if (mfRaw) ok('插件自己的 AndroidManifest.xml 存在');
else bad('缺 AndroidManifest.xml —— Service 没声明，前台服务起不来');

console.log('== 2. 传给 Android 的整数字面量必须是 Int ==');
// kotlin 编译失败：参数类型不匹配，实际 'Number' 预期 'Int'
// 起因是 UTS 把 `const NOTIFY_ID = 8801` 推成 Number，而 startForeground / notify / getActivity 收 Int
const INT_CONSTS = ['NOTIFY_ID', 'PI_FLAGS', 'FGS_TYPE_SPECIAL_USE'];
INT_CONSTS.forEach((name) => {
  const re = new RegExp('const\\s+' + name + '\\s*:\\s*Int\\s*=');
  if (re.test(uts)) ok(name + ' 显式声明为 Int');
  else bad(name + ' 没写 : Int —— 会被推成 Number，kotlin 编译报 error17');
});
// 反过来：出现过"裸 Number 常量又传给 Android"的用法就提醒
const bareConst = /const\s+(NOTIFY_ID|PI_FLAGS|FGS_TYPE_SPECIAL_USE)\s*=\s*[^;]+;/;
if (!bareConst.test(uts)) ok('没有未标注类型的同名常量');
else bad('存在未标注 : Int 的整数字面量常量');
// 用到这些常量的 API 调用还在（防止改了类型却把调用删了）
if (/startForeground\(\s*NOTIFY_ID/.test(uts) && /FGS_TYPE_SPECIAL_USE\s*\)/.test(uts)) ok('startForeground 仍在传 id + 类型（Android 14+ 分支）');
else bad('startForeground 调用缺失');
if (/manager\.notify\(\s*NOTIFY_ID/.test(uts)) ok('notify 仍在复用同一个通知 id');
else bad('notify 调用缺失');

// kotlin 警告：Identity equality for arguments of types 'Number' and 'Int' can be unstable
// because of implicit boxing —— UTS 里拿 Int 变量和整数字面量做 === 就会中招
const badEq = uts.split('\n')
  .map((l, i) => ({ l: l.replace(/\/\/.*$/, ''), n: i + 1 }))
  .filter((x) => /===|!==/.test(x.l) && /[^\w](0|1|2|-?\d+)[\s)]*$|[=!]==\s*-?\d+/.test(x.l));
if (badEq.length === 0) ok('没有拿 Int 变量和整数字面量做 === 引用相等（装箱不稳定）');
else bad('=== 比较了整数字面量，会触发 implicit boxing 警告：' + badEq.map((x) => 'L' + x.n + ' ' + x.l.trim()).join(' / '));

console.log('== 3. 与 JS 侧 notify.js 的常量一致（两边写同一条通知） ==');
const notify = read(path.join(ROOT, 'utils', 'notify.js'));
const idJs = (notify.match(/ID_ONGOING\s*=\s*(\d+)/) || [])[1];
const idUts = (uts.match(/NOTIFY_ID\s*:\s*Int\s*=\s*(\d+)/) || [])[1];
if (idJs && idJs === idUts) ok('通知 id 一致 = ' + idJs);
else bad('通知 id 不一致：notify.js=' + idJs + ' / uts=' + idUts);
const chJs = (notify.match(/CH_ONGOING\s*=\s*'([^']+)'/) || [])[1];
const chUts = (uts.match(/CHANNEL_ID\s*=\s*'([^']+)'/) || [])[1];
if (chJs && chJs === chUts) ok('渠道 id 一致 = ' + chJs);
else bad('渠道 id 不一致：notify.js=' + chJs + ' / uts=' + chUts);

console.log('== 4. 清单声明（Service / 权限 / 服务类型） ==');
if (/android:name="uts\.sdk\.modules\.pwstudyFocus\.PWFocusService"/.test(mf)) ok('Service 已声明，包名 = uts.sdk.modules.pwstudyFocus');
else bad('Service 未声明或包名不对（插件 id 驼峰）');
if (/FOREGROUND_SERVICE"/.test(mf) && /FOREGROUND_SERVICE_SPECIAL_USE"/.test(mf)) ok('前台服务权限 + specialUse 权限都在');
else bad('缺前台服务权限');
// ⚠️ 这条反直觉，但它必须是"不声明"：
// HBuilderX 打 UTS 插件用的是自带的 aapt2 2.19 + android.jar（实测只到 API 30 级）：
//   · <property>  → error: unexpected element <property> found in <manifest><application><service>
//   · specialUse  → error: 'specialUse' is incompatible with attribute foregroundServiceType
//                   (attr) flags [camera, connectedDevice, dataSync, location,
//                   mediaPlayback, mediaProjection, microphone, phoneCall]
// 最终 APK 的 compileSdk 是 36，但插件这一步先过不去。而"前台服务必须声明类型"
// 只对 targetSdk >= 34 生效，本项目 targetSdk 默认 28，所以不声明也不会出事。
// 完整推导写在插件 AndroidManifest.xml 的注释里，改这里之前先读那段。
if (/foregroundServiceType/.test(mf)) bad('插件清单写了 android:foregroundServiceType —— HBuilderX 内置 aapt2 只到 API 30 级，编不过（见清单注释）');
else if (/PROPERTY_SPECIAL_USE_FGS_SUBTYPE/.test(mf)) bad('插件清单写了 <property> —— aapt2 报 unexpected element <property>');
else ok('插件清单不声明 FGS 类型（编译链只到 API 30；本项目 targetSdk<34 也不强制）');
// 清单没声明类型 → 类型校验一旦收紧，startForeground 会被系统拒，必须有降级兜底
if (/startForeground\(NOTIFY_ID, notification, FGS_TYPE_SPECIAL_USE\)/.test(uts) &&
    /catch[\s\S]{0,240}startForeground\(NOTIFY_ID, notification\)/.test(uts)) ok('startForeground 带类型参数且有降级兜底（抛异常就退回两参，服务不至于起不来）');
else bad('startForeground 没有降级兜底 —— 类型校验一旦失败前台服务起不来，强制模式全废');
// targetSdk 护栏：抬到 34+ 会强制要求 FGS 类型，而编译链又认不出 specialUse = 死结
const appMf = read(path.join(ROOT, 'manifest.json'));
const tsdk = (appMf.match(/"targetSdkVersion"\s*:\s*(\d+)/) || [])[1];
if (!tsdk) ok('manifest.json 未覆盖 targetSdkVersion（走默认 28 < 34，不强制 FGS 类型）');
else if (Number(tsdk) < 34) ok('targetSdkVersion = ' + tsdk + '（< 34，不强制 FGS 类型）');
else bad('targetSdkVersion = ' + tsdk + ' >= 34 —— 前台服务会被强制要求声明类型，但编译链认不出 specialUse，必须先升 HBuilderX 的 UTS 编译链再动它');
// 强制模式的两条权限：少一条，"拉回"就只剩一半手段
if (/SYSTEM_ALERT_WINDOW/.test(mf)) ok('声明了 SYSTEM_ALERT_WINDOW（悬浮窗遮罩；用户还需在设置里手动授权）');
else bad('清单缺 SYSTEM_ALERT_WINDOW —— 遮罩那一层永远拿不到权限');
if (/USE_FULL_SCREEN_INTENT/.test(mf)) ok('声明了 USE_FULL_SCREEN_INTENT（全屏意图通知才能把界面弹到最前）');
else bad('清单缺 USE_FULL_SCREEN_INTENT —— fullScreenIntent 会被系统忽略');

console.log('== 5. 调用方收敛（只走 utils/fgsvc.js） ==');
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (/node_modules|unpackage|_removed_vocab/.test(name)) continue;
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|vue|ts|uts)$/.test(name)) out.push(p);
  }
  return out;
}
const importers = walk(ROOT, [])
  .filter((p) => /uni_modules\/pwstudy-focus/.test(read(p)))
  .map((p) => path.relative(ROOT, p).replace(/\\/g, '/'));
const onlyFgsvc = importers.length === 1 && importers[0] === 'utils/fgsvc.js';
if (onlyFgsvc) ok('只有 utils/fgsvc.js 直接引插件（降级逻辑集中在一处）');
else bad('直接引插件的文件不止 fgsvc.js：' + importers.join(' / '));
const fgsvc = read(path.join(ROOT, 'utils', 'fgsvc.js'));
if (/#ifdef APP-PLUS[\s\S]*?@\/uni_modules\/pwstudy-focus[\s\S]*?#endif/.test(fgsvc)) ok('插件 import 包在 #ifdef APP-PLUS 里（H5 构建不会解析失败）');
else bad('插件 import 未包在 #ifdef APP-PLUS 内');

/* ==================== 6. 强制模式（后台看门狗 + 拉回链路） ====================
 * 这一块的坑都在"编译期看不见、真机上才炸"的地方：UTS 的类型推演、
 * 清单权限、以及"谁来盯前台是谁"。所以静态拦一遍。
 */
console.log('== 6. 强制模式：看门狗 / 拉回 / 权限 ==');

// 6.1 真正的看门狗必须是原生线程：JS 的 setInterval 在 App 退到后台后会被系统挂起，
//     那正是"强制拉回失效"的根因 —— 改回纯 JS 轮询等于把这个 bug 又请回来。
if (/class\s+WatchLoop\s+extends\s+Thread/.test(uts) && /\.start\(\)/.test(uts)) ok('看门狗跑在原生 Thread 上（不是 JS 定时器）');
else bad('找不到 WatchLoop extends Thread —— 后台看门狗必须下沉到原生');
// 线程休眠只能用字面量：Thread.sleep 收 Long，Int 常量不会被自动放宽
const sleepConst = uts.match(/Thread\.sleep\(\s*[A-Za-z_][\w]*\s*\)/);
if (!sleepConst) ok('Thread.sleep 只传字面量（Int 常量传进 Long 参数会编译失败）');
else bad('Thread.sleep 传了常量：' + sleepConst[0] + ' —— 改成字面量');

// 6.2 数值类型：凡是参与算术/比较的常量都要标 Int（裸 const 会被推成 Number）
const INT_NEEDED = ['PULL_GAP_SEC', 'ESC_TICKS', 'FG_WINDOW_MS', 'WATCH_MAX_SEC', 'WINDOW_TYPE_OVERLAY', 'WINDOW_TYPE_PHONE', 'PULL_NOTIFY_ID', 'OVERLAY_MAX_TRIES'];
const missInt = INT_NEEDED.filter((n) => !new RegExp('const\\s+' + n + '\\s*:\\s*Int\\s*=').test(uts));
if (!missInt.length) ok('参与算术/传 Android 的常量全部显式 : Int（' + INT_NEEDED.length + ' 个）');
else bad('这些常量没标 : Int，会被推成 Number：' + missInt.join(' / '));
// 时间戳不能直接塞字段（Java long → UTS 类型混用）
if (/function\s+nowSec\(\)\s*:\s*Int/.test(uts)) ok('时间比较走 nowSec()（秒级 Int，避开 Long/Number 混用）');
else bad('缺 nowSec() —— 直接存 System.currentTimeMillis() 会踩 Long 与 Int/Number 的类型坑');

// 6.3 拉回链路四条手段，缺一条就少一层兜底
const PULL_PARTS = [
  ['moveTaskToFront', '① 复用 task 提到最前（不重建 Activity，专注页状态不丢）'],
  ['FLAG_ACTIVITY_REORDER_TO_FRONT', '② launch intent 兜底重启'],
  ['setFullScreenIntent', '③ 全屏意图通知（Android 10+ 系统会直接弹界面）'],
  ['TYPE_APPLICATION_OVERLAY', '④ 悬浮窗遮罩（后台跳转被 ROM 拦掉时唯一绕不过去的一层）'],
  ['WINDOW_TYPE_OVERLAY', '④ 悬浮窗窗口类型（API 26+ 用 2038，更老退 2002）']
];
PULL_PARTS.forEach(([needle, label]) => {
  if (uts.indexOf(needle) >= 0) ok('拉回手段在：' + label);
  else bad('拉回手段缺失：' + label + '（找不到 ' + needle + '）');
});
// 遮罩必须由主线程挂/撤（后台线程 addView 会直接抛）
if (/Handler\(Looper\.getMainLooper\(\)\)/.test(uts) && /runOnUiThread|mainHandler/.test(uts)) ok('遮罩的挂/撤走主线程（后台线程 addView 必抛）');
else bad('没看到主线程 post —— WindowManager.addView 只能在主线程调');
// 桌面兜底：遮罩是盖全屏的，桌面被当成"跑偏"会把用户锁在屏幕外
if (/function\s+homePackage/.test(uts) && /resolveActivity/.test(uts) && /CATEGORY_HOME/.test(uts)) ok('系统默认桌面单独兜底（遮罩不会盖住 Home）');
else bad('缺 homePackage —— 遇到没列进名单的第三方桌面会把用户锁在遮罩外面');
const apptime = read(path.join(ROOT, 'utils', 'apptime.js'));
if (/com\.miui\.home/.test(apptime) && /com\.huawei\.android\.launcher/.test(apptime) && /com\.hihonor\.android\.launcher/.test(apptime)) ok('JS 名单里有主流国产桌面（小米/华为/荣耀）');
else bad('NEUTRAL 名单缺国产桌面包 —— 强制模式会把桌面当跑偏');

// 6.4 退出路径：暂停 / 放弃 / 结束都必须能收掉看门狗，否则"番茄都结束了还在拉人"
if (/export function pauseWatch/.test(fgsvc) && /export function resumeWatch/.test(fgsvc)) ok('fgsvc 有 pauseWatch / resumeWatch');
else bad('fgsvc 缺 pauseWatch / resumeWatch —— 暂停后看门狗还在干活');
const fjs = read(path.join(ROOT, 'utils', 'focus.js'));
if (/fgsvc\.pauseWatch\(\)/.test(fjs) && /fgsvc\.resumeWatch\(\)/.test(fjs)) ok('focus.pause / resume 跟着收放看门狗');
else bad('focus.js 的 pause/resume 没通知看门狗 —— 暂停期间还会被拽回来');
if (/onDestroy\(\)[\s\S]{0,400}setWatch\(false/.test(uts)) ok('服务 onDestroy 兜底收掉看门狗（放弃/结束的最后一道）');
else bad('onDestroy 没收看门狗');

// 6.4b 绕过口子：专注页拦了返回键不等于拦住了 —— 首页也有硬控屏，
//      "回首页按一下返回"就能退出 App，强制模式白开。两处判据必须一致。
const homeVue = read(path.join(ROOT, 'pages', 'home', 'home.vue'));
if (/onBackPress\s*\(\)/.test(homeVue)) ok('首页也拦返回键（硬控屏按返回不能直接退出 App）');
else bad('首页没有 onBackPress —— 强制模式在首页可被"一次返回"绕过');
if (/onBackPress\(\)\s*\{[\s\S]{0,240}forcedOn[\s\S]{0,240}phase !== 'focus'/.test(homeVue)) ok('首页返回拦截与专注页同判据（forcedOn + 专注中且未暂停）');
else bad('首页 onBackPress 判据与专注页不一致 —— 会出现"换个页面就能出去"');
// 6.4c 落账后立刻落盘：pwstore 平时是 800ms 节流合并写，番茄结算是最不能等的那一刻
if (/pw\.recordPomo\(session\)[\s\S]{0,700}pw\.flush\(\)/.test(fjs)) ok('番茄落账后立刻 flush（不等节流，进程被杀也不丢这一笔）');
else bad('结算路径没有 flush —— 刚跑完的番茄可能在 800ms 窗口里整个丢掉');

// 6.5 到点自动收手：JS 在后台可能被冻结，"靠 JS 通知停手"不可靠
if (/untilSec/.test(uts) && /watchUntilSec/.test(uts)) ok('看门狗自带 untilSec 到点收手（JS 被冻结也不会拉过头）');
else bad('看门狗没有到点自动收手 —— 番茄结束后会一直把人拽回来');

// 6.6 JS 侧只下发策略、不重复造轮子
const forced = read(path.join(ROOT, 'utils', 'forced.js'));
if (/fgsvc\.setWatch\(/.test(forced)) ok('forced.js 把白名单/时限下发给原生');
else bad('forced.js 没下发配置 —— 原生看门狗不知道该放行谁');
if (/apptime\.allowList\(\)/.test(forced)) ok('白名单口径来自 apptime.allowList()（与 isAllowedPkg 同源）');
else bad('forced.js 没走 apptime.allowList() —— 两边口径会飘');
if (/export function allowList/.test(apptime) && /purpose\s*!==\s*'rest'/.test(read(path.join(ROOT, 'utils', 'apptime.js')).split('export function allowList')[1] || '')) ok('allowList 只放「学习」用途（休息类 App 专注期间算跑偏）');
else bad('apptime.allowList 没排除 rest 用途 —— 与 isAllowedPkg 口径不一致');

/* ==================== 7. 无障碍护卫（强制模式的能力前提） ====================
 * 这一块最容易"写了但没生效"，而且失效是静默的：清单少一条属性 → 服务根本不出现在
 * 系统的无障碍列表里；少一个 meta-data → 服务连上了但拿不到窗口事件。
 * 所以清单、资源、服务类、判定共用、JS 降级，五条一起静态守。
 */
console.log('== 7. 无障碍护卫（强制模式的能力前提） ==');

// 7.1 服务声明：Android 对无障碍服务的要求很硬 —— 没 BIND_ACCESSIBILITY_SERVICE
//     就绑不上，没 intent-filter 就不出现在列表里，没 meta-data 就拿不到事件配置。
if (/uts\.sdk\.modules\.pwstudyFocus\.PFGuardService/.test(mf)) ok('无障碍服务已声明（包名与看门狗服务同一套规则）');
else bad('清单没声明 PFGuardService —— 系统不会绑定，无障碍能力等于没写');
if (/BIND_ACCESSIBILITY_SERVICE/.test(mf)) ok('声明了 BIND_ACCESSIBILITY_SERVICE（缺它服务绑不上）');
else bad('缺 BIND_ACCESSIBILITY_SERVICE 权限声明');
if (/android\.accessibilityservice\.AccessibilityService/.test(mf)) ok('有 accessibilityservice 的 intent-filter（否则不出现在系统列表）');
else bad('缺 accessibilityservice intent-filter');
if (/android:name="android\.accessibilityservice"\s*\n?\s*android:resource="@xml\/pw_accessibility_config"/.test(mf)) ok('meta-data 指向 @xml/pw_accessibility_config');
else bad('meta-data 没指向无障碍配置 xml —— 事件类型/标志位全丢');
// exported 必须为 true：无障碍服务是"系统来绑你"，不给导出绑不上
if (/PFGuardService"[\s\S]{0,200}android:exported="true"/.test(mf)) ok('无障碍服务 exported=true（系统要来绑定）');
else bad('PFGuardService 没写 exported="true" —— 系统绑不上');
// 7.1b 兜底：meta-data 指向的 xml 属于插件 res/，而 UTS 插件编译产物是 jar/classes.dex，
//      资源要不要单独拷一份取决于打包链版本。真没拷进来，aapt2 link 阶段才会暴露；
//      就算勉强过了，服务也会退化成"什么都不监听"（静默失效，最难查）。
//      所以 onServiceConnected 里必须再用代码 setServiceInfo 设一遍同样的值。
// ⚠️ 判据里的常量名是 **DEFAULT**，不是 FLAG_DEFAULT —— 后者在 AccessibilityServiceInfo
//    里根本不存在（2026-10-13 云打包报 Unresolved reference 'FLAG_DEFAULT' 才发现：
//    这行代码以前从没被编译过）。第 10 节单独守"别把 FLAG_DEFAULT 写回来"。
if (/function buildGuardInfo\(\)/.test(uts) && /setServiceInfo\(buildGuardInfo\(\)\)/.test(uts) &&
    /info\.eventTypes\s*=\s*AccessibilityEvent\.TYPE_WINDOW_STATE_CHANGED/.test(uts) &&
    /info\.flags\s*=\s*AccessibilityServiceInfo\.DEFAULT\b/.test(uts)) ok('onServiceConnected 用代码重设了一遍服务配置（res 没被合并时的兜底）');
else bad('无障碍服务没有代码兜底配置 —— 一旦 meta-data 的 xml 没合进来，服务连上但什么都监听不到');
// ⚠️ 常量留着是为了跟 res/xml 的 android:notificationTimeout="100" 对得上，
//    **不能直接赋给 notificationTimeout**：那个字段是 long，Int 常量不会自动放宽
//    （只能写字面量，见第 10.4 节与源码里的注释）。
if (/const\s+A11Y_NOTIFY_MS\s*:\s*Int\s*=/.test(uts) &&
    /info\.notificationTimeout\s*=\s*\d+/.test(uts)) ok('A11Y_NOTIFY_MS 显式 : Int，且 notificationTimeout 走字面量（字段是 long）');
else bad('A11Y_NOTIFY_MS 没写 : Int，或 notificationTimeout 没用字面量 —— long 字段收不了 Int 常量');

// 7.2 res 资源：UTS 插件支持 res/ 目录，但路径与属性写错在打包时才炸
const A11Y_XML = path.join(PLUGIN, 'res', 'xml', 'pw_accessibility_config.xml');
const a11yRaw = read(A11Y_XML);
// 先剥 XML 注释再扫属性 —— 配置文件的注释里为了说明"刻意不开按键过滤"会写到
// flagRequestFilterKeyEvents 这个词，不去注释就会被自己的说明误判成"申请了"。
const a11yXml = a11yRaw.replace(/<!--[\s\S]*?-->/g, '');
if (a11yRaw) ok('res/xml/pw_accessibility_config.xml 存在');
else bad('缺 res/xml/pw_accessibility_config.xml');
[['accessibilityEventTypes="typeWindowStateChanged"', '只收窗口状态变化（最省电、够用）'],
['accessibilityFeedbackType=', '反馈类型'],
['canRetrieveWindowContent=', '是否读取窗口内容（见 8.5：刻意 false）'],
['android:description="@string/', '设置页里的说明（必须是 @string 引用，不能写裸字面量）'],
['notificationTimeout=', '事件节流窗口']
].forEach(([needle, label]) => {
  if (a11yXml.indexOf(needle) >= 0) ok('无障碍配置含 ' + label);
  else bad('无障碍配置缺 ' + label + '（找不到 ' + needle + '）');
});
// 刻意不开的：吞按键。Home 键本来就拦不住，吞返回/多任务会挡住来电与权限弹窗。
// 这里连 UTS 侧一起扫：onServiceConnected 有代码兜底配置，两边口径必须一致，
// 否则 XML 没合进来时代码那一套反而变成"偷偷申请了按键过滤"。
if (a11yXml.indexOf('flagRequestFilterKeyEvents') < 0 && !/FLAG_REQUEST_FILTER_KEY_EVENTS/.test(uts)) ok('XML 与代码都没申请按键过滤（不吞按键，避免挡住来电/权限弹窗）');
else bad('有一处申请了按键过滤 —— 会把用户在其它应用里的返回键也吞掉，误伤面太大');
if (a11yXml.indexOf('canPerformGestures') < 0 && a11yXml.indexOf('canTakeScreenshot') < 0) ok('没有手势 / 截图权限（只做"前台是谁"这一件事）');
else bad('无障碍配置申请了手势或截图权限 —— 与"只看前台包名"的用途不符，过审与用户信任都受影响');
// strings.xml：description 引用的字符串必须真的存在
const STRINGS = read(path.join(PLUGIN, 'res', 'values', 'strings.xml'));
const descRef = (a11yXml.match(/android:description="@string\/([A-Za-z0-9_]+)"/) || [])[1];
if (descRef && new RegExp('name="' + descRef + '"').test(STRINGS)) ok('description 引用的字符串 ' + descRef + ' 在 strings.xml 里存在');
else bad('description 引用了 @string/' + descRef + '，但 strings.xml 里没有这个名字');

// 7.3 服务类本体
if (/class\s+PFGuardService\s+extends\s+AccessibilityService/.test(uts)) ok('PFGuardService extends AccessibilityService');
else bad('找不到 PFGuardService extends AccessibilityService');
['onAccessibilityEvent', 'onInterrupt'].forEach((m) => {
  if (new RegExp('override\\s+' + m + '\\s*\\(').test(uts)) ok('实现了 ' + m + '()');
  else bad('缺 ' + m + '() —— AccessibilityService 的抽象方法，不实现编译不过');
});
// ⚠️ 2026-10-12 改设计：原来靠 getWindows() 拿窗口类型来排掉"输入法/通知栏"，
// 代价是 canRetrieveWindowContent=true（等于申请读屏，且每次窗口变化都让系统构建整棵窗口树）。
// 现在改成"输入法包名直接进白名单"—— 输入法本来就是发窗口事件的常见来源，
// 按包名放行既不需要读屏，也跟 ROM 无关。第 8 节会守"不许再用 getWindows"。
if (/getEnabledInputMethodList\(\)/.test(uts) && /imePackages\(/.test(uts)) ok('输入法包名动态进白名单（换 ROM 不会漏，且不需要读屏）');
else bad('没把输入法加进白名单 —— 打字即"跑偏"');
if (/getEnabledAccessibilityServiceList\(-1\)/.test(uts)) ok('用 AccessibilityManager 实测"到底开没开"（比读 Settings 字符串更可信）');
else bad('没有实测无障碍是否开启 —— 界面只能靠猜');
['a11yEnabled', 'a11yActive', 'a11yEvents', 'openA11ySettings'].forEach((f) => {
  if (new RegExp('export function ' + f + '\\s*\\(').test(uts)) ok('导出 ' + f + '()');
  else bad('缺导出 ' + f + '()');
});
// ACTION_ACCESSIBILITY_SETTINGS：跳系统无障碍设置页
if (/Settings\.ACTION_ACCESSIBILITY_SETTINGS/.test(uts)) ok('用 Settings.ACTION_ACCESSIBILITY_SETTINGS 跳引导页');
else bad('没有 ACTION_ACCESSIBILITY_SETTINGS —— 用户找不到去哪开');

// 7.4 判定必须只有一处：两个服务各判一套必然分叉（"事件那边说跑偏、轮询这边说没事"）
if (/seen\(pkg: string, fromEvent: boolean\)/.test(uts) && /this\.seen\(fg, false\)/.test(uts) && /s\.seen\(pkg, true\)/.test(uts)) ok('跑偏判定收敛在 seen()：轮询与无障碍事件共用同一份策略');
else bad('判定没共用：轮询与无障碍各写一套，迟早判得不一样');
if (/kickWanted/.test(uts)) ok('无障碍事件会踢醒看门狗（不必干等满一个轮询周期）');
else bad('没有 kick 机制 —— 人切走后最坏要等满 1.5 秒才被发现');
if (/guardFresh\(\)/.test(uts) && /GUARD_FRESH_SEC/.test(uts)) ok('无障碍报的包名有过期保护（事件流断了不会拿旧值乱拉人）');
else bad('没有包名过期保护 —— 服务被回收后会拿着过期包名反复拉人');

// 7.5 JS 侧降级：插件不在（标准基座 / H5）时必须安全返回 false，不能抛也不能谎报
if (/export function a11yEnabled/.test(fgsvc) && /export function a11yStats/.test(fgsvc) &&
    /export function openA11ySettings/.test(fgsvc) && /export function invalidateA11y/.test(fgsvc)) ok('fgsvc 有无障碍桥（含缓存失效，从设置页回来要立刻刷新）');
else bad('fgsvc 缺无障碍桥 —— 页面只能直接碰插件，降级没人管');
if (/#ifdef APP-PLUS[\s\S]{0,600}a11yEnabled[\s\S]{0,200}#endif/.test(fgsvc)) ok('无障碍调用也包在 #ifdef APP-PLUS 里');
else bad('无障碍的插件调用没包 #ifdef APP-PLUS');
// 无障碍要能顶替「使用情况访问」：tick 里的权限闸门必须认它
if (/!guardUsable\(\)\s*&&\s*!usageGranted/.test(uts)) ok('看门狗认"无障碍在场"就不强制要使用情况访问');
else bad('看门狗仍死要使用情况访问 —— 开了无障碍也白开，用户还要多授一个权限');
const setupSrc = read(path.join(ROOT, 'utils', 'setup.js'));
if (/key:\s*'a11y'/.test(setupSrc) && /openA11ySettings/.test(setupSrc)) ok('保活清单里有"无障碍"这一项并可跳转');
else bad('setup.js 没把无障碍列进清单 —— 用户不知道要开它');
if (/must:\s*\(\)\s*=>/.test(setupSrc)) ok('无障碍的 must 随"有没有开强制模式"变化（不用它的人不被骚扰）');
else bad('setup 的 must 不支持函数 —— 无障碍会被当成对所有人必办');

console.log('== 8. 无障碍服务的"不能崩"红线（真机踩出来的死机事故） ==');
// 背景：无障碍服务由**系统**创建并绑定，绑定时 APP 进程常常是裸的（uni / UTS 运行时
// 还没初始化）。服务在绑定过程中抛任何异常 → 系统杀进程 → 重 bind → 再崩，
// 循环起来是"APP 和整机一起卡死"，用户看到的就是"开了无障碍回来就死机"。
// 只截到这个类结束（下一个顶层声明为止），否则后面模块的 console 会被误算成"服务里的日志"
const guardCls = (() => {
  const i = uts.indexOf('class PFGuardService');
  if (i < 0) return '';
  const rest = uts.slice(i);
  const stop = rest.search(/\n(export )?function |\nclass |\n\/\* ={4,}/);
  return stop > 0 ? rest.slice(0, stop) : rest;
})();
// 8.1 服务回调里不许出现"可能抛异常还没包 try"的裸调用：
//     · getWindows() 要 canRetrieveWindowContent，是最容易被 ROM 拒/最贵的一档
//     · console.* 在裸进程里本身就是风险点（UTS 运行时可能没起来）
if (!/getWindows\s*\(/.test(guardCls)) ok('服务里不再调用 getWindows()（重量级 IPC + 需要读屏能力）');
else bad('服务里还有 getWindows() —— 每次窗口变化都让系统构建整棵窗口树，真机上会明显掉帧');
const guardCode = guardCls.replace(/\/\/.*$/gm, '');   // 剥行注释：注释里会提到 console.error 这个词
if (!/console\.(log|error|warn)/.test(guardCode)) ok('服务回调里没有 console.*（裸进程里它可能就是崩溃点）');
else bad('服务回调里还有 console.* —— 裸进程下 UTS 日志桥可能未初始化');
// 8.2 四个回调必须各有一层 try，异常绝不能冒到系统那边
const cbs = ['onServiceConnected', 'onAccessibilityEvent', 'onUnbind', 'onDestroy'];
const missed = cbs.filter(c => {
  const i = guardCls.indexOf('override ' + c);
  if (i < 0) return true;
  return !/try\s*\{/.test(guardCls.slice(i, i + 900));
});
if (missed.length === 0) ok('四个服务回调全部包了 try（异常不会冒给系统触发进程重启）');
else bad('这些回调没包 try：' + missed.join('、'));
// 8.3 保险丝：窗口期内被反复 bind = 服务在崩，必须能自己躺平
if (/function bumpBind\(\)/.test(uts) && /A11Y_BIND_MAX/.test(uts) && /a11yTripped/.test(uts)) ok('有 bind 次数保险丝：崩循环会让服务自动躺平，不再拖垮整机');
else bad('没有保险丝 —— 服务一旦崩，系统会无限重启进程，手机一起卡死');
if (/getSharedPreferences/.test(uts) && /bind_n/.test(uts)) ok('bind 计数落盘（进程被杀也记得住，不会每次重启都从零开始数）');
else bad('bind 计数只在内存里 —— 进程一被杀证据就没了，保险丝形同虚设');
if (/export function a11ySafe\(\)/.test(uts) && /export function resetA11y\(\)/.test(uts)) ok('有 a11ySafe / resetA11y：界面能如实告知并能"再试一次"');
else bad('界面拿不到跳闸状态 —— 服务躺平了用户还在被引导去开开关');
// 8.4 主线程不许做同步 Binder 查询（系统正 bind 服务时会与 system_server 互等 → 死锁）
const a11yFn = uts.slice(uts.indexOf('export function a11yEnabled'));
if (!/getEnabledAccessibilityServiceList/.test(a11yFn.slice(0, a11yFn.indexOf('\n}')))) ok('a11yEnabled() 不在调用线程上查 AccessibilityManager（躲开 Binder 死锁）');
else bad('a11yEnabled() 仍是同步跨进程查询 —— 与系统 bind 互等会让主线程冻住');
if (/class A11yQueryThread extends Thread/.test(uts)) ok('跨进程查询挪到了后台线程');
else bad('没有后台查询线程 —— 要么阻塞主线程，要么永远拿不到"系统里勾没勾"');
// 8.5 配置里不许再申请读屏（沿用第 7 节剥过注释的 a11yXml，别重复读一遍）
if (/canRetrieveWindowContent="false"/.test(a11yXml)) ok('无障碍配置不申请读取窗口内容（canRetrieveWindowContent=false）');
else bad('canRetrieveWindowContent 还是 true —— 既贵又敏感，而代码已经不需要它了');
if (!/flagRetrieveInteractiveWindows/.test(a11yXml)) ok('配置里去掉了 flagRetrieveInteractiveWindows');
else bad('还留着 flagRetrieveInteractiveWindows —— 与 canRetrieveWindowContent=false 矛盾');

/* ---------- 9. UTS → Kotlin 的两个编译期陷阱（2026-10-12 云打包炸出来的） ---------- */
console.log('== 9. UTS 生成的 Kotlin 能不能编过 ==');
// 先剥注释：本节要扫 class 声明，而注释里正好在讲这些声明（不剥就会自我命中，本项目第 6 次踩）。
const utsSrc = uts
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
  .filter((l) => !/^\s*(\*|\/\/)/.test(l))
  .join('\n');

// 9.1 `extends 一个 Java/Android 类` 必须带显式 constructor 且调 super()。
//     UTS 把它生成 `open class X : Thread`（**不带括号**），Kotlin 要求父类在声明处被初始化；
//     没有显式构造函数时没人调 super()，云端直接报
//     "This type has a constructor, so it must be initialized here"。
//     implements 一个接口（Runnable）没有这个问题 —— 接口没有构造函数。
const extendsRe = /class\s+(\w+)\s+extends\s+(\w+)/g;
let m;
let extCount = 0;
while ((m = extendsRe.exec(utsSrc)) !== null) {
  extCount++;
  const cls = m[1];
  const sup = m[2];
  // 取类体：从声明处到下一个顶格的 }
  const start = utsSrc.indexOf(m[0]);
  const end = utsSrc.indexOf('\n}', start);
  const body = end < 0 ? utsSrc.slice(start) : utsSrc.slice(start, end);
  if (/constructor\s*\(/.test(body) && /super\s*\(/.test(body)) {
    ok(cls + ' extends ' + sup + '：有显式 constructor 且调了 super()');
  } else {
    bad(cls + ' extends ' + sup + '：缺显式 constructor + super() —— 生成的 ' +
      ': ' + sup + ' 不带括号，kotlin 报 "must be initialized here"，云打包必挂');
  }
}
if (extCount === 0) bad('没找到任何 extends 声明 —— 正则或源码结构变了，本节等于没守');

// 9.2 清单里声明的类必须在源码里被引用，否则会被整块剪掉。
//     UTS 编译器会剪掉"代码里没人引用"的声明。PFGuardService 是系统按清单创建的，
//     源码里从来没有 new 过它 → 整个类（连同只被它用到的 bumpBind / buildGuardInfo）被剪掉，
//     打出的 dex 里没有这个类，而清单里却声明了它 = 用户打开开关只有 ClassNotFoundException。
//     判据：类名在源码里至少出现两次（声明本身 + 至少一处引用）。
const declared = [];
const declRe = /android:name="uts\.sdk\.modules\.pwstudyFocus\.(\w+)"/g;
while ((m = declRe.exec(mf)) !== null) declared.push(m[1]);
if (!declared.length) bad('清单里没解析到任何 uts.sdk.modules.pwstudyFocus.* 类');
declared.forEach((cls) => {
  const n = (utsSrc.match(new RegExp('\\b' + cls + '\\b', 'g')) || []).length;
  if (n >= 2) ok('清单声明的 ' + cls + ' 在源码里有 ' + n + ' 处引用（不会被剪枝）');
  else bad('清单声明了 ' + cls + '，但源码里只有 ' + n + ' 处（= 只有声明、没人引用）' +
    ' —— UTS 会把它整块剪掉，dex 里没有这个类');
});

/* ---------- 10. UTS 里"能写但编不过"的四个表达式（2026-10-13 云打包炸出来的） ----------
 * 背景：上一轮把 PFGuardService 钉进编译产物（第 9 节），于是 bumpBind / buildGuardInfo
 * 这些**从来没被编译过**的代码第一次进了 Kotlin 编译器 —— 一次性炸出 5 类错误。
 * 它们共同的特点：在 UTS 里写得很自然、语法检查也不报错，只有转成 Kotlin 才炸。
 *
 * 配套工具 `_tools/uts-to-kotlin.js`：本地调 HBuilderX 自带的 UTS 编译器把 .uts 转成 .kt，
 * 不用等云打包（一轮 3-30 分钟）就能看到生成物。改本节之前先跑它看一眼真实产出。
 */
console.log('== 10. 生成 Kotlin 时会炸的写法 ==');
const lines = utsSrc.split('\n');
const where = (re) => lines
  .map((l, i) => (re.test(l) ? i + 1 : 0))
  .filter(Boolean)
  .map((n) => 'L' + n);

// 10.1 Number(x) —— java.lang.Number 是**抽象类**，Kotlin 里 `Number(x)` 是在实例化它。
//      报错：Cannot create an instance of an abstract class + Too many arguments for 'constructor(): Number'
//      Long → Int 的正路是 `(x as Number).toInt()`，或者干脆别碰 Long（用 getInt/putInt 口径）。
const numHits = where(/\bNumber\s*\(/);
if (!numHits.length) ok('没有 Number(x)（java.lang.Number 是抽象类，实例化编不过）');
else bad('Number(x) 在生成的 Kotlin 里是实例化抽象类：' + numHits.join(', ')
  + ' —— 用 (x as Number).toInt()，或改成 Int 口径（getInt/putInt）');

// 10.2 String(x) —— Kotlin 的 String 只有 StringBuffer/StringBuilder/ByteArray/CharArray 四个构造。
//      Android 的 getPackageName() 这类返回 CharSequence 的方法，转字符串要 toString()。
const strHits = where(/\bString\s*\(/);
if (!strHits.length) ok('没有 String(x)（Kotlin 的 String 不接受 CharSequence）');
else bad('String(x) 没有对应的 Kotlin 构造：' + strHits.join(', ')
  + ' —— CharSequence 用 x.toString()');

// 10.3 声明返回 : Int 的函数，不能 return 一个"裸 let x = 0"的顶层变量 ——
//      裸字面量被 UTS 推成 **Number**，于是 "expected 'Int', actual 'Number'"。
//      修法：给变量写类型 `let x: Int = 0`。
const bareVars = [];
lines.forEach((l) => {
  // ⚠️ 必须允许缩进：顶层变量和函数里的局部变量都算，别写成 ^let
  const m = l.match(/^\s*let\s+(\w+)\s*=\s*-?\d+\s*;/);
  if (m) bareVars.push(m[1]);
});
const intFns = [];
const fnRe = /function\s+(\w+)\s*\([^)]*\)\s*:\s*Int\s*\{/g;
let fm;
while ((fm = fnRe.exec(utsSrc)) !== null) {
  const start = utsSrc.indexOf(fm[0]);
  const end = utsSrc.indexOf('\n}', start);
  intFns.push({ name: fm[1], body: end < 0 ? utsSrc.slice(start) : utsSrc.slice(start, end) });
}
const retHits = [];
intFns.forEach((f) => {
  bareVars.forEach((v) => {
    if (new RegExp('return\\s+' + v + '\\b').test(f.body)) retHits.push(f.name + ' → ' + v);
  });
});
if (!retHits.length) ok('返回 Int 的函数没有 return 未标注类型的顶层计数（' + intFns.length + ' 个 Int 函数）');
else bad('返回 Int 的函数 return 了裸 let 变量（推成 Number）：' + retHits.join(', ')
  + ' —— 给变量补 : Int');

// 10.4 收 **long** 的位置不能传 Int 常量（Kotlin 只对**字面量**按目标类型推断，常量不放宽）。
//      典型：Thread.sleep(Long)、AccessibilityServiceInfo.notificationTimeout(Long)。
const longHits = [];
lines.forEach((l, i) => {
  const m = l.match(/(Thread\.sleep\(\s*|notificationTimeout\s*=\s*)([A-Za-z_]\w*)/);
  // 只拦 UPPER_SNAKE 常量（= `const X: Int`）—— 变量可以是 Long，不该误伤
  if (m && /^[A-Z][A-Z0-9_]*$/.test(m[2])) longHits.push('L' + (i + 1) + ' ' + m[2]);
});
if (!longHits.length) ok('long 入参/字段没传 Int 常量（字面量才会被推断成 Long）');
else bad('long 位置传了 Int 常量（不会自动放宽成 Long）：' + longHits.join(', ')
  + ' —— 直接写字面量');

// 10.5 不存在的常量：AccessibilityServiceInfo 里是 DEFAULT，没有 FLAG_DEFAULT
//      （报错 Unresolved reference 'FLAG_DEFAULT'；它只存在于 res/xml 的 flagDefault 里）。
const flagHits = where(/\bFLAG_DEFAULT\b/);
if (!flagHits.length) ok("没有 FLAG_DEFAULT（AccessibilityServiceInfo 里叫 DEFAULT）");
else bad('FLAG_DEFAULT 不存在：' + flagHits.join(', ') + ' —— 写 AccessibilityServiceInfo.DEFAULT');

console.log(fail === 0 ? '\nUTS 插件校验全部通过' : '\n存在 ' + fail + ' 项失败');
process.exitCode = fail === 0 ? 0 : 1;
