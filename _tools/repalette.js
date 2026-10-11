// 一次性：把出厂主色从绯红/蓝换成青绿后，同步样式里所有写死的旧值。
// 只改 <style> 区块内的颜色字面量；var(--brand, 旧值) 的兜底值一起换。
// 连着两行一样的（老 webview 兜底行 + var 行）合并成一行。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp');
const TARGETS = ['App.vue', 'pages', 'pkgPlan/pages', 'pkgManage/pages', 'pkgStudy/pages', 'components'];
const SKIP = /(node_modules|unpackage)/;

// 历代出厂主色（玫红 #e11d48 / 蓝 #2e6bff / 青 #0d9488 / 番茄红 #e54d2e）→ 当前出厂主色。
// 2026-10-12 玫红 → 绯红（对齐图标/启动页光环实测 #e0183c）：main #e4173d / strong #bb1332 / rgb 228,23,61
// 绯红 rose：main #e4173d / strong #bb1332 / rgb 228,23,61
const RULES = [
  [/#2e6bff/gi, '#e4173d'],
  [/#1d4fd8/gi, '#bb1332'],
  [/46\s*,\s*107\s*,\s*255/g, '228, 23, 61'],
  [/#0d9488/gi, '#e4173d'],
  [/#0f766e/gi, '#bb1332'],
  [/13\s*,\s*148\s*,\s*136/g, '228, 23, 61'],
  [/#e54d2e/gi, '#e4173d'],
  [/#c43f22/gi, '#bb1332'],
  [/229\s*,\s*77\s*,\s*46/g, '228, 23, 61']
];

function walk(dir, out) {
  if (!fs.existsSync(dir)) return out;
  fs.readdirSync(dir).forEach((name) => {
    const p = path.join(dir, name);
    if (SKIP.test(p)) return;
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.vue$/.test(name)) out.push(p);
  });
  return out;
}

let files = [];
TARGETS.forEach((t) => {
  const p = path.join(ROOT, t);
  if (!fs.existsSync(p) || SKIP.test(p)) return;
  if (fs.statSync(p).isDirectory()) walk(p, files);
  else files.push(p);
});

let changed = 0;
let hits = 0;

files.forEach((file) => {
  const src = fs.readFileSync(file, 'utf8');
  // 逐段处理所有 <style ...> ... </style>
  const re = /<style[\s\S]*?<\/style>/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(src))) {
    const body = m[0].split('\n').map((line) => {
      let s = line;
      RULES.forEach((r) => { s = s.replace(r[0], r[1]); });
      if (s !== line) hits++;
      return s;
    });
    // 合并连着两行完全相同的（旧值兜底行 + var 行）
    const merged = body.filter((line, i) => !(i > 0 && line === body[i - 1]));
    out += src.slice(last, m.index) + merged.join('\n');
    last = m.index + m[0].length;
  }
  out += src.slice(last);
  if (out !== src) {
    fs.writeFileSync(file, out);
    changed++;
  }
});

console.log('扫描 ' + files.length + ' 个 .vue，改写 ' + changed + ' 个，替换 ' + hits + ' 行');
