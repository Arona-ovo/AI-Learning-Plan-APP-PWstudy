// 反向测试：故意把源码改坏，确认 check-updater.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 两条与别的反向测试不同的坑：
//   1. 不能用 child_process 起子进程（沙箱 EBUSY），同进程 require + 接管 process.exit；
//   2. **check-updater.js 是异步的**（断言在 promise 里），同步 require 返回时结果还没
//      出来 —— 必须让两拍再读退出码，否则每条用例都"看起来被抓到"（假绿）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp', rel);
const CHECK = path.join(ROOT, '_tools', 'check-updater.js');

const FILES = [
  'utils/updater.js',
  'utils/settings.js',
  'App.vue',
  'pkgManage/pages/settings/settings.vue',
  'data/build-info.js'
];
const orig = {};
FILES.forEach(f => { orig[f] = fs.readFileSync(U(f), 'utf8'); });
const PUB = path.join(ROOT, '_tools', 'publish-wgt.js');
const pubOrig = fs.readFileSync(PUB, 'utf8');

async function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const prevExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let code = 0;
  let inRequire = true;
  const buf = [];
  process.exit = (c) => {
    code = (c == null ? 0 : c);
    if (!inRequire) return;          // 异步收尾：只记，别把回归崩掉
    const e = new Error('__exit');
    e.__exit = true;
    throw e;
  };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  process.exitCode = 0;
  let crash = null;
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) crash = e; }
  inRequire = false;
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setTimeout(res, 0));
  console.log = realLog;
  console.error = realErr;
  process.exit = prevExit;
  const ec = process.exitCode || 0;
  process.exitCode = 0;
  return { code: crash ? 99 : (code || ec), fails: buf.filter(l => l.indexOf('✗') >= 0) };
}

const cases = [
  ['版本比成字符串（1.10 < 1.9 的坑）', 'utils/updater.js',
    s => s.replace('return { name, code: Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] || 0) };',
      'return { name, code: Number(name.replace(/[^\\d]/g, "")) };')],
  ['基座太老照样装 wgt（会白屏）', 'utils/updater.js',
    s => s.replace('if (remote.minNative && local.nativeCode && local.nativeCode < remote.minNative) {', 'if (false) {')],
  ['装完不重启（不生效）', 'utils/updater.js',
    s => s.replace('  await install(path);\n  restart();', '  await install(path);')],
  ['启动自检失败不静默（弹窗吓人）', 'utils/updater.js',
    s => s.replace('    return null;   // 静默：网络不通不该弹"检查失败"', "    toast('检查失败'); return null;")],
  ['自检不节流（一天弹 N 次）', 'utils/updater.js',
    s => s.replace('if (u.lastCheckAt === todayStr()) return null;    // 今天查过了', '')],
  // 两个失败弹窗各有一条（去掉哪条都不行）：按"更新没装上"那段的标题精确定位
  ['安装失败弹窗不给出口', 'utils/updater.js', s => {
    const i = s.indexOf("title: '更新没装上'");
    return i < 0 ? s : s.slice(0, i) + s.slice(i).replace('if (res && res.confirm) openRelease();', '');
  }],
  ['手动检查失败弹窗不给出口', 'utils/updater.js', s => {
    const i = s.indexOf("title: '没查到版本信息'");
    return i < 0 ? s : s.slice(0, i) + s.slice(i).replace('if (res && res.confirm) openRelease();', '');
  }],
  // 改名脱节：脚本仍按 PWstudy-<版本> 打，客户端却认不出（这条最常悄悄断）
  ['客户端认不出发布脚本的包名（改名脱节）', 'utils/updater.js',
    s => s.replace("'^PWstudy-", "'^pws-")],
  ['发布脚本改了命名（客户端不认）', PUB,
    s => s.replace("'PWstudy-' + ver + '-n' + nativeCode + '.wgt'", "'pws-' + ver + '.wgt'")],
  ['下载失败被吞掉（静默）', 'utils/updater.js',
    s => s.replace('fail: (e) => reject(new Error((e && e.errMsg) || \'下载失败\'))', "fail: (e) => resolve('/tmp/x.wgt')")],
  ['默认不自检（功能等于没有）', 'utils/settings.js',
    s => s.replace('    update: {\n      auto: true,', '    update: {\n      auto: false,')],
  ['App 启动不自检', 'App.vue',
    s => s.replace('setTimeout(() => { updater.autoCheck() }, 3000)', '')],
  ['设置页没有手动检查入口', 'pkgManage/pages/settings/settings.vue',
    s => s.replace('updater.manualCheck()', 'Promise.resolve(null)')],
  ['设置页没有整包入口', 'pkgManage/pages/settings/settings.vue',
    s => s.replace('updater.openRelease()\n    }', 'null\n    }')],
  // 占位 APK 那条语义：认了它就等于拿猜的吓用户
  ['整包不挑名字（占位 APK 被当成新版）', 'utils/updater.js',
    s => s.replace("return parseNamed(name, 'apk');",
      "return parseNamed(name, 'apk') || { version: '9.9.9', code: 90909, minNative: 0 };")],
  ['pickApk 用错了解析规则（整包永远认不出）', 'utils/updater.js',
    s => s.replace("return pickAsset(rel, 'apk', parseApkName);", "return pickAsset(rel, 'apk', parseAssetName);")],
  ['没有可用包时又把人指去下载页', 'utils/updater.js',
    s => s.replace("toast('版本页里没有可用的更新包');",
      "uni.showModal({ title: '没有热更新包', confirmText: '去下载', success: (res) => { if (res && res.confirm) openRelease(); } });")],
  ['整包比本机新也不提示（只认 wgt）', 'utils/updater.js',
    s => s.replace('if (apk && local.code < apk.code) return { state: \'apk\', local, remote: apk, notes };',
      'if (false) return { state: \'apk\', local, remote: apk, notes };')]
];

(async () => {
  let bad = 0;
  const base = await runCheck();
  console.log('基线：exit=' + base.code + '（应为 0）');
  if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗'); process.exit(1); }

  for (const [name, file, mut] of cases) {
    const isPub = file === PUB;
    const src = isPub ? pubOrig : orig[file];
    const next = mut(src);
    if (next === src) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
    if (isPub) fs.writeFileSync(PUB, next, 'utf8'); else fs.writeFileSync(U(file), next, 'utf8');
    let r;
    try { r = await runCheck(); } finally {
      if (isPub) fs.writeFileSync(PUB, pubOrig, 'utf8'); else fs.writeFileSync(U(file), orig[file], 'utf8');
    }
    if (r.code !== 0) console.log('  抓到 ' + name + '（' + r.fails.length + ' 条红）');
    else { console.log('  漏了 ' + name + ' ✗'); bad++; }
  }

  const after = await runCheck();
  console.log('还原后：exit=' + after.code + '（应为 0）');
  if (after.code !== 0) bad++;

  console.log(bad === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
  process.exit(bad ? 1 : 0);
})();
