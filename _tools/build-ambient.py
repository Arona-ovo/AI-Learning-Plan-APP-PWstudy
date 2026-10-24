# _tools/build-ambient.py - 用**真实录音**构建有具体声音形象的环境音（雨声 / 沙滩海浪）
#
# 为什么不再合成：合成雨声再物理化也只是"像雨"（共振雨滴 + 雨幕滤波），
#   真实录音才"是雨" —— 而且真实录音自带那种合成不出来的细密随机感。
#   代价是要处理版权，所以只挑 **CC0（公有领域贡献声明）** 的素材，
#   不用 CC-BY / CC-BY-SA（要署名，随包分发多一层义务）。
#
# 挑素材的四条硬标准（都是脚本跑出来的客观指标，不是"听起来还行"）：
#   ① 许可 = CC0 / PD            —— 换素材时先过这一条，不过就不用往下看
#   ② 窗口内无突发（>中位+10dB）  —— 雷声、鸟叫、关门、人声都在这条上现形
#   ③ 首尾 1s 电平落差 < 1dB      —— 循环接缝才不会"咕咚"一下变响
#   ④ 频谱像大自然：低频与高频都滚降，重心落在 250Hz~5kHz
#      （反例：能量堆在 9~14k 的是近场大雨/录音嘶声 —— 听久了刺耳；
#        能量堆在 <250Hz 的是交通隆隆 —— 听着像风不像雨）
#   用 _tools/_scratch/_bestwin.py 搜窗口、_analyze_amb.py 看包络、_spec_amb.py 看频谱。
#
# 产出：uniapp-PWstudy/static/noise/{rain,beach}.wav
#   PCM 单声道 16bit @ 32kHz（32k 够：雨声与海浪的能量都集中在 5kHz 以下，
#   32k 的 16k 上限留足余量，比 44.1k 省 27% 体积）
#
# 运行：python _tools/build-ambient.py       （首次会下载源录音到 _tools/_cache/）
import array
import os
import shutil
import subprocess
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import noise_util

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'uniapp-PWstudy', 'static', 'noise')
CACHE = os.path.join(HERE, '_cache')
UA = 'PWstudy/1.0 (ambient asset build)'

# ⚠️ 换素材时这三处要一起改：这里的 SOURCES、static/noise/SOURCES.md、本文件顶部的挑选标准。
#    SOURCES.md 是给人看的许可清单（护栏会核对两者是否对得上）。
SOURCES = [
    {
        'kind': 'rain',
        'name': '雨声',
        # 为什么选它（PD，零许可义务；挑素材的四条标准见文件头）：
        #   crest 5.3 —— 全场最低的一批，归一后 RMS 能真正打到 0.12
        #   （对比：另一份 CC0 的小雨 crest 23，夹峰值后 RMS 只有 0.019，
        #    比别的音色轻 16dB，开到最大也听不见，而界面完全看不出异常）
        #   频谱 250Hz~2kHz 平坦、2kHz 以上 -6dB/oct 滚降 —— 正是自然雨声的形状
        #   首尾落差 2.8dB —— 靠 400ms 交叉淡化抹平（雨声本来就有起伏）
        'url': 'https://upload.wikimedia.org/wikipedia/commons/0/0e/Rain_%281%29.ogg',
        'page': 'https://commons.wikimedia.org/wiki/File:Rain_(1).ogg',
        'credit': 'ezwa（pdsounds.org），Public domain',
        'license': 'Public domain（PD-author）',
        'cache': 'rain_ezwa_pdsounds.ogg',
        'ss': 5.0,
        'dur': 30.0,
        'rate': 32000,
        'soften': 0,     # 频谱本身已自然滚降，再压就闷了
        'peak_cap': 0.7,  # crest 5.3 的素材，0.55 会把 RMS 压到 0.103；0.7 才刚好达标且不削波
        'xfade_ms': 400,
    },
    {
        'kind': 'beach',
        'name': '沙滩',
        # 热带海滩的潮汐浪（作者原话 "great for studying"）。
        'url': 'https://upload.wikimedia.org/wikipedia/commons/6/64/Ocean_Waves_on_a_Tropical_Beach.ogg',
        'page': 'https://commons.wikimedia.org/wiki/File:Ocean_Waves_on_a_Tropical_Beach.ogg',
        'credit': 'Jarrod stanley（J.D. Savanyu），Own work，CC0',
        'license': 'CC0 1.0',
        'cache': 'ocean_waves_jarrod_stanley.ogg',
        'ss': 294.0,     # 6.4 分钟的原录音里最稳的一段：0 突发、首尾落差 0.0dB
        'dur': 30.0,
        'rate': 32000,
        'soften': 0,     # 海浪低频为主，高频水花是真内容，压掉就没"哗"了
        'xfade_ms': 400,
    },
]


