// 反向测试：故意把源码改坏，确认 check-home-focus.js 第 6 节（圆圈衔接转场）真的会红。
// 转场跨两个文件（首页放大退出 + 专注页缩回归位），所以本测试双文件备份 / 双文件还原。
// 结束后一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 不能用 child_process 起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"抓到了"（假绿）。
// ⚠️ 源码是 CRLF：多行锚点里必须写 \r\n，这里尽量用**单行**锚点绕开这个坑；
//    绕不开的用 \s* 兼容。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const HOME_FILE = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const FOCUS_FILE = path.join(ROOT, 'uniapp-PWstudy', 'pkgPlan', 'pages', 'focus', 'focus.vue');
const CHECK = path.join(ROOT, '_tools', 'check-home-focus.js');
const origHome = fs.readFileSync(HOME_FILE, 'utf8');
const origFocus = fs.readFileSync(FOCUS_FILE, 'utf8');

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

// 每条：[名称, 目标('home'|'focus'), 变异函数]
const cases = [
  // ---- 首页侧 ----
  ['点圆不播动画直接裸跳（launchRing 立不起）', 'home',
    s => s.replace('this.launchRing = true', 'this.launchRing = false')],
  ['launchScale 写死 1.5625（只能盖满屏宽，屏高露底色 → 两圆对不齐）', 'home',
    s => s.replace('const s = Math.max(w, h) / ringPx', 'const s = 1.5625')],
  ['放大没有 transition（硬切，没有"动画"）', 'home',
    s => s.replace('  transition: transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1);', '')],
  ['转场规则排到按压态之前（被 scale(0.965) 压住，圆停在原地跳页）', 'home',
    s => s.replace('.tp-block.focus-card:active .hc-ring { transform: scale(0.965); }', '')
          .replace('  transition: transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1);',
                   '  transition: transform 260ms cubic-bezier(0.22, 0.61, 0.36, 1);\n.tp-block.focus-card:active .hc-ring { transform: scale(0.965); }')],
  ['hero-main 不挂 ring-launch（其余内容不淡出，圆放大时字压在圆上）', 'home',
    s => s.replace(':class="{ \'ring-launch\': launchRing }"', ':class="{}"')],
  ['focusUrl 不带 zoom（专注页不知道要播缩回动画）', 'home',
    s => s.replace('if (zoom) q.push(\'zoom=1\')', 'if (false) q.push(\'zoom=1\')')],
  ['大圆不绑 ringVars（--launch-scale 缺省，放大倍数失控）', 'home',
    s => s.replace(':style="ringVars"', '')],
  // ---- 专注页侧 ----
  ['zoom 进来不置 ringIntro（没有放大态起点，圆直接出现）', 'focus',
    s => s.replace('this.ringIntro = true', 'this.ringIntro = false')],
  ['onShow 同一帧移除 intro（浏览器不跑 transition，圆闪一下归位）', 'focus',
    s => s.replace(/requestAnimationFrame\(\(\) => \{\s*requestAnimationFrame\(\(\) => \{ this\.ringIntro = false \}\)\s*\}/,
                   'this.ringIntro = false')],
  ['coverScale 不用 480rpx 算法（两边倍数不一致，收缩终点对不上）', 'focus',
    s => s.replace('const ringPx = 480 * w / 750', 'const ringPx = 480')],
  ['intro 期不换首页大圆皮肤（白玻璃圆突然出现，跳色）', 'focus',
    s => s.replace('  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);', '')],
  ['intro 态 ring 不放大（没有"从全屏缩回"的起点）', 'focus',
    s => s.replace('.fr-intro .ring { transform: scale(var(--cover-scale, 2.8)); }', '')],
  ['圆外内容不让位（收缩完成前页面文字已经糊在屏幕上）', 'focus',
    s => s.replace('.fr-intro .focus-body > *:not(.ring-wrap) { opacity: 0; }', '')],
  // ---- 圆盘即开始键（第 7 节）----
  ['圆盘不接管点击（ring-wrap 丢了 @tap，按钮删了又没替身）', 'focus',
    s => s.replace('class="ring-wrap" @tap="onRingTap"', 'class="ring-wrap"')],
  ['起表按钮又回来了（start-wrap  resurrection）', 'focus',
    s => s.replace('<view class="ring-wrap" @tap="onRingTap">',
      '<view class="ring-wrap" @tap="onRingTap">\n      <view v-if="!active" class="start-wrap"><button class="btn-primary start-btn" @tap="beginFocus">开始专注</button></view>')],
  ['点圆没有震动（hapticTick 丢了）', 'focus',
    s => s.replace('hapticTick(\'switch\')', '/* haptic gone */')],
  ['点圆不跳（ring-pulse 动画规则删了）', 'focus',
    s => s.replace(/\.ring-pulse \{ animation: ring-pulse[^}]*\}/, '')],
  ['圆盘内任务名点开会误触发起表（.stop 丢了）', 'focus',
    s => s.replace('@tap.stop="toggleTitle"', '@tap="toggleTitle"')],
  ['点圆不起表（onRingTap 没调 beginFocus）', 'focus',
    s => s.replace('this.beginFocus()', '/* no begin */')]
];

let bad = 0;
const base = runCheck();
console.log('基线：exit=' + base.code + '（应为 0）');
if (base.code !== 0) { console.log('基线就不是绿的，先修好再来 ✗ ' + base.fails.join(' | ')); process.exit(1); }

// ⚠️ 还原必须放在 finally 里：某个变异把护栏自己搞崩时，进程会带着被改坏的源码
//    一起死，源码就留在变异状态了（2026-10-23 在 neg-home-hero 上实锤过一次）。
try {
  for (const [name, target, mut] of cases) {
    const orig = target === 'home' ? origHome : origFocus;
    const next = mut(orig);
    if (next === orig) { console.log('SKIP 没匹配到改动点: ' + name); bad++; continue; }
    if (target === 'home') fs.writeFileSync(HOME_FILE, next); else fs.writeFileSync(FOCUS_FILE, next);
    const r = runCheck();
    const hit = r.code !== 0;
    console.log((hit ? 'OK   被抓到: ' : 'MISS 假绿  : ') + name + (hit ? '  → ' + r.fails[0] : ''));
    if (!hit) bad++;
    fs.writeFileSync(target === 'home' ? HOME_FILE : FOCUS_FILE, orig);
  }
} finally {
  fs.writeFileSync(HOME_FILE, origHome);
  fs.writeFileSync(FOCUS_FILE, origFocus);
}
const back = runCheck();
console.log(back.code === 0 ? '还原后仍是绿 ✓' : '还原后不绿 ✗ ' + back.fails.join(' | '));
if (back.code !== 0) bad++;
console.log(bad ? '反向测试有问题 ' + bad + ' 项 ✗' : '反向测试全部通过 ✓');
process.exitCode = bad ? 1 : 0;
