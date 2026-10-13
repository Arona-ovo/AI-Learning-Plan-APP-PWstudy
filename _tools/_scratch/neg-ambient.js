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
const NOISE = path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise', 'white.wav');

const FILES = [AMB, AUDIO, FV, FJ];
const backup = {};
FILES.forEach(f => { backup[f] = fs.readFileSync(f); });
const noiseBackup = fs.readFileSync(NOISE);
function restore() {
  Object.keys(backup).forEach(f => fs.writeFileSync(f, backup[f]));
  fs.writeFileSync(NOISE, noiseBackup);
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
  const b = Buffer.from(noiseBackup);
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
//    （番茄跑到一半开开关，要等下一轮才响，用户以为功能坏了）
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

restore();
console.log('');
console.log(fail === 0 ? '反向测试全部通过（护栏真的会红）' : '失败 ' + fail + ' 项 ✗');
process.exit(fail ? 1 : 0);
