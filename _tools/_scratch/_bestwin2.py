# 在长录音里找"最适合做循环"的窗口。
#
# ⚠️ 为什么只看 crest（峰值因子）和局部起伏，不看"有没有爆音"：
#    白噪音是按 RMS 归一 + 夹峰值的。素材里只要有一段 crest 特别高的地方，
#    夹峰值就会把**整段**压下去十几 dB —— 这个音色比别的所有音色轻一大截，
#    而界面完全看不出异常（音量条满的，就是没声）。所以 crest 是硬指标，
#    必须挑 crest 低的窗口，不能指望后处理（后处理削掉的是真瞬态，雨声就平了）。
#    局部起伏同理：循环里突然"呼"地响一下，专注时很出戏。
import subprocess, sys, os, math, array
import shutil

FFMPEG = shutil.which('ffmpeg') or shutil.which('ffmpeg.exe') or 'ffmpeg'
RATE = 32000
BLOCK = 2048


def load(fp):
    raw = fp + '.scan.raw'
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', fp,
                    '-ac', '1', '-ar', str(RATE), '-f', 's16le', raw], check=True)
    a = array.array('h')
    a.frombytes(open(raw, 'rb').read())
    os.remove(raw)
    return a


def scan(a, want=30.0, topn=8):
    n = len(a)
    # 累积平方和 → 任意区间的 RMS 可以 O(1) 查
    cs = array.array('d', [0.0]) * 0
    cs = [0.0] * (n + 1)
    for i in range(n):
        cs[i + 1] = cs[i] + (a[i] / 32768.0) ** 2
    # 分块最大值 → 窗口内的峰值近似（误差只在窗口两端各一个块，够用）
    nb = (n + BLOCK - 1) // BLOCK
    bmax = [0.0] * nb
    for b in range(nb):
        m = 0.0
        for j in range(b * BLOCK, min(n, (b + 1) * BLOCK)):
            v = abs(a[j])
            if v > m:
                m = v
        bmax[b] = m / 32768.0

    step = RATE // 2               # 0.5 s 步进
    wn = int(want * RATE)
    cands = []
    for s in range(0, n - wn, step):
        rms_w = math.sqrt((cs[s + wn] - cs[s]) / wn)
        # 峰值
        b0, b1 = s // BLOCK, (s + wn - 1) // BLOCK
        peak = max(bmax[b0:b1 + 1])
        crest = peak / max(1e-9, rms_w)
        # 局部起伏：0.25s 子窗 RMS 的 P95 相对中位
        sub = RATE // 4
        subs = []
        for k in range(s, s + wn - sub, sub):
            subs.append(math.sqrt((cs[k + sub] - cs[k]) / sub))
        subs.sort()
        med = subs[len(subs) // 2]
        p95 = subs[int(len(subs) * 0.95)]
        swell = 20 * math.log10(max(1e-9, p95) / max(1e-9, med))
        # 首尾各 1s 的电平落差：循环接缝"咕咚"一下的来源
        head = math.sqrt((cs[s + RATE] - cs[s]) / RATE)
        tail = math.sqrt((cs[s + wn] - cs[s + wn - RATE]) / RATE)
        seam = abs(20 * math.log10(max(1e-9, head) / max(1e-9, tail)))
        cands.append((s / float(RATE), crest, swell, seam,
                      20 * math.log10(max(1e-9, rms_w)), peak))
    # crest 是硬指标（决定归一后能不能达标）；其次是接缝落差与起伏
    good = [c for c in cands if c[1] <= 8.0] or cands
    good.sort(key=lambda c: c[3] + c[2] * 0.5 + c[1] * 0.1)
    print('--- %s  (%.1fs, 窗口 %.0fs)' % (os.path.basename(sys.argv[1] if sys.argv[1:] else '?'),
                                           n / float(RATE), want))
    print('    %-8s %-8s %-8s %-8s %-9s %s' % ('起点', 'crest', '起伏dB', '接缝dB', 'RMS dB', '峰值'))
    for c in good[:topn]:
        print('    %6.1fs  %6.1f   %6.2f    %6.2f    %6.1f     %.3f' % c)


for fp in sys.argv[1:]:
    a = load(fp)
    scan(a, float(os.environ.get('WANT', 30)))
