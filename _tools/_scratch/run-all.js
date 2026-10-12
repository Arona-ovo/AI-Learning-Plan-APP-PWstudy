// 全量回归：跑 _tools/check-*.js + 根目录三个总检，统计红绿。
// 不能 spawn（沙箱 EBUSY），用同进程 require + 接管 process.exit 取退出码。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');

function run(file) {
  const abs = path.resolve(file);
  delete require.cache[require.resolve(abs)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const realWarn = console.warn;
  let code = 0;
  const buf = [];
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  console.warn = (...a) => buf.push(a.join(' '));
  // ⚠️ 有一部分护栏结尾只写 process.exitCode、不调 process.exit()（check-uts.js 就是）。
  // 只接管 exit 的话这类脚本永远读到 0 —— 全量回归会把它算成绿。两个都要收。
  process.exitCode = 0;
  let crash = null;
  try { require(abs); } catch (e) { if (!e || !e.__exit) crash = e; }
  finally { console.log = realLog; console.error = realErr; console.warn = realWarn; process.exit = realExit; }
  const exitCode = process.exitCode || 0;
  process.exitCode = 0;
  return { code: crash ? 99 : (code || exitCode), buf, crash };
}

const files = [];
for (const f of fs.readdirSync(path.join(ROOT, '_tools')).sort()) {
  if (/^check-.*\.js$/.test(f)) files.push(path.join(ROOT, '_tools', f));
}
for (const f of ['check-vue.js', 'check-pwstudy.js']) files.push(path.join(ROOT, f));

const green = [];
const red = [];
const skipped = [];
for (const f of files) {
  const r = run(f);
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
