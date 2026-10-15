# _tools/gen-noise.py - 合成专注白噪音（白噪 / 粉噪 / 棕噪 / 雨声）到 uniapp-PWstudy/static/noise/
#
# 为什么自己合成而不是找素材（同 gen-sfx.py 的理由，再外加一条）：
#   4) 网上的"CC0 环境音"许可经常混着 Pixabay / CC-BY（要署名），
#      自己合成 == 零版权风险，随包分发不用核对任何许可。
#
# 四种音色的合成法：
#   white  白噪：均匀随机 —— "嗡"的宽带底噪，屏蔽人声最有效
#   pink   粉噪：白噪过 Paul Kellet 滤波器，能量往低频倾 —— 听感比白噪柔，公认更好听
#   brown  棕噪：白噪积分（布朗运动），只有低频轰隆 —— 像远处的海浪/飞机舱
#   rain   雨声：物理化模型 —— 共振雨滴"嗒" + 44.1k 自然雨幕 + 阵风起伏（见 gen_rain）
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

RATE = 16000          # 白/粉/棕噪采样率：噪声没有高频细节，16k 足够且省一半体积
SECONDS = 8           # 循环长度：太短听得出规律，太长费体积；8s 是甜点
XFADE_MS = 120        # 首尾交叉淡化宽度
# ⚠️ 雨声单独用更高采样率 + 更长循环：
#   雨声的细密沙沙在 8k 以上还有能量，16k 会发闷、像电话线；44.1k 才"润"。
#   更长循环（20s）让雨势/雨滴的随机性更不容易听出循环点。
RAIN_RATE = 44100
RAIN_SECONDS = 20
PEAK = 0.55           # 峰值归一化目标（见下：响度交给 App 内 volume，素材只管不削波）
OUT = os.path.join(os.path.dirname(__file__), '..', 'uniapp-PWstudy', 'static', 'noise')

# ⚠️ 柔化截止频率（2026-10-14 真机反馈"白噪音很刺耳"）
#
# 只调音量解决不了"刺"：刺耳是**高频段**的能量问题，不是整体响度问题。
# 均匀随机白噪每倍频程 +3dB，能量全堆在 3~8kHz —— 正是人耳最敏感、也最容易疲劳的区间，
# 听久了像"电视没信号"的沙沙声。参数化一阶低通把这一段压下去：
#   white  压到 3.2k：原本最刺的一个，柔化后是"远处的风声"
#   pink   压到 4.5k：本身已往低频倾，少压一点，保留掩蔽人声的能力
#   brown  不压：它只有低频，压了反而更闷
#   rain   不额外压：2026-10-16 改成物理化雨声模型（共振雨滴"嗒" + 44.1k 雨幕）。
#          雨幕自己已在 11k 做一阶自然滚降（正是真实雨声的高频倾斜），不再叠低通；
#          旧版"刺耳"来自带限噪声雨滴，新版改共振正弦"嗒"后那一层已无，无需再压。
# 掩蔽效果（挡住外界说话声）主要由中低频贡献，压高频几乎不损失这个功能。
SOFTEN = {'white': 3200, 'pink': 4500, 'brown': 0, 'rain': 0}


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


