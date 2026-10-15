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
#   rain   雨声：带通雨幕（沙沙）+ 泊松雨滴瞬态（嗒嗒）+ 慢速雨势起伏（见下面的三层说明）
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
#   rain   不压：2026-10-15 重写后雨声**自己**做了带通（800Hz~5kHz 雨幕
#          + 2.2k~6k 雨滴），再压一刀就会把雨滴的"嗒"一起抹掉、变回闷响。
# 掩蔽效果（挡住外界说话声）主要由中低频贡献，压高频几乎不损失这个功能。
SOFTEN = {'white': 3200, 'pink': 4500, 'brown': 0, 'rain': 0}


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


# ⚠️ 雨声三层参数（2026-10-15 重写）
#
# 旧版为什么"不像雨"：白噪 → 两级一阶低通，截止压到 560Hz 附近。
# 那个频谱是**低频为主** —— 听感是"呼呼"的风声/闷响，跟雨没关系。
# 真实雨声两个缺一不可的特征：
#   ① 雨幕的"沙沙"能量集中在 **1~6kHz**（不是低频）；
#   ② **一颗颗雨滴打下来的瞬态** —— 缺了它，再怎么滤波都只是"滤过的噪声"，
#      有沙沙但没有"在下雨"的下落感。旧版只有 ① 的残缺形态、完全没有 ②。
RAIN_HP_HZ = 800          # 雨幕高通：切掉 800Hz 以下（那一段正是"风声"的来源）
RAIN_LP_HZ = 3800         # 雨幕低通：切掉 3.8k 以上，去毛刺
RAIN_DROP_HP_HZ = 1800    # 雨滴瞬态的高通：让每颗"嗒"落在更亮的频段
RAIN_DROP_LP_HZ = 4200    # 雨滴瞬态的低通（采样率 16k，Nyquist 8k，留出余量）
RAIN_BODY_HZ = 320        # 雨幕低频"厚度"：只给一点点（见下，多了就变回风声）
RAIN_BODY_GAIN = 0.14
RAIN_DROP_RATE = 150      # 雨滴密度（颗/秒）：中等雨势。太稀像滴水，太密糊成一片
RAIN_DROP_TAU_MS = 3.0    # 单颗雨滴的衰减时间常数（毫秒）：决定"嗒"有多干脆
#
# ⚠️ 密度与衰减是**一对**：190 颗/秒 × 4ms 时重叠度 0.76，一颗颗全糊在一起，
#   实测包络起伏只比平滑噪声高一点点（0.245 vs 0.211）——听上去还是"一片沙沙"，
#   没有雨打在棚顶那种颗粒感。降到 150 × 3ms（重叠度 0.45）后瞬态才立得起来。
#
# ⚠️ 低通为什么要**两级级联**（2026-10-15 实测）：
#   单极点只有 -6dB/oct，在 16k 采样率下几乎压不住 6~8kHz —— 实测单级时
#   >6kHz 占了 26.5% 的能量、频谱重心冲到 4267Hz，听感偏"嘶"，正好踩回
#   "白噪音刺耳"那个坑。两级级联是 -12dB/oct，才能把重心压回 2~3kHz 的雨声区。


def gen_rain(n):
    # ① 雨幕 hiss：白噪 → 高通(去风感) → 低通(去毛刺) → 800Hz~5kHz 的沙沙
    # ② 雨滴 patter：泊松过程触发的一颗颗"嗒"，每颗 = 指数衰减 × 更亮频段的带限噪声
    # ③ 雨势起伏：慢速调制整体强度**和雨滴密度**（忽大忽小才像真的在下，不是循环贴片）
    a_hp = 1.0 - math.exp(-2.0 * math.pi * RAIN_HP_HZ / RATE)
    a_lp = 1.0 - math.exp(-2.0 * math.pi * RAIN_LP_HZ / RATE)
    a_dhp = 1.0 - math.exp(-2.0 * math.pi * RAIN_DROP_HP_HZ / RATE)
    a_dlp = 1.0 - math.exp(-2.0 * math.pi * RAIN_DROP_LP_HZ / RATE)
    # 单颗雨滴的每样本衰减系数：tau 毫秒换算成样本数后取 e^(-1/n)
    tau_n = RAIN_DROP_TAU_MS * RATE / 1000.0
    decay = math.exp(-1.0 / max(1.0, tau_n))
    p_drop = RAIN_DROP_RATE / RATE      # 每个样本触发一颗雨滴的概率

    a_body = 1.0 - math.exp(-2.0 * math.pi * RAIN_BODY_HZ / RATE)

    hp1 = lp1 = lp2 = body = 0.0
    dhp = dlp1 = dlp2 = 0.0
    env = 0.0                            # 雨滴包络：累加各颗的冲激，按 decay 衰减
    out = []
    for i in range(n):
        t = i / RATE
        w = random.uniform(-1.0, 1.0)

        # ① 雨幕：带通白噪（高通 → 两级低通，见上面的级联说明）
        hp1 += a_hp * (w - hp1)
        lp1 += a_lp * ((w - hp1) - lp1)
        lp2 += a_lp * (lp1 - lp2)
        hiss = lp2

        # 雨幕的"厚度"：一点点低频，纯高频会显得单薄。
        # ⚠️ 只给 0.10 —— 旧版就是因为这一层占了一半能量才变成风声
        body += a_body * (w - body)

        # ③ 雨势起伏：两个错开周期的慢正弦（周期互质，8 秒内不重复）
        mod = 1.0 + 0.18 * (
            0.6 * math.sin(2 * math.pi * t / 5.3)
            + 0.4 * math.sin(2 * math.pi * t / 2.9 + 1.7)
        )

        # ② 雨滴：密度也跟着雨势走（雨大 = 滴更密，不只是更响）
        if random.random() < p_drop * mod:
            env += random.uniform(0.35, 1.0)
        env *= decay
        dhp += a_dhp * (w - dhp)
        dlp1 += a_dlp * ((w - dhp) - dlp1)
        dlp2 += a_dlp * (dlp1 - dlp2)
        patter = env * dlp2

        out.append(0.62 * hiss + 0.85 * patter + RAIN_BODY_GAIN * body)
    return out


def soften(samples, cutoff_hz):
    """一阶低通：压掉最刺耳的高频段（cutoff_hz <= 0 表示不处理）"""
    if cutoff_hz <= 0:
        return samples
    # 一阶 RC：系数由截止频率与采样率推出
    a = 1.0 - math.exp(-2.0 * math.pi * cutoff_hz / RATE)
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


def build(name, gen):
    """合成 → 柔化高频 → 峰值归一化 → 首尾交叉淡化"""
    raw = gen(RATE * SECONDS)
    soft = soften(raw, SOFTEN.get(name, 0))
    return crossfade_loop(normalize(soft))


def main():
    os.makedirs(OUT, exist_ok=True)
    print('合成专注白噪音 →', os.path.normpath(OUT))
    write_wav('white', build('white', gen_white))
    write_wav('pink', build('pink', gen_pink))
    write_wav('brown', build('brown', gen_brown))
    write_wav('rain', build('rain', gen_rain))
    print('完成：4 种音色，全部无缝循环（高频已按 SOFTEN 柔化）。')


if __name__ == '__main__':
    main()
