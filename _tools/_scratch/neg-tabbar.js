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
  // 2026-10-26 真机截图：胶囊停在目标、红色选中态挂在"我的"。
  // 旧实现"navLock 期间保留 pending"就是漏洞本体 —— 恢复它必须红。
  ['sync 恢复旧判断（连点锁期间保留残留 pending）', s => s.replace(
    '      this.pending = \'\';\n      this.__navLock = false;',
    '      if (this.pending && !this.__navLock) this.pending = \'\';')],
  ['sync 不解除过期的连点锁（回来后第一次点 tab 被吞）', s => s.replace(
    '      this.pending = \'\';\n      this.__navLock = false;',
    '      this.pending = \'\';')],
  ['switchTab 不接 fail（路由锁拒绝后 pending 残留 → 选中态分裂 + 点了没反应）', s => s.replace(
    '        fail: () => {\n          setTimeout(() => {\n            uni.switchTab({\n              url: t.path,\n              fail: () => { self.pending = \'\'; }\n            });\n          }, 350);\n        }',
    '')],
  ['重试再失败不退回即时高亮（红色选中态挂在别人身上）', s => s.replace(
    'fail: () => { self.pending = \'\'; }',
    'fail: () => {}')]
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
