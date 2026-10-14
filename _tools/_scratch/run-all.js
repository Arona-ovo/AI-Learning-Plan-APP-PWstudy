// 全量回归：跑 _tools/ 下的全部 check-*.js，统计红绿。
// 用法：node _tools/_scratch/run-all.js
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

// ⚠️ 有的护栏（check-sfx 就是）在 **run() 已经恢复现场之后** 的异步回调里才调 process.exit。
// 那一刻 process.exit 已经换回真的了 —— 整个回归进程被它干掉，退出码还是 0，
// 汇总那行永远打不出来，看起来像"跑完了、全绿"。实际后半程一个都没跑。
// 所以 process.exit 由这里统一吞：整个进程期间都不允许任何脚本真的退出，
// 最后汇总打完再由 REAL_EXIT 决定退出码。
const REAL_EXIT = process.exit;
let lateExit = null;
const SWALLOW_EXIT = (c) => { lateExit = (c == null ? 0 : c); };
process.exit = SWALLOW_EXIT;

async function run(file) {
  const abs = path.resolve(file);
  delete require.cache[require.resolve(abs)];
  const realLog = console.log;
  const realErr = console.error;
  const realWarn = console.warn;
  const prevExit = process.exit;
  const mine = { code: 0, buf: [] };
  const buf = mine.buf;
  lateExit = null;
  // inRequire：只有在同步 require 的栈里，throw 才有人接得住。
  // 异步回调里（有些护栏在 setImmediate / 定时器里才收尾）再 throw 就是 uncaught，
  // 会直接把整个回归进程崩掉 —— 那时只记退出码就够了。
  let inRequire = true;
  process.exit = (c) => {
    mine.code = (c == null ? 0 : c);
    mine.exited = true;          // 脚本自己喊"我跑完了"——run() 据此提前收工
    if (!inRequire) return;
    const e = new Error('__exit');
    e.__exit = true;
    throw e;
  };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  console.warn = (...a) => buf.push(a.join(' '));
  // ⚠️ 有一部分护栏结尾只写 process.exitCode、不调 process.exit()（check-uts.js 就是）。
  // 只接管 exit 的话这类脚本永远读到 0 —— 两个都要收。
  process.exitCode = 0;
  let crash = null;
  try { require(abs); } catch (e) { if (!e || !e.__exit) crash = e; }
  inRequire = false;
  // 让两拍：异步护栏（check-updater / check-version-egg 这类结尾在 promise 里的）
  // 同步 require 返回时断言还没跑，不等就恒为 0 —— 全量回归会把它算成绿（假绿）。
  await new Promise((res) => setImmediate(res));
  await new Promise((res) => setTimeout(res, 0));
  // ⚠️ 有的护栏是"一串 setTimeout 走完才收尾"的（check-schedule 走完六步收工对话要 3.7s，
  // check-sfx 的音频链同理）。等不够久的话，它们的断言输出会落进**下一个**脚本的收集窗口，
  // 红条被记到别人头上（check-schedule 的"缩略图"三条曾经记到 check-tpl-balance 头上）。
  // 所以这里等脚本自己喊结束（调 process.exit / 写 exitCode），最多等 6s。
  const t0 = Date.now();
  while (!mine.exited && !process.exitCode && Date.now() - t0 < 6000) {
    await new Promise((res) => setTimeout(res, 50));
  }
  console.log = realLog;
  console.error = realErr;
  console.warn = realWarn;
  process.exit = SWALLOW_EXIT;
  const exitCode = process.exitCode || 0;
  process.exitCode = 0;
  // 异步里才调的 exit 也要算数，否则红的全被记成 0（又一个假绿口子）
  const code = mine.code || exitCode || (lateExit == null ? 0 : lateExit);
  // ⚠️ process.exit 是靠 throw 一个哨兵 Error('__exit') 中断同步 require 的。
  // 写成 `(async () => { ... })().catch(e => { console.error(e); process.exit(1); })` 的护栏
  // （check-smooth 就是）会把它当真错误接住，打印 "Error: __exit" 然后 exit(1)
  // —— 断言其实全绿，却因为运行器的实现方式被记成红。
  // 判据：输出里有 __exit、且一条 ✗ 都没有 → 那 1 是运行器自己造的，按实际断言算。
  const badLines = buf.filter(l => l.indexOf('✗') >= 0);
  const falseAlarm = !crash && code !== 0 && badLines.length === 0
    && buf.some(l => l.indexOf('__exit') >= 0);
  return { code: crash ? 99 : (falseAlarm ? 0 : code), buf, crash, badLines, falseAlarm };
}

