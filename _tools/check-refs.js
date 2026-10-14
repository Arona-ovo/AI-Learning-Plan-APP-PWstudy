// check-refs.js - 静态检查所有页面的 import 链：目标文件是否存在
// 用法：node _tools/check-refs.js（从仓库根目录跑）
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', 'uniapp-PWstudy');

const missing = [];
const movedOut = [];   // 指向已挪出编译范围（_removed_vocab/）的导入：报告但不算缺失
const external = [];   // 裸包名（外部依赖）：本机零 npm 依赖、没 node_modules，判定不了
const seen = new Map();

// ⚠️ 扫之前必须先剥注释。utils/tab-slide-mixin.js 的用法示例就写在注释里
//（"import tabSlideMixin from '../../utils/tab-slide-mixin.js'"），
// 不剥会被当成真导入报"缺失"，而那条路径相对 utils/ 根本不存在。
const stripComments = (t) =>
  t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');

function exists(f) {
  // 候选要覆盖 index.ts：repositories/ 只有 index.ts 没有 index.js，
  // 漏了这一项会让 '@/repositories' 这条自引用被误判成缺失。
  for (const cand of [f, f + '.js', f + '.ts', f + '.vue', f + '.json',
                      path.join(f, 'index.js'), path.join(f, 'index.ts')]) {
    if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return cand;
  }
  return null;
}

function walk(file) {
  if (seen.has(file)) return;
  seen.set(file, 1);
  let src = '';
  try { src = stripComments(fs.readFileSync(file, 'utf8')); } catch (e) { return }
  const re = /from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[1] || m[2] || m[3];
    if (!spec) continue;
    if (spec.startsWith('http') || spec.startsWith('//')) continue;
    // 模块路径不可能含空格 —— 命中说明是英文文案里的 "… from "xxx""，不是 import
    if (/\s/.test(spec)) continue;
    // '@/xxx' 是 uni-app 的根别名，剥掉前缀后按仓库根找下同名的东西。
    const specPath = spec.startsWith('@/') ? spec.slice(2) : spec;
    // UTS 插件：入口是 utssdk/ 下的 .uts（HBuilderX 构建期接管，Node 侧跑不了）——
    // 目录在 + utssdk 在就算可达。必须先判，否则会被下面的"裸包名"分支抢先吃掉。
    if (specPath.startsWith('uni_modules/') && fs.existsSync(path.join(ROOT, specPath, 'utssdk'))) {
      continue;
    }
    let target;
    if (specPath.startsWith('.')) {
      target = path.resolve(path.dirname(file), specPath);
    } else if (specPath.startsWith('/')) {
      target = path.join(ROOT, specPath.replace(/^\//, ''));
    } else {
      // 裸包名 = 外部依赖（vue / hash-wasm / argon2-wasm …）。本工程确定零 npm 依赖、
      // 没有 node_modules，这里没法判定装没装 —— 单列出来提示，不算缺失。
      external.push(path.relative(ROOT, file) + '  ->  ' + spec);
      continue;
    }
    const hit = exists(target);
    if (!hit) {
      // 老 App（背单词）的模块挪到工作区根 _removed_vocab/ 之后，uniapp-PWstudy/ 里剩下的死代码
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
if (external.length) {
  const u = [...new Set(external)];
  console.log('外部依赖 ' + u.length + ' 条（本机无 node_modules，不判定是否装了）:');
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
