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
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const CHECK = path.join(ROOT, '_tools', 'check-updater.js');

const FILES = [
  'utils/updater.js',
  'utils/settings.js',
  'manifest.json',
  'App.vue',
  'pkgManage/pages/settings/settings.vue',
  'pages/home/home.vue',
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
  let code = null;                 // null = 还没跑到 process.exit
  const buf = [];
  //
  // ★ 等"跑完了"的可靠信号是 process.exit 被调用，不是"等两拍"。
  //   check-updater 的断言是串在一条 async 链上的，链里还夹着 setTimeout（宏任务），
  //   等两拍只能推进到中途 —— 那时 code 还是初始值 0，于是整条用例被判成"漏了"。
  //   这个假象在用例变多、链变长之后才暴露：加第 6.9 节之前一直是"全过"。
  let fire = null;
  const done = new Promise((res) => { fire = res; });
  process.exit = (c) => {
    code = (c == null ? 0 : c);
    if (fire) fire();
  };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  process.exitCode = 0;
  let crash = null;
  try { require(CHECK); } catch (e) { crash = e; }
  await Promise.race([done, new Promise((res) => setTimeout(res, 8000))]);
  console.log = realLog;
  console.error = realErr;
  process.exit = prevExit;
  const ec = process.exitCode || 0;
  process.exitCode = 0;
  return {
    code: crash ? 99 : (code == null ? 0 : (code || ec)),
    // 跑超时了 —— 这个结果不可信，不能算"抓到"
    timeout: code === null && !crash,
    // 崩了也不算数：护栏崩掉和"报红"是两回事，把崩溃当红就是假绿
    crash: crash ? String(crash && (crash.stack || crash.message)) : '',
    fails: buf.filter(l => l.indexOf('✗') >= 0)
  };
}

