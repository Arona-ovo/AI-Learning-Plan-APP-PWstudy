# _tools/noise-util.py - 白噪音素材的共用处理（合成产线与真实录音产线都用这几步）
#
# 为什么单独抽一份：白噪音现在有两条产线 ——
#   gen-noise.py      合成白噪 / 粉噪 / 棕噪
#   build-ambient.py  从真实录音裁雨声 / 沙滩海浪
# 两条线最后三步完全一样（柔化 → RMS 归一 → 首尾交叉淡化），各写一份必然分叉：
# 比如一边改了归一口径，另一边的音色就突然比别的所有音色响一倍（这正是 RMS 归一要防的事）。
#
# 只有这一个实现，两条产线 import 它。

import math
import struct
import wave

RMS_TARGET = 0.12   # 统一目标平均电平（听感响度由 RMS 决定，不是峰值）
PEAK_CAP = 0.55     # 峰值上限（素材只管不削波，听感响度交给 App 内 volume）
XFADE_MS = 250      # 首尾交叉淡化宽度（真实录音用，见 crossfade_loop 的说明）


def rms(samples):
    if not samples:
        return 0.0
    return math.sqrt(sum(x * x for x in samples) / len(samples))


def db(x):
    return 20.0 * math.log10(max(1e-9, x))


def soften(samples, cutoff_hz, rate):
    """一阶低通：压掉最刺耳的高频段（cutoff_hz <= 0 表示不处理）"""
    if cutoff_hz <= 0:
        return samples
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff_hz / rate)
    out = []
    acc = 0.0
    for x in samples:
        acc += a * (x - acc)
        out.append(acc)
    return out


def normalize(samples, target=RMS_TARGET, peak_cap=PEAK_CAP):
    """按 RMS 归一，再夹峰值。

    ⚠️ 为什么不是按峰值：白噪的峰值因子只有 3~4dB，同样峰值下平均能量比粉噪/雨声高
       近一倍 —— 按峰值归一的结果就是"切到白噪突然变吵一倍"。按 RMS 归一才能让
       各种音色听起来一样响，切换音色不会有落差。"""
    cur = rms(samples)
    k = target / max(1e-9, cur)
    out = [x * k for x in samples]
    m = max(1e-9, max(abs(x) for x in out))
    if m > peak_cap:
        k2 = peak_cap / m
        out = [x * k2 for x in out]
    return out


def declick(samples, rate, thresh_ratio=8.0, max_ms=1.5, ratio=8.0):
    """削掉孤立的窄爆音（一滴雨正打在麦克风上、录音时的数字故障那种）。

    ⚠️ 为什么非削不可（2026-10-24 实锤）：
      白噪音是按 RMS 归一的，而归一后还要夹一次峰值上限。只要素材里有一个 -8dB 的
      尖脉冲，夹峰值就会把**整段**压下去十几 dB —— 结果这个音色比别的轻一大截：
      第一版雨声 RMS 只剩 0.019（目标 0.12，差 16dB），开到最大也基本听不见，
      而界面上看不出任何异常（音量条是满的，就是没声）。这种"没报错但没声音"
      最难受，所以削峰必须是产线里的一步，不能靠"挑素材时运气好"。

    ⚠️ 阈值为什么是**相对 RMS** 而不是绝对值：
      素材的录音电平差异极大（这次两个源一个 RMS -39.9dB、一个 -14.2dB）。
      写死 0.15 的话，安静的那份一个也抓不到，响的那份会抓到一大堆正常瞬态。

    判据用**窄**而不是**响**：
      响的瞬态里有正常内容（雨滴打在叶子上的"嗒"是 4~26ms 的共振衰减，那是雨声的灵魂）；
      真正的爆音是 <1.5ms 的孤脉冲。所以两个条件都要满足才动它：
        ① 连续段 ≤ max_ms
        ② 段内峰值 ≥ ratio × 段外邻域 RMS
      宁可放过几个可疑的，也不能把雨滴的"嗒"削平。

    @returns (处理后的样本, 削掉的段数)
    """
    n = len(samples)
    if n < 8:
        return samples, 0
    span = int(rate * max_ms / 1000.0)
    # ① 先把"超标样本"找出来聚成段（相对 RMS，一般只有几十个）
    thresh = thresh_ratio * rms(samples)
    hot = [i for i in range(n) if abs(samples[i]) >= thresh]
    if not hot:
        return samples, 0
    segs = []
    cur = [hot[0]]
    for i in hot[1:]:
        if i - cur[-1] <= 2:      # 间隔 ≤2 样本算同一段
            cur.append(i)
        else:
            segs.append(cur); cur = [i]
    segs.append(cur)

    def local_rms(i0, i1):
        """段外邻域 RMS（左右各取 20ms，不含段本身）"""
        w = int(rate * 0.02)
        vals = []
        for j in range(max(0, i0 - w), i0):
            vals.append(samples[j])
        for j in range(i1 + 1, min(n, i1 + 1 + w)):
            vals.append(samples[j])
        if not vals:
            return 0.0
        return rms(vals)

    out = list(samples)
    fixed = 0
    for seg in segs:
        i0, i1 = seg[0], seg[-1]
        if i1 - i0 + 1 > span:
            continue                      # 够宽 = 正常瞬态，不是爆音
        peak = max(abs(samples[i]) for i in seg)
        if peak < ratio * max(1e-9, local_rms(i0, i1)):
            continue                      # 相对周围不够突出
        # 线性插值填掉：用段两侧各一个干净样本拉一条直线
        a = samples[i0 - 1] if i0 > 0 else 0.0
        b = samples[i1 + 1] if i1 + 1 < n else 0.0
        m = i1 - i0 + 2
        for k, i in enumerate(range(i0, i1 + 1)):
            out[i] = a + (b - a) * (k + 1) / m
        fixed += 1
    return out, fixed


