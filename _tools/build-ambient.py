# _tools/build-ambient.py - 雨声/沙滩 真实录音产线
#
# 2026-10-26 起改用真实录音，弃用程序合成。
# 原因：三轮合成都「不像真的」—— 雨声听着像滤波噪音、沙滩频率太固定、整体偏吵。
# 真雨的声音主体是无数有音高的水珠、海浪是一阵一阵的涌浪，这些合成很难做真；
# 而真实录音天然就有这些纹理。所以回归真实录音：从 opengameart 拉 CC0 实况录音，
# 经 ffmpeg 转码 + noise_util（declick → RMS 归一 → 首尾交叉淡化）处理成
# 30s 无缝循环、32k 单声道 16bit、RMS 0.10（与白/粉/棕噪差 1.6dB，在护栏 ±2dB 窗口内）。
#
# 用法：python3 _tools/build-ambient.py
#   · 需 ffmpeg 在 PATH
#   · 联网拉取源文件（已下载则复用 _tools/_cache/raw 缓存）
#
# 真实录音必须有出处与许可（check-ambient.js §5.5 会逐行核对 SOURCES.md）。
# 两条源都是 CC0 1.0（opengameart），可再分发、无署名义务。

import os
import sys
import math
import subprocess

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import noise_util as nu  # 两条产线共用：declick / normalize / crossfade_loop / write_wav

RAW = os.path.join(HERE, '_cache', 'raw')
OUT = os.path.join(ROOT, 'uniapp-PWstudy', 'static', 'noise')
SR = 32000
DUR = 30.0
XFADE = nu.XFADE_MS / 1000.0
TARGET_RMS = 0.10          # 与白/粉/棕噪（0.12）差 1.6dB，在护栏 ±2dB 窗口内
PEAK_CAP = 0.95            # 不削波；真实录音动态大，这里放宽到护栏上限

# 真实录音源（均为 CC0 1.0，opengameart）
# 注意：雨声已改为程序合成（见 _tools/gen-rain.py），不再走真实录音产线 ——
# 用户的反馈是「真实雨声还是太密集偏吵」，而真实录音的性格（密度/频谱）改不了，
# 合成才能把「稀疏、平缓」做出来。沙滩因用户认可、保留真实录音。
SOURCES = [
    {
        'kind': 'beach',
        'url': 'https://opengameart.org/sites/default/files/VistulaShort_0.mp3',
        'credit': 'Sea and river wave sounds (VistulaShort) — RandomMind (CC0 1.0, opengameart)',
        'license': 'CC0',
    },
]


def cache_path(url):
    return os.path.join(RAW, os.path.basename(url.split('?')[0]))


def download(src):
    dst = cache_path(src['url'])
    if os.path.exists(dst) and os.path.getsize(dst) > 1000:
        return dst
    os.makedirs(RAW, exist_ok=True)
    print('  下载 %s ...' % src['url'])
    r = subprocess.run(['curl', '-sSL', '--max-time', '180', '-o', dst, src['url']])
    if r.returncode != 0 or os.path.getsize(dst) < 1000:
        raise RuntimeError('下载失败: ' + src['url'])
    return dst


def decode_to_mono_wav(src_path, dst_wav):
    """ffmpeg 转 32k 单声道 16bit wav（安卓 MediaPlayer 只稳吃 PCM）。"""
    subprocess.run(
        ['ffmpeg', '-y', '-i', src_path, '-ar', str(SR), '-ac', '1', '-f', 'wav', dst_wav],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def read_wav_samples(path):
    import wave
    import array
    w = wave.open(path, 'rb')
    n = w.getnframes()
    raw = w.readframes(n)
    a = array.array('h')
    a.frombytes(raw)
    return [x / 32768.0 for x in a]


def select_window(samples, is_ocean):
    """从解码后的整段里挑一个 30.25s 窗口。
    · 雨声是循环素材，任意窗口都行 → 直接取开头。
    · 海浪要"一阵一阵"的涌浪感 → 用 1s 能量包络挑一个「从波谷起、峰谷差明显」的窗口，
      这样 30s 里有清晰起伏且循环点落在安静处，听感自然。
    """
    need = int(SR * (DUR + XFADE))
    if len(samples) <= need:
        return samples[:need]
    if not is_ocean:
        return samples[:need]
    step = SR
    env = []
    for i in range(0, len(samples) - step, step):
        seg = samples[i:i + step]
        env.append(math.sqrt(sum(v * v for v in seg) / len(seg)))
    best_s = None
    best_score = -1.0
    nwin = int(DUR)
    for s in range(30, len(env) - nwin - 1):
        w = env[s:s + nwin]
        lo, hi = min(w), max(w)
        if hi <= 0:
            continue
        score = (hi - lo) / hi                 # 峰谷差占比：越大越有涌浪感
        if env[s] > lo * 1.3:                  # 起点不能在波峰，要在波谷附近起
            score *= 0.5
        if score > best_score:
            best_score = score
            best_s = s
    if best_s is None:
        best_s = 30
    start = best_s * step
    return samples[start:start + need]


def soft_limit(samples, ceiling=0.95):
    """只压超过 ceiling 的峰、其余不动 → 保住 RMS（避免整段被峰值夹压垮）。

    真实录音峰值因子高（雨声源 ~11），按 RMS 归一到 0.10 时峰会顶到 0.95 上限，
    noise_util 的硬夹是把「整段」缩放下去、RMS 被拖到 -20.8dB（破护栏 2dB 窗口）。
    这里只把越界的峰用 tanh 压平，主体样本不变，RMS 基本守住 0.10、峰值恰好 ≤0.95。"""
    return [ceiling * math.tanh(x / ceiling) for x in samples]


def process(src):
    raw = download(src)
    tmp = os.path.join(RAW, src['kind'] + '_decoded.wav')
    decode_to_mono_wav(raw, tmp)
    samples = read_wav_samples(tmp)
    win = select_window(samples, src['kind'] == 'beach')
    # 三步与白噪产线一致：削爆音 → RMS 归一 → 首尾交叉淡化
    win, _ = nu.declick(win, SR)
    win = nu.normalize(win, target=TARGET_RMS, peak_cap=9.0)  # 先只按 RMS 归一，不夹峰
    win = soft_limit(win, PEAK_CAP)                            # 再只压越界峰，保住 RMS
    loop = nu.crossfade_loop(win, SR)
    out_path = os.path.join(OUT, src['kind'] + '.wav')
    nu.write_wav(out_path, loop, SR)
    nu.report(src['kind'], out_path, loop, SR)
    return out_path


if __name__ == '__main__':
    print('== 真实录音产线（仅沙滩；雨声见 _tools/gen-rain.py 合成）==')
    for s in SOURCES:
        print('· %s  (%s)' % (s['kind'], s['license']))
        process(s)
    print('完成。输出在', OUT)