// ⚠️ 顺序不能随便调（2026-10-14 踩过）：
//   下面这三样是**整仓级**检查，用 `await import('file:///…/pwstore.js')` 动态
//   加载数据层。**ESM 的模块注册表不清空、也无法像 require.cache 那样手动失效**
//   —— 同一个 file:/// URL 在整个进程里只有一份实例，pwstore.js 的库存放在模块作用域，
//   谁先 import 谁就一直持有。于是它们跑在中间时，后面同样 import pwstore 的护栏会
//   读到前一个脚本塞进去的目标：check-schedule 的"今天只有第 1 天那一项"从 1 变成 5。
//   （曾经试过按 dump require.cache 隔离，对 ESM 完全无效。）
//   所以：整仓级检查固定放最后。别为了让列表"看起来整齐"把它们并进上面的字母序。
const HEAVY = ['check-refs.js', 'check-pwstudy.js', 'check-vue.js'];
const files = [];
for (const f of fs.readdirSync(path.join(ROOT, '_tools')).sort()) {
  if (/^check-.*\.js$/.test(f) && HEAVY.indexOf(f) < 0) files.push(path.join(ROOT, '_tools', f));
}
HEAVY.forEach(f => files.push(path.join(ROOT, '_tools', f)));

const green = [];
const red = [];
const skipped = [];
const falseAlarms = [];

(async () => {
for (const f of files) {
  const r = await run(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (r.crash) {
    // ⚠️ 有几个护栏（check-api-usage / check-circuit-breaker / check-intent-route /
    //    check-stream）依赖 ESM + top-level await，同进程 require 会直接抛
    //    "require() cannot be used on an ESM graph with top-level await"。
    //    那是**运行器**的限制，不是它们的红 —— 计成 SKIP（单独 `node _tools/x.js`
    //    跑是绿的），否则每次全量回归都挂 4 个假红，看久了就没人当真了。
    if (/ESM graph with top-level await/.test(r.crash.message)) {
      skipped.push(rel + '（ESM / top-level await，需单独跑）');
      continue;
    }
    red.push(rel + '  CRASH: ' + r.crash.message);
    continue;
  }
  if (r.code === 0) { green.push(rel); if (r.falseAlarm) falseAlarms.push(rel); }
  else {
    // 有 ✗ 就摘 ✗（那是真断言失败）；一条 ✗ 都没有却被判红，八成是退出码串了台，
    // 那就把输出尾巴打出来 —— 只看"红 1"不看内容，很容易把运行器的问题当成代码的问题。
    const bad = r.badLines || [];
    const msg = bad.length ? bad.slice(0, 3).join(' | ')
      : '（输出里没有 ✗，末尾：' + r.buf.slice(-4).join(' / ') + '）';
    red.push(rel + '  ' + msg);
  }
}
console.log('绿 ' + green.length + ' / 共 ' + files.length
  + (skipped.length ? '（另 ' + skipped.length + ' 个需单独跑）' : ''));
if (skipped.length) {
  console.log('');
  console.log('跳过 ' + skipped.length + ':');
  skipped.forEach(s => console.log('  ⤼ ' + s));
}
console.log('');
if (falseAlarms.length) {
  console.log('运行器误报（已按实际断言判绿，但脚本收尾方式会误吞退出哨兵，建议改成不用 .catch）：');
  falseAlarms.forEach(f => console.log('  ⚠ ' + f));
  console.log('');
}
if (red.length) {
  console.log('红 ' + red.length + ':');
  red.forEach(r => console.log('  ✗ ' + r));
}
REAL_EXIT(red.length ? 1 : 0);
})();
