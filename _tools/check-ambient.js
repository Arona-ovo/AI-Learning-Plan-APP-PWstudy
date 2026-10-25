// _tools/check-ambient.js - 白噪音（专注环境音）与出声链路的校验
// 运行：node _tools/check-ambient.js
//
// 真机反馈（2026-10-14）：「开始专注的时候，白噪音等那几个声音都没有任何声音」。
// 这类问题静态很难发现 —— 播不出来时不一定吐 onError，界面也完全静默。守四件事：
//   1) 素材真的在包里、格式是安卓认的 PCM（换素材忘了同步这里就会静音）
//   2) 路径不能只有一条候选（convertLocalFileSystemURL 在部分机型给出的绝对路径
//      播放器认不了，是"白噪音 + 响铃一起没声"的共同根因）→ 播不出来必须换下一条再试
//   3) 开关 / 切音色必须**当场生效**（以前只有"开始专注"会起声，专注跑到一半开开关
//      要等下一轮才响 —— 用户只会以为功能坏了）
//   4) 白噪音只陪专注（进休息要停），别在休息时也响
//
// 只读，不改源码。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', 'uniapp-PWstudy');
const AMB = path.join(ROOT, 'utils', 'ambient.js');
const AUDIO = path.join(ROOT, 'utils', 'audio.js');
const FOCUS_VUE = path.join(ROOT, 'pkgPlan', 'pages', 'focus', 'focus.vue');
const FOCUS_JS = path.join(ROOT, 'utils', 'focus.js');
const NOISE_DIR = path.join(ROOT, 'static', 'noise');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

const amb = fs.readFileSync(AMB, 'utf8');
const audio = fs.readFileSync(AUDIO, 'utf8');
const fv = fs.readFileSync(FOCUS_VUE, 'utf8');
const fj = fs.readFileSync(FOCUS_JS, 'utf8');

/**
 * 切出某个方法的函数体（配大括号）。
 * ⚠️ 别写 `fn\(\)[\s\S]{0,240}x` 这种有界窗口 —— 多插两行就假红（第 22 条硬约束）。
 */
function fnBody(src, name) {
  // 两种形态都要认，而且**顺序不能反**：
  //   ① `export function name(...)` —— 模块顶层函数（三个 utils 都是这种）
  //   ② `    name() {`             —— vue 里的缩进方法
  // ⚠️ 先试 ② 会先命中"缩进的调用处"（比如 selfTest 里那行 `  playOnce(...)`），
  //    切出来的"函数体"只有二十几个字符，后面所有断言都静默落空（已踩）
  let m = new RegExp('^[ \\t]*(?:export\\s+)?(?:async\\s+)?function\\s*\\*?\\s*' + name + '\\s*\\(', 'm').exec(src);
  if (!m) m = new RegExp('^[ \\t]{2,6}' + name + '\\s*\\(', 'm').exec(src);
  if (!m) return '';
  const j = src.indexOf('{', m.index + m[0].length);
  if (j < 0) return '';
  let d = 0;
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (d === 0) return src.slice(j, k + 1); }
  }
  return src.slice(j);
}

/* ---------- 1. 素材：真的在包里、是安卓认的 PCM ---------- */
console.log('== 1. 白噪音素材（static/noise）==');
const kinds = [];
const reK = /\{\s*k:\s*'([a-z]+)',\s*t:\s*'[^']*'\s*\}/g;
let m;
while ((m = reK.exec(amb))) kinds.push(m[1]);
assert(kinds.length > 0, 'KINDS 里登记了 ' + kinds.length + ' 种音色（' + kinds.join('/') + '）');

function wavInfo(p) {
  const b = fs.readFileSync(p);
  if (b.slice(0, 4).toString('ascii') !== 'RIFF' || b.slice(8, 12).toString('ascii') !== 'WAVE') return null;
  let i = 12, fmt = null;
  while (i + 8 <= b.length) {
    const id = b.slice(i, i + 4).toString('ascii');
    const sz = b.readUInt32LE(i + 4);
    if (id === 'fmt ' && sz >= 16) {
      // fmt 体：i+8 编码 / i+10 声道 / i+12 采样率 / i+22 位深
      // （i+14 开始是 byteRate 与 blockAlign，位深在它们后面 —— 读成 i+14 全是错的）
      fmt = { format: b.readUInt16LE(i + 8), ch: b.readUInt16LE(i + 10), rate: b.readUInt32LE(i + 12), bits: b.readUInt16LE(i + 22) };
    }
    i += 8 + sz + (sz % 2);
  }
  return fmt;
}

