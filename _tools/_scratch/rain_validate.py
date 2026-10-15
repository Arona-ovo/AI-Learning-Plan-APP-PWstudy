# _scratch/rain_validate.py - 雨声客观校验（纯标准库 FFT，无需 numpy）
# 对照旧/新雨声，看"像不像雨"的频谱特征是否改善：
#   · 频段能量分布：雨声主体应在 1~6kHz，低频(<500Hz)占比低
#   · 频谱重心 centroid：风声/闷响 < 800Hz；真实雨声 1.5~3kHz
#   · 峰值因子 crest：有离散雨滴瞬态时更高（平滑噪声只有 3~4dB）
import sys, wave, struct, math, cmath

N = 16384  # FFT 长度（2 的幂）

def load(p):
    with wave.open(p, 'rb') as f:
        n = f.getnframes()
        d = f.readframes(n)
    x = list(struct.unpack('<%dh' % n, d))
    x = [v / 32768.0 for v in x]
    return x, f.getframerate()

def fft(a):
    n = len(a)
    j = 0
    for i in range(1, n):
        bit = n >> 1
        while j & bit:
            j ^= bit
            bit >>= 1
        j ^= bit
        if i < j:
            a[i], a[j] = a[j], a[i]
    m = 2
    while m <= n:
        ang = -2.0 * math.pi / m
        wm = cmath.exp(complex(0, ang))
        for k in range(0, n, m):
            w = 1.0 + 0j
            half = m // 2
            for jj in range(half):
                t = w * a[k + jj + half]
                u = a[k + jj]
                a[k + jj] = u + t
                a[k + jj + half] = u - t
                w *= wm
        m <<= 1
    return a

def spectrum(x, rate):
    # 取中段一窗，去循环接缝；Hann 窗
    start = len(x) // 2 - N // 2
    seg = x[start:start + N]
    w = [0.5 - 0.5 * math.cos(2 * math.pi * i / (N - 1)) for i in range(N)]
    c = [complex(seg[i] * w[i], 0.0) for i in range(N)]
    C = fft(c)
    mag = [abs(C[i]) for i in range(N // 2 + 1)]   # 0..Nyquist
    freqs = [i * rate / N for i in range(N // 2 + 1)]
    return mag, freqs

def band_energy(mag, freqs, lo, hi):
    s = 0.0
    for m, f in zip(mag, freqs):
        if lo <= f < hi:
            s += m * m
    return s

def analyze(tag, p):
    x, rate = load(p)
    rms = math.sqrt(sum(v * v for v in x) / len(x))
    peak = max(abs(v) for v in x)
    crest = 20 * math.log10(peak / max(1e-9, rms))
    mag, freqs = spectrum(x, rate)
    tot = sum(m * m for m in mag) + 1e-12
    bands = {'<500': (0, 500), '0.5-1k': (500, 1000),
             '1-3k': (1000, 3000), '3-6k': (3000, 6000), '6-12k': (6000, 12000)}
    dist = {k: 100.0 * band_energy(mag, freqs, lo, hi) / tot for k, (lo, hi) in bands.items()}
    centroid = sum(f * (m * m) for f, m in zip(freqs, mag)) / tot
    print('%s  (%d Hz, %d samples)' % (tag, rate, len(x)))
    print('  RMS=%.4f  峰值=%.4f  峰值因子=%.1f dB  频谱重心=%.0f Hz'
          % (rms, peak, crest, centroid))
    print('  频段占比: ' + '  '.join('%s %.1f%%' % (k, dist[k]) for k in bands))
    return dist, crest, centroid

if __name__ == '__main__':
    old, new = sys.argv[1], sys.argv[2]
    do, co, ceo = analyze('旧', old)
    dn, cn, cen = analyze('新', new)
    print('改善: 低频<500 %+.1f%%   1-3k %+.1f%%   3-6k %+.1f%%   重心 %+.0f Hz   峰值因子 %+.1f dB'
          % (dn['<500'] - do['<500'], dn['1-3k'] - do['1-3k'],
             dn['3-6k'] - do['3-6k'], cen - ceo, cn - co))
