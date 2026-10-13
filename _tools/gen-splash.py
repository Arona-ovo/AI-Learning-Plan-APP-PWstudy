# _tools/gen-splash.py - 生成 Android 原生启动图（**只画渐变背景，不画任何图案**）
#
# 运行（需要 Pillow，只有系统 Python 装了）：
#   C:/Users/33156/AppData/Local/Programs/Python/Python312/python.exe _tools/gen-splash.py
# 输出：uniapp-PWstudy/static/splash/splash-{hdpi,xhdpi,xxhdpi}.9.png
# ⚠️ 改完必须重新云打包才生效；启动图是**打进 APK 的原生资源**，热更新换不掉。
#
# ── 一、为什么只有背景、没有圆圈/脸/文字（2026-10-12，借自 AWword 的实测结论）──
#   曾经在那张图上画了「圆头像 + 品牌文字 + 进度槽」，想跟 cover 页无缝衔接。
#   但 .9.png 的图案区是**不可拉伸的固定像素**（xxhdpi 内容宽 1080），
#   而 cover 页的圆圈是 **rpx 布局**（340rpx = 屏幕宽 × 340/750）：
#     · 1212px 宽的屏幕上：splash 圆圈 ≈ 490px，cover 圆圈 ≈ 549px（差 12%）
#     · 若设备命中 xhdpi（内容宽 720），差 40%
#   屏幕越宽差得越多 → 用户实测「第一张跟第二张之间圆圈错位/跳一下」。
#   位图图案的绝对尺寸不可能跟上每台屏幕的宽度，这是死结 ——
#   所以图案（圆圈、脸、文字、进度条）**全部交给 cover 页自己画并淡入**
#   （见 pages/cover/cover.vue 的 .stage / @keyframes stageIn），
#   原生启动图只保留一张被拉伸也看不出来的**渐变背景**：
#   两边衔接只剩背景，而背景是平滑渐变，fitXY 拉伸无感。
#   这份契约两头一起守：_tools/check-native-assets.js 第 5 组。
#
# ── 二、为什么必须 .9.png（九宫格）而不是普通 png ──
#   云打包时启动图会被**铺满整屏**（fitXY）。普通 png 的比例只要和屏幕对不上，
#   整张图就被拉长/压扁 —— 实测事故：图 1080x1882（比例 0.574）对上
#   1212x2616 的手机（比例 0.463），纵向被拉长约 24%，圆脸变竖椭圆。
#   渐变内容 + 全幅可拉伸 = 任意比例屏幕都无感。
#
#   9-patch 的四条黑边（画在最外一圈 1px，其余边缘像素必须透明）：
#     上边、左边 = 可拉伸区（全幅，画面里没有任何不许变形的东西）
#     右边、下边 = padding 区（官方要求"拉满"，不拉满部分设备会显示灰边）
#
# ── 三、颜色从哪来（单一真相，别手抄）──
#   启动图的颜色**不是**在这里随便定的，而是把 cover 页首帧的画面算出来：
#
#     uniapp-PWstudy/utils/settings.js   出厂 accent = rose（绯红）、background = sand（暖砂）
#     uniapp-PWstudy/utils/theme.js      ACCENTS[rose].rgb   = 228, 23, 61
#                                BACKGROUNDS[sand].solid = #f0e4d2  ← 页面底色（inline backgroundColor）
#     uniapp-PWstudy/pages/cover/cover.vue  .cover 的 165deg 渐变 = 绯红 6% → 13% → 22%
#
#   cover 页根节点同时挂 `:style="appBgStyle"`：它下发的是 background-color（实色），
#   而 .cover 的类规则给的是 background-image（半透明渐变）—— 两者叠加才是首帧底色。
#   所以这里做的就是把 **半透明渐变合成到底色上**，得到三个不透明色标。
#   本脚本每次运行都重新解析上面三个文件（不写死），设计一改、这里就跟着变；
#   脚本跑完没重新打包、或忘了重新生成，check-native-assets.js 第 5 组会报红。
from PIL import Image
import math
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
UNI = os.path.join(HERE, '..', 'uniapp-PWstudy')
OUT = os.path.join(UNI, 'static', 'splash')
SCRATCH = os.path.join(HERE, '_scratch')