# ⚠️ 雨声：物理化模型（2026-10-16 重写，解决"像雨但不是雨 / 刺耳"）
#
# 旧版为什么一听就是假的：雨滴用的是**带限噪声咔哒**（1800~4200Hz 的噪声小爆发），
# 那听感是"咔哒咔哒"的静电，不是水滴打在东西上的"嗒"。真实雨滴是一个个**有共振的
# 衰减音**（打在叶面/地面/棚顶各有不同音高），缺了这个，再怎么滤波都只是"滤过的噪声"。
#
# 新版四层（采样率提到 44.1k：雨幕的细沙在 8k 以上还有能量，16k 会发闷）：
#   ① 雨幕 hiss：白噪 → 去低频(>350Hz，去掉"风感") → 一阶低通(~6.5k) 做自然高频滚降
#      （真实雨声能量随频率约 -6dB/oct 衰减，不是"全高频刺耳"也不是"低频风声"）
#   ② 雨滴瞬态：泊松过程触发的一颗颗"嗒"——每颗 = 指数衰减的**共振正弦**(随机音高/衰减)
#      + 极短噪声冲击(砸到表面的"啪")。共振正弦才有"打在东西上"的颗粒感，这是关键。
#   ③ 雨势起伏：周期**恰好整除循环长度**的慢正弦叠加 → 整体强度像阵风一样缓慢呼吸，
#      且在循环接缝处连续（不会"咕咚"一下）。
#   ④ 极低频"厚度"：一点点 <150Hz 棕噪垫底，避免发飘。
def gen_rain(n, rate):
    TWO_PI = 2.0 * math.pi
    a_hp = math.exp(-TWO_PI * 350.0 / rate)       # 去低频风感（一阶高通 = DC 阻断器，截止 350Hz）
    a_lp = 1.0 - math.exp(-TWO_PI * 8500.0 / rate)    # 雨幕自然高频滚降（~8.5k 一阶 = 雨声真实的高频倾斜，重心落到自然区间）
    a_body = 1.0 - math.exp(-TWO_PI * 150.0 / rate)   # 极低频厚度

    DROP_RATE = 170.0                  # 雨滴密度（颗/秒，与采样率无关）
    p_drop = DROP_RATE / rate

    loop_s = float(n) / rate           # 循环时长（秒）：起伏周期整除它 → 接缝连续

    # ① 雨幕 + ④ 厚度：逐样本滤波（标准一阶高通 → 两级级联一阶低通，状态跨样本累积）
    hiss = [0.0] * n
    hp = 0.0
    w_prev = 0.0
    lp1 = 0.0
    lp2 = 0.0
    body = 0.0
    for i in range(n):
        w = random.uniform(-1.0, 1.0)
        hp = a_hp * hp + (w - w_prev)        # 一阶高通（去风感，保留 350Hz 以上）
        w_prev = w
        lp1 += a_lp * (hp - lp1)             # 一阶低通①
        lp2 += a_lp * (lp1 - lp2)            # 一阶低通②（级联 → -12dB/oct，高频滚降更自然，雨声不是全高频）
        hiss[i] = lp2
        body += a_body * (w - body)

    # ② 雨滴：泊松触发，每颗直接写进 drops 缓冲（共振衰减正弦 + 起点噪声冲击）
    drops = [0.0] * n
    for i in range(n):
        if random.random() < p_drop:
            size = random.random()                  # 0=小滴 1=大滴
            f0 = 700.0 + size * 2600.0              # 大滴低频、小滴高频：700~3300 Hz
            amp = 0.25 + (1.0 - size) * 0.85       # 大滴更响
            tau = 0.004 + (1.0 - size) * 0.022      # 衰减 4~26 ms（大滴"嗒"更拖）
            phase = random.uniform(0.0, TWO_PI)
            L = int(6.0 * tau * rate) + 1
            for j in range(L):
                k = i + j
                if k >= n:
                    break
                age = j / rate
                env = math.exp(-age / tau)
                # 指数衰减的共振正弦：随机相位让起点有突兀的"嗒"，不需要叠白噪爆破
                # （白噪冲击是全带宽的，会抬高重心、显得刺，真实雨滴是共振体感不是噪声）
                s = amp * env * math.sin(TWO_PI * f0 * age + phase)
                drops[k] += s

    # ③ 合成 + 慢起伏调制（周期整除 loop_s → 循环点连续）
    out = [0.0] * n
    for i in range(n):
        t = i / rate
        gust = 1.0 + 0.18 * (
            0.5 * math.sin(TWO_PI * t / loop_s)
            + 0.3 * math.sin(TWO_PI * t / (loop_s / 2.0) + 1.1)
            + 0.2 * math.sin(TWO_PI * t / (loop_s / 3.0) + 2.3)
        )
        # 雨幕为主（铺满 1~11k 的"雨床"），雨滴是叠在上面的颗粒纹理，低频厚度垫底
        out[i] = (1.00 * hiss[i] + 0.40 * drops[i] + 0.05 * body) * gust
    return out


