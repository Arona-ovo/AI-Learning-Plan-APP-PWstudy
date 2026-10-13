// _tools/check-deadcode.js - 死代码体检（只读，不改源码）
//
// 背景：PWstudy 是从背单词 App 原地转过来的，uniapp-PWstudy/ 里还堆着一大批
// 「没有被任何页面引用」的老模块（辞典 / 出题 / 判题 / 词书 / 卡片规范…）。
// 它们不会被打进包（uni-app 只打包可达模块），但会一直干扰判断：
// 改一个文件前总要先猜"这个还有人用吗"。
//
// 做法：从真正的编译入口（pages.json 里的所有页面 + App.vue + main.js）
// 出发做闭包，闭包外的就是死代码。
//   · components/ 单独列：uni-app 的 easycom 可以不写 import 就按目录名自动引用，
//     静态扫描看不见这种引用，所以只提示、不判死。
//   · uni_modules/ 是插件，static/ 是静态资源，都不参与。
//
// 用法：node _tools/check-deadcode.js
// 出口：有死代码就非 0（和 check-isolation 一样是"待办清单"，清理到 0 之前一直红）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'uniapp-PWstudy');
const P = (...a) => path.join(ROOT, ...a);
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, '/');

const IMPORT_RE = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)['"]([^'"]+)['"]/g;

function resolve(from, spec) {
  if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('/')) return null;
  let base;
  if (spec.startsWith('@/')) base = P(spec.slice(2));
  else if (spec.startsWith('/')) base = P(spec.slice(1));
  else base = path.resolve(path.dirname(from), spec);
  for (const c of [base, base + '.js', base + '.ts', base + '.vue', base + '.json',
    path.join(base, 'index.js'), path.join(base, 'index.ts')]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

// 源码里可能有条件编译注释（// #ifdef ... ）包裹的 import —— 照扫，
// 反正 conditional 分支里引用的模块也算"有人用"
function importsOf(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) {
    const r = resolve(file, m[1]);
    if (r) out.push(r);
  }
  return out;
}

/* ---------------- 入口 ---------------- */
const rawPj = fs.readFileSync(P('pages.json'), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
const pj = JSON.parse(rawPj);
const entries = [];
pj.pages.forEach(p => entries.push(P(p.path + '.vue')));
(pj.subPackages || []).forEach(sp => sp.pages.forEach(p => entries.push(P(sp.root, p.path + '.vue'))));
['App.vue', 'main.js'].forEach(f => { if (fs.existsSync(P(f))) entries.push(P(f)); });

/* ---------------- 闭包 ---------------- */
const alive = new Set();
const stack = entries.filter(f => fs.existsSync(f));
while (stack.length) {
  const f = stack.pop();
  if (!f || alive.has(f)) continue;
  alive.add(f);
  importsOf(f).forEach(d => { if (!alive.has(d)) stack.push(d); });
}

/* ---------------- 全量文件 ---------------- */
const SKIP_DIR = new Set(['unpackage', 'node_modules', 'uni_modules', 'static', '.hbuilderx']);
const all = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIR.has(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(vue|js|ts)$/.test(e.name)) all.push(p);
  }
})(ROOT);

// 预留未接线：**在线模式**的基础（服务器通道 + 云同步骨架）。服务器还没接，
// 现在没有任何页面调用它们 —— 等服务端就绪后接线，**接线后请把这里删掉**。
// 它们不会腐烂：_tools/check-online.js 守着（默认关闭 / 凭证 / 同步红线），
// _tools/_scratch/neg-online.js 反向测试 11 条。
const RESERVED = ['services/backend.ts', 'services/cloud-sync.ts'];

const dead = all.filter(f => !alive.has(f)
  && rel(f).indexOf('components/') !== 0
  && RESERVED.indexOf(rel(f)) < 0);
const comps = all.filter(f => !alive.has(f) && rel(f).indexOf('components/') === 0);
const kb = (arr) => arr.reduce((s, f) => s + fs.statSync(f).size, 0) / 1024;

console.log('入口: ' + entries.length + ' 个页面/入口文件 → 闭包 ' + alive.size + ' 个文件');
console.log('扫描: ' + all.length + ' 个源文件（不含 unpackage / uni_modules / static）\n');

console.log('== 1. 死代码（编译入口闭包之外）==');
if (!dead.length) console.log('  ✓ 没有死代码');
else {
  dead.sort((a, b) => fs.statSync(b).size - fs.statSync(a).size)
    .forEach(f => console.log('  ✗ ' + rel(f) + '  (' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB)'));
  console.log('     合计 ' + dead.length + ' 个文件 / ' + kb(dead).toFixed(0) + ' KB');
}

console.log('\n== 2. components/ 下没被显式 import 的（easycom 可能自动引用，需人工确认）==');
if (!comps.length) console.log('  ✓ 没有');
else comps.sort().forEach(f => console.log('      ' + rel(f) + '  (' + (fs.statSync(f).size / 1024).toFixed(0) + ' KB)'));

// 白名单自己也要体检：文件改名了 / 已经接线了，都得提醒清理 ——
// 否则白名单会变成一个"永远放过"的洞
console.log('\n== 3. 预留白名单（接线后要删）==');
const gone = RESERVED.filter(r => !all.some(f => rel(f) === r));
const wired = RESERVED.filter(r => all.some(f => rel(f) === r && alive.has(f)));
gone.forEach(r => console.log('  ✗ 白名单里的 ' + r + ' 已不存在（改名了？请清理 RESERVED）'));
wired.forEach(r => console.log('  ✗ ' + r + ' 已经接线了 —— 把 check-deadcode.js 的 RESERVED 删掉'));
if (!gone.length && !wired.length) {
  console.log('  ✓ ' + RESERVED.length + ' 个预留文件都还在、也都还没接线');
}

const bad = dead.length + gone.length + wired.length;
console.log(bad ? '\n死代码体检：' + bad + ' 项待处理' : '\n死代码体检：干净');
process.exit(bad ? 1 : 0);