const cases = [
  ['版本比成字符串（1.10 < 1.9 的坑）', 'utils/updater.js',
    s => s.replace('return { name, code: Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3] || 0) };',
      'return { name, code: Number(name.replace(/[^\\d]/g, "")) };')],
  ['基座太老照样装 wgt（会白屏）', 'utils/updater.js',
    s => s.replace('if (remote.minNative && local.nativeCode && local.nativeCode < remote.minNative) {', 'if (false) {')],
  // 锚点跟着改过：现在只有 wgt 才重启（APK 交给系统安装器，重启会打断它）
  ['装完不重启（不生效）', 'utils/updater.js',
    s => s.replace("if (got.kind === 'wgt') restart();", "if (false) restart();")],
  ['启动自检失败不静默（弹窗吓人）', 'utils/updater.js',
    s => s.replace('    return null;   // 静默：网络不通不该弹"检查失败"', "    toast('检查失败'); return null;")],
  // 节流只挡"联网查版本"，不挡"把已有信息准备好的包" —— 所以这里改的是那个 if 的判据
  ['自检不节流（一天弹 N 次）', 'utils/updater.js',
    s => s.replace('if (u.lastCheckAt === todayStr()) {', 'if (false) {')],
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
  ['包内版本不跟文件名对齐（装完死循环提示）', PUB,
    s => s.replace('const innerOld = alignInnerVersion(entries, ver, nativeCode);', 'const innerOld = null;')],
  ['打完不自检包内版本（坏包会发出去）', PUB,
    s => s.replace("const backRaw = readZipEntry(outPath, 'manifest.json');", 'const backRaw = null;')],
  ['--no-sync 挡不住同步（wgt 一号把源码版本抬走，跟打包界面填的对不上）', PUB,
    s => s.replace("if (!has('--no-sync') && (has('--bump') || val('--ver'))) {",
      "if (has('--bump') || val('--ver')) {")],
  // 2026-10-14 起 --bump 只认严格的 x.y.z：宽松兜底会把 `1.3beta` 当成 `1.3.0`
  // 抬成 `1.3.1`，再写回源码三处，把云打包界面填的名字顶掉。所以"改回兜底"现在是坏的。
  ['--bump 又用宽松解析兜底（带后缀的版本会被写成另一个）', PUB,
    s => s.replace('const cur = parseVer(from);', 'const cur = parseVer(from) || looseVer(from);')],
  ['--bump 直接拿 looseVer 的猜测当当前版本', PUB,
    s => s.replace('const cur = parseVer(from);', 'const cur = looseVer(from);')],
  ['--bump 认不出版本号时自己猜一个（不报错）', PUB,
    s => s.replace("fail('版本号「' + from + '」不是 x.y.z", "cur = { a: 1, b: 0, c: 0 }; //")],
  // ---- Wi-Fi 预下载 / 移动网络门禁（check-updater 第 11 节 + 6.8 真跑） ----
  ['EMPTY_PENDING 漏了 downloadPath（deepMerge 清不掉旧路径，会拿着失效路径去装）',
    'utils/updater.js',
    s => s.replace("state: '', downloadPath: '', digestUrl: '' }", "state: '', digestUrl: '' }")],
  ['网络判定又退回异步的 uni.getNetworkType（弹窗文案要等 await，契约全变）',
    'utils/updater.js',
    s => s.replace(/return canDownloadNetwork\(netTypeSync\(\)\);/,
      "return new Promise((r) => { try { uni.getNetworkType({ success: (o) => r(canDownloadNetwork(o.networkType)), fail: () => r(canDownloadNetwork('unknown')) }) } catch (e) { r(canDownloadNetwork('unknown')) } });")],
  ['netTypeSync 不读 plus.networkinfo（拿不到真实网络，等于门禁失效）',
    'utils/updater.js',
    s => s.replace(/const t = P\.getCurrentType\(\);/, "const t = 3;")],
  // 需求反过来了：现在两种网都能下（用户明确要求），所以"把蜂窝拦下"才是错
  ['蜂窝网络又被拦下了（用户要的是两种网都能下）', 'utils/updater.js',
    s => s.replace(/if \(type === 'cellular' \|\| CELLULAR\.indexOf\(type\) >= 0\) return \{ ok: true, type: type, why: 'cellular' \};/,
      "if (type === 'cellular' || CELLULAR.indexOf(type) >= 0) return { ok: false, type: type, why: 'cellular' };")],
  ['没网也放行（用户只会被"下载失败"糊一下）', 'utils/updater.js',
    s => s.replace(/if \(type === 'none'\) return \{ ok: false/, "if (false) return { ok: false")],
  ['unknown 也拦下（拿不到网络类型的机型就永远不许更新了）', 'utils/updater.js',
    s => s.replace(/return \{ ok: true, type: type \|\| 'unknown', why: '' \};/,
      "return { ok: false, type: type || 'unknown', why: 'cellular' };")],
  ['prefetch 里偷偷装了（合规红线：不许静默安装）', 'utils/updater.js',
    s => s.replace('return Object.assign({}, p, { downloadPath: got.path, ready: true });',
      'await install(got.path); return Object.assign({}, p, { downloadPath: got.path, ready: true });')],
  // 需求反过来了：整包也要静默预取（用户明确要求 APK 与 WGT 共用同一套）
  ['prefetch 只下热更包（整包不预取，用户点更新时要干等 20MB）', 'utils/updater.js',
    s => s.replace('const got = await ensurePackage(item);',
      "const got = (p.state === 'update') ? await ensurePackage(item) : null;")],
  ['ensurePackage 不认本地缓存，一律重新下载（重复下载）', 'utils/updater.js',
    s => s.replace('const ready = await reuseIfReady(item);', 'const ready = null;')],
  ['拦下来的错误不带 why 标记（会错进"去下载整包"那条路）', 'utils/updater.js',
    s => s.replace(/e\.why = net\.ok \? '' : \(net\.why \|\| 'none'\);/, "e.why = '';")],
  // 注入要"换成 failDialog"，不是"删掉分支" —— 删掉的话静态断言还在
  //（源码里 netHint() 那行仍存在），会变成假绿
  ['runUpdate 把"没网"也丢给 failDialog（点下去还是下不动）', 'utils/updater.js',
    s => s.replace("if (why === 'none') { netHint(); return false; }",
      'if (why === \'none\') { failDialog(""); return false; }')],
  ['netHint 又给了下载入口（把人推回同一个坑）', 'utils/updater.js',
    s => s.replace(/confirmText: '知道了',\n    showCancel: false/,
      "confirmText: '去下载',\n    showCancel: true,\n    success: (r) => { if (r && r.confirm) openRelease(); }")],
  ['watchNetwork 不幂等（每次调用都多挂一个监听）', 'utils/updater.js',
    s => s.replace(/if \(netWatched\) return false;/, 'if (false) return false;')],
  ['红点不看本地包有没有准备好（没下好也亮，点了干等）', 'utils/updater.js',
    s => s.replace('if (!path) return null;              // 没下好 / 校验没过 → 不亮、不弹',
      'if (false) return null;')],
  ['App.vue 不挂 watchNetwork（连上网也不会补下载）', 'App.vue',
    s => s.replace(/try \{ updater\.watchNetwork\(\) \} catch \(e\) \{\}/, '')],
  // 没有这条权限，plus.networkinfo 只能返回 unknown，而 unknown 是放行的
  // —— 移动网络照样下，功能等于没做，而且日志上一片安静
  ['manifest 没有 ACCESS_NETWORK_STATE（门禁读不出蜂窝网，形同虚设）', 'manifest.json',
    // 要连开头的引号一起删 —— 只删半截会在数组里留下一个未闭合的字符串，
    // check-updater 会在 JSON.parse 处**崩掉**而不是报红（那就成了假绿：看着"被抓到"了）
    s => s.replace('"<uses-permission android:name=\\"android.permission.ACCESS_NETWORK_STATE\\"/>",', '')],

  // 上传指引要把三段式版本号打出来 —— Release 标题/说明是手填的，照抄才不会写成别的号
  ['发布指引不再给出 Release 标题（GitHub 上会写成别的号）', PUB,
    s => s.replace(/console\.log\('  3\. 标题写  PWstudy ' \+ ver[^;]*\);/, '')],
  ['发布指引不再给出说明首行的版本号', PUB,
    s => s.replace(/console\.log\('  4\. 说明首行写  ' \+ ver[^;]*\);/, '')],
  ['发布指引不提醒 tag 别写成版本号（tag 一改客户端就全查不到了）', PUB,
    s => s.replace(/console\.log\('[^']*tag 永远是 PWstudy[^;]*\);/, '')],

  /* ---------- 完整性校验三层：少一层都不许 ---------- */
  ['校验不比大小（断了一半的包也能过）', 'utils/updater.js',
    s => s.replace("if (want > 0 && st.size !== want) return { ok: false, why: 'size', size: st.size, want: want };",
      "if (false) return { ok: false, why: 'size', size: st.size, want: want };")],
  ['校验不看 zip 头（错误页也能当更新包）', 'utils/updater.js',
    s => s.replace(/!\(head\[0\] === 0x50 && head\[1\] === 0x4b && head\[2\] === 0x03 && head\[3\] === 0x04\)\)/,
      'false)')],
  ['校验不看 EOCD（大小刚好对的半个包能过）', 'utils/updater.js',
    s => s.replace("if (!tail || !hasEocd(tail)) return { ok: false, why: 'truncated', size: st.size };",
      "if (false) return { ok: false, why: 'truncated', size: st.size };")],
  ['校验不比摘要（挂了 .sha256 也白挂）', 'utils/updater.js',
    s => s.replace("if (sha256Hex(buf) !== want256) return { ok: false, why: 'sha256', size: st.size };",
      "if (false) return { ok: false, why: 'sha256', size: st.size };")],
  ['大文件也去算摘要（20MB 读进内存滚一遍，卡死主线程）', 'utils/updater.js',
    s => s.replace('if (want256 && st.size <= SHA256_MAX) {', 'if (want256) {')],
  ['残缺包不删（留着占地方，哪天还被当成"已下好"）', 'utils/updater.js',
    s => s.replace('function removeFile(p) {', 'function removeFile(p) { return Promise.resolve(false);')],

  /* ---------- 单实例 / 去重 / 清场 ---------- */
  ['没有单实例（同一时间能开两路下载，下出两份包）', 'utils/updater.js',
    s => s.replace('if (inflight && inflight.key === key) return inflight.promise;',
      'if (false) return inflight.promise;')],
  ['下新包不清旧包（_doc 里堆一串历史 APK）', 'utils/updater.js',
    s => s.replace('if (stale && d.path) await removeFile(d.path);', 'if (false) await removeFile(d.path);')],
  ['进程被杀留下的 downloading 不重新校准（拿半成品去装）', 'utils/updater.js',
    s => s.replace("const stale = !same || (d.url && item.url && d.url !== item.url) || d.state === 'downloading';",
      "const stale = !same || (d.url && item.url && d.url !== item.url);")],

  /* ---------- 静默 ---------- */
  ['预下载失败会 toast（用户没主动点，没资格打扰他）', 'utils/updater.js',
    s => s.replace('  if (!got) return null;',
      "  if (!got) { uni.showToast({ title: '下载失败', icon: 'none' }); return null; }")],

  /* ---------- APK 与 WGT 共用一套 ---------- */
  ['装 APK 也重启（把系统安装界面打断）', 'utils/updater.js',
    s => s.replace("if (got.kind === 'wgt') restart();", 'restart();')],
  ['kind 用 state 猜而不是看后缀（会把 wgt 当整包装到老基座上 → 白屏）', 'utils/updater.js',
    s => s.replace("const isApk = /\\.apk(\\?|$)/i.test(String(rm.url));",
      "const isApk = (st === 'native' || st === 'apk');")],
  ['基座太老时照样下 wgt（老基座装新资源包 = 白屏）', 'utils/updater.js',
    s => s.replace("if ((st === 'native' || st === 'apk') && !isApk) return null;", '')],
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
      'if (false) return { state: \'apk\', local, remote: apk, notes };')],
  // 清单接口：latest 会漂
  ['清单接口改用 /releases/latest（会漂到别的 Release）', 'utils/updater.js',
    s => s.replace("releases/tags/' + RELEASE_TAG", 'releases/latest\'')],
  ['不校验 tag（拿到别人的清单照用）', 'utils/updater.js',
    s => s.replace('if (d.tag_name && d.tag_name !== RELEASE_TAG) {', 'if (false) {')],
  // 同一个 Release 里 wgt 与 APK 共存：APK 不该抢在热更前面
  ['有可用 wgt 却因为 Release 里挂着 APK 走了整包', 'utils/updater.js',
    s => s.replace('if (remote && local.code < remote.code) {', 'if (false) {')],
  // 红点 / 首页弹窗
  // ⚠️ 按函数定位后再替换：`markChecked();` 在 autoCheck / manualCheck 里各有一处，
  //    而且注释跨了两行 —— 拿半句注释当锚点会把后半句留在代码里（直接语法错，
  //    "被抓到"的是崩溃不是断言，假绿）
  ['自检又弹窗了（启动瞬间糊一张卡片）', 'utils/updater.js', s => {
    const i = s.indexOf('export async function autoCheck()');
    if (i < 0) return s;
    return s.slice(0, i) + s.slice(i).replace('    markChecked();\n',
      "    markChecked();\n    if (r.state === 'update') return askUpdate(r);\n");
  }],
  ['pending 不跟本机版本比（红点永远摘不掉）', 'utils/updater.js',
    s => s.replace('if (local && local.code >= p.code) { clearPending(); return null; }', '')],
  ['首页弹窗每次进都弹（切个 tab 回来又一遍）', 'utils/updater.js',
    s => s.replace('if (prompted) return Promise.resolve(false);', '')],
  ['有别的事在场也照弹（抢在引导/关联询问前面）', 'utils/updater.js',
    s => s.replace('if (o.busy) return Promise.resolve(false);', '')],
  ['红点状态不放 storage（重启后闪一下就没了）', 'utils/settings.js',
    s => s.replace("pending: { version: '', code: 0, minNative: 0, url: '', size: 0, notes: '', state: '', downloadPath: '', digestUrl: '' },", '')],
  ['说过「不再提示」红点还亮着', 'utils/updater.js',
    s => s.replace('return (settings.get().update || {}).skip !== p.version;', 'return true;')],
  ['首页不再问更新', 'pages/home/home.vue',
    s => s.replace('    this.maybeUpdatePrompt()', '')]
];

