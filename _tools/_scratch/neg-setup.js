// 反向测试：故意把源码改坏，确认 check-setup.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// check-setup.js 是**同步**的（没有 async IIFE），所以这里不用等"跑完了"的信号，
// require 回来退出码就已经在那里了（跟 neg-updater 那套异步 harness 不同）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const U = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const CHECK = path.join(ROOT, '_tools', 'check-setup.js');

const FILES = [
  'utils/setup.js',
  'utils/settings.js',
  'utils/i18n-en.js',
  'pkgManage/pages/setup/setup.vue',
  'pages/home/home.vue',
  'pkgPlan/pages/wizard/wizard.vue',
  'pkgPlan/pages/goal-detail/goal-detail.vue'
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

const cases = [
  /* ---------- 悬浮窗：历史上就是被漏掉才出的事故 ---------- */
  ['清单里没有悬浮窗（强制模式永远拉不回来，而且毫无报错）', 'utils/setup.js',
    s => s.replace("    key: 'overlay',", "    key: 'overlayX',")],
  ['悬浮窗的 must 写成字面量（不开强制模式也被逼着去授权）', 'utils/setup.js',
    s => s.replace("    must: () => forcedOn(),", "    must: true,")],
  ['悬浮窗的 check 不查 canDrawOverlays（永远显示未开）', 'utils/setup.js',
    s => s.replace("    check: () => apptime.canDrawOverlays(),", "    check: () => false,")],
  ['悬浮窗的 fix 跳错页（点"去设置"去了别的地方）', 'utils/setup.js',
    s => s.replace("    fix: () => apptime.openOverlaySettings()", "    fix: () => apptime.openUsageSettings()")],
  ['无障碍的 must 写成字面量（不开强制模式也被逼着授全屏警示页）', 'utils/setup.js',
    s => s.replace("    must: () => forcedOn() && apptime.a11ySafe(),", "    must: true,")],
  // ⚠️ 保险丝是**两层**保险：must 里判 a11ySafe、check 里也判。只去掉一层，
  //    另一层还撑着，护栏不会红 —— 那不是假绿，是冗余设计生效了。要验就得两层一起拆。
  ['无障碍保险丝跳闸还去引导（用户开了又崩，来回卡）', 'utils/setup.js',
    s => s.replace("    must: () => forcedOn() && apptime.a11ySafe(),", "    must: () => forcedOn(),")
      .replace("    check: () => !apptime.a11ySafe() || apptime.hasA11yPermission(),",
        "    check: () => apptime.hasA11yPermission(),")],

  /* ---------- 跳过 ---------- */
  ['跳过不生效（点了"先不弄"还天天弹）', 'utils/setup.js',
    s => s.replace("    s.setup.done = true;", "    s.setup.done = false;")],

  /* ---------- 新建目标 → 学习 App ---------- */
  ['wizard 建完不带 new=1（详情页没机会放引导）', 'pkgPlan/pages/wizard/wizard.vue',
    s => s.replace(" + '&new=1'", "")],
  ['详情页不认 new=1（刚建的也当老目标，引导永远不出现）', 'pkgPlan/pages/goal-detail/goal-detail.vue',
    s => s.replace("this.justCreated = !!(query && (query.new === '1' || query.new === 1))",
      "this.justCreated = false")],
  ['onShow 不放引导', 'pkgPlan/pages/goal-detail/goal-detail.vue',
    s => s.replace("    this.maybeAskApps()", "")],
  ['没判"只问一次"（每建一个目标都问一遍，话多）', 'pkgPlan/pages/goal-detail/goal-detail.vue',
    s => s.replace("      if (setup.appsAsked()) return", "      if (false) return")],
  ['根本没记账（打断了下次又问一遍）', 'utils/setup.js',
    s => s.replace("    return !!(s && s.setup && s.setup.appsAsked);", "    return false;")],
  ['点「去添加」不跳学习 App 管理页', 'pkgPlan/pages/goal-detail/goal-detail.vue',
    s => s.replace("      if (act === 'apps') safeNav('/pkgPlan/pages/apps/apps')", "")],

  /* ---------- 文案 ---------- */
  ['权限页又写回"不碰无障碍"（跟清单里的 a11y 项打架）', 'pkgManage/pages/setup/setup.vue',
    s => s.replace("        「无障碍」和「显示在其他应用上层」",
      "        所以 PWstudy 只申请真正用得上的权限，不碰无障碍。「无障碍」和「显示在其他应用上层」")],
  ['首页弹窗写死名单（清单加一项就漏一条）', 'pages/home/home.vue',
    s => s.replace("      const names = setup.pendingNames()", "      const names = []")],
  ['英文词表少了新词条（英文态会掉回中文）', 'utils/i18n-en.js',
    s => s.replace("  '去添加': 'Add',", "")]
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
  const src = orig[file];
  const next = mut(src);
  if (next === src) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(U(file), next, 'utf8');
  let r;
  try { r = runCheck(); } finally { fs.writeFileSync(U(file), orig[file], 'utf8'); }
  if (r.crash) { console.log('  ⚠ 护栏崩了: ' + name + '（不算"抓到"）✗\n     ' + r.crash.split('\n')[0]); bad++; }
  else if (r.code !== 0) console.log('  抓到 ' + name + '（' + r.code + '）');
  else { console.log('  漏了 ' + name + ' ✗'); bad++; }
}

restoreAll();
const after = runCheck();
console.log('还原后：exit=' + after.code + '（应为 0）');
if (after.code !== 0 || after.crash) bad++;

console.log(bad === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
process.exit(bad ? 1 : 0);
