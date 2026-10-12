// utils/audio.js - App 端播放本地 wav 的统一出口（含自检与兜底）
//
// 为什么要有这一层：白噪音（ambient）和提示音（sfx）原本各写一套
// createInnerAudioContext，两边都把 onError 静默吞掉 —— 真机上"开了开关没声音"
// 时谁也不知道是路径错了、格式不支持，还是用户媒体音量为 0。
// 统一到这里之后：
//   1) 播不出来就**降级**：先用 uni 的 InnerAudioContext，失败再走系统蜂鸣
//      （ToneGenerator，走 STREAM_ALARM，几乎在所有设备上都能出声）；
//   2) 提供 selfTest()：把"媒体音量是多少 + 播放结果 + 错误码"一次问清楚，
//      真机上一句话就能定位，不用再来回猜。
//
// 素材都是随包分发的 wav（_tools/gen-noise.py / gen-sfx.py 合成，离线可播）。

const RING_MS = 420;   // 兜底蜂鸣时长

/** '/static/...' → 各端能用的路径（App 端要过 convertLocalFileSystemURL） */
export function localUrl(rel) {
  const p = String(rel || '');
  if (!p) return '';
  // #ifdef APP-PLUS
  if (typeof plus !== 'undefined' && plus.io && plus.io.convertLocalFileSystemURL) {
    try {
      const u = plus.io.convertLocalFileSystemURL('_www' + p);
      if (u) return u;
    } catch (e) { /* 转不了就用原路径 */ }
  }
  // #endif
  return p;
}

/**
 * 系统媒体音量（App 端）。
 * 这是"没声音"的第一嫌疑：安卓的 InnerAudioContext 走 STREAM_MUSIC，
 * 媒体音量为 0 / 开了勿扰时，播得再对也听不见。
 */
export function mediaVolume() {
  // #ifdef APP-PLUS
  try {
    const activity = plus.android.runtimeMainActivity();
    const am = activity.getSystemService('audio');        // Context.AUDIO_SERVICE
    plus.android.importClass(am);
    const stream = 3;   // AudioManager.STREAM_MUSIC
    const vol = Number(am.getStreamVolume(stream));
    const max = Number(am.getStreamMaxVolume(stream));
    return { vol, max, ok: true };
  } catch (e) {
    return null;
  }
  // #endif
  return null;
}

/**
 * 系统媒体音量是不是 0（"没声音"的第一嫌疑）。
 * 读不到时返回 false —— 宁可不提示，也别乱提示。
 */
export function quiet() {
  const mv = mediaVolume();
  return !!mv && mv.max > 0 && mv.vol === 0;
}

/**
 * 系统蜂鸣（兜底）。走 STREAM_ALARM：不受媒体音量静音影响，
 * 用户按了"响铃"却因为媒体音量为 0 听不见时，这一声至少还能响。
 */
export function tone(ms) {
  // #ifdef APP-PLUS
  try {
    const AudioManager = plus.android.importClass('android.media.AudioManager');
    const ToneGenerator = plus.android.importClass('android.media.ToneGenerator');
    const STREAM_ALARM = Number(plus.android.getAttribute(AudioManager, 'STREAM_ALARM')) || 4;
    const BEEP = Number(plus.android.getAttribute(ToneGenerator, 'TONE_PROP_BEEP')) || 24;
    // 音量给满的 80%：蜂鸣本身很吵，但"叫得醒"比"好听"重要
    const tg = new ToneGenerator(STREAM_ALARM, 80);
    tg.startTone(BEEP, Math.max(120, Number(ms) || RING_MS));
    setTimeout(() => {
      try { tg.release(); } catch (e) {}
    }, Math.max(200, Number(ms) || RING_MS) + 200);
    return true;
  } catch (e) {
    return false;
  }
  // #endif
  return false;
}

/**
 * 播一次本地音频。
 * @param {string} rel '/static/sfx/correct.wav' 这类包内相对路径
 * @param {{volume?:number, fallback?:boolean, ms?:number, probe?:boolean}} opt
 *        fallback = true 时，播放失败自动补一声系统蜂鸣（默认 true）
 *        ms > 0 时只播这么长就停（给"试听"用），不传就播到完
 *        probe = true 时顺便看播放进度有没有推进（给自检用，结果放 info.advanced）
 * @param {(info:{ok:boolean, err?:any, code?:number}) => void} done
 * @returns {boolean} 是否成功发起（不代表真的出声，结果看 done）
 */
