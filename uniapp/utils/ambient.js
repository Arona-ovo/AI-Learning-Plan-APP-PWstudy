// utils/ambient.js - 专注白噪音（循环环境音，跟着番茄状态走）
//
// 音源是自己合成的（_tools/gen-noise.py：白噪/粉噪/棕噪/雨声），
// 没有任何第三方版权问题，离线可播。
//
// 与 sfx.js 的三点不同：
//   1) 白噪音是长循环 —— 用一个**常驻**的 InnerAudioContext（loop=true），
//      播完/停掉时才 destroy；不能像答题音效那样"每次新建、播完即弃"。
//   2) 生命周期归 focus.js 状态机管：开始专注 → start，暂停 → pause，恢复 → resume，
//      结束/放弃/进休息 → stop。页面不用管，切页不影响（和计时本身一个待遇）。
//   3) 没有全局静音开关耦合（sfx 关的是"音效"，白噪音有自己的开关）。

export const KINDS = [
  { k: 'white', t: '白噪' },
  { k: 'pink', t: '粉噪' },
  { k: 'brown', t: '棕噪' },
  { k: 'rain', t: '雨声' }
];

let ctx = null;
let cur = '';

export function current() { return cur; }

function srcOf(kind) {
  const p = '/static/noise/' + kind + '.wav';
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.io && plus.io.convertLocalFileSystemURL) {
    try {
      return plus.io.convertLocalFileSystemURL('_www' + p);
    } catch (e) { /* 转换失败就用原路径 */ }
  }
  // #endif
  return p;
}

/** 开始循环播放。已在该音色上时等价于 resume */
export function start(kind) {
  if (!KINDS.some(x => x.k === kind)) return false;
  if (ctx && cur === kind) {
    try { ctx.play(); } catch (e) {}
    return true;
  }
  stop();
  let c = null;
  try {
    c = uni.createInnerAudioContext();
  } catch (e) {
    return false;
  }
  ctx = c;
  cur = kind;
  try {
    c.loop = true;
    c.volume = 0.6;
    c.onError(() => {});          // 播放失败静默（别让一条环境音弹 toast 打断专注）
    c.src = srcOf(kind);
    c.play();
    return true;
  } catch (e) {
    stop();
    return false;
  }
}

export function pause() {
  if (ctx) {
    try { ctx.pause(); } catch (e) {}
  }
}

export function resume() {
  if (ctx && cur) {
    try { ctx.play(); } catch (e) {}
  }
}

export function stop() {
  if (!ctx) return;
  const c = ctx;
  ctx = null;
  cur = '';
  try { c.stop(); } catch (e) {}
  try { c.destroy(); } catch (e) {}
}