/** 把所有被测文件写回内存里的备份（结束、异常、中途放弃都要走一遍） */
function restoreAll() {
  FILES.forEach(f => fs.writeFileSync(U(f), orig[f], 'utf8'));
  fs.writeFileSync(PUB, pubOrig, 'utf8');
}

(async () => {
  let bad = 0;
  // 进来先兜底还原一次：上一轮要是中途挂了，磁盘上可能还留着注入，
  // 那样这一轮的"基线"就是红的，后面每条用例的判据也全都不作数
  restoreAll();
  const base = await runCheck();
  console.log('基线：exit=' + base.code + '（应为 0）');
  if (base.code !== 0 || base.timeout) {
    console.log('基线就不是绿的，先修好再来 ✗（已把被测文件还原）');
    restoreAll();
    process.exit(1);
  }

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
    if (r.crash) { console.log('  ⚠ 护栏崩了: ' + name + '（不算"抓到"）✗\n     ' + r.crash.split('\n')[0]); bad++; }
    else if (r.timeout) { console.log('  ⚠ 超时没跑完: ' + name + '（结果不可信）✗'); bad++; }
    else if (r.code !== 0) console.log('  抓到 ' + name + '（' + r.fails.length + ' 条红）');
    else { console.log('  漏了 ' + name + ' ✗'); bad++; }
  }

  restoreAll();
  const after = await runCheck();
  console.log('还原后：exit=' + after.code + '（应为 0）');
  if (after.code !== 0 || after.timeout) bad++;

  console.log(bad === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
  process.exit(bad ? 1 : 0);
})();
