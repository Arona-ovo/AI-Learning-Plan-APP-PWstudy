# _tools/build-ambient.py - 程序合成「雨声 / 沙滩海浪」两种有具体声音形象的环境音
#
# 为什么改成合成（2026-10-26）：
#   之前用的是真实录音（雨声 ezwa/pdsounds、沙滩 Jarrod stanley/CC0）。但真机反馈是
#   "雨声过于密集（像暴雨）、沙滩太连续没有一阵一阵的海浪感、整体偏吵" —— 这些是
#   **素材本身的性格**，真实录音改不了：
#     · 雨声源本身就是大雨，滤波只能把它闷成"闷暴雨"，降不了雨滴密度；
#     · 沙滩源挑的是最平稳的一段（首尾落差 0dB），天然没有涌浪的起伏。
#   要精确拿到"小雨 + 一阵一阵的海浪、学习用不吵"这种性格，只能程序合成：
#   密度（雨滴/秒）、涌浪周期、频谱滚降全部可控，且离线可播、零许可义务。
#
# 两条产线现在统一了：白/粉/棕噪是 gen-noise.py 合成，雨声/沙滩是这里合成，
#   最后三步（柔化 → RMS 归一 → 首尾交叉淡化成无缝循环）都走 noise_util，不会分叉。
#
# 产出：uniapp-PWstudy/static/noise/{rain,beach}.wav
#   PCM 单声道 16bit @ 32kHz（雨声与海浪能量都在 5kHz 以下，32k 留足余量，比 44.1k 省体积）
#
# 运行：python _tools/build-ambient.py
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import noise_util

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'uniapp-PWstudy', 'static', 'noise')
SR = 32000          # 采样率
DUR = 30.0          # 循环长度（秒）
XFADE = noise_util.XFADE_MS / 1000.0
SEED = 20261026     # 固定种子 → 每次生成一致，便于回归

# ⚠️ 换素材时这两处要一起改：这里的 SOURCES、static/noise/SOURCES.md
#    （check-ambient.js §5.5 会核对两边对得上）。
#    rain/beach 现在是程序合成（无第三方素材），license 记为 synthesized。
SOURCES = [
    {
        'kind': 'rain',
        'name': '雨声',
        'synth': True,
        'credit': '程序合成（无第三方素材，零许可义务）',
        'license': 'synthesized',
        # 电平比另外三种噪声低约 1.6dB（0.12 → 0.10）：用户两轮反馈"太吵"。
        # ⚠️ 幅度不能降太多 —— 护栏要求各音色响度极差 ≤2dB、且最轻的 ≥-21dB；
        #    0.10 = -20.0dB，白/粉/棕噪是 -18.4dB，差 1.6dB 正好落在窗口内。
        #    （真正降"吵"靠的是上面的密度/频谱，电平只做小幅配合。）
        'target': 0.10,
    },
    {
        'kind': 'beach',
        'name': '沙滩',
        'synth': True,
        'credit': '程序合成（无第三方素材，零许可义务）',
        'license': 'synthesized',
        # ⚠️ 单个大涌浪天然 crest 高（浪峰尖、浪谷深，平均能量低）：crest 6.4 时，
        #    按默认的 0.55 夹峰值会把整段压到 RMS 0.086（-21.3dB），比别的音色轻近 3dB
        #    —— 界面上完全看不出（音量条满的，就是没声）。放高到 0.8，既不夹、又能把 RMS 顶到目标值。
        #    （真实录音产线当年给雨声用过 peak_cap 0.7，同一招，先例已有。）
        'peak_cap': 0.8,
        'target': 0.10,   # 同雨声：比另外三种低 1.6dB，配合"不吵"
    },
]


def white(n):
    return [random.uniform(-1.0, 1.0) for _ in range(n)]


def lowpass(s, cutoff, sr):
    """一阶低通（与 noise_util.soften 同式，只是可以单独用）。"""
    if cutoff <= 0:
        return s
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff / sr)
    out = []
    acc = 0.0
    for x in s:
        acc += a * (x - acc)
        out.append(acc)
    return out


def synth_rain(sr, dur):
    """小雨：柔和的"沙沙"底噪 + 稀疏的短促雨滴点缀。

    关键参数（2026-10-26 二次校准：用户反馈"还是太吵、频率要舒缓、雨要稀疏"）：
      · 底噪低通到 ~1.4kHz（原 1.8k）—— 频谱再压暗一档，去掉残留的"嘶"，
        听感从"雨幕"变成更远的、蒙蒙的背景，学习时不抢注意力。
      · 雨滴 ~5 滴/秒（原 12）—— 稀疏是这个音色的主诉求；暴雨几十上百滴/秒，
        12 滴/秒仍偏密，5 滴/秒是"偶尔落几滴"的疏落感。
      · 每滴 14ms、5ms 衰减（原 12ms/3ms）—— 更钝更软，不要"嗒"的硬边。
      · ⚠️ 单滴幅度别太小：雨点能量被底噪盖住的话，听着就是一段滤波白噪，不像在下雨。
        放大到"能量约底噪的 1/3"这个量级，才有下雨的颗粒感又不盖过雨幕。
        （稀疏化之后每滴要更"冒尖"才听得见，所以幅度不跟着密度一起降。）
    """
    N = int(sr * (dur + XFADE))
    bed = lowpass(white(N), 1400.0, sr)
    drops = [0.0] * N
    rate = 5.0                       # 每秒约 5 滴 = 疏落的小雨
    i = int(random.uniform(0, sr / rate))
    while i < N:
        amp = random.uniform(0.22, 0.48)   # 稀疏了，单滴仍要够"冒尖"才听得见
        d = int(sr * 0.014)          # 雨滴长度 ~14ms（钝一点）
        dec = sr * 0.005             # 衰减时间常数 ~5ms（软一点）
        for k in range(d):
            j = i + k
            if j >= N:
                break
            drops[j] += amp * math.exp(-k / dec) * random.uniform(-1.0, 1.0)
        i += max(1, int(random.expovariate(rate) * sr))
    drops = lowpass(drops, 1100.0, sr)
    out = [bed[k] * 0.9 + drops[k] * 0.85 for k in range(N)]
    return out


