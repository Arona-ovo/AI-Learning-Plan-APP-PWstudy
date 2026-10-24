# _tools/gen-noise.py - 合成专注白噪音的**噪声类**音色（白噪 / 粉噪 / 棕噪）
#
# ⚠️ 本脚本只合成"没有具体声音形象"的三种噪声。
#    **雨声与沙滩海浪已改用真实录音**（2026-10-24），走另一条产线：
#      _tools/build-ambient.py（从 CC0 录音裁切，详见那里的来源与许可表）。
#    原因：合成再物理化也只是"像雨"，真实录音才"是雨" —— 用户要的是后者。
#    两条产线共用 _tools/noise_util.py 的柔化 / 归口 / 交叉淡化，不会分叉。
#
# 为什么噪声类仍然自己合成：零版权风险，离线可播，且噪声本来就没有"真实采样"可言。
#
# 三种音色的合成法：
#   white  白噪：均匀随机 —— "嗡"的宽带底噪，屏蔽人声最有效
#   pink   粉噪：白噪过 Paul Kellet 滤波器，能量往低频倾 —— 听感比白噪柔，公认更好听
#   brown  棕噪：白噪积分（布朗运动），只有低频轰隆 —— 像远处的海浪/飞机舱
#
# 循环无缝：loop 播放在接缝处最容易露馅 —— 生成后把首尾做等功率交叉淡化，
# 保证循环点波形连续，听不出接缝（见 noise_util.crossfade_loop 的方向说明）。
#
# 运行：python _tools/gen-noise.py
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import noise_util

RATE = 16000          # 白/粉/棕噪采样率：噪声没有高频细节，16k 足够且省一半体积
SECONDS = 8           # 循环长度：太短听得出规律，太长费体积；8s 是甜点
XFADE_MS = 120        # 首尾交叉淡化宽度（噪声统计平稳，不需要真实录音那么宽）
OUT = os.path.join(os.path.dirname(__file__), '..', 'uniapp-PWstudy', 'static', 'noise')

# ⚠️ 柔化截止频率（2026-10-14 真机反馈"白噪音很刺耳"）
#
# 只调音量解决不了"刺"：刺耳是**高频段**的能量问题，不是整体响度问题。
# 均匀随机白噪每倍频程 +3dB，能量全堆在 3~8kHz —— 正是人耳最敏感、也最容易疲劳的区间，
# 听久了像"电视没信号"的沙沙声。参数化一阶低通把这一段压下去：
#   white  压到 3.2k：原本最刺的一个，柔化后是"远处的风声"
#   pink   压到 4.5k：本身已往低频倾，少压一点，保留掩蔽人声的能力
#   brown  不压：它只有低频，压了反而更闷
# 掩蔽效果（挡住外界说话声）主要由中低频贡献，压高频几乎不损失这个功能。
SOFTEN = {'white': 3200, 'pink': 4500, 'brown': 0}


def gen_white(n, rate=None):
    return [random.uniform(-1.0, 1.0) for _ in range(n)]


def gen_pink(n, rate=None):
    # Paul Kellet 的经典经济型粉噪滤波器
    b0 = b1 = b2 = b3 = b4 = b5 = b6 = 0.0
    out = []
    for _ in range(n):
        w = random.uniform(-1.0, 1.0)
        b0 = 0.99886 * b0 + w * 0.0555179
        b1 = 0.99332 * b1 + w * 0.0750759
        b2 = 0.96900 * b2 + w * 0.1538520
        b3 = 0.86650 * b3 + w * 0.3104856
        b4 = 0.55000 * b4 + w * 0.5329522
        b5 = -0.7616 * b5 - w * 0.0168980
        out.append(b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362)
        b6 = w * 0.115926
    return out


def gen_brown(n, rate=None):
    out = []
    acc = 0.0
    for _ in range(n):
        acc += random.uniform(-1.0, 1.0)
        # 轻微泄漏防止积分漂移
        acc *= 0.998
        out.append(acc)
    return out


def build(name, gen, rate=RATE, seconds=SECONDS):
    """合成 → 柔化高频 → RMS 归一 → 首尾交叉淡化"""
    raw = gen(int(rate * seconds), rate)
    soft = noise_util.soften(raw, SOFTEN.get(name, 0), rate)
    return noise_util.crossfade_loop(noise_util.normalize(soft), rate, XFADE_MS)


def main():
    os.makedirs(OUT, exist_ok=True)
    print('合成噪声类白噪音 →', os.path.normpath(OUT))
    for name, gen in (('white', gen_white), ('pink', gen_pink), ('brown', gen_brown)):
        s = build(name, gen)
        p = os.path.join(OUT, name + '.wav')
        noise_util.write_wav(p, s, RATE)
        noise_util.report(name, p, s, RATE)
    print('完成：3 种噪声音色（雨声 / 沙滩海浪见 build-ambient.py）。')


if __name__ == '__main__':
    main()
