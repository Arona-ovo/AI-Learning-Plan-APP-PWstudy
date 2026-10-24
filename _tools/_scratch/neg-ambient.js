// 反向测试：故意把白噪音 / 出声链路改坏，确认 check-ambient.js 真的会红（防假绿）。
// 结束（或中途出错）一定把文件还原 —— 用内存里的备份写回，不走 git。
//
// ⚠️ 同进程 require 而不是起子进程：这个沙箱里 spawnSync 直接 EBUSY，
//    而且失败时 status/signal 都是 null、stdout 为空 —— 会被误判成"被抓到"（假绿）。
// ⚠️ process.exit() 与 process.exitCode 两条退出口径都要收（有的守卫只写后者）。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHECK = path.join(ROOT, '_tools', 'check-ambient.js');
const AMB = path.join(ROOT, 'uniapp-PWstudy', 'utils', 'ambient.js');
const AUDIO = path.join(ROOT, 'uniapp-PWstudy', 'utils', 'audio.js');
const FV = path.join(ROOT, 'uniapp-PWstudy', 'pkgPlan', 'pages', 'focus', 'focus.vue');
const FJ = path.join(ROOT, 'uniapp-PWstudy', 'utils', 'focus.js');
// ⚠️ 二进制（wav）**不能**跟文本文件混在 FILES 里：shouldCatch 会把它们当 utf8 读再写回，
//    那是毁文件。所以分两组 —— 文本走 cur 字符串，wav 走 Buffer，还原统一走 backup。
const HOME = path.join(ROOT, 'uniapp-PWstudy', 'pages', 'home', 'home.vue');
const TOOL = path.join(ROOT, '_tools', 'build-ambient.py');
const SRC = path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise', 'SOURCES.md');
const NOISE = path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise', 'white.wav');
const NOISE_RAIN = path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise', 'rain.wav');
const NOISE_BEACH = path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise', 'beach.wav');

const FILES = [AMB, AUDIO, FV, FJ, HOME, TOOL, SRC];
const BINS = [NOISE, NOISE_RAIN, NOISE_BEACH];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });
BINS.forEach(f => { backup[f] = fs.readFileSync(f); });   // Buffer，不能 utf8
function restore() {
  Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f]));
}

/** wav 的 data 段整体乘一个系数（改响度） */
function scaleWav(file, k) {
  const b = Buffer.from(backup[file]);
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.slice(i, i + 4).toString('ascii');
    const sz = b.readUInt32LE(i + 4);
    if (id === 'data') {
      for (let j = i + 8; j + 1 < i + 8 + sz; j += 2) {
        b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(b.readInt16LE(j) * k))), j);
      }
      break;
    }
    i += 8 + sz + (sz % 2);
  }
  fs.writeFileSync(file, b);
}

/** 把 wav 的第一个样本打满 —— 模拟"忘了做首尾交叉淡化"的接缝跳变 */
function breakSeam(file) {
  const b = Buffer.from(backup[file]);
  let i = 12;
  while (i + 8 <= b.length) {
    const id = b.slice(i, i + 4).toString('ascii');
    const sz = b.readUInt32LE(i + 4);
    if (id === 'data') { b.writeInt16LE(32767, i + 8); break; }
    i += 8 + sz + (sz % 2);
  }
  fs.writeFileSync(file, b);
}

function runCheck() {
  delete require.cache[require.resolve(CHECK)];
  const realExit = process.exit;
  const realLog = console.log;
  const realErr = console.error;
  const buf = [];
  let code = 0;
  process.exitCode = 0;
  process.exit = (c) => { code = (c == null ? 0 : c); const e = new Error('__exit'); e.__exit = true; throw e; };
  console.log = (...a) => buf.push(a.join(' '));
  console.error = (...a) => buf.push(a.join(' '));
  let crash = null;
  try { require(CHECK); } catch (e) { if (!e || !e.__exit) crash = e; }
  process.exit = realExit;
  console.log = realLog;
  console.error = realErr;
  const c = crash ? 99 : (code || process.exitCode || 0);
  process.exitCode = 0;
  return { code: c, buf: buf };
}

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };

/** 改坏 → 跑 → 断言"被抓到"。红条数必须 > 0：一条都没有说明是脚本崩了，不是断言命中 */
function shouldCatch(label, mutate, expect) {
  restore();
  const cur = {};
  FILES.forEach(f => { cur[f] = fs.readFileSync(f, 'utf8'); });
  try {
    mutate(cur);
  } catch (e) {
    // 锚点失效（源码改过了）必须当成失败，不能让它把整个脚本崩掉然后看都不看
    bad(label + ' —— 注入失败：' + e.message);
    restore();
    return;
  }
  FILES.forEach(f => fs.writeFileSync(f, cur[f]));
  const r = runCheck();
  const reds = r.buf.filter(l => l.indexOf('✗') >= 0);
  const hit = r.code !== 0 && reds.length > 0
    && (!expect || r.buf.join('\n').indexOf(expect) >= 0);
  if (hit) ok(label + '（红 ' + reds.length + ' 条）');
  else bad(label + ' —— 没被抓到：code=' + r.code + ' 红条=' + reds.length
    + (expect ? ' 期望看到「' + expect + '」' : '')
    + (reds.length === 0 ? '\n      输出尾巴：' + r.buf.slice(-4).join(' | ') : ''));
  restore();
}

/**
 * 锚点替换：换了必须真的生效，否则抛错。
 * from 可以是字符串（只换第一处）也可以是正则（要跨行就只能用正则 ——
 * ⚠️ 字符串里的 \r\n 不会被解析，写多行锚点必然落空，已踩）。
 */
