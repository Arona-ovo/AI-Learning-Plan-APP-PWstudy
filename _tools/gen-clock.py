# _tools/gen-clock.py - 合成「时钟滴答」环境音（秒针一下一下的滴答声）
#
# 为什么自己合成：时钟滴答是**有规律的单点瞬态**，真实录音反而不好用 ——
#   录一段钟表声要裁到"每一下都均匀、背景没有房间底噪"，很难；而这里每一下的
#   音高、衰减、间隔都能自己定，还零版权风险（与白/粉/棕噪、雨声同一条思路）。
#
# 音色设计：
#   · 每秒一下，**tick / tock 交替**（音高一个高一个低）—— 机械钟摆的听感；
#     均匀间隔 + 两种音高，不会像"电子蜂鸣器"那样一下一下戳人。
#   · 每一下 = 极短的软起音 + 阻尼正弦（tick ~2.1kHz / tock ~1.5kHz）+ 一点点
#     高频谐波 + 很轻的宽带"嗒"；整体低通到 5kHz，把刺耳的边缘压圆。
#   · 8s 一个循环（正好 8 下，1Hz 与循环长度整除），循环播放永远均匀。
#
# ⚠️ 循环接缝：**刻意不做 crossfade_loop**（与其它音色不同）。
#   交叉淡化会把"尾部"混到"头部"，而本音色的头部正好是第一下的**起音**——
#   混完第一下就被衰减掉一大截，8s 里最响的一下听不见了。
#   这里改成让循环点落在**安静处**：第一下从 t=0 起音（首样本为 0）、
#   最后一下在 7s 处早已衰减干净，8s 末尾是静音 —— 首尾都是 0，接缝天然连续。
#
# 响度口径与其它五种一致（见 noise_util / check-ambient §5.2）：
#   滴答是稀疏瞬态，峰值因子高，按 RMS 归一到 0.105（在 ±2dB 窗口内、不触 -21dB 底线），
#   峰值上限 0.95 不削波。衰减长度（tau）就是在这里定的：太短则 RMS 追不上目标，
#   放大后峰值会撞上限、整段被压下去（和第一版雨声同一个坑）。
#
# 运行：py _tools/gen-clock.py   → 写出 uniapp-PWstudy/static/noise/clock.wav

import os
import sys
import math
import random

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import noise_util as nu

OUT = os.path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise', 'clock.wav')
SR = 32000          # 滴答是高频瞬态，16k 会削掉"嗒"的锐度；32k 与雨声/沙滩一致
DUR = 8.0           # 8 下 = 1Hz，且与循环长度整除
N = int(SR * DUR)

SEED = 20261029
random.seed(SEED)

LOWPASS_HZ = 5000.0  # 整体柔化：压掉最刺耳的高频边缘（保留了滴答的"脆"）
RMS_TARGET = 0.105   # 与雨声/沙滩 0.10、白/粉/棕噪 0.12 同在一个 ±2dB 窗口


def lowpass(samples, cutoff_hz):
    """一阶低通（与 gen-rain.py 同一实现口径）。"""
    if cutoff_hz <= 0:
        return list(samples)
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff_hz / SR)
    out = [0.0] * len(samples)
    acc = 0.0
    for i, x in enumerate(samples):
        acc += a * (x - acc)
        out[i] = acc
    return out


def strike(buf, t0, freq, amp, tau):
    """在 t0 秒处打一下：软起音 + 阻尼正弦 + 轻谐波 + 极短"嗒"。"""
    start = int(t0 * SR)
    # 长度取 6 个时间常数：尾巴基本已经衰减到听不见，截断处不会形成"咔"一下
    dur = int(SR * max(0.09, 6.0 * tau))
    click_len = int(SR * 0.0025)   # 2.5ms 宽带成分，只为"脆"，不抢主体
    for i in range(dur):
        j = start + i
        if j >= len(buf):
            break
        t = i / float(SR)
        atk = 1.0 - math.exp(-t / 0.0015)   # 1.5ms 软起音，避免硬切
        env = atk * math.exp(-t / tau)
        body = math.sin(2.0 * math.pi * freq * t) \
            + 0.12 * math.sin(2.0 * math.pi * (freq * 2.7) * t + 0.8)
        sample = amp * env * body
        if i < click_len:
            # 衰减 2.5ms 的极轻噪声：机械碰击的那一下"嗒"
            sample += 0.06 * amp * (random.random() * 2.0 - 1.0) * (1.0 - i / click_len)
        buf[j] += sample


def main():
    buf = [0.0] * N
    # tick / tock 交替：高一点的那下像秒针落下，低一点的那下像回摆
    # tau 决定"响多久"：太短则 RMS 追不上 0.105（放大后撞峰值上限 → 整段变轻），
    # 这里取 48~54ms —— 一声滴答响到 0.25s 左右，像真钟表那样有余韵。
    for n in range(int(DUR)):
        if n % 2 == 0:
            strike(buf, float(n), 2100.0, 0.80, 0.048)   # tick
        else:
            strike(buf, float(n), 1500.0, 0.72, 0.054)   # tock

    buf = lowpass(buf, LOWPASS_HZ)
    buf = nu.normalize(buf, target=RMS_TARGET, peak_cap=0.95)

    # 接缝：这里**不做 crossfade_loop**（见文件头）；确认首尾确实都在静音里
    seam = nu.seam_jump(buf)
    if seam > 1.0:
        print('⚠️ 接缝偏大（%.2f×RMS）—— 检查滴答是否压到了循环点' % seam)

    nu.write_wav(OUT, buf, SR)
    nu.report('clock', OUT, buf, SR)
    print('  时钟滴答：%d 下（tick/tock 交替，1Hz），已写出 %s'
          % (int(DUR), os.path.normpath(OUT)))


if __name__ == '__main__':
    main()