export function playOnce(rel, opt, done) {
  const o = opt || {};
  const cb = typeof done === 'function' ? done : (typeof o === 'function' ? o : null);
  const cfg = cb === o ? {} : o;
  let settled = false;
  const settle = (info) => {
    if (settled) return;
    settled = true;
    if (cb) cb(info);
  };

  let ctx = null;
  try {
    ctx = uni.createInnerAudioContext();
  } catch (e) {
    // 连实例都建不出来（平台不支持）→ 直接兜底蜂鸣
    const ok = cfg.fallback === false ? false : tone(RING_MS);
    settle({ ok, err: 'create failed', via: ok ? 'tone' : 'none' });
    return ok;
  }

  let finished = false;
  let advanced = false;   // 播放进度有没有真的往前走（唯一能间接证明"出声了"的信号）
  const finish = (info) => {
    if (finished) return;
    finished = true;
    info.advanced = advanced;
    try { ctx.destroy(); } catch (e) {}
    settle(info);
  };
  // 探测点：短音效 400ms 内必推进；这里取 200ms 采样一次。
  // 拿不到 currentTime 也不会报失败（advanced 保持 false，只是少一条佐证）。
  if (cfg.probe) {
    setTimeout(() => {
      if (finished) return;
      try { advanced = (Number(ctx.currentTime) || 0) > 0; } catch (e) {}
    }, 200);
  }

  try {
    ctx.volume = cfg.volume == null ? 1 : Number(cfg.volume) || 1;
    ctx.onCanplay(() => {
      // ⚠️ 缓冲好再播：src 刚设下去就 play()，部分安卓机会直接失败（冷启动尤其明显）
      try { ctx.play(); } catch (e) { finish({ ok: false, err: 'play threw', via: 'none' }); }
    });
    ctx.onEnded(() => finish({ ok: true, via: 'iac' }));
    ctx.onError((e) => {
      const code = e && (e.errCode != null ? e.errCode : e.code);
      const msg = (e && (e.errMsg || e.message)) || 'error';
      const ok = cfg.fallback === false ? false : tone(RING_MS);
      finish({ ok, err: msg, code, via: ok ? 'tone' : 'none' });
    });
    ctx.src = localUrl(rel);
    // 双保险：能播就播（onCanplay 在部分平台不触发，只靠它会一直不响）
    try { ctx.play(); } catch (e) {}
    // 试听：到点掐掉（不掐就变成"开了一路关不掉的背景音"）
    if (cfg.ms > 0) {
      setTimeout(() => {
        try { ctx.stop(); } catch (e) {}
        finish({ ok: true, via: 'iac', note: 'preview' });
      }, Number(cfg.ms) || 1000);
    }
    // 兜底结算：3 秒（试听则放宽到时长 + 1.5 秒）还没结束也没报错 → 认为播成了
    // （长音频/循环不适用，这里只给短音效和试听用）
    const settleMs = cfg.ms > 0 ? (Number(cfg.ms) || 1000) + 1500 : 3000;
    setTimeout(() => finish({ ok: true, via: 'iac', note: 'timeout-assumed' }), settleMs);
  } catch (e) {
    const ok = cfg.fallback === false ? false : tone(RING_MS);
    finish({ ok, err: String(e && e.message || e), via: ok ? 'tone' : 'none' });
  }
  return true;
}

/**
 * 自检：把"能不能出声"这件事一次问清楚。
 * 真机上"没声音"无非三类：媒体音量为 0、素材播不出来、压根没走播放。
 * 这里把三类全测一遍，结果直接给调用方显示。
 */
export function selfTest(cb) {
  const mv = mediaVolume();
  playOnce('/static/sfx/correct.wav', { volume: 1, probe: true }, (info) => {
    cb({
      volume: mv,                 // null = 读不到（非 App 端 / 桥异常）
      play: info,
      quiet: quiet()              // 媒体音量为 0 是最常见的"没声音"
    });
  });
}
