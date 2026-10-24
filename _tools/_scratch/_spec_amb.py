# 分频段能量占比：真实雨声应该高频随频率滚降（约 -6dB/oct），
# 而 mp3 编码的宽带噪声往往在某点后能量"塌掉"（编码砍高频）→ 听感发闷/有 warbling
import subprocess, sys, os
import shutil

FFMPEG = shutil.which('ffmpeg') or shutil.which('ffmpeg.exe') or 'ffmpeg'

BANDS = [(20, 250), (250, 800), (800, 2000), (2000, 5000), (5000, 9000), (9000, 14000), (14000, 20000)]

def band_rms(fp, lo, hi):
    af = 'highpass=f=%d,lowpass=f=%d,astats=metadata=1:reset=0' % (lo, hi)
    # ⚠️ astats 的统计是 info 级日志，用 -v error 会把结果一起吞掉（全是 n/a）
    p = subprocess.run([FFMPEG, '-v', 'info', '-i', fp, '-t', '20', '-af', af, '-f', 'null', '-'],
                       capture_output=True, text=True, errors='ignore')
    for line in p.stderr.splitlines():
        if 'RMS level dB' in line:
            try: return float(line.split(':')[-1].strip())
            except Exception: return None
    return None

for fp in sys.argv[1:]:
    print('--- %s' % os.path.basename(fp))
    vals = []
    for lo, hi in BANDS:
        v = band_rms(fp, lo, hi)
        vals.append(v)
        print('   %5d-%5d Hz  %s dB' % (lo, hi, ('%.1f' % v) if v is not None else 'n/a'))
    print()
