// _tools/check-font.js - 全站字体"单一继承链"校验（只读）
// 运行：node _tools/check-font.js
//
// 为什么要这道闸（2026-10-28）：
//   设置里能换字体（theme.font → --app-font 挂在页面根节点，见 utils/theme.js）。
//   但页面里只要有人硬写 font-family，那一块就脱链：用户换字体它不跟着变。
//   更糟的是历史上一批读数（stats 大数字、日历日、hex 色值…）写的是
//      font-family: Georgia, "Times New Roman", serif
//   —— **安卓一个都没有**，实际全部退到 Noto Serif，跟旁边无衬线的正文
//   同一张卡里两种字体，看着像"系统默认混进来了"。用户明确要求整体统一。
//
//   focus.vue 的计时圆早就踩过并立了规矩（check-home-focus.js：两个圆不许出现
//   font-family / Georgia），这里把同一条规矩扩到全站。
//
// 校验项：
//   1) App.vue 里仍有 .app-root/.container/.cover 吃 var(--app-font) —— 继承链的源头
//   2) theme.js 仍下发 '--app-font'（否则用户换字体写了但不生效）
//   3) 除 App.vue 的全局那两条，任何 .vue/.css/.scss 都不许写 font-family
//      （inherit 与 var(--app-font…) 放行）
//   4) 全站（剥掉注释后）不许出现具体衬线族名：Georgia / Times New Roman /
//      Songti SC / SimSun —— 安卓没有，写了必退字体
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'uniapp-PWstudy');
const THEME = path.join(APP, 'utils', 'theme.js');
const APP_VUE = path.join(APP, 'App.vue');

let pass = 0;
let fail = 0;
function assert(cond, label, extra) {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '\n      → ' + extra : '')); }
}

// 注释要剥掉：本文件/源码里到处是"不写 font-family"这种说明文字，
// 不剥就永远假红（check-home-focus.js 踩过同一个坑）。
function stripComments(s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

const SKIP_DIR = new Set(['unpackage', 'node_modules', 'static', '.git', 'uni_modules']);

function walk(dir, out) {
  let list = [];
  try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return out; }
  for (const d of list) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) {
      if (SKIP_DIR.has(d.name)) continue;
      walk(p, out);
    } else if (/\.(vue|css|scss)$/i.test(d.name)) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(APP, []);

// ---- 1) 继承链源头 ----
let appTxt = '';
try { appTxt = fs.readFileSync(APP_VUE, 'utf8'); } catch (e) {}
const appCss = stripComments(appTxt);
assert(/\.app-root\s*,\s*[\s\S]{0,120}?\.container\s*,\s*[\s\S]{0,80}?\.cover\s*\{[^}]*font-family:\s*var\(--app-font/.test(appCss),
  'App.vue 的 .app-root/.container/.cover 仍吃 var(--app-font)（继承链源头）',
  '这条没了 → 全站都拿不到用户选的字体');

// ---- 2) theme.js 下发变量 ----
let themeTxt = '';
try { themeTxt = fs.readFileSync(THEME, 'utf8'); } catch (e) {}
assert(/['"]--app-font['"]\s*:/.test(stripComments(themeTxt)),
  'theme.js 仍下发 --app-font（换字体才真生效）');

// ---- 3) / 4) 逐文件扫 ----
const FONT_DECL = /font-family\s*:\s*([^;}\n]+)/g;
const SERIF_NAMES = /(Georgia|Times New Roman|Songti SC|SimSun)/g;

const badDecl = [];
const badSerif = [];
let allowedGlobal = 0;

for (const f of files) {
  const rel = path.relative(ROOT, f).replace(/\\/g, '/');
  const raw = fs.readFileSync(f, 'utf8');
  const css = stripComments(raw);

  let m;
  FONT_DECL.lastIndex = 0;
  while ((m = FONT_DECL.exec(css))) {
    const val = m[1].trim();
    const ok = /^(inherit|unset|initial)$/i.test(val) || /^var\(--app-font/.test(val);
    if (ok) continue;
    // App.vue 的 page 兜底栈（绝对族名）是唯一允许的
    // —— 根节点那条是 var(--app-font)，已被上面的放行分支吃掉
    if (rel === 'uniapp-PWstudy/App.vue') { allowedGlobal++; continue; }
    badDecl.push(rel + '  →  font-family: ' + val);
  }

  SERIF_NAMES.lastIndex = 0;
  while ((m = SERIF_NAMES.exec(css))) {
    badSerif.push(rel + '  →  ' + m[1]);
  }
}

assert(badDecl.length === 0,
  '页面/组件里没有硬写 font-family（只许 App.vue 的全局两条）',
  badDecl.slice(0, 8).join('\n      → '));

assert(badSerif.length === 0,
  '全站不出现安卓没有的衬线族名（Georgia / Times New Roman / Songti SC / SimSun）',
  badSerif.slice(0, 8).join('\n      → '));

assert(allowedGlobal === 1,
  'App.vue 里写死族名的全局声明恰好 1 条（page 兜底栈）',
  '实际 ' + allowedGlobal + ' 条：多了说明有人在别处加了绝对族名，少了说明 page 兜底也没了');

// ---- 5) 设置页有字体选择器，且真的接到 theme.setFont ----
let setTxt = '';
try { setTxt = fs.readFileSync(path.join(APP, 'pkgManage', 'pages', 'settings', 'settings.vue'), 'utf8'); } catch (e) {}
const setSrc = stripComments(setTxt);
assert(/fonts:\s*FONT_OPTIONS/.test(setSrc) && /@tap="pickFont"/.test(setSrc) && /setFont\(/.test(setSrc),
  '外观里挂了字体选择器（fonts: FONT_OPTIONS + pickFont → setFont）',
  '只加 FONT_STACKS 不给入口 = 用户选不到；入口不接 setFont = 点了没反应');

// ---- 6) 每一档字族都有入口，入口也不许指向不存在的档 ----
const stacksBlock = (themeTxt.match(/export const FONT_STACKS\s*=\s*\{([\s\S]*?)\n\};/) || [])[1] || '';
const optsBlock = (themeTxt.match(/export const FONT_OPTIONS\s*=\s*\[([\s\S]*?)\n\]/) || [])[1] || '';
const stackKeys = [];
stacksBlock.replace(/^\s*([A-Za-z_]\w*)\s*:/gm, function (_m, k) { stackKeys.push(k); return _m; });
const optKeys = [];
optsBlock.replace(/key:\s*'([^']+)'/g, function (_m, k) { optKeys.push(k); return _m; });
const missing = stackKeys.filter(function (k) { return optKeys.indexOf(k) < 0; });
const extra = optKeys.filter(function (k) { return stackKeys.indexOf(k) < 0; });
assert(stackKeys.length > 0 && missing.length === 0 && extra.length === 0,
  'FONT_OPTIONS 与 FONT_STACKS 一一对应（' + stackKeys.join(' / ') + '）',
  (missing.length ? '有字族但没入口：' + missing.join(', ') + '；' : '') +
  (extra.length ? '入口指向不存在的档：' + extra.join(', ') : ''));

console.log('\n' + (fail ? '✗ FAIL ' + fail : '✓ ALL PASS ' + pass + ' 项'));
process.exitCode = fail ? 1 : 0;
