// 反向测试：故意把「拦截通知」的授权链路改坏，确认 check-notif.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// check-notif.js 是**同步**的，require 回来退出码就在那儿了。
// ⚠️ 别跟 run-all 并发跑：本脚本会临时改坏源码（第 23 条硬约束）。
// ⚠️ 注入一律用**正则**：这个仓库里有的文件 CRLF、有的 LF，同一个 harness 会各踩一半
//    （第 24 条：String.replace 的 from 里 \r\n 是字面量不是换行）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const CHECK = path.join(ROOT, '_tools', 'check-notif.js');

const FILES = [
  'pkgPlan/pages/focus/focus.vue',
  'pages/home/home.vue',
  'uni_modules/pwstudy-focus/utssdk/app-android/AndroidManifest.xml'
];
const orig = {};
FILES.forEach(f => { orig[f] = fs.readFileSync(U(f), 'utf8'); });

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const prevExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let code = null;
  process.exit = (c) => { code = (c == null ? 0 : c); };
  console.log = () => {};
  console.error = () => {};
  process.exitCode = 0;
  let crash = null;
  try { require(CHECK); } catch (e) { crash = e; }
  console.log = realLog;
  console.error = realErr;
  process.exit = prevExit;
  const ec = process.exitCode || 0;
  process.exitCode = 0;
  return {
    code: crash ? 99 : (code == null ? 0 : (code || ec)),
    crash: crash ? String((crash && (crash.stack || crash.message)) || '') : ''
  };
}

/** 按正则替换；替换**没有发生**就抛错（锚点失效 = 这条用例没测到东西） */
function sub(s, re, to) {
  const next = s.replace(re, to);
  if (next === s) throw new Error('锚点没命中：' + re);
  return next;
}

const cases = [
  /* ---------- ① 系统列表里得有 PWstudy ---------- */
  ['清单里丢掉 BIND_NOTIFICATION_LISTENER_SERVICE（系统那页里根本没有 PWstudy）',
    'uni_modules/pwstudy-focus/utssdk/app-android/AndroidManifest.xml',
    (s) => sub(s, /android:permission="android\.permission\.BIND_NOTIFICATION_LISTENER_SERVICE"/,
      'android:permission="android.permission.BIND_ACCESSIBILITY_SERVICE"')],
  ['丢了 NotificationListenerService 这个 action',
    'uni_modules/pwstudy-focus/utssdk/app-android/AndroidManifest.xml',
    (s) => sub(s, /android\.service\.notification\.NotificationListenerService/,
      'android.service.notification.NotificationListenerServiceX')],

  /* ---------- ② 跳转失败不许静默 ---------- */
  ['又把 openNotifSettings 的返回值扔掉（跳没跳出去永远不知道）',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /let opened = false\r?\n        try \{ opened = !!fgsvc\.openNotifSettings\(\) \} catch \(e\) \{ opened = false \}/,
      'let opened = false')],
  ['跳失败不弹框（用户点了"去开启"毫无反应 = "开不了"）',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /if \(!opened\) \{/, 'if (false) {')],
  ['首页也不收返回值',
    'pages/home/home.vue',
    (s) => sub(s, /let opened = false\r?\n        try \{ opened = !!fgsvc\.openNotifSettings\(\) \} catch \(e\) \{ opened = false \}/,
      'let opened = false')],

  /* ---------- ③ 回来要重检 ---------- */
  ['从系统设置页回来不重检（开完权限还得再点一次，第二次点又是同一个框）',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /if \(this\.__fromNotif\) \{/, 'if (false) {')],
  ['首页回来也不重检',
    'pages/home/home.vue',
    (s) => sub(s, /if \(this\.__fromNotif\) \{/, 'if (false) {')],
  ['syncNotifOpt 授权成功也不开开关（界面永远停在"关"）',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /if \(!this\.opts\.blockNotif\) \{\r?\n        this\.opts = Object\.assign\(\{\}, this\.opts, \{ blockNotif: true \}\)/,
      'if (false) {\n        this.opts = Object.assign({}, this.opts, { blockNotif: false })')],
  ['syncNotifOpt 没授权也把开关打开（开着却一条也拦不住 = 骗人的界面）',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /if \(!g\) return false/, 'if (!g) return true')],

  /* ---------- ④ 引导文案 ---------- */
  ['又不说在系统列表里找哪一项（用户进去一脸茫然）',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /找到「PWstudy 专注通知拦截」/g, '找到你要的那一项')],
  ['又不说"列表里没有时重启一次"',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /完全退出再重新打开一次/, '再试一次')],

  /* ---------- ⑤ 重新检测的出口 ---------- */
  ['首页把"重新检测"提示撤了（开关打不开就没有任何出口）',
    'pages/home/home.vue',
    (s) => sub(s, /<text v-if="blockNotifOn && !notifOk" class="fc-try fc-try-warn" @tap\.stop="recheckNotif">[^<]*<\/text>/, '')],
  ['专注页把它撤了',
    'pkgPlan/pages/focus/focus.vue',
    (s) => sub(s, /<text v-else-if="o\.key === 'blockNotif' && opts\[o\.key\] && !notifOk"[^>]*>[^<]*<\/text>/, '')]
];

function restoreAll() {
  FILES.forEach(f => fs.writeFileSync(U(f), orig[f], 'utf8'));
}

let bad = 0;
restoreAll();                        // 上一轮要是中途挂了，磁盘上可能还留着注入
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0 || base.crash) {
  console.log('基线就不是绿的，先修好再来 ✗（已把被测文件还原）');
  restoreAll();
  process.exit(1);
}

for (const [name, file, mut] of cases) {
  let next;
  try {
    next = mut(orig[file]);
  } catch (e) {
    console.log('  ✗ 注入失败 ' + name + ' —— ' + e.message);
    bad++;
    continue;
  }
  fs.writeFileSync(U(file), next, 'utf8');
  let r;
  try { r = runCheck(); } finally { fs.writeFileSync(U(file), orig[file], 'utf8'); }
  if (r.crash) { console.log('  ⚠ 护栏崩了: ' + name + '（不算"抓到"）✗\n     ' + r.crash.split('\n')[0]); bad++; }
  else if (r.code !== 0) console.log('  ✓ 抓到 ' + name + '（exit=' + r.code + '）');
  else { console.log('  ✗ 漏了 ' + name); bad++; }
}

restoreAll();
const after = runCheck();
console.log('还原后：exit=' + after.code + '（应为 0）');
if (after.code !== 0 || after.crash) bad++;

console.log(bad === 0 ? '\n反向测试全部通过（check-notif.js 不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
process.exit(bad === 0 ? 0 : 1);
