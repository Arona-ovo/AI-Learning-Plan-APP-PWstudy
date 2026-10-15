# _scratch/rain-check.py - 雨声客观验证（新旧对比）
#
# 主观"像不像雨"其实对应几个可量化的频谱特征：
#   · 频谱重心 spectral centroid：风声/闷响 < 800Hz；真实雨声 1.5~3kHz
#   · 频段能量分布：雨声的能量主体应在 1~6kHz，低频(<500Hz)占比要低
#   · 峰值因子 crest factor：有离散雨滴瞬态时更高（噪声平滑时只有 3~4dB）
#   · 包络起伏：雨滴带来 20~200Hz 的包络波动（旧版只有慢速调制，几乎没有）
#
# 运行：python _tools/_scratch/rain-check.py <旧wav> <新wav>
import sys, wave, struct, math
import numpy as np

def load(p):
    with wave.open(p, 'rb') as f:
        n = f.getnframes()
        d = f.readframes(n)
    x = np.frombuffer(d, dtype='<i2').astype(np.float64) / 32768.0
    return x, f.getframerate()

def band_energy(x, rate):
    """返回几个频段的能量占比（FFT 功率谱积分）"""
    X = np.abs(np.fft.rfft(x)) ** 2
    fr = np.fft.rfftfreq(len(x), 1.0 / rate)
    tot = X.sum()
    def frac(lo, hi):
        m = (fr >= lo) & (fr < hi)
        return float(X[m].sum() / tot)
    return {
        '<500':  frac(0, 500),
        '0.5-1k': frac(500, 1000),
        '1-3k':  frac(1000, 3000),
        '3-6k':  frac(3000, 6000),
        '>6k':   frac(6000, rate / 2),
    }

def centroid(x, rate):
    X = np.abs(np.fft.rfft(x))
    fr = np.fft.rfftfreq(len(x), 1.0 / rate)
    return float((X * fr).sum() / max(1e-9, X.sum()))

def crest(x):
    rms = math.sqrt(float((x ** 2).mean()))
    return 20 * math.log10(max(1e-9, np.abs(x).max()) / max(1e-9, rms))

def env_flux(x, rate):
    """包络起伏：短时 RMS 的波动率（雨滴瞬态会让它明显大于平滑噪声）"""
    w = int(rate * 0.005)                      # 5ms 窗
    n = len(x) // w
    e = np.array([float((x[i * w:(i + 1) * w] ** 2).mean()) for i in range(n)])
    e = np.sqrt(np.maximum(e, 0))
    return float(e.std() / max(1e-9, e.mean()))

def report(tag, p):
    x, rate = load(p)
    b = band_energy(x, rate)
    print('%s  重心 %6.0f Hz   峰值因子 %5.1f dB   包络起伏 %.3f'
          % (tag, centroid(x, rate), crest(x), env_flux(x, rate)))
    print('      频段占比：' + '  '.join('%s %.1f%%' % (k, v * 100) for k, v in b.items()))

old, new = sys.argv[1], sys.argv[2]
report('旧', old)
report('新', new)
