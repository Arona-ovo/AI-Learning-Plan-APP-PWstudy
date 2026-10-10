// check-refs.js - 静态检查所有页面的 import 链：目标文件是否存在
// 用法：node check-refs.js
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, 'uniapp');

const missing = [];
const movedOut = [];   // 指向已挪出编译范围（_removed_vocab/）的导入：报告但不算缺失
const seen = new Map();

function exists(f) {
  for (const cand of [f, f + '.js', f + '.ts', f + '.vue', f + '.json', path.join(f, 'index.js')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function walk(file) {
  if (seen.has(file)) return;
  seen.set(file, 1);
  let src = '';
  try { src = fs.readFileSync(file, 'utf8'); } catch (e) { return }
  const re = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    if (spec.startsWith('http') || spec.startsWith('//')) continue;
    // '@/xxx' 是 uni-app 的根别名；'@/uni_modules/<id>' 是 UTS 插件 ——
    // 入口是 utssdk/ 下的 .uts（由 HBuilderX 构建期接管，Node 侧跑不了），
    // 这里只确认插件目录真实存在，不深入
    const specPath = spec.startsWith('@/') ? spec.slice(2) : spec;
    let target;
    if (specPath.startsWith('.')) {
      target = path.resolve(path.dirname(file), specPath);
    } else if (specPath.startsWith('/')) {
      target = path.join(ROOT, specPath.replace(/^\//, ''));
    } else {
      target = path.join(ROOT, specPath);   // 裸模块按 static 处理
    }
    if (specPath.startsWith('uni_modules/') && fs.existsSync(path.join(target, 'utssdk'))) {
      continue;   // UTS 插件目录在、utssdk 在 → 可达
    }
    const hit = exists(target);
    if (!hit) {
      // 老 App（背单词）的模块挪到工作区根 _removed_vocab/ 之后，uniapp/ 里剩下的死代码
      // （utils/{dict,engine,importer,wordbook}.js）会指向一个"搬走了"的目标。
      // 那边找得到 = 有意为之，不计入缺失（与 _tools/check-graph.js 同一条口径）；
      // 死代码本身等 D1 那一轮统一清。
      const moved = exists(path.resolve(ROOT, '..', '_removed_vocab', path.relative(ROOT, target)));
      if (moved) { movedOut.push(path.relative(ROOT, file) + '  ->  ' + spec); continue; }
      missing.push(path.relative(ROOT, file) + '  ->  ' + spec);
    } else {
      if (/\.(js|ts|vue)$/.test(hit)) walk(hit);
    }
  }
}

// 入口：所有页面 + 入口文件
const entries = [];
function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.') || e.name === 'unpackage') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (/\.(vue|js|ts)$/.test(e.name)) entries.push(p);
  }
}
collect(ROOT);

// 页面作为入口逐个走一遍图，保证每条路径都被记录
entries.forEach(f => walk(f));

console.log('扫描文件数: ' + seen.size);
if (movedOut.length) {
  const u = [...new Set(movedOut)];
  console.log('注意：' + u.length + ' 条导入指向已挪到 _removed_vocab/ 的老模块（死代码遗留引用，D1 清理）:');
  u.forEach(x => console.log('      ' + x));
}
if (missing.length) {
  console.error('缺失依赖 ' + missing.length + ' 条:');
  const uniq = [...new Set(missing)];
  uniq.forEach(x => console.error('  ✗ ' + x));
  process.exit(1);
} else {
  console.log('全部 import 都能解析到本地文件 ✓');
}
