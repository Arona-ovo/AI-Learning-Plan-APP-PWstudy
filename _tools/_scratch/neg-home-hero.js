// 反向测试：故意把首页分层改坏，确认 check-home-hero.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件，并接管 process.exit 取退出码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const CHECK = path.join(ROOT, '_tools', 'check-home-hero.js');
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
  ['聚焦区整块改名（第一屏没了）', s => s.replace('class="hero"', 'class="hero2"')],
  ['主任务不排除已完成的', s => s.replace(
    "(this.queue || []).filter(i => i.task && i.task.status !== 'done')", "(this.queue || []).slice()")],
  ['主任务不再"超期优先"', s => s.replace('if (late.length) return late[0]', 'if (false) return late[0]')],
  ['主任务不再挑剩余最多的', s => s.replace('left(b) - left(a)', '0')],
  ['图形槽改名（一排高低不齐）', s => s.replace('class="mg-slot"', 'class="mg-slot2"')],
  ['miniList 给 focus 也发一格', s => s.replace("if (id === 'focus') return", "if (id === 'focus') {}")],
  ['jumpModule 只滚不展开', s => s.replace(
    /(jumpModule\(id\) \{[\s\S]{0,120}?)this\.modsOpen = true/, '$1this.modsOpen = false')],
  ['折叠区默认就展开（首页不再简洁）', s => s.replace('modsOpen: false', 'modsOpen: true')],
  ['把手丢掉上滑手势', s => s.replace('@touchmove="peekMove"', '@touchmove="noop"')],
  ['把手点不动（没有 openMods）', s => s.replace('@tap="openMods"', '@tap="noop"')],
  ['列表头整块删掉', s => s.replace('class="mods-head"', 'class="mods-head2"')],
  ['进编辑态不自动展开（看不见卡片）', s => s.replace('if (this.editing) this.modsOpen = true', 'if (this.editing) {}')],
  // ⚠️ 不能只替换 'if (this.editing) return' —— cardOrder 里那句
  //    'if (this.editing) return ids' 同前缀会被先命中，改坏的是别处（假绿）
  ['编辑态允许收起（拖到一半没了）', s => s.replace(
    /(closeMods\(\) \{[\s\S]{0,200}?)if \(this\.editing\) return/, '$1if (false) return')],
  ['引导前不展开（两步被跳过）', s => s.replace(
    /(引导要挖洞[\s\S]{0,320}?)this\.modsOpen = true/, '$1this.modsOpen = false')],
  ['主按钮直接起表（带 auto）', s => s.replace(
    /(startFocusTask\(\) \{[\s\S]{0,80}?)this\.startFor\(this\.focusTask\)/,
    "$1uni.navigateTo({ url: this.focusUrl() + '&auto=1' })")]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗'); process.exit(1); }

for (const [name, mut] of cases) {
  const next = mut(orig);
  if (next === orig) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(FILE, next);
  const r = runCheck();
  const hit = r.code !== 0;
  console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0] : ''));
  if (!hit) bad++;
}

fs.writeFileSync(FILE, orig);
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓');
process.exitCode = bad ? 1 : 0;