def crossfade_loop(samples, rate, ms=XFADE_MS):
    """把**尾部** f 个样本交叉淡化到**头部** → 循环点连续。

    ⚠️ 方向不能反（2026-10-24 修正，真实录音上线时发现的）：
      循环播放的接缝是 out[n-1] → out[0]。要让这一对连续，就得让 out[0] 附近
      **带着尾部的尾巴**，所以混合必须发生在**头部**：
          out[i] = raw[i]*渐入 + raw[n+i]*渐出      （i ∈ [0, f)）
      这样 out[0] ≈ raw[n]，正好接在 out[n-1] = raw[n-1] 之后 —— 波形连续。
      反过来"把开头混到结尾"（旧实现）得到的是 out[n-1] ≈ raw[f-1]，
      接回 out[0] = raw[0] 仍是一次样本级跳变，只是整体电平不突变而已。
      对统计平稳的合成噪声（白/粉/棕/雨幕）这点跳变听不出来，
      但对有明显波形的真实录音（海浪一波一波、雨势起伏）就是接缝处"啪"一下。

      等功率（sin/cos）交叉：两段信号不相关时 sin²+cos²=1，响度不会在交叉区塌陷。

    @returns 长度 = len(samples) - f 的循环样本
    """
    f = int(rate * ms / 1000)
    n = len(samples) - f
    if n <= f:
        raise ValueError('素材太短，做不了 %dms 交叉淡化（需要 > %d 样本）' % (ms, 2 * f))
    out = list(samples[:n])
    for i in range(f):
        th = 0.5 * math.pi * (i + 0.5) / f
        out[i] = samples[i] * math.sin(th) + samples[n + i] * math.cos(th)
    return out


def seam_jump(samples):
    """循环接缝的样本级跳变（相对 RMS 的倍数）。

    这是"接缝会不会啪一下"的客观指标：循环播放时 out[n-1] 后面紧跟 out[0]，
    两者差值越大越像爆音。随机噪声相邻样本差约 1.4 倍 RMS，
    所以 ≤4 倍基本听不出来；真实录音忘了做交叉淡化时往往能到十几倍。"""
    if len(samples) < 2:
        return 0.0
    return abs(samples[0] - samples[-1]) / max(1e-9, rms(samples))


def write_wav(path, samples, rate):
    with wave.open(path, 'wb') as f:
        f.setnchannels(1)          # 单声道：环境音没有声场信息，立体声纯属翻倍体积
        f.setsampwidth(2)          # 16-bit
        f.setframerate(rate)
        frames = b''.join(
            struct.pack('<h', max(-32768, min(32767, int(x * 32767)))) for x in samples)
        f.writeframes(frames)


def report(name, path, samples, rate):
    import os
    kb = os.path.getsize(path) / 1024.0
    print('  %-6s %6.1f KB  (%.1f s @ %d Hz)  RMS %.4f (%s dB)  峰值 %.2f  接缝 %.2f×RMS'
          % (name, kb, len(samples) / float(rate), rate,
             rms(samples), ('%.1f' % db(rms(samples))),
             max(abs(x) for x in samples), seam_jump(samples)))
