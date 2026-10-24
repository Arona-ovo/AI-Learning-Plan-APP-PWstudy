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
const cases = [
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

let bad = 0;
const base = runCheck();
console.log('基线 exit=' + base.code + (base.crash ? ' 崩了: ' + base.crash.split('\n')[0] : ''));
if (base.code !== 0 || base.crash) {
  console.log('基线就不是绿的，先修好再来 ✗');
  process.exit(1);
}

for (const [name, mut] of cases) {
  const next = mut(orig);
  if (next === orig) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(FILE, next, 'utf8');
  let r;
  try { r = runCheck(); } finally { fs.writeFileSync(FILE, orig, 'utf8'); }
  if (r.crash) { console.log('  ⚠ 护栏崩了: ' + name + '（不算"抓到"）✗\n     ' + r.crash.split('\n')[0]); bad++; }
  else if (r.code !== 0) console.log('  抓到 ' + name + '（' + r.code + '）');
  else { console.log('  漏了 ' + name + ' ✗'); bad++; }
}

const after = runCheck();
console.log('还原后：exit=' + after.code + '（应为 0）');
if (after.code !== 0 || after.crash) bad++;

console.log(bad === 0 ? '\n反向测试全部通过（护栏不是假绿）' : '\n反向测试失败 ' + bad + ' 项 ✗');
process.exit(bad ? 1 : 0);
