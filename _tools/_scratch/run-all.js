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
  let crash = null;
  try { require(abs); } catch (e) { if (!e || !e.__exit) crash = e; }
  finally { console.log = realLog; console.error = realErr; console.warn = realWarn; process.exit = realExit; }
  return { code: crash ? 99 : code, buf, crash };
}

const files = [];
for (const f of fs.readdirSync(path.join(ROOT, '_tools')).sort()) {
  if (/^check-.*\.js$/.test(f)) files.push(path.join(ROOT, '_tools', f));
}
for (const f of ['check-vue.js', 'check-pwstudy.js']) files.push(path.join(ROOT, f));

const green = [];
const red = [];
for (const f of files) {
  const r = run(f);
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  if (r.crash) { red.push(rel + '  CRASH: ' + r.crash.message); continue; }
  if (r.code === 0) green.push(rel);
  else {
    const msg = r.buf.filter(l => l.indexOf('✗') >= 0).slice(0, 3).join(' | ');
    red.push(rel + (msg ? '  ' + msg : ''));
  }
}
console.log('绿 ' + green.length + ' / 共 ' + files.length);
console.log('');
if (red.length) {
  console.log('红 ' + red.length + ':');
  red.forEach(r => console.log('  ✗ ' + r));
}