def synth_beach(sr, dur):
    """一阵一阵的海浪：低频涌动主体 + 浪头才有的中高频浪花，套一个 10s 周期的涌浪包络。

    关键参数：
      · 主体 surf 低通到 ~600Hz（原 700）—— 更暗更沉，"轰轰"的体量感留下、
        把中高频的躁动压掉，这是"不吵"的主力。
      · 浪花 foam 是 1k~3.5kHz 的带通噪声，只在浪头出现（shape > 0.6 才起），
        增益压到 0.30（原 0.5）—— 浪花的"哗"是最亮最吵的部分，收敛它。
      · 涌浪包络 **15s** 一个（原 10s，用户要求"舒缓"），30s 循环正好 2 个浪，
        cycles 整除 → 接缝连续。浪与浪之间隔得更久，呼吸感更足。
      · ⚠️ 包络别用"基波 + 多次谐波叠加"求形状：那样每个谐波各自贡献一个峰，
        实测会在 10s 的浪里多出 2~3 个小峰（每 2.5s 一个），听着是乱糟糟的碎浪，
        不是"一阵一阵"。直接**按 10s 周期构造单个浪形**（35% 涌上 + 65% 退去的光滑
        不对称曲线），30s 里严格只有 3 个峰。
      · 前 35% 是涌上来（较快的 build），后 65% 是缓缓退去 —— 真海浪就是这种不对称。
      · 浪谷保留一点底噪（基值 0.10），不是完全静音的硬开关，像潮水退去后的细碎水声。
    """
    N = int(sr * (dur + XFADE))
    w = white(N)
    surf = lowpass(w, 600.0, sr)
    lp35 = lowpass(w, 3500.0, sr)
    lp10 = lowpass(w, 1000.0, sr)
    foam = [a - b for a, b in zip(lp35, lp10)]   # 带通 1k~3.5k

    out = [0.0] * N
    PERIOD = 15.0     # 一个涌浪的周期（舒缓档：30s 里 2 个浪）
    ATT = 0.35        # 周期内前 35% 是"涌上来"，后 65% 是"退下去"
    PI = math.pi
    for i in range(N):
        t = i / sr
        p = (t % PERIOD) / PERIOD
        if p < ATT:
            shape = 0.5 - 0.5 * math.cos(PI * p / ATT)            # 0 → 1 涌上来
        else:
            shape = 0.5 + 0.5 * math.cos(PI * (p - ATT) / (1.0 - ATT))  # 1 → 0 退下去
        e = 0.10 + 0.90 * shape                                  # 涌浪包络（0.10~1.0）
        foame = max(0.0, shape - 0.6) ** 1.5                     # 只在浪头起浪花
        out[i] = surf[i] * e + foam[i] * foame * 0.30
    return out


SYNTH = {'rain': synth_rain, 'beach': synth_beach}


def main():
    random.seed(SEED)
    os.makedirs(OUT, exist_ok=True)
    print('程序合成 → 环境音素材：', os.path.normpath(OUT))
    for src in SOURCES:
        kind = src['kind']
        print('[%s] %s  (%s)' % (kind, src['name'], src['credit']))
        s = SYNTH[kind](SR, DUR)
        # 合成一般没爆音，但留一步 declick 兜底（与真实录音产线一致的保险）
        s, fixed = noise_util.declick(s, SR)
        if fixed:
            print('  削掉 %d 处爆音' % fixed)
        crest = max(abs(x) for x in s) / max(1e-9, noise_util.rms(s))
        print('  合成后 crest = %.1f (%.1f dB)' % (crest, noise_util.db(crest)))
        s = noise_util.crossfade_loop(
            noise_util.normalize(s,
                                 target=src.get('target', noise_util.RMS_TARGET),
                                 peak_cap=src.get('peak_cap', noise_util.PEAK_CAP)),
            SR, noise_util.XFADE_MS)
        p = os.path.join(OUT, kind + '.wav')
        noise_util.write_wav(p, s, SR)
        noise_util.report(kind, p, s, SR)
    print('完成。已改为程序合成（离线、零许可义务）。记得同步 static/noise/SOURCES.md')


if __name__ == '__main__':
    main()