def find_ffmpeg():
    for c in ('ffmpeg', 'ffmpeg.exe'):
        p = shutil.which(c)
        if p:
            return p
    raise SystemExit('找不到 ffmpeg：请先安装并加进 PATH（本脚本用它裁切与重采样）')


def fetch(src):
    os.makedirs(CACHE, exist_ok=True)
    p = os.path.join(CACHE, src['cache'])
    if os.path.exists(p) and os.path.getsize(p) > 0:
        print('  用缓存 %s（%.1f MB）' % (src['cache'], os.path.getsize(p) / 1048576.0))
        return p
    print('  下载 %s ...' % src['url'])
    req = urllib.request.Request(src['url'], headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=300) as resp, open(p, 'wb') as f:
        while True:
            b = resp.read(1 << 16)
            if not b:
                break
            f.write(b)
    print('  -> %.1f MB' % (os.path.getsize(p) / 1048576.0))
    return p


def slice_pcm(ffmpeg, src, wav_path):
    """裁一段 + 转单声道 + 重采样，返回 float 样本（-1..1）。
    ⚠️ 多裁 XFADE 那么长：交叉淡化会把尾部那 f 个样本融进头部（见 noise_util），
       所以输入要比目标循环长度多一点点，输出才是整 dur 秒。"""
    rate = src['rate']
    extra = noise_util.XFADE_MS / 1000.0
    raw = os.path.join(CACHE, src['kind'] + '.raw')
    # -ss 放在 -i 之后：解码后 seek，样本级精确（放前面是容器级快 seek，ogg 上会偏）
    subprocess.run([ffmpeg, '-v', 'error', '-y', '-i', wav_path,
                    '-ss', '%.3f' % src['ss'], '-t', '%.3f' % (src['dur'] + extra),
                    '-ac', '1', '-ar', str(rate), '-f', 's16le', raw], check=True)
    a = array.array('h')
    a.frombytes(open(raw, 'rb').read())
    os.remove(raw)
    return [x / 32768.0 for x in a]


def main():
    ffmpeg = find_ffmpeg()
    os.makedirs(OUT, exist_ok=True)
    print('真实录音 → 环境音素材：', os.path.normpath(OUT))
    for src in SOURCES:
        print('[%s] %s  (%s)' % (src['kind'], src['name'], src['credit']))
        wav = fetch(src)
        s = slice_pcm(ffmpeg, src, wav)
        s = noise_util.soften(s, src['soften'], src['rate'])
        # ⚠️ 真实录音常带 1ms 级的爆音（雨滴打麦 / 数字故障）。不削的话，
        #    夹峰值那一步会把整段素材压下去十几 dB —— 这个音色就比别的轻一大截，
        #    而界面完全看不出异常（见 noise_util.declick 的说明）。
        s, fixed = noise_util.declick(s, src['rate'])
        if fixed:
            print('  削掉 %d 处爆音' % fixed)
        # 峰值因子（crest factor）：真实录音的瞬态（雨滴"嗒"、浪头"哗"）是真内容，
        # 比合成噪声高得多。这个数决定了归一化能不能同时满足"响度达标"和"不削波"。
        crest = max(abs(x) for x in s) / max(1e-9, noise_util.rms(s))
        print('  削峰后 crest = %.1f (%.1f dB)' % (crest, noise_util.db(crest)))
        s = noise_util.crossfade_loop(
            noise_util.normalize(s, peak_cap=src.get('peak_cap', noise_util.PEAK_CAP)),
            src['rate'], src.get('xfade_ms', noise_util.XFADE_MS))
        p = os.path.join(OUT, src['kind'] + '.wav')
        noise_util.write_wav(p, s, src['rate'])
        noise_util.report(src['kind'], p, s, src['rate'])
        if fixed:
            print('  削掉 %d 处爆音' % fixed)
        j = noise_util.seam_jump(s)
        if j > 4.0:
            print('  ⚠️ 接缝跳变 %.2f×RMS 偏大，建议换个窗口起点重跑 _bestwin.py' % j)
    print('完成。别忘了同步 static/noise/SOURCES.md（护栏会核对许可清单）。')


if __name__ == '__main__':
    main()
