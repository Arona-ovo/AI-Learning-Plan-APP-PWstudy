// 反向测试：故意把源码改坏，确认 check-home-focus.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件，并接管 process.exit 取退出码。
// ⚠️ 源码是 CRLF：多行锚点里必须写 \r\n，这里一律用**单行**锚点绕开这个坑。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const CHECK = path.join(ROOT, '_tools', 'check-home-focus.js');
const orig = fs.readFileSync(FILE, 'utf8');

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let code = 0;
  const buf = [];
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) throw e; }
  finally { console.log = realLog; console.error = realErr; process.exit = realExit; }
  return { code, fails: buf.filter(l => l.indexOf('✗') >= 0) };
}

const cases = [
  ['时长不写 pomoCfg（首页/专注页两份配置）', s => s.replace('focus.setCfg({ focus: m })', "this.saveFocus('focusMin', m)")],
  ['休息时长不写 pomoCfg', s => s.replace('focus.setCfg({ rest: m })', "this.saveFocus('restMin', m)")],
  ['刷新时不从 pomoCfg 读回', s => s.replace('this.focusMin = pc.focus || 25', 'this.focusMin = 25')],
  ['卡片不可滚（scroll-view 换回 view）', s => s.replace('<scroll-view class="fs-body" scroll-y>', '<view class="fs-body">')],
  ['卡片不限高（十行撑满整屏）', s => s.replace('max-height: 62vh;', '')],
  ['白噪音关写 true 而不是空串', s => s.replace("next ? (this.noiseKind || 'rain') : ''", "next ? (this.noiseKind || 'rain') : true")],
  ['音色排常显（关着也占一行）', s => s.replace('v-if="noiseOn" class="fc-opts fc-opts-pad"', 'class="fc-opts fc-opts-pad"')],
  ['改完严格模式不 sync（开关与真实状态分叉）', s => s.replace(/tapStrict\(\)[\s\S]*?\n {4}\}/, m => m.replace('strict.sync()', ''))],
  ['出口不收卡片（跳回来还浮在脸上）', s => s.replace(/goFocusSet\(\)[\s\S]*?\n {4}\}/, m => m.replace('this.focusSheet = false', ''))],
  ['focusSetOn 漏掉白噪音', s => s.replace('this.strictOn || this.noiseOn', 'this.strictOn')],
  ['音色名不走 $t（字面量数组）', s => s.replace("this.$t('白噪')", "'白噪'")],
  ['少一个分组（十行不分组成一堵墙）', s => s.replace("$t('管住自己')", "$t('自我管理')")],
  ['最后一条分隔线没收掉', s => s.replace('.fc-row.is-last { border-bottom: none; }', '.fc-row.is-last { }')],
  ['顶栏高亮不接 focusSetOn', s => s.replace(':focus-on="focusSetOn"', ':focus-on="forcedOn"')]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗ ' + base.fails.join(' | ')); process.exit(1); }

// ⚠️ 还原必须放在 finally 里：某个变异把护栏自己搞崩时，进程会带着被改坏的源码
//    一起死，源码就留在变异状态了（2026-10-23 在 neg-home-hero 上实锤过一次）。
try {
  for (const [name, mut] of cases) {
    const next = mut(orig);
    if (next === orig) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
    fs.writeFileSync(FILE, next);
    const r = runCheck();
    const hit = r.code !== 0;
    console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0] : ''));
    if (!hit) bad++;
  }
} finally {
  fs.writeFileSync(FILE, orig);
}
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓');
process.exitCode = bad ? 1 : 0;
