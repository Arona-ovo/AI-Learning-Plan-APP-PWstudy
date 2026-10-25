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
    },
    {
        'kind': 'beach',
        'name': '沙滩',
        'synth': True,
        'credit': '程序合成（无第三方素材，零许可义务）',
        'license': 'synthesized',
        # ⚠️ 单个大涌浪天然 crest 高（浪峰尖、浪谷深，平均能量低）：crest 6.4 时，
        #    按默认的 0.55 夹峰值会把整段压到 RMS 0.086（-21.3dB），比别的音色轻近 3dB
        #    —— 界面上完全看不出（音量条满的，就是没声）。放高到 0.8，既不夹、又能把 RMS 顶到 0.12。
        #    （真实录音产线当年给雨声用过 peak_cap 0.7，同一招，先例已有。）
        'peak_cap': 0.8,
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

    关键参数：
      · 底噪低通到 ~1.8kHz —— 去掉大雨那种刺耳的高频"嘶"，留下温润的雨幕声。
      · 雨滴 ~12 滴/秒（指数间隔，不机械）—— 细雨是连绵细密但每滴极轻的"沙沙"，
        暴雨是几十上百滴/秒还带大颗的"啪";两者密度差一个数量级。
      · 每滴是 12ms 的滤波噪声短脉冲（3ms 快衰减），是"沙/嗒"而不是正弦"叮咚"。
      · ⚠️ 单滴幅度别太小：雨点能量被底噪盖住的话，听着就是一段滤波白噪，不像在下雨。
        放大到"能量约底噪的 1/3"这个量级，才有下雨的颗粒感又不盖过雨幕。
    """
    N = int(sr * (dur + XFADE))
    bed = lowpass(white(N), 1800.0, sr)
    drops = [0.0] * N
    rate = 12.0                      # 每秒约 12 滴 = 细雨
    i = int(random.uniform(0, sr / rate))
    while i < N:
        amp = random.uniform(0.25, 0.55)   # 单滴够轻（细雨），但要够"冒尖"才听得见
        d = int(sr * 0.012)          # 雨滴长度 ~12ms（短促）
        dec = sr * 0.003             # 衰减时间常数 ~3ms
        for k in range(d):
            j = i + k
            if j >= N:
                break
            drops[j] += amp * math.exp(-k / dec) * random.uniform(-1.0, 1.0)
        i += max(1, int(random.expovariate(rate) * sr))
    drops = lowpass(drops, 1500.0, sr)
    out = [bed[k] * 0.9 + drops[k] * 1.0 for k in range(N)]
    return out


def synth_beach(sr, dur):
    """一阵一阵的海浪：低频涌动主体 + 浪头才有的中高频浪花，套一个 10s 周期的涌浪包络。

    关键参数：
      · 主体 surf 低通到 ~700Hz —— 海浪的低频"轰轰" body，不刺耳。
      · 浪花 foam 是 1k~3.5kHz 的带通噪声，只在浪头出现（f > 0.55 才起）。
      · 涌浪包络 10s 一个，30s 循环正好 3 个浪， cycles 整除 → 接缝连续。
      · ⚠️ 包络别用"基波 + 多次谐波叠加"求形状：那样每个谐波各自贡献一个峰，
        实测会在 10s 的浪里多出 2~3 个小峰（每 2.5s 一个），听着是乱糟糟的碎浪，
        不是"一阵一阵"。直接**按 10s 周期构造单个浪形**（35% 涌上 + 65% 退去的光滑
        不对称曲线），30s 里严格只有 3 个峰。
      · 前 35% 是涌上来（较快的 build），后 65% 是缓缓退去 —— 真海浪就是这种不对称。
      · 浪谷保留一点底噪（基值 0.10），不是完全静音的硬开关，像潮水退去后的细碎水声。
    """
    N = int(sr * (dur + XFADE))
    w = white(N)
    surf = lowpass(w, 700.0, sr)
    lp35 = lowpass(w, 3500.0, sr)
    lp10 = lowpass(w, 1000.0, sr)
    foam = [a - b for a, b in zip(lp35, lp10)]   # 带通 1k~3.5k

    out = [0.0] * N
    PERIOD = 10.0     # 一个涌浪的周期
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
        foame = max(0.0, shape - 0.55) ** 1.5                    # 只在浪头起浪花
        out[i] = surf[i] * e + foam[i] * foame * 0.5
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
            noise_util.normalize(s, peak_cap=src.get('peak_cap', noise_util.PEAK_CAP)),
            SR, noise_util.XFADE_MS)
        p = os.path.join(OUT, kind + '.wav')
        noise_util.write_wav(p, s, SR)
        noise_util.report(kind, p, s, SR)
    print('完成。已改为程序合成（离线、零许可义务）。记得同步 static/noise/SOURCES.md')


if __name__ == '__main__':
    main()
