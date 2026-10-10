# gen_icons.py - 一次性生成 PWstudy 的应用图标与底部导航图标
# 源图：icon-src.jpg（用户提供）；输出到 uniapp/static/
# 运行：python gen_icons.py（工作区根目录）
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(ROOT, 'uniapp')
STATIC = os.path.join(APP, 'static')

SRC = os.path.join(ROOT, 'icon-src.jpg')

# ---------- 1. 应用图标：中心裁方 + 各尺寸 ----------
img = Image.open(SRC).convert('RGB')
w, h = img.size
side = min(w, h)
left, top = (w - side) // 2, (h - side) // 2
sq = img.crop((left, top, left + side, top + side))

ICONS_DIR = os.path.join(STATIC, 'icons')
os.makedirs(ICONS_DIR, exist_ok=True)
for size in (48, 72, 96, 144, 192, 1024):
    sq.resize((size, size), Image.LANCZOS).save(os.path.join(ICONS_DIR, 'icon-%d.png' % size))

# 封面 / 头像用的吉祥物图（沿用旧文件名，cover 与 profile 无需改引用）
mascot = sq.resize((512, 512), Image.LANCZOS)
mascot.save(os.path.join(STATIC, 'mascot.jpg'), quality=88)

# ---------- 2. 底部导航图标：极简线性，灰 / 蓝两色 ----------
GREY = (152, 161, 155, 255)     # #98a19b
BLUE = (225, 29, 72, 255)     # #e11d48 玫红（与出厂主色一致）
S = 96          # 画布
STROKE = 7      # 线宽

def canvas():
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im)

def ring(d, cx, cy, r, color, width=STROKE):
    d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=color, width=width)

def save_pair(name, draw_fn):
    for suffix, color in (('', GREY), ('-active', BLUE)):
        im, d = canvas()
        draw_fn(d, color)
        im.save(os.path.join(STATIC, 'tabbar', name + suffix + '.png'))

# 专注：番茄钟 —— 圆环 + 顶部按钮 + 指针
def draw_focus(d, c):
    ring(d, 48, 54, 30, c)
    d.line((48, 10, 48, 20), fill=c, width=STROKE)          # 顶部提手
    d.line((48, 54, 48, 36), fill=c, width=STROKE)          # 指针指向上
    d.line((48, 54, 60, 62), fill=c, width=STROKE)          # 指针偏向右下

# 目标：靶心 —— 外环 + 内环 + 圆点
def draw_goals(d, c):
    ring(d, 48, 48, 34, c)
    ring(d, 48, 48, 19, c, STROKE)
    r = 6
    d.ellipse((48 - r, 48 - r, 48 + r, 48 + r), fill=c)

# 统计：三根柱 + 底线
def draw_stats(d, c):
    y0 = 78
    for x, hh in ((26, 30), (48, 46), (70, 60)):
        d.rounded_rectangle((x - 7, y0 - hh, x + 7, y0), radius=6, fill=c)

save_pair('focus', draw_focus)
save_pair('goals', draw_goals)
save_pair('stats', draw_stats)

print('icons done')