function swap(cur, file, from, to) {
  const before = cur[file];
  cur[file] = before.replace(from, to);
  if (cur[file] === before) throw new Error('锚点没命中：' + from.slice(0, 60));
}

console.log('反向测试：check-ambient.js 应该抓到下面这些坏法');
console.log('');

// 1. 素材被弄坏（不是合法 wav）
shouldCatch('white.wav 不是合法 wav', () => {
  const b = Buffer.from(backup[NOISE]);
  b.write('XXXX', 0);                 // 破坏 RIFF 头
  fs.writeFileSync(NOISE, b);
}, '合法 wav');

// 2. 只留一条路径候选 —— 转出来的绝对路径播放器认不了就彻底静默
//    （真机"白噪音 + 响铃一起没声"的共同根因）
shouldCatch('srcCandidates 只给一条路径', (c) => {
  swap(c, AUDIO, "  if (out.indexOf(rel) < 0) out.push(rel);", "  /* 只留绝对路径 */");
}, '既有转出来的绝对路径');

// 3. 响铃（playOnce）播失败不换路径
//    ⚠️ 锚点只匹配单行：`swap` 用的是 String.replace，from 里的 \r\n 是字面量不是换行（已踩）
shouldCatch('playOnce 播失败不换路径', (c) => {
  swap(c, AUDIO, "        pi++;", "        /* 不重试 */");
}, '换下一条候选');

// 4. 白噪音播失败不换路径
shouldCatch('ambient 播失败不换路径', (c) => {
  swap(c, AMB, "        pi++;", "        /* 不重试 */");
}, '换下一条候选');

// 5. 开关打开了却不当场起声 —— 本次真机 bug 的正主
//    （专注跑到一半开开关，要等下一轮才响，用户以为功能坏了）
//    ⚠️ 用字符串锚点、只替换第一处（= toggleNoise 里的那次），pickNoise 那次留给用例 6
shouldCatch('开关打开后不当场起声', (c) => {
  swap(c, FV, "      this.syncAmbient()", "      /* 不当场起声 */");
}, '当场同步播放');

// 6. 切音色不当场换声（要动 pickNoise 里那次 → 用 saveNoise(k) 做定位锚点 + 正则吃换行）
shouldCatch('切音色不当场换声', (c) => {
  swap(c, FV, /this\.saveNoise\(k\)\r?\n[ \t]*this\.syncAmbient\(\)/, "this.saveNoise(k)");
}, '当场同步播放');

// 7. 休息时也响（白噪音只陪专注）
shouldCatch('休息时白噪音也响', (c) => {
  swap(c, FV, "this.noiseOn && this.active && !this.paused && !this.isRest", "this.noiseOn && this.active && !this.paused");
}, '休息中不陪');

// 8. 开始专注不接白噪音
shouldCatch('开始专注不起声', (c) => {
  swap(c, FJ, "  if (fcfg().noise) ambient.start(fcfg().noise);", "  /* 忘了起声 */");
}, '开始专注');

// 9. 进休息不停
shouldCatch('进休息没停', (c) => {
  swap(c, FJ, "  ambient.stop();          // 白噪音只陪专注，休息就停", "  /* 忘了停 */");
}, '进休息');

// ---------- 第 5 组：素材质量与来源（真实录音上线后新增） ----------
// 这几个坑的共同点：**界面上全都看不出来**，只能靠护栏静态钉住。

// 10~12. 三处音色名单分叉 —— 某个页面点得到、播放层又不认（或反过来）
shouldCatch('ambient.js 少了沙滩（页面有、播不出来）', (c) => {
  swap(c, AMB, "  { k: 'beach', t: '沙滩' }\n", '');
}, '沙滩');
// ⚠️ 锚点里的换行必须写 \r?\n：这些文件是 CRLF，写裸 \n 一律落空（第 17 条硬约束）
shouldCatch('home.vue 音色选择器漏了沙滩', (c) => {
  swap(c, HOME, /\{ k: 'beach', t: this\.\$t\('沙滩'\) \}\r?\n/, '');
}, 'home.vue 的音色名单');
shouldCatch('focus.vue 音色选择器漏了沙滩', (c) => {
  swap(c, FV, /\{ k: 'beach', t: this\.\$t\('沙滩'\) \}\r?\n/, '');
}, 'focus.vue 的音色名单');

// 13~14. 真实录音的许可：换了素材却没同步 SOURCES.md / 混进要署名的素材
shouldCatch('换了素材但没同步 SOURCES.md（kind 改名）', (c) => {
  swap(c, TOOL, "'kind': 'rain',", "'kind': 'rainfall',");
}, 'SOURCES.md 记了');
shouldCatch('产线混进 CC BY 的素材（要署名，App 里没署名界面）', (c) => {
  swap(c, TOOL, "'license': 'CC0 1.0',", "'license': 'CC BY 4.0',");
}, 'CC-BY');
shouldCatch('SOURCES.md 不写许可', (c) => {
  swap(c, SRC, 'Public domain', '作者授权');
}, '许可');

// 15. 忘了做首尾交叉淡化 → 循环点"啪"一下
//     （合成噪声统计平稳听不出，真实录音上一听就是接缝）
shouldCatch('雨声忘了做首尾交叉淡化（循环点跳变）', () => {
  breakSeam(NOISE_RAIN);
}, '循环接缝连续');

// 16. 某个音色被峰值夹下去一大截 —— crest 高的素材最容易踩：
//     界面上音量条照常是满的，就是没声（第一版真实雨声就差了 16dB）
shouldCatch('沙滩的响度被压下去（界面看不出来）', () => {
  scaleWav(NOISE_BEACH, 0.25);
}, '响度一致');

restore();
console.log('');
console.log(fail === 0 ? '反向测试全部通过（护栏真的会红）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
