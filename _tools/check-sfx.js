// _tools/check-sfx.js - 答题音效校验
// 核心断言：
//   - 三个 wav 真实存在，是合法 PCM、单声道 16bit，时长与 sfx.js 里的时长表一致
//     （换音频文件时若忘了同步 DURATION，朗读就会和音效叠在一起 → 这里拦住）
//   - pass→correct / partial→partial / fail→wrong 映射正确
//   - 开关关掉后彻底不创建播放器；连点被吞；同时只存在一个实例
//   - 练习页 / App.vue / 设置页三处接线都在
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'uniapp');
const { load } = require('./lib/load');

let fail = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));
function eq(a, b, label) {
  if (a === b) ok(label + ' = ' + b);
  else bad(label + ' 期望 ' + b + '，实际 ' + a);
}

/* ---------------- mock uni ---------------- */
const mem = {};
const live = [];        // 所有被创建出来的播放器记录
const played = [];      // 实际调过 play() 的 src 顺序
function mkCtx() {
  const rec = { src: '', destroyed: false, stopped: false, started: false, h: {} };
  live.push(rec);
  return {
    set src(v) { rec.src = v; },
    get src() { return rec.src; },
    play() { rec.started = true; played.push(rec.src); },
    stop() { rec.stopped = true; if (rec.h.onStop) rec.h.onStop(); },
    destroy() { rec.destroyed = true; },
    onEnded(f) { rec.h.onEnded = f; },
    onError(f) { rec.h.onError = f; },
    onStop(f) { rec.h.onStop = f; },
    // ⚠️ 必须有 onCanplay：sfx.js 现在是"缓冲好再播一次"，mock 缺这个方法会直接抛
    //    TypeError（而 run-all 里被别的脚本泄漏的 uni mock 恰好有 → 出现假绿，已踩）
    onCanplay(f) { rec.h.onCanplay = f; }
  };
}
global.uni = {
  getStorageSync: (k) => mem[k],
  setStorageSync: (k, v) => { mem[k] = v; },
  removeStorageSync: (k) => { delete mem[k]; },
  createInnerAudioContext: () => mkCtx(),
  showToast: () => {}
};

console.log('== 1. 音频文件 ==');
const SFX_DIR = path.join(ROOT, 'static', 'sfx');
const names = ['correct', 'partial', 'wrong'];
const realDur = {};
names.forEach((n) => {
  const p = path.join(SFX_DIR, n + '.wav');
  if (!fs.existsSync(p)) { bad('缺少 ' + n + '.wav'); return; }
  const b = fs.readFileSync(p);
  const isWav = b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WAVE';
  assert(isWav, n + '.wav 是合法 WAV');
  const ch = b.readUInt16LE(22);
  const rate = b.readUInt32LE(24);
  const bits = b.readUInt16LE(34);
  assert(ch === 1, n + '.wav 单声道（越小越省包体）');
  assert(bits === 16, n + '.wav 16bit');
  const dataLen = b.readUInt32LE(40);
  const ms = Math.round((dataLen / (rate * ch * bits / 8)) * 1000);
  realDur[n] = ms;
  ok(n + '.wav ' + rate + 'Hz，时长 ' + ms + 'ms，' + (b.length / 1024).toFixed(1) + ' KB');
});
const totalKB = names.reduce((s, n) => s + fs.statSync(path.join(SFX_DIR, n + '.wav')).size, 0) / 1024;
assert(totalKB < 80, '三个音效合计 ' + totalKB.toFixed(0) + ' KB（< 80 KB，不拖累包体）');

/* ---------------- 装载 ---------------- */
const settings = load('utils/settings.js');
settings.init();
// sfx 现在把路径转换与"播不出来就走系统蜂鸣"的兜底都交给 utils/audio.js 了，
// 依赖袋里必须带上（load() 是按标识符注入的，漏了就是运行时 ReferenceError）
const audio = load('utils/audio.js');
const sfx = load('utils/sfx.js', { settings, audio });

console.log('== 2. 时长表与实际音频一致 ==');
names.forEach((n) => {
  const d = sfx.durationOf(n);
  const gap = Math.abs(d - realDur[n]);
  assert(gap <= 60, 'durationOf("' + n + '") = ' + d + 'ms，实际 ' + realDur[n] + 'ms（差 ' + gap + '）');
});
eq(sfx.durationOf('pass'), sfx.durationOf('correct'), 'pass 与 correct 同长');
eq(sfx.durationOf('fail'), sfx.durationOf('wrong'), 'fail 与 wrong 同长');

