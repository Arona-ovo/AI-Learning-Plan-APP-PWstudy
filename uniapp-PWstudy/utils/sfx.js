// utils/sfx.js - 答题音效（正确 / 半对 / 错误）
//
// 三个 wav 由 _tools/gen-sfx.py 合成（正弦叠谐波 + 指数衰减，钟琴感），
// 随包分发：没有版权问题，也不需要联网 —— 断网时反馈依旧完整。
//
// 三条硬规矩：
//   1) 每次播放新建 InnerAudioContext、播完立即 destroy。
//      复用实例切 src 在部分安卓机上会报 -99（utils/tts.js 已经是这个做法）。
//   2) 同时只存在一个实例：新的先掐掉旧的，连点不会叠成噪音。
//   3) 跟着设置里的开关走，关掉就是彻底静音（连实例都不创建）。
import * as settings from './settings.js';
import * as audio from './audio.js';

const FILES = {
  correct: 'correct',
  pass: 'correct',
  partial: 'partial',
  wrong: 'wrong',
  fail: 'wrong'
};

// 各音效时长（ms）：供调用方安排"音效之后再朗读"，避免两种声音叠在一起
const DURATION = { correct: 400, partial: 200, wrong: 380 };

const MIN_GAP = 80;    // 连点保护：这么短的时间内的重复触发直接丢掉

let current = null;
let lastAt = 0;

function srcOf(name) {
  // 路径转换统一走 utils/audio.js（App 端要过 convertLocalFileSystemURL）
  return audio.localUrl('/static/sfx/' + name + '.wav');
}

/** 音效开关（设置 › 朗读与音效） */
export function isEnabled() {
  try {
    return !!(settings.get() && settings.get().voice && settings.get().voice.sfx !== false);
  } catch (e) {
    return true;
  }
}

export function durationOf(kind) {
  return DURATION[kind] || DURATION[FILES[kind]] || 400;
}

function kill() {
  if (!current) return;
  const c = current;
  current = null;
  try { c.stop(); } catch (e) {}
  try { c.destroy(); } catch (e) {}
}

export function stop() {
  kill();
}

/**
 * 播一条答题音效。
 * @param {'correct'|'partial'|'wrong'|'pass'|'fail'} kind
 * @returns {boolean} 是否真的播了（关掉开关 / 连点 / 平台不支持都会返回 false）
 */
export function play(kind, opt) {
  // ⚠️ force：番茄结束的「响铃」必须走这一路。
  // isEnabled() 管的是设置里的「朗读与音效」（背单词时代那一栏），跟专注页的
  // 「结束响铃」是两个开关 —— 响铃不该被另一个用户根本没见过的开关掐掉。
  // 谁开谁负责：focus.sound 已经判过了才轮到 beep()，这里就不能再查一遍 voice.sfx。
  const force = !!(opt && opt.force);
  if (!force && !isEnabled()) return false;
  const name = FILES[kind];
  if (!name) return false;

  // 提醒类（番茄结束响铃）：媒体音量为 0 时直接走系统闹钟流蜂鸣。
  // 安卓的播放器固定走 STREAM_MUSIC，而"专注时把媒体音量调成 0"非常常见 ——
  // 那是"叫得醒"的场景，不该被媒体静音掐掉。
  if (force && audio.quiet()) {
    lastAt = Date.now();
    return audio.tone(durationOf(kind));
  }

  const now = Date.now();
  if (now - lastAt < MIN_GAP) return false;
  lastAt = now;

  kill();
  let ctx = null;
  try {
    ctx = uni.createInnerAudioContext();
  } catch (e) {
    return false;
  }
  current = ctx;
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    if (current === ctx) current = null;
    try { ctx.destroy(); } catch (e) {}
  };
  ctx.onCanplay(() => {
    // 缓冲好再播一次：src 刚设下去就 play()，部分安卓机会直接失败（冷启动尤其明显）
    try { ctx.play(); } catch (e) {}
  });
  ctx.onEnded(finish);
  ctx.onError(() => {
    finish();
    // 提醒类播不出来也得响：降级到系统蜂鸣（STREAM_ALARM），至少叫得醒
    if (force) audio.tone(durationOf(kind));
  });
  ctx.onStop(finish);
  ctx.src = srcOf(name);
  try {
    ctx.play();
  } catch (e) {
    finish();
    if (force) audio.tone(durationOf(kind));
    return false;
  }
  return true;
}
