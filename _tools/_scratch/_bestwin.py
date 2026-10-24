# 在长录音里找"最适合做循环"的窗口：无突发（雷声/人声/鸟叫）+ 首尾电平接近
import subprocess, sys, os, math, statistics, array

FFMPEG = r"C:/Users/33156/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-9.0.2-full_build/bin/ffmpeg"

def load(fp, rate=8000):
    raw = fp + '.raw'
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', fp,
                    '-ac', '1', '-ar', str(rate), '-f', 's16le', raw], check=True)
    a = array.array('h')
    a.frombytes(open(raw, 'rb').read())
    os.remove(raw)
    return a, rate

def envelope(a, rate, win=0.25):
    W = int(rate * win)
    out = []
    for i in range(0, len(a) - W, W):
        s = 0.0
        for j in range(i, i + W, 8):
            v = a[j] / 32768.0
            s += v * v
        out.append(math.sqrt(s / (W / 8)))
    return out

def db(x): return 20 * math.log10(max(1e-9, x))

def best_window(fp, want=30.0, topn=6):
    a, rate = load(fp)
    env = [db(x) for x in envelope(a, rate)]
    per = 0.25
    nw = int(want / per)
    med_all = statistics.median(env)
    cands = []
    for s in range(0, len(env) - nw, 2):          # 0.5s 步进
        w = env[s:s + nw]
        med = statistics.median(w)
        mx = max(w)
        # 窗口内的突发（雷声）：相对本窗口中位 +10dB
        bursts = sum(1 for x in w if x > med + 10)
        # 首尾各 1s 电平落差
        head = statistics.median(w[:4]); tail = statistics.median(w[-4:])
        seam = abs(head - tail)
        drift = abs(med - med_all)
        score = bursts * 100 + seam * 3 + drift * 2 + max(0, mx - med - 8)
        cands.append((score, s * per, med, mx - med, bursts, seam))
    cands.sort()
    print('--- %s  (总长 %.1fs, 全片中位 %.1f dB)' % (os.path.basename(fp), len(a) / rate, med_all))
    for c in cands[:topn]:
        print('   起点 %6.1fs  中位 %6.1f dB  峰-中位 %4.1f dB  突发 %d  首尾落差 %4.1f dB  score %.1f'
              % (c[1], c[2], c[3], c[4], c[5], c[0]))

for fp in sys.argv[1:]:
    want = float(os.environ.get('WANT', 30))
    best_window(fp, want)
