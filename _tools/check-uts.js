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

console.log(fail === 0 ? '\nUTS 插件校验全部通过' : '\n存在 ' + fail + ' 项失败');
process.exitCode = fail === 0 ? 0 : 1;
