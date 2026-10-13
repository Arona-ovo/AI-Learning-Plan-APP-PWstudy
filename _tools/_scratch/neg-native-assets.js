// 反向测试：故意把原生资源配坏，确认 check-native-assets.js 真的会红（防假绿）。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
//    改成同进程 require：清掉 require.cache 让它重新读文件。
// ⚠️ 必须同时读 process.exit() 与 process.exitCode 两条退出口径：
//    这个项目的守卫脚本有的写 process.exit(1)，有的只写 process.exitCode = 1，
//    只接管前者的话后者永远读到 0（"怎么改坏都是绿"）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-native-assets.js');
const IMG = path.join(ROOT, '_tools', '_scratch', '_img');

const MANIFEST = path.join(ROOT, 'uniapp-PWstudy', 'manifest.json');
const COVER = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'cover', 'cover.vue');
const THEME = path.join(ROOT, 'uniapp-PWstudy', 'utils', 'theme.js');
const SPLASH_HD = path.join(ROOT, 'uniapp-PWstudy', 'static', 'splash', 'splash-hdpi.9.png');

const FILES = [MANIFEST, COVER, THEME, SPLASH_HD];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });

function restore() {
  FILES.forEach(f => fs.writeFileSync(f, backup[f]));
  // 改后缀那个用例会留下一个普通 png，一并清掉
  const twin = path.join(ROOT, 'uniapp-PWstudy', 'static', 'splash', 'splash-hdpi.png');
  if (fs.existsSync(twin)) fs.unlinkSync(twin);
}

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const realCode = process.exitCode;
  let code = 0;
  const buf = [];
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) throw e; }
  finally {
    code = code || (process.exitCode || 0);
    console.log = realLog; console.error = realErr;
    process.exit = realExit; process.exitCode = realCode;
  }
  return { code, fails: buf.filter(l => l.indexOf('✗') >= 0) };
}

const M = () => fs.readFileSync(MANIFEST, 'utf8');
const C = () => fs.readFileSync(COVER, 'utf8');
const T = () => fs.readFileSync(THEME, 'utf8');
const write = (p, s) => fs.writeFileSync(p, s);

const cases = [
  ['图标挪回错层级（distribute.android.icons）', () => {
    const s = M().replace('"packagename" : "com.PWstudy"',
      '"packagename" : "com.PWstudy",\n                "icons" : { "xxhdpi" : "static/icons/icon-144.png" }');
    if (s === M()) return false;
    write(MANIFEST, s);
  }],
  ['整个 distribute.icons 被删掉', () => {
    const s = M().replace(/"icons"\s*:\s*\{\s*"android"\s*:\s*\{[\s\S]*?\}\s*\},/, '');
    if (s === M()) return false;
    write(MANIFEST, s);
  }],
  ['xxxhdpi 图标换成了 144 的图（尺寸不符）', () => {
    const s = M().replace('"xxxhdpi" : "static/icons/icon-192.png"', '"xxxhdpi" : "static/icons/icon-144.png"');
    if (s === M()) return false;
    write(MANIFEST, s);
  }],
  ['xxxhdpi 图标文件不存在', () => {
    const s = M().replace('"xxxhdpi" : "static/icons/icon-192.png"', '"xxxhdpi" : "static/icons/icon-999.png"');
    if (s === M()) return false;
    write(MANIFEST, s);
  }],
  ['启动图黑线全没了（会变形/错位）', () => {
    write(SPLASH_HD, fs.readFileSync(path.join(IMG, 'neg-9-no-lines.9.png')));
  }],
  ['启动图黑线只有中间一段', () => {
    write(SPLASH_HD, fs.readFileSync(path.join(IMG, 'neg-9-partial.9.png')));
  }],
  ['启动图边上混了非黑的不透明像素', () => {
    write(SPLASH_HD, fs.readFileSync(path.join(IMG, 'neg-9-opaque-edge.9.png')));
  }],
  ['启动图不是 .9.png（普通 png 会被铺满拉伸）', () => {
    fs.renameSync(SPLASH_HD, path.join(ROOT, 'uniapp-PWstudy', 'static', 'splash', 'splash-hdpi.png'));
    write(MANIFEST, M().replace('"hdpi" : "static/splash/splash-hdpi.9.png"', '"hdpi" : "static/splash/splash-hdpi.png"'));
  }],
  ['封面透明档改成 30%（改了配色没重新生成启动图）', () => {
    const s2 = C().replace(/rgba\(var\(--brand-rgb, 228, 23, 61\), 0\.06\)/, 'rgba(var(--brand-rgb, 228, 23, 61), 0.30)');
    if (s2 === C()) return false;
    write(COVER, s2);
  }],
  ['出厂底色换掉（没重新生成启动图）', () => {
    const s = T().replace("solid: '#f0e4d2'", "solid: '#e0d0b8'");
    if (s === T()) return false;
    write(THEME, s);
  }],
  ['cover 的圆框不再淡入（splash→cover 硬切）', () => {
    const s = C().replace('  opacity: 0;\n  animation: stageIn 0.6s ease 0.15s forwards;', '');
    if (s === C()) return false;
    write(COVER, s);
  }],
  ['alwaysShowBeforeRender 被写回 false（会闪白）', () => {
    const s = M().replace('"alwaysShowBeforeRender" : true', '"alwaysShowBeforeRender" : false');
    if (s === M()) return false;
    write(MANIFEST, s);
  }]
];

let bad = 0;
restore();
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('  基线就不是绿的，先修好再来 ✗ ' + base.fails[0]); process.exit(1); }

for (const [name, mut] of cases) {
  restore();
  const matched = mut();
  if (matched === false) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
  const r = runCheck();
  const hit = r.code !== 0;
  console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0] : ''));
  if (!hit) bad++;
}

restore();
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓（' + cases.length + ' 项）');
process.exitCode = bad ? 1 : 0;
