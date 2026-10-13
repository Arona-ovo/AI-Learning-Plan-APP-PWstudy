// _tools/check-aigate.js - AI 分项开关的登记与接线校验
// 运行：node _tools/check-aigate.js
//
// 守三件事（全是"错了也没人报警"的那类）：
//  1) 表里不许再混进背单词 App 的功能（查词 / 例句 / 点评 / 专练 / 词书 / 对话陪练 /
//     首页 AI 指令 / 生成配图）。它们要么随背单词整簇挪走了，要么 PWstudy 压根没做过 ——
//     留在列表里，用户关了一个永远不会被调用的开关，还以为自己在省钱。
//  2) 每一项都必须**真的接在花钱的出口上**。登记了却没人守卫 = 假开关：
//     用户关了它，模型照调、钱照花。
//  3) 顺序按花钱从多到少：想省钱的人从上往下关就行。
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const GATE = path.join(ROOT, 'services', 'ai-gate.js');
const SERVICES = path.join(ROOT, 'services');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const gate = fs.readFileSync(GATE, 'utf8');

/* ---------- 1. 不许有背单词遗留项 ---------- */
// ⚠️ 先剥注释再扫：这次的改动说明里就写满了这些词，不剥会把自己命中（已踩过多次）
const code = gate.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const DEAD = {
  lookup: '查词（背单词）',
  sentence: 'AI 例句（背单词）',
  critique: '翻译点评（背单词）',
  drill: '薄弱点专练（背单词）',
  wordbook: 'AI 生成词书（背单词）',
  chat: '对话陪练（背单词）',
  command: '首页 AI 指令（PWstudy 没做这套）',
  image: 'AI 生成配图（PWstudy 不出图）'
};
console.log('== 1. 表里没有背单词遗留 / 不存在的功能 ==');
Object.keys(DEAD).forEach(k => {
  assert(!new RegExp("key:\\s*'" + k + "'").test(code), '没有登记 ' + DEAD[k]);
});

/* ---------- 2. 每一项都要接在花钱的出口上 ---------- */
console.log('');
console.log('== 2. 登记的每一项都真的有守卫（不是假开关）==');
const keys = [];
const re = /key:\s*'([a-zA-Z0-9_]+)'/g;
let m;
while ((m = re.exec(code))) keys.push(m[1]);
assert(keys.length > 0, '表里有 ' + keys.length + ' 项');
assert(new Set(keys).size === keys.length, 'key 没有重复');

// 别名 import（ensureFeature as aiFeature）也要认，所以匹配"任意标识符( 'key' )"
const svcFiles = fs.readdirSync(SERVICES).filter(f => f.endsWith('.js'));
const svcSrc = svcFiles.map(f => fs.readFileSync(path.join(SERVICES, f), 'utf8')).join('\n');
keys.forEach(k => {
  const guarded = new RegExp("[A-Za-z_$][\\w$]*\\(\\s*'" + k + "'").test(svcSrc);
  assert(guarded, '「' + k + '」在 services 下有守卫调用');
});

/* ---------- 3. 顺序：花钱从多到少 ---------- */
console.log('');
console.log('== 3. 顺序按开销从大到小（想省钱从上往下关）==');
const ORDER = { max: 4, high: 3, mid: 2, low: 1 };
const levels = [];
const reLv = /level:\s*'([a-z]+)'/g;
while ((m = reLv.exec(code))) levels.push(m[1]);
assert(levels.length === keys.length, '每项都有 level（' + levels.length + '/' + keys.length + '）');
assert(levels.every(l => ORDER[l] !== undefined), 'level 只用了 low / mid / high / max');
let sorted = true;
for (let i = 1; i < levels.length; i++) {
  if ((ORDER[levels[i]] || 0) > (ORDER[levels[i - 1]] || 0)) sorted = false;
}
assert(sorted, '开销从大到小排列（当前：' + levels.join(' → ') + '）');

console.log('');
console.log(fail === 0 ? 'AI 分项开关校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