// 模块自带 80ms 连点保护，测试必须按真实节奏来，否则自己的调用会被吞掉
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 110;

(async () => {
console.log('== 3. 判定 → 音效映射 ==');
assert(sfx.isEnabled(), '默认开启');
assert(sfx.play('pass') === true, '答对播得出');
assert(/correct\.wav$/.test(played[played.length - 1]), 'pass → correct.wav（' + played[played.length - 1] + '）');
await sleep(GAP);
sfx.play('partial');
assert(/partial\.wav$/.test(played[played.length - 1]), 'partial → partial.wav');
await sleep(GAP);
sfx.play('fail');
assert(/wrong\.wav$/.test(played[played.length - 1]), 'fail → wrong.wav');
assert(sfx.play('不存在的状态') === false, '未知状态不播');

console.log('== 4. 连点保护与单例 ==');
await sleep(GAP);
const n0 = live.length;
sfx.play('pass');
eq(live.length, n0 + 1, '正常播放会新建播放器');
const first = live[live.length - 1];
assert(sfx.play('fail') === false, '80ms 内的连点被吞（不会叠成噪音）');
eq(live.length, n0 + 1, '连点没有多建播放器');
await sleep(GAP);
sfx.play('fail');
eq(live.length, n0 + 2, '间隔够后正常新建播放器');
assert(first.stopped || first.destroyed, '新音效掐掉了上一个（stop 或 destroy）');
// 上一个被 destroy 后，未销毁的只剩最新这一个
eq(live.filter((r) => !r.destroyed).length <= 1, true, '同一时刻最多 1 个未销毁的实例');

console.log('== 5. 开关 ==');
await sleep(GAP);
settings.set({ voice: { sfx: false } });
assert(!sfx.isEnabled(), '关掉后 isEnabled = false');
const n1 = live.length;
assert(sfx.play('pass') === false, '关掉后 play 返回 false');
eq(live.length, n1, '关掉后连播放器都不创建');
settings.set({ voice: { sfx: true } });
assert(sfx.isEnabled(), '重新打开');
assert(sfx.play('pass') === true, '重新打开后能播');

console.log('== 6. stop() ==');
const rec = live[live.length - 1];
sfx.stop();
assert(rec.stopped && rec.destroyed, 'stop() 停掉并销毁当前实例');

console.log('== 7. 接线 ==');
  // 练习页（pkgStudy/pages/practice）随背单词一起退役，这里改查当前真正的调用方：
  // notify.js（番茄结束的响铃走 sfx）与设置页（音效开关 / 试听 / 彩蛋开奖音）
  const nt = fs.readFileSync(path.join(ROOT, 'utils', 'notify.js'), 'utf8');
  assert(/import \* as sfx from/.test(nt), 'notify.js 引入 sfx');
  assert(/sfx\.play\('correct'/.test(nt), '提示音走 sfx.play');
  // ⚠️ 这条是真机事故换来的：番茄结束的「响铃」由 focus.sound 单独管，
  //    不能再过 sfx 自己的 voice.sfx（设置里另一栏）判断 —— 否则用户开了响铃却没声音。
  //    谁开谁负责，所以必须带 force。
  assert(/sfx\.play\('correct',\s*\{[^}]*force:\s*true/.test(nt), '响铃带 force（不被设置里的音效开关二次掐掉）');
  const app = fs.readFileSync(path.join(ROOT, 'App.vue'), 'utf8');
  assert(/sfx\.stop\(\)/.test(app), 'App onHide 掐掉音效');
  const st = fs.readFileSync(path.join(ROOT, 'pkgManage', 'pages', 'settings', 'settings.vue'), 'utf8');
  assert(/setVoice\('sfx'/.test(st), '设置页有音效开关');
  assert(/previewSfx/.test(st), '设置页有试听');
  assert(/voice\.sfx/.test(st) || /'sfx'/.test(st), '设置页绑定 sfx 状态');
  const sd = fs.readFileSync(path.join(ROOT, 'utils', 'settings.js'), 'utf8');
  assert(/sfx:\s*true/.test(sd), 'settings 默认值带 sfx: true');

  console.log(fail === 0 ? '\n答题音效全部通过' : '\n失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})();
