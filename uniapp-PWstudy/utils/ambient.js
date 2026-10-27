// utils/ambient.js - 专注白噪音（循环环境音，跟着专注状态走）
//
// 音源分两类：
//   白噪 / 粉噪 / 棕噪 —— 自己合成（_tools/gen-noise.py），零版权问题
//   雨声 / 沙滩（海浪） —— **真实录音**，只挑 CC0 / 公有领域的素材
//      （_tools/build-ambient.py，来源与许可逐条记在 static/noise/SOURCES.md）
//   为什么雨声要换真录音：合成得再物理化也只是"像雨"，真实录音自带那种
//    合成不出来的细密随机感。代价是要过版权，所以只收 CC0/PD，不收要署名的。
//
// 与 sfx.js 的三点不同：
//   1) 白噪音是长循环 —— 用一个**常驻**的 InnerAudioContext（loop=true），
//      播完/停掉时才 destroy；不能像答题音效那样"每次新建、播完即弃"。
//   2) 生命周期归 focus.js 状态机管：开始专注 → start，暂停 → pause，恢复 → resume，
//      结束/放弃/进休息 → stop。页面不用管，切页不影响（和计时本身一个待遇）。
//   3) 没有全局静音开关耦合（sfx 关的是"音效"，白噪音有自己的开关）。
//
// 播放本身统一走 utils/audio.js 的路径转换（那一层也负责错误上报的口径），
// 这里只管"该不该响"和"什么时候响"。

import * as audio from './audio.js';
import * as fgsvc from './fgsvc.js';

// ⚠️ 这里加/删音色时，三处名单要一起动（各写一份必然分叉）：
//   utils/ambient.js 的 KINDS（唯一权威：播放前按它校验 kind）
//   pages/home/home.vue 的 noiseKinds
//   pkgPlan/pages/focus/focus.vue 的 noiseKinds
// 素材本身：白/粉/棕噪由 _tools/gen-noise.py 合成，
//           雨声与沙滩是真实录音（_tools/build-ambient.py，来源见 static/noise/SOURCES.md）。
export const KINDS = [
  { k: 'white', t: '白噪' },
  { k: 'pink', t: '粉噪' },
  { k: 'brown', t: '棕噪' },
  { k: 'rain', t: '雨声' },
  { k: 'beach', t: '沙滩' }
];

// ⚠️ 白噪音是**宽带噪声**，峰值因子（crest factor）只有 3~4dB —— 同样的音量数值下，
//    它的平均能量远高于音乐/语音，听感比"同音量的音乐"吵得多。以前按音乐习惯给 0.7，
//    真机反馈就是"刺耳"。环境音该是**垫底的背景**，不盖过注意力：0.32。
//    真要更响去设置页调（这里只给默认值），别再往回抬。
const VOLUME = 0.32;
// 起播后多久还没见 onPlay 就认为"没响"（界面据此提示，而不是一直静默）
const START_MS = 2500;

let ctx = null;          // uni.createInnerAudioContext（兜底 / 非 App 端 / 标准基座）
let nativeOn = false;    // 当前是否走原生 MediaPlayer（后台不中断、单路音量）
let cur = '';
let lastErr = '';      // 最近一次播放错误（界面可以据此提示"播不出来"）

export function current() { return cur; }
export function lastError() { return lastErr; }

function relOf(kind) {
  return '/static/noise/' + kind + '.wav';
}

// 路径候选复用 audio.srcCandidates（响铃 / 音效走同一层）：
// 真机上"白噪音和响铃一起没声音"就是这一层给出的绝对路径播放器认不了，
// 在这里另写一份只会两头不一致。

/**
 * 开始循环播放。已在该音色上时等价于 resume。
 * @returns {boolean} 是否成功发起。真出没出声看 lastError() ——
 *   长循环音没有"蜂鸣兜底"那一路（那只会变成刺耳的一声），如实记错给界面显示。
 */
