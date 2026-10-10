# _tools/gen-noise.py - 合成专注白噪音（白噪 / 粉噪 / 棕噪 / 雨声）到 uniapp/static/noise/
#
# 为什么自己合成而不是找素材（同 gen-sfx.py 的理由，再外加一条）：
#   4) 网上的"CC0 环境音"许可经常混着 Pixabay / CC-BY（要署名），
#      自己合成 == 零版权风险，随包分发不用核对任何许可。
#
# 四种音色的合成法：
#   white  白噪：均匀随机 —— "嗡"的宽带底噪，屏蔽人声最有效
#   pink   粉噪：白噪过 Paul Kellet 滤波器，能量往低频倾 —— 听感比白噪柔，公认更好听
#   brown  棕噪：白噪积分（布朗运动），只有低频轰隆 —— 像远处的海浪/飞机舱
#   rain   雨声：白噪过低通（去掉高频毛刺）+ 一点高通（去掉闷感）+ 慢速随机幅度起伏
#
# 循环无缝：loop 播放在接缝处最容易露馅 —— 生成后把结尾 X 毫秒与开头做等功率交叉淡化，
# 保证首尾样本连续，听不出接缝。
#
# 运行：python _tools/gen-noise.py
import math
import os
import random
import struct
import wave

RATE = 16000          # 采样率：噪声没有高频细节，16k 足够且省一半体积
SECONDS = 8           # 循环长度：太短听得出规律，太长费体积；8s 是甜点
XFADE_MS = 120        # 首尾交叉淡化宽度
PEAK = 0.7            # 峰值归一化目标（留 3dB 余量，配合 App 内 volume=0.6）
OUT = os.path.join(os.path.dirname(__file__), '..', 'uniapp', 'static', 'noise')


def gen_white(n):
    return [random.uniform(-1.0, 1.0) for _ in range(n)]


def gen_pink(n):
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


def gen_brown(n):
    out = []
    acc = 0.0
    for _ in range(n):
        acc += random.uniform(-1.0, 1.0)
        # 轻微泄漏防止积分漂移
        acc *= 0.998
        out.append(acc)
    return out


def gen_rain(n):
    # 白噪 → 两级一阶低通（压掉"嘶"的高频毛刺）→ 一阶高通（去掉闷底的直流感）
    # → 慢速随机幅度起伏（模拟雨势忽大忽小）
    lp1 = lp2 = hp = 0.0
    out = []
    # 幅度包络：几个不同相位的慢正弦叠加（周期错开，8 秒内不重复）
    for i in range(n):
        t = i / RATE
        w = random.uniform(-1.0, 1.0)
        lp1 += 0.22 * (w - lp1)          # 一阶低通，截止约 560Hz
        lp2 += 0.45 * (lp1 - lp2)        # 再压一档，截止约 1.8kHz 附近的坡
        hp += 0.02 * (lp2 - hp)          # 一阶高通支路（取 lp2 与慢跟随的差）
        base = lp2 - hp
        mod = 1.0 + 0.22 * (
            0.6 * math.sin(2 * math.pi * t / 5.3)
            + 0.4 * math.sin(2 * math.pi * t / 2.9 + 1.7)
        )
        out.append(base * mod)
    return out


def normalize(samples, peak=PEAK):
    m = max(1e-9, max(abs(x) for x in samples))
    k = peak / m
    return [x * k for x in samples]


def crossfade_loop(samples):
    """结尾 XFADE_MS 与开头等功率交叉淡化 → loop 接缝连续，听不出循环点"""
    f = int(RATE * XFADE_MS / 1000)
    n = len(samples)
    out = list(samples)
    for i in range(f):
        # 等功率（恒定响度）交叉：sin/cos 曲线
        a = math.sin(0.5 * math.pi * (i + 0.5) / f)
        tail = samples[n - f + i]
        head = samples[i]
        out[n - f + i] = tail * math.cos(0.5 * math.pi * (i + 0.5) / f) + head * a
    return out


def write_wav(name, samples):
    path = os.path.join(OUT, name + '.wav')
    with wave.open(path, 'wb') as f:
        f.setnchannels(1)          # 单声道：白噪音没有声场信息，立体声纯属翻倍体积
        f.setsampwidth(2)          # 16-bit
        f.setframerate(RATE)
        frames = b''.join(struct.pack('<h', max(-32768, min(32767, int(x * 32767)))) for x in samples)
        f.writeframes(frames)
    kb = os.path.getsize(path) / 1024
    print('  %-6s %6.1f KB  (%d s @ %d Hz)' % (name, kb, SECONDS, RATE))


def main():
    os.makedirs(OUT, exist_ok=True)
    n = RATE * SECONDS
    print('合成专注白噪音 →', os.path.normpath(OUT))
    write_wav('white', crossfade_loop(normalize(gen_white(n))))
    write_wav('pink', crossfade_loop(normalize(gen_pink(n))))
    write_wav('brown', crossfade_loop(normalize(gen_brown(n))))
    write_wav('rain', crossfade_loop(normalize(gen_rain(n))))
    print('完成：4 种音色，全部无缝循环。')


if __name__ == '__main__':
    main()