kinds.forEach(k => {
  const p = path.join(NOISE_DIR, k + '.wav');
  if (!fs.existsSync(p)) { bad('缺素材 static/noise/' + k + '.wav'); return; }
  const f = wavInfo(p);
  if (!f) { bad('static/noise/' + k + '.wav 不是合法 wav'); return; }
  // 安卓 MediaPlayer 对 PCM 之外的 wav 编码（以及高采样率）支持不稳 → 一律要求 PCM
  const good = f.format === 1 && f.ch === 1 && f.bits === 16;
  assert(good, 'static/noise/' + k + '.wav = PCM 单声道 16bit（' + f.rate + 'Hz）');
});
// 目录里不许多余文件（KINDS 改了却忘了删素材，或者反过来）
const files = fs.readdirSync(NOISE_DIR).filter(f => f.endsWith('.wav')).map(f => f.replace(/\.wav$/, ''));
const orphan = files.filter(f => kinds.indexOf(f) < 0);
assert(orphan.length === 0, orphan.length === 0
  ? '目录里没有 KINDS 之外的多余素材'
  : '多余素材（KINDS 里没有）：' + orphan.join('/'));

/* ---------- 2. 路径：不能只有一条候选，播不出来必须换下一条 ---------- */
console.log('');
console.log('== 2. 播不出来要换路径重试（白噪音 + 响铃共用这一层）==');
assert(/export function srcCandidates/.test(audio), 'audio.js 导出 srcCandidates（响铃 / 音效 / 白噪音同一层）');
const cand = fnBody(audio, 'srcCandidates');
assert(cand.length > 0, '能切到 srcCandidates() 的函数体');
assert(/localUrl\(/.test(cand) && /indexOf\(rel\)/.test(cand),
  '候选里既有转出来的绝对路径、也有包内相对路径');

// playOnce（响铃 / 音效走它）的 onError 里要换 src
const playOnce = fnBody(audio, 'playOnce');
assert(playOnce.length > 0, '能切到 playOnce() 的函数体');
const poErr = /onError\(\(e\) => \{([\s\S]*?)\n {4}\}\);/.exec(playOnce);
assert(!!poErr, '能切到 playOnce 的 onError 回调');
assert(poErr && /paths\[\s*pi/.test(poErr[1]) && /pi\+\+/.test(poErr[1]),
  'playOnce 播失败会换下一条候选再试（否则响铃也一起哑）');

// ambient 自己的 onError 同理
const startBody = fnBody(amb, 'start');
assert(startBody.length > 0, '能切到 ambient.start() 的函数体');
assert(/audio\.srcCandidates\(/.test(startBody), 'ambient 复用 audio.srcCandidates（不另写一份）');
const amErr = /c\.onError\(\(e\) => \{([\s\S]*?)\n {4}\}\);/.exec(startBody);
assert(!!amErr, '能切到 ambient 的 onError 回调');
assert(amErr && /pi\+\+/.test(amErr[1]), 'ambient 播失败会换下一条候选再试');
assert(/onPlay\(/.test(startBody), 'ambient 记了"真的响了"（onPlay）—— 没响时能给用户提示');

/* ---------- 3. 开关 / 切音色必须当场生效 ---------- */
console.log('');
console.log('== 3. 开关与切音色当场起声（不用等下一轮）==');
['toggleNoise', 'pickNoise'].forEach(name => {
  const b = fnBody(fv, name);
  assert(b.length > 0, '能切到 focus.vue 的 ' + name + '()');
  assert(/syncAmbient\(\)/.test(b), name + '() 当场同步播放（不是只存设置）');
});
const sync = fnBody(fv, 'syncAmbient');
assert(sync.length > 0, '能切到 focus.vue 的 syncAmbient()');
assert(/ambient\.start\(/.test(sync), 'syncAmbient 会起声');
assert(/!this\.isRest/.test(sync), '休息中不陪（白噪音只陪专注）');
assert(/ambient\.stop\(\)/.test(sync), '不该响的时候立刻停');
assert(/lastError\(\)/.test(sync), '播不出来会把原因告诉用户（不静默）');

/* ---------- 4. 生命周期：只陪专注 ---------- */
console.log('');
console.log('== 4. 生命周期（开始 / 结束 / 休息 / 暂停）==');
assert(/ambient\.start\(/.test(fj) && /ambient\.stop\(/.test(fj) &&
       /ambient\.pause\(/.test(fj) && /ambient\.resume\(/.test(fj),
  'focus.js 状态机四种动作都接了（start / stop / pause / resume）');
// ⚠️ 状态机里叫 startFocus（不是 start）—— 名字对不上会切出空串，断言全落空
const startFn = fnBody(fj, 'startFocus');
assert(startFn.length > 0, '能切到 focus.js 的 startFocus()');
assert(/ambient\.start\(/.test(startFn), '开始专注 → 起声');
// ⚠️ 停白噪音在 startBreak 里（startRest 只是算出时长后委托给它）
const restFn = fnBody(fj, 'startBreak');
assert(restFn.length > 0, '能切到 focus.js 的 startBreak()');
assert(/ambient\.stop\(/.test(restFn), '进休息 → 停（白噪音只陪专注）');

/* ---------- 5. 素材质量（接缝 / 响度一致 / 不削波）与来源记录 ---------- */
// 这一组是 2026-10-24 换真实录音时踩出来的，三个坑**在界面上全都看不出来**：
//   ① crest 高的素材，归一后会被夹峰值压下去十几 dB —— 音量条是满的，就是没声
//   ② 交叉淡化方向反了，循环点有样本级跳变 —— 只在有明显波形的真实录音上"啪"一下
//   ③ 三种音色的名单写在三个文件里 —— 分叉了就是某个页面点了没反应
console.log('');
console.log('== 5. 素材质量（接缝 / 响度一致 / 不削波）与来源记录 ==');

/** 读 PCM wav 的样本（-1..1），顺带给出格式信息 */
function readWav(p) {
  const b = fs.readFileSync(p);
  let i = 12, fmt = null, data = null;
  while (i + 8 <= b.length) {
    const id = b.slice(i, i + 4).toString('ascii');
    const sz = b.readUInt32LE(i + 4);
    if (id === 'fmt ' && sz >= 16) {
      fmt = { ch: b.readUInt16LE(i + 10), rate: b.readUInt32LE(i + 12), bits: b.readUInt16LE(i + 22) };
    } else if (id === 'data') {
      data = b.slice(i + 8, i + 8 + sz);
    }
    i += 8 + sz + (sz % 2);
  }
  if (!fmt || !data) return null;
  const n = data.length >> 1;
  const s = new Float64Array(n);
  for (let k = 0; k < n; k++) s[k] = data.readInt16LE(k * 2) / 32768;
  return { fmt: fmt, s: s };
}

const stats = {};
kinds.forEach(k => {
  const w = readWav(path.join(NOISE_DIR, k + '.wav'));
  if (!w) { bad('读不出 ' + k + '.wav 的样本'); return; }
  let sum = 0, peak = 0;
  for (let i = 0; i < w.s.length; i++) {
    sum += w.s[i] * w.s[i];
    const a = Math.abs(w.s[i]);
    if (a > peak) peak = a;
  }
  const rmsv = Math.sqrt(sum / w.s.length);
  // 循环播放时 s[n-1] 后面紧跟 s[0]，差值越大越像爆音。
  // 随机噪声相邻样本差约 1.4×RMS；真实录音忘了交叉淡化能到十几倍。
  const seam = Math.abs(w.s[0] - w.s[w.s.length - 1]) / Math.max(1e-9, rmsv);
  stats[k] = { rms: rmsv, peak: peak, seam: seam };
});

// 5.1 接缝：忘了做交叉淡化（或方向做反了）就会"啪"一下
Object.keys(stats).forEach(k => {
  assert(stats[k].seam <= 4.0,
    k + ' 循环接缝连续（跳变 ' + stats[k].seam.toFixed(2) + '×RMS，阈值 4）');
});

// 5.2 响度一致：某个音色比别的轻一大截，界面上完全看不出来（音量条照常是满的）
//     ⚠️ 这条防的就是 crest 高的素材被夹峰值压下去 —— 第一版真实雨声 RMS 只有 0.019
{
  const arr = Object.keys(stats).map(k => ({ k: k, db: 20 * Math.log10(stats[k].rms) }));
  const lo = Math.min.apply(null, arr.map(x => x.db));
  const hi = Math.max.apply(null, arr.map(x => x.db));
  const worst = arr.filter(x => x.db === lo)[0];
  assert(hi - lo <= 2.0,
    '各音色响度一致（极差 ' + (hi - lo).toFixed(1) + ' dB：' +
    arr.map(x => x.k + ' ' + x.db.toFixed(1)).join(' / ') + '）');
  // 单独点名最轻的那个，出问题时一眼看得出是谁
  assert(lo >= -21.0,
    '最轻的音色（' + worst.k + ' ' + lo.toFixed(1) + ' dB）也没被峰值夹下去（阈值 -21 dB）');
}

// 5.3 不削波
Object.keys(stats).forEach(k => {
  assert(stats[k].peak <= 0.95, k + ' 峰值 ' + stats[k].peak.toFixed(2) + ' 没削波（≤0.95）');
});

// 5.4 三处名单必须一致：ambient.js（播放前校验 kind）+ 两个页面的音色选择器
{
  const listOf = (src) => {
    const out = [];
    const re = /\{\s*k:\s*'([a-z]+)',\s*t:\s*(?:this\.\$t\()?'[^']*'\)?\s*\}/g;
    let m2;
    while ((m2 = re.exec(src))) out.push(m2[1]);
    return out;
  };
  const home = listOf(fs.readFileSync(path.join(ROOT, 'pages/home/home.vue'), 'utf8'));
  const focus = listOf(fs.readFileSync(FOCUS_VUE, 'utf8'));
  const want = kinds.join(',');
  assert(home.join(',') === want,
    'home.vue 的音色名单与 ambient.KINDS 一致（' + home.join(',') + '）');
  assert(focus.join(',') === want,
    'focus.vue 的音色名单与 ambient.KINDS 一致（' + focus.join(',') + '）');
  assert(kinds.indexOf('beach') >= 0, '有沙滩（海浪）音色');
}

// 5.5 真实录音必须有许可记录：随包分发的东西不能没有出处
{
  const srcDoc = path.join(NOISE_DIR, 'SOURCES.md');
  assert(fs.existsSync(srcDoc), 'static/noise/SOURCES.md 存在（真实录音的来源与许可）');
  const doc = fs.existsSync(srcDoc) ? fs.readFileSync(srcDoc, 'utf8') : '';
  const builder = path.join(__dirname, 'build-ambient.py');
  assert(fs.existsSync(builder), '_tools/build-ambient.py 存在（真实录音的产线）');
  const bsrc = fs.existsSync(builder) ? fs.readFileSync(builder, 'utf8') : '';
  // 先剥注释，否则文档串里的 "kind" 会被当成真的源条目
  const bcode = bsrc.replace(/#[^\n]*/g, '');
  const real = [];
  const re2 = /'kind':\s*'([a-z]+)'/g;
  let m3;
  while ((m3 = re2.exec(bcode))) real.push(m3[1]);
  assert(real.length > 0, 'build-ambient.py 里登记了真实录音源（' + real.join('/') + '）');
  real.forEach(k => {
    // ⚠️ 必须按**行**核对：写成"文档里出现过某个许可词"的话，只要还有一个素材
    //    写了许可就放行 —— 另一个素材的许可被删掉照样绿（反向测试抓到的假绿）。
    const line = doc.split('\n').filter(l => l.indexOf(k + '.wav') >= 0)[0] || '';
    assert(line.length > 0, 'SOURCES.md 记了 ' + k + '.wav 的出处');
    assert(/Public domain|CC0|CC BY|synthesized|自合成/i.test(line),
      'SOURCES.md 里 ' + k + '.wav 那一行写了许可');
  });
  // 只收 CC0/PD：要署名的素材得在 App 里补署名界面，不能悄悄换进来
  assert(!/CC\s*BY/i.test(bsrc.replace(/#.*$/gm, '')),
    '★ 产线里没有 CC-BY / CC-BY-SA 的素材（要署名，换进来就得在 App 里补署名界面）');
}

console.log('');
console.log(fail === 0 ? '白噪音与出声链路校验全部通过' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
