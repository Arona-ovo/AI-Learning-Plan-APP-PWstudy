// 反向测试：故意把 index.uts 改坏，确认 check-uts.js 第 7.1b / 9 / 10 节真的会红（防假绿）。
// ⚠️ 不能 spawn 子进程（沙箱 EBUSY），同进程 require + 接管 process.exit 取退出码。
// 结束后用内存备份还原，不走 git（index.uts 上还有未提交的正常改动）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const FILE = path.join(ROOT, 'uniapp', 'uni_modules', 'pwstudy-focus', 'utssdk', 'app-android', 'index.uts');
const CHECK = path.join(ROOT, '_tools', 'check-uts.js');
const orig = fs.readFileSync(FILE, 'utf8');

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit, realLog = console.log, realErr = console.error;
  let code = 0;
  const buf = [];
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  // ⚠️ check-uts.js 结尾写的是 process.exitCode 而不是 process.exit()，
  // 只接管 exit 会永远读到 0 —— 那就是"怎么改坏都是绿"的假绿。两个都要收。
  process.exitCode = 0;
  let crash = null;
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) crash = e; }
  finally { console.log = realLog; console.error = realErr; process.exit = realExit; }
  const exitCode = process.exitCode || 0;
  process.exitCode = 0;
  return { code: crash ? 99 : (code || exitCode), fails: buf.filter((l) => l.indexOf('✗') >= 0) };
}

// index.uts 在 Windows 工作区里是 CRLF —— 正则里写 \n 会全部落空（静默变成 SKIP），
// 所以统一按 LF 处理，写回时再还原成原来的换行符。
const EOL = orig.indexOf('\r\n') >= 0 ? '\r\n' : '\n';
const norm = orig.replace(/\r\n/g, '\n');
const toEOL = (s) => s.replace(/\n/g, EOL);

const cases = [
  ['删掉 A11yQueryThread 的 constructor',
    (s) => s.replace('  constructor() {\n    super();\n  }\n\n  override run(): void {', '  override run(): void {')],
  ['删掉 PFGuardService 的 constructor',
    (s) => s.replace('  constructor() {\n    super();\n  }\n\n  override onServiceConnected(): void {', '  override onServiceConnected(): void {')],
  ['去掉把 PFGuardService 钉住的 new',
    (s) => s.replace('let probe = new PFGuardService();', 'let probe: any = null;')],
  ['把 WatchLoop 的 super() 去掉',
    (s) => s.replace('  constructor(owner: PWFocusService) {\n    super();\n', '  constructor(owner: PWFocusService) {\n')],

  // ---- 第 10 节：2026-10-13 云打包炸出来的"能写但编不过"的四个表达式 ----
  // 这些代码以前从来没被编译过（PFGuardService 被剪枝），所以是第一次进 Kotlin 编译器才暴露。
  ['Number(x) 又写回来了（实例化抽象类）',
    (s) => s.replace("let last: Int = p!.getInt('bind_at', 0);", "let last = Number(p!.getLong('bind_at', 0));")],
  ['String(x) 又写回来了（CharSequence 没有对应构造）',
    (s) => s.replace('let pkg = p!.toString();', 'let pkg = String(p!);')],
  ['Int 函数的 return 用了裸 let 计数（推成 Number）',
    (s) => s.replace('let a11yBindN: Int = 0;', 'let a11yBindN = 0;')],
  ['long 字段传了 Int 常量（不会放宽成 Long）',
    (s) => s.replace('info.notificationTimeout = 100;', 'info.notificationTimeout = A11Y_NOTIFY_MS;')],
  ['FLAG_DEFAULT 写回来了（这个常量不存在）',
    (s) => s.replace('info.flags = AccessibilityServiceInfo.DEFAULT;', 'info.flags = AccessibilityServiceInfo.FLAG_DEFAULT;')]
];

const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不绿，先修好再来 ✗'); process.exit(1); }

let bad = 0;
for (const [name, mut] of cases) {
  const next = mut(norm);
  if (next === norm) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  fs.writeFileSync(FILE, toEOL(next));
  const r = runCheck();
  // 判据就是"改坏了必须红" —— 不再限定失败文案属于第几节，
  // 否则新增一节（比如第 10 节）的失败会被这个过滤器放过，变成假绿。
  const hit = r.code !== 0 && r.fails.length > 0;
  console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0].trim() : ''));
  if (!hit) bad++;
}

fs.writeFileSync(FILE, orig);
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓');
process.exitCode = bad ? 1 : 0;
