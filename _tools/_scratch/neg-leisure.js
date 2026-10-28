// 反向变异测试：逐条把 check-leisure 依赖的关键点改坏，看它是否报红，然后原样还原。
// 不放进 _tools（它不是护栏，是一次性验证脚本），跑完即可删。
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = 'C:/Users/33156/WorkBuddy/PWstudy';
const UNI = ROOT + '/uniapp-PWstudy';
const CHECK = ROOT + '/_tools/check-leisure.js';

const cases = [
  { name: '默认改成关闭', file: UNI + '/utils/settings.js',
    find: /(\n\s{6}on:\s*)true/, rep: '$1false' },
  { name: '预置一个休闲 App', file: UNI + '/utils/settings.js',
    find: /pkgs:\s*\[\]/, rep: "pkgs: [{ pkg: 'com.ss.android.ugc.aweme', name: '抖音' }]" },
  { name: '阈值改成 3 分钟', file: UNI + '/utils/settings.js',
    find: /dwellMin:\s*30/, rep: 'dwellMin: 3' },
  { name: '原生混进 Number()', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /function leisureGuardCheck\(ctx: Context\): void \{/,
    rep: "function leisureGuardCheck(ctx: Context): void {\n  let bad = Number('12')" },
  { name: '原生用 join 拼串', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /function leisureFill\(s: string, key: string, val: string\): string \{/,
    rep: "function leisureFill(s: string, key: string, val: string): string {\n  let z = [val].join(',')" },
  { name: '复盘改回解析字符串', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /return leisureNowHm\(\) >= c\.digestHm;/,
    rep: 'return leisureNowHm() >= Number(c.digestTime);' },
  { name: 'payload 丢 digestHm', file: UNI + '/utils/leisure.js',
    find: /\n\s*digestHm: digestHm,/, rep: '' },
  { name: '静默时段丢了跨午夜', file: UNI + '/utils/leisure.js',
    find: /return mins >= a \|\| mins < b;/, rep: 'return mins >= a && mins < b;' },
  { name: '专注完成不通知原生', file: UNI + '/utils/focus.js',
    find: /leisure\.markFocusDone\(\)/, rep: '0' },
  { name: 'onShow 不挂原生', file: UNI + '/App.vue',
    find: /leisure\.armGuard\(\)/, rep: 'void 0' },
  { name: '关开关不撤闹钟', file: UNI + '/pkgManage/pages/settings/settings.vue',
    find: /leisure\.disarmGuard\(\)/, rep: '0' },
  { name: 'EN 少一条文案', file: UNI + '/utils/leisure.js',
    find: /\n {2}leisure_digest_text: "You still/, rep: '\n  leisure_digest_txt: "You still' },
  { name: '清单漏注册接收器', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/AndroidManifest.xml',
    find: /android:name="uts\.sdk\.modules\.pwstudyFocus\.LeisureGuard"/,
    rep: 'android:name="X.LeisureGuard"' },
  { name: '原生漏 RECEIVE_BOOT_COMPLETED', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/AndroidManifest.xml',
    find: /<uses-permission android:name="android\.permission\.RECEIVE_BOOT_COMPLETED" \/>/,
    rep: '' },
  { name: '清单多出 QUERY_ALL_PACKAGES', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/AndroidManifest.xml',
    find: /<uses-permission android:name="android\.permission\.RECEIVE_BOOT_COMPLETED" \/>/,
    rep: '<uses-permission android:name="android.permission.QUERY_ALL_PACKAGES" />' },
  { name: 'receivER 改成可导出', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/AndroidManifest.xml',
    find: /android:exported="false">\s*\n\s*<intent-filter>/, rep: 'android:exported="true">\n            <intent-filter>' },
  { name: '不判使用情况权限', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /if \(!usageGranted\(ctx\)\) return;/, rep: '// removed' },
  { name: '关掉节流上限', file: UNI + '/utils/leisure.js',
    find: /st\.count >= Number\(c\.maxPerDay \|\| 3\)/, rep: 'false' },
  { name: 'pages.json 漏路由', file: UNI + '/pages.json',
    find: /"pages\/leisure\/leisure",?/, rep: '' },
  { name: '设置页漏入口', file: UNI + '/pkgManage/pages/settings/settings.vue',
    find: /@tap="goLeisure"/, rep: '@tap="noop"' },
  { name: '闹钟改回精确闹钟', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /am\.setAndAllowWhileIdle\(0, t, pi\)/, rep: 'am.setExactAndAllowWhileIdle(0, t, pi)' },
  { name: '闹钟只排一次不自续约', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /try \{ scheduleLeisureAlarm\(ctx!\) \} catch \(e\) \{\}/, rep: '' },
  { name: '检测与续约塞回同一个 try', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /try \{ leisureGuardCheck\(ctx!\) \} catch \(e\) \{\}\n\s*try \{ scheduleLeisureAlarm\(ctx!\) \} catch \(e\) \{\}/,
    rep: 'try { leisureGuardCheck(ctx!); scheduleLeisureAlarm(ctx!) } catch (e) {}' },
  { name: '回前台无脑重排闹钟', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /if \(!leisureAlarmFresh\(\)\) scheduleLeisureAlarm\(ctx!\);/, rep: 'scheduleLeisureAlarm(ctx!);' },
  { name: '不判通知开关', file: UNI + '/uni_modules/pwstudy-focus/utssdk/app-android/index.uts',
    find: /if \(!notifAllowed\(ctx\)\) return;/, rep: '' },
];

let caught = 0;
const missed = [];
const skipped = [];

for (const c of cases) {
  // ⚠️ Windows 工作区里 index.uts 等文件是 CRLF：锚点里写 \n 会**静默落空**（假绿）。
  //    所以变异在归一化后的副本上做，但还原时必须写回**原始字节**（不能把整文件改成 LF）。
  const orig = fs.readFileSync(c.file, 'utf8');
  const norm = orig.replace(/\r\n/g, '\n');
  if (!c.find.test(norm)) { skipped.push(c.name); console.log('  ?? 锚点没命中：' + c.name); continue; }
  const mutated = norm.replace(c.find, c.rep);
  if (mutated === norm) { skipped.push(c.name); console.log('  ?? 变异无效：' + c.name); continue; }
  fs.writeFileSync(c.file, mutated);
  let failed = false;
  try {
    execFileSync(process.execPath, [CHECK], { stdio: 'pipe' });
  } catch (e) {
    failed = true;
  } finally {
    fs.writeFileSync(c.file, orig);
  }
  if (failed) { caught++; console.log('  ✓ 抓到：' + c.name); }
  else { missed.push(c.name); console.log('  ✗ 漏了：' + c.name); }
}

console.log('');
console.log('抓到 ' + caught + '/' + cases.length
  + (missed.length ? '　漏：' + missed.join(' / ') : '　没有漏网')
  + (skipped.length ? '　跳过：' + skipped.join(' / ') : ''));
process.exit(missed.length ? 1 : 0);
