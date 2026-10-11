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

console.log(fail === 0 ? '\nUTS 插件校验全部通过' : '\n存在 ' + fail + ' 项失败');
process.exitCode = fail === 0 ? 0 : 1;
