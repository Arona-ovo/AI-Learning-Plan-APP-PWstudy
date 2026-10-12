// 全量回归：跑 _tools/check-*.js + 根目录三个总检，统计红绿。
// 不能 spawn（沙箱 EBUSY），用同进程 require + 接管 process.exit 取退出码。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

async function run(file) {
  const abs = path.resolve(file);
  delete require.cache[require.resolve(abs)];
  const realLog = console.log;
  const realErr = console.error;
  const realWarn = console.warn;
  const prevExit = process.exit;
  const mine = { code: 0, buf: [] };
  const buf = mine.buf;
  // inRequire：只有在同步 require 的栈里，throw 才有人接得住。
  // 异步回调里（有些护栏在 setImmediate / 定时器里才收尾）再 throw 就是 uncaught，
  // 会直接把整个回归进程崩掉 —— 那时只记退出码就够了。
  let inRequire = true;
  process.exit = (c) => {
    mine.code = (c == null ? 0 : c);
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
  console.log = realLog;
  console.error = realErr;
  console.warn = realWarn;
  process.exit = prevExit;
  const exitCode = process.exitCode || 0;
  process.exitCode = 0;
  return { code: crash ? 99 : (mine.code || exitCode), buf, crash };
}

const files = [];
for (const f of fs.readdirSync(path.join(ROOT, '_tools')).sort()) {
  if (/^check-.*\.js$/.test(f)) files.push(path.join(ROOT, '_tools', f));
}
for (const f of ['check-vue.js', 'check-pwstudy.js']) files.push(path.join(ROOT, f));

const green = [];
const red = [];
const skipped = [];

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
  if (r.code === 0) green.push(rel);
  else {
    const msg = r.buf.filter(l => l.indexOf('✗') >= 0).slice(0, 3).join(' | ');
    red.push(rel + (msg ? '  ' + msg : ''));
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
if (red.length) {
  console.log('红 ' + red.length + ':');
  red.forEach(r => console.log('  ✗ ' + r));
}
})();