def read(rel):
    with open(os.path.join(UNI, rel), encoding='utf-8') as f:
        return f.read()


def derive():
    """从源码里推导启动图的三个色标（见文件头「三」）"""
    settings = read('utils/settings.js')
    theme = read('utils/theme.js')
    cover = read('pages/cover/cover.vue')

    m = re.search(r"\baccent:\s*'([A-Za-z0-9_]+)'", settings)
    if not m:
        sys.exit('✗ 解析不出 settings.js 里的出厂 accent')
    accent = m.group(1)

    m = re.search(r"\bbackground:\s*'([A-Za-z0-9_]+)'", settings)
    if not m:
        sys.exit('✗ 解析不出 settings.js 里的出厂 background')
    bgkey = m.group(1)

    m = re.search(r"\{\s*key:\s*'%s'[\s\S]{0,240}?rgb:\s*'([\d\s,]+)'" % accent, theme)
    if not m:
        sys.exit('✗ 解析不出 theme.js 的 ACCENTS[%s].rgb' % accent)
    brand = tuple(int(x) for x in m.group(1).split(','))

    m = re.search(r"\{\s*key:\s*'%s'[\s\S]{0,420}?solid:\s*'(#[0-9a-fA-F]{6})'" % bgkey, theme)
    if not m:
        sys.exit('✗ 解析不出 theme.js 的 BACKGROUNDS[%s].solid' % bgkey)
    h = m.group(1).lstrip('#')
    base = tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

    # cover 页 .cover 上「品牌色 + 透明档」的那条渐变：165deg，三个色标都要用 --brand-rgb。
    # 深色那条中间一档是 rgba(8,10,9,.6)（不是品牌变量），所以不会被下面这个正则收进来 ——
    # 我们必须取的是**浅色那条**（启动图固定一张，见文件尾的取舍说明）。
    stop_re = re.compile(
        r"rgba\(var\(--brand-rgb[^)]*\)\s*,\s*([\d.]+)\)\s*([\d.]+)%")
    angle, stops = None, None
    for g in re.finditer(r"linear-gradient\((\d+)deg,([^;]*)\)", cover):
        found = stop_re.findall(g.group(2))
        if len(found) == 3 and abs(float(found[0][1])) < 0.01 and abs(float(found[-1][1]) - 100) < 0.01:
            angle, stops = int(g.group(1)), [(float(p) / 100.0, float(a)) for a, p in found]
            break
    if not stops:
        sys.exit('✗ 解析不出 cover.vue 的 .cover 品牌渐变（165deg / 三档透明）')

    # 半透明渐变合成到实色底上：c = base·(1-a) + brand·a。
    # 品牌色在三档里是同一个常数、只有 alpha 在变，而 alpha 沿轴线性 ——
    # 所以"先合成再插值"与"先插值再合成"完全等价，可以直接拿合成后的三色做渐变。
    colors = []
    for pos, a in stops:
        colors.append((pos, tuple(round(base[i] * (1 - a) + brand[i] * a) for i in range(3))))

    return {'accent': accent, 'bg': bgkey, 'brand': brand, 'base': base,
            'angle': angle, 'colors': colors}


GRAD = None      # [(pos, (r,g,b))] 由 derive() 填
GRAD_DEG = 165


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def grad_color(t):
    t = max(0.0, min(1.0, t))
    for i in range(len(GRAD) - 1):
        t0, c0 = GRAD[i]
        t1, c1 = GRAD[i + 1]
        if t0 <= t <= t1:
            return lerp(c0, c1, (t - t0) / (t1 - t0) if t1 > t0 else 0)
    return GRAD[-1][1]