export function start(kind) {
  if (!KINDS.some(x => x.k === kind)) return false;
  // 已在播同一音色：等价于 resume（原生 / InnerAudioContext 各自续上）
  if (cur === kind) {
    if (nativeOn) { try { fgsvc.ambientResume(); } catch (e) {} }
    else if (ctx) { try { ctx.play(); } catch (e) {} }
    return true;
  }
  stop();
  lastErr = '';
  // ① 优先走原生 MediaPlayer（自定义基座 + 插件可用）：App 退后台 WebView 被回收时
  //    不会像 InnerAudioContext 那样报 -5，且能单独压音量（0.32 这种"垫底背景音"必须压得住）。
  const abs = audio.localUrl(relOf(kind));
  if (abs && fgsvc.ambientStart(abs, VOLUME, true)) {
    nativeOn = true;
    cur = kind;
    lastErr = '';
    return true;
  }
  // ② 兜底：uni.createInnerAudioContext（标准基座 / H5 / 开发期）。
  //    只能在 App 前台稳播；切到后台可能 -5 —— 但至少能响，且自带路径重试。
  let c = null;
  try {
    c = uni.createInnerAudioContext();
  } catch (e) {
    lastErr = '无法创建播放器';
    return false;
  }
  ctx = c;
  nativeOn = false;
  cur = kind;
  const paths = audio.srcCandidates(relOf(kind));
  let pi = 0;
  let sounded = false;
  const playNow = () => { try { c.play(); } catch (e) {} };
  try {
    c.loop = true;
    c.volume = VOLUME;
    c.onPlay(() => { sounded = true; lastErr = ''; });
    c.onError((e) => {
      // 还有候选没试：换下一条路径再发起一次（见 srcCandidates 的注释）
      if (pi < paths.length - 1) {
        pi++;
        try { c.src = paths[pi]; playNow(); } catch (e2) {}
        return;
      }
      const code = e && (e.errCode != null ? e.errCode : e.code);
      lastErr = '白噪音播放失败' + (code ? '（' + code + '）' : '') +
        '：' + ((e && (e.errMsg || e.message)) || '未知原因');
      console.warn('[ambient] ' + lastErr);
    });
    c.onCanplay(() => {
      lastErr = '';
      try { c.play(); } catch (e) {}
    });
    c.src = paths[pi];
    // 缓冲好会再播一次；这里先发起，防的是部分平台 onCanplay 不触发就一直不响
    playNow();
    // 一直没见 onPlay、也没报错 = "发起了但没出声"。以前这种情况是完全静默的，
    // 用户只能以为功能坏了 —— 记下来，界面好歹能说一句。
    setTimeout(() => {
      if (c !== ctx || sounded || lastErr) return;
      lastErr = '已发起播放，但没听到声音（媒体音量为 0 也会这样）';
      console.warn('[ambient] ' + lastErr);
    }, START_MS);
    return true;
  } catch (e) {
    lastErr = '白噪音启动失败';
    stop();
    return false;
  }
}

/**
 * 试听某一种音色几秒（不影响正在播的那一路）。
 * 真机上"开关开了却没声音"，点一下试听就能分辨：
 * 是素材播不出来（回调给 err/code），还是媒体音量为 0（audio.quiet()）。
 */
export function preview(kind, ms, cb) {
  if (!KINDS.some(x => x.k === kind)) return false;
  return audio.playOnce(relOf(kind), {
    volume: VOLUME,
    ms: Math.max(1000, Number(ms) || 4000),
    fallback: false        // 白噪音没有"蜂鸣兜底"这一说，那只会变成刺耳的一声
  }, cb || function () {});
}

export function pause() {
  if (nativeOn) { try { fgsvc.ambientPause(); } catch (e) {} return; }
  if (ctx) {
    try { ctx.pause(); } catch (e) {}
  }
}

export function resume() {
  if (nativeOn && cur) { try { fgsvc.ambientResume(); } catch (e) {} return; }
  if (ctx && cur) {
    try { ctx.play(); } catch (e) {}
  }
}

export function stop() {
  if (nativeOn) { try { fgsvc.ambientStop(); } catch (e) {} nativeOn = false; }
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  cur = '';
  try { c.stop(); } catch (e) {}
  try { c.destroy(); } catch (e) {}
}
