// 反向测试：故意把 float-tabbar.vue 改坏，确认 check-tabbar.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：沙箱里 spawnSync 会 EBUSY 且失败形态像"通过"。
//    同进程 require + 清 cache + 接管 process.exit（骨架照抄 neg-home-edit.js）。
// ⚠️ 源码是 CRLF：多行锚点按 LF 写会静默 SKIP，applyMut 统一兜一层转换。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp-PWstudy', 'components', 'float-tabbar', 'float-tabbar.vue');
const CHECK = path.join(ROOT, '_tools', 'check-tabbar.js');
const orig = fs.readFileSync(FILE, 'utf8');

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  let code = 0;
  const buf = [];
  // ⚠️ check-tabbar 结尾只写 process.exitCode、不调 process.exit() ——
  //    只接 exit 会永远读到 0，全部用例假绿（run-all.js 对这两个都收，这里照抄）。
  const realExitCode = Object.getOwnPropertyDescriptor(process, 'exitCode');
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) throw e; }
  finally {
    // ⚠️ 脚本没喊 exit 时退出码落在 process.exitCode 上（check-tabbar 就是这种）——
    //    require 返回后读它；读完恢复默认值，别把 0 带进下一条用例
    if (code === 0 && process.exitCode) code = Number(process.exitCode) || 0;
    process.exitCode = 0;
    console.log = realLog; console.error = realErr; process.exit = realExit;
  }
  return { code, fails: buf.filter(l => l.indexOf('✗') >= 0) };
}

const cases = [
  // 2026-10-31 scrcpy 逐帧取证：首帧脏状态 = 红与胶囊分裂的本体。
  // activeKey 恢复"pending 优先"就是把首帧脏状态请回来 —— 必须红。
  ['activeKey 恢复 pending 优先（首帧脏状态回来 → 红与胶囊分裂）', s => s.replace(
    '      return this.current;',
    '      return this.pending || this.current;')],
  ['胶囊位置不再由 current 派生（写死归 0，永远停第一格）', s => s.replace(
    '      const i = this.curIndex;\n      return (i < 0 ? 0 : i) * 100;',
    '      return 0;')],
  ['sync 不清残留连点锁（快速切回后第一次点 tab 被吞）', s => s.replace(
    '      this.__navLock = false;\n      if (this.__navLockT)',
    '      if (this.__navLockT)')],
  ['switchTab 不接 fail（路由锁静默拒绝 → 点击被吞，点了没反应）', s => s.replace(
    '        fail: () => { setTimeout(retry, 350); }',
    '')],
  ['连点锁被移除（350ms 内连点会连续触发 switchTab）', s => s.replace(
    'if (this.__navLock) return;',
    '')],
  ['实例缓存状态机回潮（this.indIndex 回来 = 首帧脏状态回来）', s => s.replace(
    'this.__navLock = false;   //',
    'this.indIndex = 0; this.__navLock = false;   //')]
];

// 源码是 CRLF：LF 锚点先按 LF 试，命中后按 CRLF 还原（只动行尾，不改内容）
const applyMut = (mut, src) => {
  const direct = mut(src);
  if (direct !== src) return direct;
  const lf = src.split('\r\n').join('\n');
  const changed = mut(lf);
  if (changed === lf) return src; // 真没命中
  return changed.split('\n').join('\r\n');
};

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗'); process.exit(1); }

for (const [name, mut] of cases) {
  const next = applyMut(mut, orig);
  if (next === orig) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(FILE, next);
  let r;
  try { r = runCheck(); } catch (e) { console.log('CRASH 跑护栏自己崩了: ' + name + ' → ' + e.message); bad++; fs.writeFileSync(FILE, orig); continue; }
  const hit = r.code !== 0;
  console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0].trim() : ''));
  if (!hit) bad++;
}

fs.writeFileSync(FILE, orig);
const back = runCheck();
if (back.code !== 0) { console.log('还原后基线不是绿的 ✗（文件没写回去）'); bad++; }
else console.log('还原后基线：绿 ✓');
console.log(bad === 0 ? '反向测试全部通过 ✓' : ('有问题 ' + bad + ' 条 ✗'));
process.exit(bad ? 1 : 0);