def make_gradient(w, h):
    """按 CSS 角度算线性渐变。低分辨率逐像素算准，再放大 ——
    渐变沿轴线性，双线性放大会精确还原（8bit 取整是唯一误差）。"""
    lw, lh = max(2, w // 8), max(2, h // 8)
    rad = math.radians(GRAD_DEG)
    dx, dy = math.sin(rad), -math.cos(rad)   # CSS 0deg = to top，顺时针为正
    projs = [(x * dx + y * dy) for x in (0, lw) for y in (0, lh)]
    lo, hi = min(projs), max(projs)
    span = (hi - lo) or 1
    small = Image.new('RGB', (lw, lh))
    px = small.load()
    for y in range(lh):
        for x in range(lw):
            px[x, y] = grad_color(((x * dx + y * dy) - lo) / span)
    return small.resize((w, h), Image.BILINEAR)


def add_ninepatch(img, x_stretch, y_stretch):
    """
    在内容图外圈加 1px 黑边，产出 .9.png。
      x_stretch = [(a, b), ...] 内容图坐标系里可水平拉伸的列区间（其余不可拉伸）
      y_stretch = [(a, b), ...] 可垂直拉伸的行区间
    右/下两条黑线按官方要求"拉满"（= padding 覆盖整幅，避免部分设备显示灰边）。
    四边除黑线外的像素必须**完全透明**，aapt 才能认出黑线。
    """
    w, h = img.size
    out = Image.new('RGBA', (w + 2, h + 2), (0, 0, 0, 0))
    out.paste(img.convert('RGBA'), (1, 1))
    px = out.load()
    BLACK = (0, 0, 0, 255)

    for (a, b) in x_stretch:                     # 上边：可水平拉伸的列
        for x in range(max(0, a), min(w, b)):
            px[x + 1, 0] = BLACK
    for (a, b) in y_stretch:                     # 左边：可垂直拉伸的行
        for y in range(max(0, a), min(h, b)):
            px[0, y + 1] = BLACK
    for y in range(h):                           # 右边：拉满（padding）
        px[w + 1, y + 1] = BLACK
    for x in range(w):                           # 下边：拉满（padding）
        px[x + 1, h + 1] = BLACK
    return out


def stretch_from_black(path):
    """从 .9.png 里把黑线读回来（校验/预览用）：返回 (x_stretch, y_stretch, padding_ok)"""
    im = Image.open(path).convert('RGBA')
    w, h = im.size
    px = im.load()

    def dark(p):
        return p[3] > 200 and p[0] < 16 and p[1] < 16 and p[2] < 16

    xs, ys = [], []
    run = None
    for x in range(1, w - 1):
        if dark(px[x, 0]):
            run = (x - 1, x) if run is None else (run[0], x)
        elif run:
            xs.append((run[0], run[1] + 1)); run = None
    if run:
        xs.append((run[0], run[1] + 1))
    run = None
    for y in range(1, h - 1):
        if dark(px[0, y]):
            run = (y - 1, y) if run is None else (run[0], y)
        elif run:
            ys.append((run[0], run[1] + 1)); run = None
    if run:
        ys.append((run[0], run[1] + 1))
    right_full = all(dark(px[w - 1, y]) for y in range(1, h - 1))
    bottom_full = all(dark(px[x, h - 1]) for x in range(1, w - 1))
    return xs, ys, (right_full and bottom_full)


def render_ninepatch(path, out_w, out_h):
    """把 .9.png 按目标尺寸渲染出来（本地预览用，还原 Android 的拉伸规则）"""
    xs_all, ys_all, _ = stretch_from_black(path)
    src = Image.open(path)
    im = src.convert('RGBA').crop((1, 1, src.size[0] - 1, src.size[1] - 1))
    w, h = im.size

    def segs(size, ranges):
        """把 [0,size) 切成 (段起, 段止, 是否可拉伸) 列表"""
        out, cur = [], 0
        for (a, b) in ranges:
            if a > cur:
                out.append((cur, a, False))
            out.append((a, b, True))
            cur = b
        if cur < size:
            out.append((cur, size, False))
        return out

    cols = segs(w, xs_all)
    rows = segs(h, ys_all)
    fixed_w = sum(b - a for a, b, s in cols if not s)
    fixed_h = sum(b - a for a, b, s in rows if not s)
    kx = max(0.0, (out_w - fixed_w)) / max(1, sum(b - a for a, b, s in cols if s))
    ky = max(0.0, (out_h - fixed_h)) / max(1, sum(b - a for a, b, s in rows if s))

    xs_pos, x = [], 0
    for a, b, s in cols:
        n = max(1, int(round((b - a) * (kx if s else 1))))
        xs_pos.append((a, b, x, x + n)); x += n
    ys_pos, y = [], 0
    for a, b, s in rows:
        n = max(1, int(round((b - a) * (ky if s else 1))))
        ys_pos.append((a, b, y, y + n)); y += n

    out = Image.new('RGBA', (x, y), (255, 255, 255, 255))
    for (a, b, dx0, dx1) in xs_pos:
        for (c, d, dy0, dy1) in ys_pos:
            piece = im.crop((a, c, b, d)).resize((max(1, dx1 - dx0), max(1, dy1 - dy0)),
                                                 Image.NEAREST if (dx1 - dx0) <= 2 else Image.BILINEAR)
            out.paste(piece, (dx0, dy0))
    return out


def build(w, h, out_path):
    """整幅都是平滑渐变 → 全幅可拉伸，任何屏幕比例都无感"""
    img = make_gradient(w, h)
    nine = add_ninepatch(img, [(0, w)], [(0, h)])
    nine.save(out_path, 'PNG', optimize=True)
    return {
        'file': os.path.basename(out_path),
        'content': (w, h),
        'file_size': nine.size,
        'bytes': os.path.getsize(out_path),
    }


def main():
    global GRAD, GRAD_DEG
    info = derive()
    GRAD = info['colors']
    GRAD_DEG = info['angle']
    hexs = ['#%02x%02x%02x' % c for _, c in GRAD]

    print('== 从源码推导启动图色标 ==')
    print('  settings.js  accent=%s / background=%s' % (info['accent'], info['bg']))
    print('  theme.js     ACCENTS[%s].rgb   = %s' % (info['accent'], ', '.join(map(str, info['brand']))))
    print('  theme.js     BACKGROUNDS[%s].solid = #%02x%02x%02x'
          % (info['bg'], info['base'][0], info['base'][1], info['base'][2]))
    print('  cover.vue    .cover %ddeg 绯红 %s 合成后 = %s'
          % (GRAD_DEG, ' → '.join('%d%%' % round(p * 100) for p, _ in GRAD), ' → '.join(hexs)))
    print()

    os.makedirs(OUT, exist_ok=True)
    targets = [('splash-hdpi.9.png', 480, 800),
               ('splash-xhdpi.9.png', 720, 1280),
               ('splash-xxhdpi.9.png', 1080, 1920)]
    print('== 生成 .9.png（内容区尺寸取自 uni-app 官方 manifest 说明）==')
    for name, w, h in targets:
        r = build(w, h, os.path.join(OUT, name))
        print('  \u2713 %-24s 内容 %dx%d → 文件 %dx%d  %d KB（纯渐变背景，无图案）'
              % (r['file'], r['content'][0], r['content'][1],
                 r['file_size'][0], r['file_size'][1], r['bytes'] // 1024))

    # ---- 本地预览：按常见机型尺寸把 xxhdpi 那张铺开渲染，肉眼核对"摊平后仍是同一个渐变" ----
    os.makedirs(SCRATCH, exist_ok=True)
    big = os.path.join(OUT, 'splash-xxhdpi.9.png')
    print('== 本地预览（还原 Android 拉伸规则）==')
    for (dw, dh, tag) in [(1212, 2616, '20-9'), (1080, 1920, '16-9'), (1080, 2340, '19.5-9')]:
        pv = render_ninepatch(big, dw, dh)
        p = os.path.join(SCRATCH, 'splash-preview-%s.png' % tag)
        pv.convert('RGB').save(p, 'PNG', optimize=True)
        print('  \u2713 %-8s %dx%d → _tools/_scratch/splash-preview-%s.png' % (tag, dw, dh, tag))

    print()
    print('⚠️ 深色模式取舍：启动图只有**一张**（Android 原生启动窗口不吃主题），')
    print('   所以固定用出厂浅色档。夜间启动会先看到暖砂渐变再切到深色 cover ——')
    print('   这跟 AWword 的选择一致（那边同样只有浅色档），比"白底 + 图标"轻得多。')


if __name__ == '__main__':
    main()
