# 分析候选环境音：能量包络 / 突发（雷声、人声、关门）/ 首尾电平（循环接缝）
import subprocess, sys, os, math, statistics
import shutil

FFMPEG = shutil.which('ffmpeg') or shutil.which('ffmpeg.exe') or 'ffmpeg'

def to_raw(fp, rate=8000):
    out = fp + '.raw'
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', fp,
                    '-ac', '1', '-ar', str(rate), '-f', 's16le', out], check=True)
    return out

def analyze(fp):
    rate = 8000
    raw = to_raw(fp)
    data = open(raw, 'rb').read()
    os.remove(raw)
    n = len(data) // 2
    import array
    a = array.array('h')
    a.frombytes(data[:n * 2])
    W = rate // 4           # 0.25 s 窗口
    rms = []
    for i in range(0, n - W, W):
        s = 0.0
        for j in range(i, i + W, 4):   # 抽样，够用
            v = a[j] / 32768.0
            s += v * v
        rms.append(math.sqrt(s / (W / 4)))
    def db(x): return 20 * math.log10(max(1e-9, x))
    d = [db(x) for x in rms]
    med = statistics.median(d)
    mx = max(d)
    print('--- %s' % os.path.basename(fp))
    print('   时长 %.1fs  中位 %.1f dB  峰值 %.1f dB  峰-中位 %.1f dB' % (n / rate, med, mx, mx - med))
    # 突发：超过中位 +12 dB 的窗口
    bursts = [(i * 0.25, d[i]) for i in range(len(d)) if d[i] > med + 12]
    print('   突发窗口(>中位+12dB): %d 个' % len(bursts),
          ('首个 @%.1fs' % bursts[0][0]) if bursts else '')
    # 首尾 1 秒电平（接缝落差）
    head = statistics.median(d[:4]); tail = statistics.median(d[-4:])
    print('   首 1s %.1f dB / 尾 1s %.1f dB  落差 %.1f dB' % (head, tail, abs(head - tail)))
    # 包络缩略（每 2 秒取一个点，画成字符）
    step = max(1, len(d) // 60)
    pts = [d[i] for i in range(0, len(d), step)]
    lo, hi = min(pts), max(pts)
    chars = ' .:-=+*#%@'
    line = ''.join(chars[min(9, int((p - lo) / max(1e-9, hi - lo) * 9))] for p in pts)
    print('   包络 |%s|  (%.0f~%.0f dB, 每点 %.1fs)' % (line, lo, hi, step * 0.25))
    print()

for fp in sys.argv[1:]:
    try:
        analyze(fp)
    except Exception as e:
        print('FAIL', fp, e)
