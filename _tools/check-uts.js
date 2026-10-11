// _tools/check-uts.js - UTS 插件（pwstudy-focus 前台服务）静态校验
// 只做静态扫描：UTS 的 kotlin 编译要云打包/自定义基座才跑得起来，本地编译一次几分钟，
// 所以"整数字面量被推成 Number、Android API 要 Int"这类问题最好在这里拦住。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const PLUGIN = path.join(ROOT, 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android');
const UTS = path.join(PLUGIN, 'index.uts');
const MANIFEST = path.join(PLUGIN, 'AndroidManifest.xml');

let fail = 0;
function ok(m) { console.log('  ✓ ' + m); }
function bad(m) { fail++; console.error('  ✗ ' + m); }
function read(p) { return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''; }

console.log('== 1. 插件文件齐全 ==');
const uts = read(UTS);
const mf = read(MANIFEST);
if (uts) ok('index.uts 存在（' + uts.split('\n').length + ' 行）');
else bad('缺 index.uts');
if (mf) ok('插件自己的 AndroidManifest.xml 存在');
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
if (/foregroundServiceType="specialUse"/.test(mf) && /PROPERTY_SPECIAL_USE_FGS_SUBTYPE/.test(mf)) ok('Android 14+ 服务类型 = specialUse（含用途说明）');
else bad('未声明 foregroundServiceType —— Android 14 起会抛 MissingForegroundServiceTypeException');
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
['canRetrieveWindowContent="true"', '取窗口信息（用来分辨"应用窗口"还是"输入法/通知栏"）'],
['android:description="@string/', '设置页里的说明（必须是 @string 引用，不能写裸字面量）'],
['notificationTimeout=', '事件节流窗口']
].forEach(([needle, label]) => {
  if (a11yXml.indexOf(needle) >= 0) ok('无障碍配置含 ' + label);
  else bad('无障碍配置缺 ' + label + '（找不到 ' + needle + '）');
});
// 刻意不开的：吞按键。Home 键本来就拦不住，吞返回/多任务会挡住来电与权限弹窗
if (a11yXml.indexOf('flagRequestFilterKeyEvents') < 0) ok('没有申请 flagRequestFilterKeyEvents（不吞按键，避免挡住来电/权限弹窗）');
else bad('申请了按键过滤 —— 会把用户在其它应用里的返回键也吞掉，误伤面太大');
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
if (/getWindows\(\)/.test(uts) && /getType\(\)\s*==\s*1/.test(uts)) ok('用窗口类型过滤（1 = TYPE_APPLICATION，排掉输入法/通知栏/系统浮层）');
else bad('没做窗口类型过滤 —— 输入法一弹出来就会被判成"跑偏"，用户每打字一次被拉回一次');
if (/getEnabledInputMethodList\(\)/.test(uts)) ok('输入法包名动态进白名单（换 ROM 不会漏）');
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

console.log(fail === 0 ? '\nUTS 插件校验全部通过' : '\n存在 ' + fail + ' 项失败');
process.exitCode = fail === 0 ? 0 : 1;
