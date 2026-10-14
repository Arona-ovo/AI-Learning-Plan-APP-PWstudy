// 临时小工具：对比两份 .vue 里"漏网的静态中文"字面量（check-i18n 第 3 节的口径），
// 用来定位某次改动到底新增了哪几条。用完即弃，不进 run-all。
const fs = require('fs');
const HAN = /[\u4e00-\u9fa5]/;

function pick(p) {
  const raw = fs.readFileSync(p, 'utf8');
  const sc = (/<script[^>]*>([\s\S]*?)<\/script>/.exec(raw) || [])[1] || '';
  const out = [];
  sc.split(/\r?\n/).forEach((line0) => {
    const t = line0.trim();
    if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
    if (/^\s*import /.test(line0)) return;
    const line = line0.replace(/\s+\/\/.*$/, '');
    (line.match(/'[^'\n]*'/g) || []).forEach((m) => {
      const v = m.slice(1, -1);
      const i = line.indexOf(m);
      const pre = line.slice(Math.max(0, i - 3), i + 1);
      if (HAN.test(v) && !pre.includes('t(')) out.push(v);
    });
  });
  return out;
}

const [a, b] = process.argv.slice(2);
const A = pick(a), B = pick(b);
const cnt = (arr) => arr.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {});
const ca = cnt(A), cb = cnt(B);
const keys = Array.from(new Set(Object.keys(ca).concat(Object.keys(cb))));
keys.forEach((k) => {
  const d = (cb[k] || 0) - (ca[k] || 0);
  if (d !== 0) console.log((d > 0 ? '+' : '') + d + '  ' + JSON.stringify(k));
});
console.log('旧 ' + A.length + ' 条 → 新 ' + B.length + ' 条');
