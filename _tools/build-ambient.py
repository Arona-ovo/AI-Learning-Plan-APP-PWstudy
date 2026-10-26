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
        # ⚠️ 雨点是 2~4ms 的极短爆音，crest 高达 8.5（比平稳噪声高一大截）。
        #    默认的 0.55 峰值夹会把整段增益压垮 → RMS 掉到 -23.8dB（破护栏下限）。
        #    放宽到 0.85（同沙滩 0.8 一个道理）—— 0.85 仍是短暂瞬态、不削波，
        #    归一后 RMS 能稳在目标 0.10。
        'peak_cap': 0.95,
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
    """小雨：明亮会起伏的"雨幕嘶声" + 稀疏有音高的"叮/嗒"雨点。

    为什么这次更像真雨、不再"像噪音"（踩了好几轮坑的总结）：
      之前三版都栽在「保留了一层稳态嘶声底」—— 那层底不管怎么调截止频率，都是
      "一段会被缓慢调幅的宽带噪声"，人耳一听就是"合成噪音"。真雨不是一段噪音，
      真雨的声音主体是**无数水珠打在表面连成的噼啪**，以及**一颗颗有明确音高的
      水珠声**。所以这一版：
      · 雨幕嘶声改成 2~7kHz 的明亮带通（真雨那种高频"沙——"，不是 1.4k 闷哼），
        电平只给 0.08，只是"雨场"的底色；
      · ⭐ 雨点用**阻尼正弦**（每滴一个 700~1900Hz 的"叮/嗒"，有音高、会衰减），
        不是噪声爆 —— 有音高的水珠声才是"像雨而非像噪音"的分水岭；
      · 雨点稀疏（~2~5 滴/秒，用户要的"更疏"），间隙长 → 疏落感；
      · 雨幕的强弱用「多个互质周期正弦 + 慢随机游走」调制，破"频率太固定"
        （不再是干净的周期呼吸，听着是自然的时强时弱）。
    """
    N = int(sr * (dur + XFADE))
    TWO_PI = 2.0 * math.pi
    w = white(N)
    # 雨幕"嘶声"：带通 2k~7k 的明亮宽带噪声（真雨的高频嘶，不是闷哼）
    lp7k = lowpass(w, 7000.0, sr)
    lp2k = lowpass(w, 2000.0, sr)
    hiss = [a - b for a, b in zip(lp7k, lp2k)]
    # 不规则调制：多个互质周期正弦 + 慢随机游走 → 雨势时强时弱，不机械
    walk = 0.0
    env = []
    for i in range(N):
        t = i / sr
        s = (0.6 * math.sin(TWO_PI * t / 7.3)
             + 0.3 * math.sin(TWO_PI * t / 11.0 + 1.0)
             + 0.2 * math.sin(TWO_PI * t / 4.1 + 2.0))
        walk += random.uniform(-0.004, 0.004)
        walk = max(-0.3, min(0.3, walk))
        env.append(max(0.35, 0.75 + 0.18 * s + 0.12 * walk))
    # 稀疏的"雨点"：阻尼正弦（有音高的水珠声，不是噪声爆）
    drops = [0.0] * N
    t = random.uniform(0.1, 0.5)
    while t < dur + XFADE:
        bi = int(t * sr)
        f = random.uniform(700.0, 1900.0)       # 每滴音高不同
        amp = random.uniform(0.12, 0.30)
        d = int(sr * random.uniform(0.004, 0.010))
        dec = sr * 0.004                        # 衰减时间常数 4ms
        for k in range(d):
            j = bi + k
            if j >= N:
                break
            drops[j] += amp * math.exp(-k / dec) * math.sin(TWO_PI * f * k / sr)
        t += random.uniform(0.18, 0.55)         # ~2~5 滴/秒（疏落）
    drops = lowpass(drops, 4000.0, sr)
    out = [hiss[i] * 0.10 * env[i] + drops[i] * 0.7 for i in range(N)]
    # 软限幅（K=3）：压尖峰、抬低电平 → 降 crest。真实雨声也被介质自然压缩过，
    # 这步反而更真实；关键是归一化时偶发峰不会被顶到 0.95 而把整体 RMS 压垮
    # （之前 crest 12 导致 RMS 掉到 -22dB、破护栏下限）。K=3 实测归一后正好 RMS 0.10、
    # 峰值 0.93（<0.95 上限，无削波）。
    K = 3.0
    tk = math.tanh(K)
    out = [math.tanh(x * K) / tk for x in out]
    return out


def synth_beach(sr, dur):
    """一阵一阵的海浪：低频涌动主体 + 浪头才有的中高频浪花，套 15s 涌浪包络，但更平缓、更不机械。

    用户反馈：一段一段可以（保留），但「拉的太高」（浪峰太突出/太响）、
    「频率太固定」（两个浪一模一样、机械）。改法：
      · 包络动态范围压窄：基值 0.10→0.35、峰 1.0→0.80（再乘呼吸），浪峰不再"耸起来"。
      · 浪花增益 0.30→0.20、起浪阈值 0.60→0.65：浪花是最亮最吵的部分，再收。
      · 破"太固定"：叠 ~30s 的缓慢呼吸（value(0)=value(30)→无缝）让前 15s 的浪和后
        15s 的浪高度不同；再把涌浪相位整体平移 3s，浪不再正好卡在 0/15/30 的整数点。
      · 主体 600Hz 低通、浪花 1k~3.5k 带通不变（这是"不吵"的主力）。
      · 单个涌浪仍是"前 35% 涌上 + 后 65% 退去"的光滑不对称曲线（真海浪就是这种不对称，
        也避开了"基波+谐波叠加"会多出碎浪峰的坑）。
    """
    N = int(sr * (dur + XFADE))
    w = white(N)
    surf = lowpass(w, 600.0, sr)
    lp35 = lowpass(w, 3500.0, sr)
    lp10 = lowpass(w, 1000.0, sr)
    foam = [a - b for a, b in zip(lp35, lp10)]   # 带通 1k~3.5k

    out = [0.0] * N
    PERIOD = 15.0     # 一个涌浪的周期（30s 循环正好 2 个浪，无缝）
    ATT = 0.35        # 周期内前 35% 是"涌上来"，后 65% 是"退下去"
    DELTA = 3.0       # 涌浪相位平移，破"正好卡在整数点"
    PI = math.pi
    for i in range(N):
        t = i / sr
        p = ((t + DELTA) % PERIOD) / PERIOD
        if p < ATT:
            shape = 0.5 - 0.5 * math.cos(PI * p / ATT)            # 0 → 1 涌上来
        else:
            shape = 0.5 + 0.5 * math.cos(PI * (p - ATT) / (1.0 - ATT))  # 1 → 0 退下去
        breath = 0.85 + 0.15 * math.cos(2.0 * PI * t / 30.0)      # 30s 呼吸，无缝
        e = (0.35 + 0.45 * shape) * breath                       # 涌浪包络（0.35~0.80 再乘呼吸）
        foame = max(0.0, shape - 0.65) ** 1.5                    # 只在浪头起浪花
        out[i] = surf[i] * e + foam[i] * foame * 0.20
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
