// 反向测试：故意把顶栏标题的居中写法改坏，确认 check-navbar.js 第 11 组真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// check-navbar.js 用 process.exitCode 收尾（不是 process.exit），所以读 exitCode 即可。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp-PWstudy', 'components', 'float-navbar', 'float-navbar.vue');
const CHECK = path.join(ROOT, '_tools', 'check-navbar.js');
const orig = fs.readFileSync(FILE, 'utf8');

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realLog = console.log;
  const realErr = console.error;
  console.log = () => {};
  console.error = () => {};
  process.exitCode = 0;
  let crash = null;
  try { require(CHECK); } catch (e) { crash = e; }
  console.log = realLog;
  console.error = realErr;
  const ec = process.exitCode || 0;
  process.exitCode = 0;
  return { code: crash ? 99 : ec, crash: crash ? String((crash && (crash.stack || crash.message)) || '') : '' };
}

// 每个 case：把 from 换成 to，护栏必须变红
const BAR_CASES = [
  // 回到旧写法：flex:1 只在"剩下的空间"里居中 → 右侧多一颗键时标题整体偏左
  ['标题改回 flex:1（右槽一宽，标题就偏左）',
    s => s.replace('  position: absolute;\n  left: 0;\n  right: 0;\n  top: 0;\n  height: 100%;\n  line-height: 88rpx;\n  padding: 0 88rpx;\n  box-sizing: border-box;',
      '  flex: 1;')],
  // 绝对定位的标题盖在左槽之上，不穿透会把返回键点死
  ['标题去掉 pointer-events:none（左槽点不动）',
    s => s.replace('  text-overflow: ellipsis;\n  pointer-events: none;\n}', '  text-overflow: ellipsis;\n}')],
  // 标题脱流后没有东西撑开 → 右槽串到返回键旁边
  ['胶囊去掉 space-between（右槽串到最左）',
    s => s.replace('  justify-content: space-between;\n', '')],
  // ⚠️ 锚点必须带 position:absolute：光匹配 "left:0 / right:0" 会先命中 .fnb-wrap，
  //    改的是外层而不是标题 —— 于是这条用例变成假绿（反向测试第一轮抓到）
  ['标题不再左右归零（居中基准变成剩余空间）',
    s => s.replace('  position: absolute;\n  left: 0;\n  right: 0;\n', '  position: absolute;\n  left: 88rpx;\n')],
  ['标题去掉 text-align:center',
    s => s.replace('  text-align: center;\n  font-size: 30rpx;', '  font-size: 30rpx;')]
];

// 造一条 case：mut + 目标文件（不写就是组件），原文在还原时要用
function mk(name, mut, target) {
  const t = target || FILE;
  return { name: name, mut: mut, target: t, orig: t === FILE ? orig : pageOrig[t] };
}

// 页面级的改动点（第 12 组扫的是页面里的 :back 声明，不只是组件）
const P = (rel) => path.join(ROOT, 'uniapp-PWstudy', rel);
const SETTINGS = P('pkgManage/pages/settings/settings.vue');
const PROFILE = P('pages/profile/profile.vue');
const GOALS = P('pages/goals/goals.vue');
const pageOrig = {};
[SETTINGS, PROFILE, GOALS].forEach(f => { pageOrig[f] = fs.readFileSync(f, 'utf8'); });

// 每个 case：target 是被改坏的文件（组件或某个页面），orig 是它的原文
const cases = BAR_CASES.map(c => ({ name: c[0], mut: c[1], target: FILE, orig: orig })).concat(
  // 子页漏声明 → 退回"看运气的自动判定"，箭头时有时无
  mk('子页漏写 :back（设置页）',
    s => s.replace('<float-navbar :title="$t(\'设置\')" :back="true" />',
      '<float-navbar :title="$t(\'设置\')" />'), SETTINGS),
  // tab 根页写成 true → 首页/目标/统计/我的 左上角凭空多一个回不去的箭头
  mk('tab 根页写成 :back="true"（我的页）',
    s => s.replace(':back="false"', ':back="true"'), PROFILE),
  // tab 根页漏声明
  mk('tab 根页漏写 :back（目标页）',
    s => s.replace('<float-navbar title="目标" :back="false" />', '<float-navbar title="目标" />'), GOALS),
  // 忙碌转圈挪回左槽 → AI 跑起来时左槽被顶掉，返回键"加载完才出现"
  mk('转圈挪回左槽（又把返回键顶掉）',
    s => s.replace('        <text v-if="!search && showBack" class="fnb-back"',
      '        <view v-if="busy" class="fnb-spin"></view>\n        <text v-else-if="!search && showBack" class="fnb-back"'), FILE),
  // 返回不再问页面 → 强制模式下点左上角就能跑出去（绕开 onBackPress）
  mk('返回不再问页面（绕开 onBackPress）',
    s => s.replace('      let vetoed = false\n      this.$emit(\'before-back\', () => { vetoed = true })\n      if (vetoed) return\n', ''), FILE),
  // mounted 里不再重新量栈深 → 又回到"页面创建时栈里还没有自己"
  mk('mounted 里不再重新量栈深',
    s => s.replace('    // 挂载后再量一次栈深：这时当前页一定已经在栈里了（创建时未必）\n    this.measureStack()\n', ''), FILE)
);

let bad = 0;
const base = runCheck();
console.log('基线 exit=' + base.code + (base.crash ? ' 崩了: ' + base.crash.split('\n')[0] : ''));
if (base.code !== 0 || base.crash) {
  console.log('基线就不是绿的，先修好再来 ✗');
  process.exit(1);
}

for (const c of cases) {
  const name = c.name, mut = c.mut, target = c.target, src = c.orig;
  const next = mut(src);
  if (next === src) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(target, next, 'utf8');
  let r;
  try { r = runCheck(); } finally { fs.writeFileSync(target, src, 'utf8'); }
  if (r.crash) { console.log('  ⚠ 护栏崩了: ' + name + '（不算"抓到"）✗\n     ' + r.crash.split('\n')[0]); bad++; }
  else if (r.code !== 0) console.log('  抓到 ' + name + '（' + r.code + '）');
  else { console.log('  漏了 ' + name + ' ✗'); bad++; }
}

const after = runCheck();
console.log('还原后：exit=' + after.code + '（应为 0）');
if (after.code !== 0 || after.crash) bad++;

console.log(bad === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
process.exit(bad ? 1 : 0);
