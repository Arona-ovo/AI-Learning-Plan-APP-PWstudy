// check-vue.js - 改完 .vue 的秒级预检：SFC 的 <script> ESM 语法 + <style> 括号平衡
// 用法：node check-vue.js
//
// style 块为什么要一并查：HBuilderX 编译才会报 postcss 的错，反馈慢一轮。
// 最常见的坑是 var() 兜底值里再嵌一个函数 —— 例如
//     border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));   ← 少一个 )
// 手改"多余括号"时很容易顺手把该留的那个删掉，肉眼几乎看不出来，
// 但 postcss 会报 Unclosed bracket 且行号指向症状末尾，很难定位。这里直接拦截。
// 只 spawn 一次 node（反复 spawn 会被沙箱拦成 EBUSY），由 check-parse.mjs 批量解析。
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const NODE = process.execPath;
const ROOT = path.resolve(__dirname, 'uniapp-PWstudy');
const list = [];

(function collect(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'unpackage' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) collect(p);
    else if (e.name.endsWith('.vue')) {
      const src = fs.readFileSync(p, 'utf8');
      const m = src.match(/<script[^>]*>([\s\S]*?)<\/script>/);
      if (m) list.push({ name: path.relative(ROOT, p), code: m[1] });
    }
  }
})(ROOT);

const manifest = path.join(os.tmpdir(), 'pw-vue-manifest-' + Date.now() + '.json');
fs.writeFileSync(manifest, JSON.stringify(list), 'utf8');

let out = '';
try {
  out = execFileSync(NODE, ['--experimental-vm-modules', path.resolve(__dirname, 'check-parse.mjs'), manifest], { encoding: 'utf8' });
} catch (e) {
  out = String(e.stdout || '') + String(e.stderr || '');
}

let bad = 0;
for (const line of out.split('\n')) {
  if (!line.trim()) continue;
  const [st, name, msg] = line.split('\t');
  if (st === 'OK') continue;
  bad++;
  console.error('✗ ' + name);
  console.error('  ' + String(msg || '').split('\n').slice(0, 3).join('\n  '));
}
try { fs.unlinkSync(manifest); } catch (e) {}

// ---------- style 块的括号 / 花括号平衡 ----------
const cssBad = checkStyleBlocks();
console.log(bad || cssBad
  ? ('\n' + bad + ' 个 script 语法错误 · ' + cssBad + ' 个 style 括号失衡')
  : ('\n' + list.length + ' 个页面 script 语法全部通过 · style 括号平衡'));
process.exit(bad || cssBad ? 1 : 0);

function checkStyleBlocks() {
  const files = [];
  (function collect(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'unpackage' || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) collect(p);
      else if (e.name.endsWith('.vue') || e.name.endsWith('.nvue')) files.push(p);
    }
  })(ROOT);

  let n = 0;
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /<style[^>]*>([\s\S]*?)<\/style>/g;
    let m;
    while ((m = re.exec(src))) {
      const css = m[1].replace(/\/\*[\s\S]*?\*\//g, '');   // 注释里的括号不计
      const lines = css.split('\n');
      let depth = 0;
      let first = 0;
      let base = src.slice(0, m.index).split('\n').length;
      lines.forEach((l, i) => {
        for (const ch of l) {
          if (ch === '(') depth++;
          else if (ch === ')') depth--;
        }
        // 行尾回到 0 是正常的（一条声明写在同一行）；只在整体收不住时记住首个失衡点
        if (depth !== 0 && !first) first = base + i;
      });
      let brace = 0;
      for (const ch of css) {
        if (ch === '{') brace++;
        else if (ch === '}') brace--;
      }
      if (depth !== 0 || brace !== 0) {
        n++;
        console.error('✗ ' + path.relative(ROOT, f) + ' 的 style 块');
        if (brace !== 0) console.error('  花括号不平衡：多出 ' + brace + ' 个 ' + (brace > 0 ? '{' : '}'));
        if (depth !== 0) console.error('  括号不平衡：' + (depth > 0 ? '少 ' + depth + ' 个 )' : '多 ' + (-depth) + ' 个 )') +
          '，首个失衡处在第 ' + (first || base) + ' 行');
      }
    }
  }
  return n;
}
