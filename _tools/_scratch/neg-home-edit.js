// 反向测试：故意把源码改坏，确认 check-home-edit.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件，并接管 process.exit 取退出码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const CHECK = path.join(ROOT, '_tools', 'check-home-edit.js');
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
  ['拖拽量 .card 而不是 .mod-wrap', s => s.replace("selectAll('.mod-wrap')", "selectAll('.card')")],
  ['编辑态不返回全部卡片', s => s.replace('if (this.editing) return ids', 'return ids.filter(id => this.cardVisible(id))')],
  ['去掉"至少留一个"守卫', s => s.replace('if (this.cardOrder.length <= 1) {', 'if (false) {')],
  ['删掉 dock 分支', s => s.replace(`v-else-if="id === 'dock'"`, `v-else-if="id === 'nope'"`)],
  ['把手 z-index 低于遮罩', s => s.replace('z-index: 11;', 'z-index: 9;')],
  ['硬控起不退编辑态', s => s.replace('if (v) this.finishEdit()', 'if (v) {}')],
  ['收纳后不同步布局', s => s.replace('try { layout.stash(id) } catch (e) {}\n      this.syncLayout()', 'try { layout.stash(id) } catch (e) {}')],
  ['抽屉挪进 .page-slide', s => s.replace('</view>\n\n    <!-- 「添加组件」抽屉', '\n    <!-- 「添加组件」抽屉')],
  ['遮罩与把手同层（把手被挡住）', s => s.replace('z-index: 11;', 'z-index: 10;')],
  ['onHide 不退编辑态', s => s.replace('onHide() {\n    // 离开首页一律退出编辑态，保证回来时界面是简洁的\n    this.finishEdit()', 'onHide() {\n    // 离开首页一律退出编辑态，保证回来时界面是简洁的')]
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
