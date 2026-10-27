# _tools/gen-rain.py - 合成「稀疏平缓」的雨声（替代原来偏吵的真实录音）
#
# 背景：用户反馈原来的雨声（AMB Rain Loop 1，真实录音）「太嘈杂」，要更稀、更平。
# 真实录音的性格改不了（密度/频谱都是固定的），而合成可以完全控制密度与柔和度，
# 且零版权风险（与白/粉/棕噪同一条思路）。所以雨声改用本脚本合成，沙滩仍走
# build-ambient.py 的真实录音产线。
#
# 音色设计（稀疏 + 平缓）：
#   · 一层很轻的低通「雨幕底噪」（远处雨声的嘶嘶底），RMS 占比小、不过密；
#   · 稀疏的水珠瞬态：低平均密度（约 6~10 滴/秒，且带随机间隙），每滴是很短的
#     软起音衰减正弦（600~2200Hz 随机）+ 一点点极轻的宽带"嗒"，峰值克制；
#   · 整体再低通一遍（~3.5kHz）把刺耳高频压掉 → 平缓；
#   · 一条很慢的幅度调制（LFO）让它有一点"雨势起伏"但不忙。
#
# 与既有产线同一套口径（见 noise_util）：RMS 归一到 0.10（与白/粉/棕噪 0.12 差 1.6dB，
# 在 check-ambient §5.2 的 ±2dB 窗口内）、峰值 ≤0.95 不削波、首尾交叉淡化成无缝循环、
# 32k 单声道 16bit（安卓 MediaPlayer 认得稳）。
#
# 运行：python3 _tools/gen-rain.py   → 写出 uniapp-PWstudy/static/noise/rain.wav

import os
import sys
import math
import random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import noise_util as nu

OUT = os.path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise', 'rain.wav')
SR = 32000
DUR = 30.0
N = int(SR * DUR)

SEED = 20261026
random.seed(SEED)


def lowpass(samples, cutoff_hz):
    """一阶低通（复用 noise_util.soften 的思路，但返回新列表）。"""
    if cutoff_hz <= 0:
        return list(samples)
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff_hz / SR)
    out = []
    acc = 0.0
    for x in samples:
        acc += a * (x - acc)
        out.append(acc)
    return out


def main():
    # ---------- ① 雨幕底噪：低通的宽带噪声，很轻、不过密 ----------
    bed_rms_target = 0.05
    bed = [0.0] * N
    # 用 Box-Muller 生成高斯白噪（比均匀随机更"柔"，没有均匀分布的方波感）
    g = 0
    while g < N:
        u1 = random.random() or 1e-9
        u2 = random.random()
        z0 = math.sqrt(-2.0 * math.log(u1)) * math.cos(2.0 * math.pi * u2)
        bed[g] = z0
        g += 1
        if g < N:
            z1 = math.sqrt(-2.0 * math.log(u1)) * math.sin(2.0 * math.pi * u2)
            bed[g] = z1
            g += 1
    # 床先低通到 ~1.2kHz，再按目标 RMS 缩放
    bed = lowpass(bed, 1200.0)
    cur = math.sqrt(sum(x * x for x in bed) / N)
    k = bed_rms_target / max(1e-9, cur)
    bed = [x * k for x in bed]

    # ---------- ② 稀疏水珠瞬态 ----------
    # 平均密度偏低（稀疏）；用指数分布造随机间隙，避免"机械等距"。
    mean_gap = 1.0 / 8.0  # 平均每秒约 8 滴（比真实中雨稀）
    pos = random.expovariate(1.0 / (mean_gap * SR))  # 第一滴的位置（样本）
    drop_rms_target = 0.085  # 水珠整体贡献略高于床，但每滴克制
    drop_hits = 0
    while pos < N - 4000:
        f = random.uniform(600.0, 2200.0)                 # 水珠音高随机
        dur = int(random.uniform(0.020, 0.060) * SR)      # 衰减长度 20~60ms
        tau = dur / 3.0                                   # 衰减时间常数
        attack = int(random.uniform(0.002, 0.004) * SR)   # 软起音 2~4ms
        amp = random.uniform(0.18, 0.40)                  # 单滴峰值（克制）
        tick = random.uniform(0.04, 0.12)                 # 一点点宽带"嗒"
        ph = random.uniform(0, 2 * math.pi)
        for i in range(dur):
            if pos + i >= N:
                break
            env = math.exp(-i / tau)
            atk = 1.0 if i >= attack else (i / attack)
            s = amp * env * atk * math.sin(2.0 * math.pi * f * i / SR + ph)
            # 极轻的宽带成分（雨珠打在面上的细碎感），不抢主音
            s += tick * env * atk * (random.random() * 2 - 1)
            bed[int(pos) + i] += s
        drop_hits += 1
        pos += random.expovariate(1.0 / (mean_gap * SR))

    # ---------- ③ 很慢的幅度调制（雨势起伏，但不忙）----------
    lfo_hz = 0.05  # 20 秒一个周期
    mod = []
    for i in range(N):
        mod.append(1.0 + 0.12 * math.sin(2.0 * math.pi * lfo_hz * i / SR))
    bed = [bed[i] * mod[i] for i in range(N)]

    # ---------- ④ 整体再低通一遍 → 平缓 ----------
    bed = lowpass(bed, 3500.0)

    # ---------- ⑤ 归一（RMS→0.10，峰值≤0.95）+ 削孤立爆音 + 无缝循环 ----------
    bed, fixed = nu.declick(bed, SR)
    bed = nu.normalize(bed, target=0.10, peak_cap=0.95)
    bed = nu.crossfade_loop(bed, SR)

    nu.write_wav(OUT, bed, SR)
    nu.report('rain', OUT, bed, SR)
    print('  合成雨声：%d 滴水珠瞬态，RMS 归一到 0.10' % drop_hits)
    print('  已写出 %s' % OUT)


if __name__ == '__main__':
    main()