def soften(samples, cutoff_hz, rate=RATE):
    """一阶低通：压掉最刺耳的高频段（cutoff_hz <= 0 表示不处理）"""
    if cutoff_hz <= 0:
        return samples
    # 一阶 RC：系数由截止频率与采样率推出
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff_hz / rate)
    out = []
    acc = 0.0
    for x in samples:
        acc += a * (x - acc)
        out.append(acc)
    return out


RMS_TARGET = 0.12      # 统一的目标平均电平（听感响度由 RMS 决定，不是峰值）

def normalize(samples, rms=RMS_TARGET, peak_cap=PEAK):
    """按 RMS 归一，再夹峰值。
    ⚠️ 为什么不是按峰值：白噪的峰值因子只有 3~4dB，同样峰值下平均能量比粉噪/雨声高
       近一倍 —— 按峰值归一的结果就是"切到白噪突然变吵一倍"。按 RMS 归一才能让
       四种音色听起来一样响，切换音色不会有落差。"""
    cur = math.sqrt(sum(x * x for x in samples) / max(1, len(samples)))
    k = rms / max(1e-9, cur)
    out = [x * k for x in samples]
    m = max(1e-9, max(abs(x) for x in out))
    if m > peak_cap:
        k2 = peak_cap / m
        out = [x * k2 for x in out]
    return out


def crossfade_loop(samples, rate=RATE):
    """结尾 XFADE_MS 与开头等功率交叉淡化 → loop 接缝连续，听不出循环点"""
    f = int(rate * XFADE_MS / 1000)
    n = len(samples)
    out = list(samples)
    for i in range(f):
        # 等功率（恒定响度）交叉：sin/cos 曲线
        a = math.sin(0.5 * math.pi * (i + 0.5) / f)
        tail = samples[n - f + i]
        head = samples[i]
        out[n - f + i] = tail * math.cos(0.5 * math.pi * (i + 0.5) / f) + head * a
    return out


def write_wav(name, samples, rate=RATE):
    path = os.path.join(OUT, name + '.wav')
    with wave.open(path, 'wb') as f:
        f.setnchannels(1)          # 单声道：白噪音没有声场信息，立体声纯属翻倍体积
        f.setsampwidth(2)          # 16-bit
        f.setframerate(rate)
        frames = b''.join(struct.pack('<h', max(-32768, min(32767, int(x * 32767)))) for x in samples)
        f.writeframes(frames)
    kb = os.path.getsize(path) / 1024
    dur = len(samples) / rate
    print('  %-6s %6.1f KB  (%d s @ %d Hz)' % (name, kb, int(dur), rate))


def build(name, gen, rate=RATE, seconds=SECONDS):
    """合成 → 柔化高频 → 峰值归一化 → 首尾交叉淡化"""
    raw = gen(int(rate * seconds), rate)
    soft = soften(raw, SOFTEN.get(name, 0), rate)
    return crossfade_loop(normalize(soft), rate)


def main():
    os.makedirs(OUT, exist_ok=True)
    print('合成专注白噪音 →', os.path.normpath(OUT))
    write_wav('white', build('white', gen_white))
    write_wav('pink', build('pink', gen_pink))
    write_wav('brown', build('brown', gen_brown))
    write_wav('rain', build('rain', gen_rain, RAIN_RATE, RAIN_SECONDS), RAIN_RATE)
    print('完成：4 种音色，全部无缝循环（高频已按 SOFTEN 柔化；雨声为 44.1k 物理化模型）。')


if __name__ == '__main__':
    main()
