# gen-pin.py - 生成学习范围地图上的图钉（uniapp-PWstudy/static/pin.png）
# 运行：python _tools/gen-pin.py（仓库根目录）
#
# 为什么非得有这张图（2026-10-26）：
#   range-map.vue 里 marker 的 iconPath 写的是 '/static/pin.png'，而这张图**从来没被生成过**
#   —— uni 的 markers 结构里 iconPath 是必填项，指向一个不存在的文件时高德 SDK 取不到
#   bitmap，图钉就整个不画。用户在地图里看到的就是"一个点都没有"。
#   「不传 iconPath 让高德用默认红图钉」这条路在 uni 里走不通（必填），所以补图是唯一解。
#
# 画法：水滴形（圆头 + 向下的尖），绯红实心 + 白描边 + 白圆心。
#   白描边不是装饰：底图颜色深浅不定（道路灰白 / 绿地 / 水体），纯红图钉压在浅色路面上
#   会糊成一片；一圈白边在任何底图上都能把形状抠出来。
#   出图 3 倍（marker 里按 28×36 px 显示）：安卓高分屏直接按 1:1 采样才不毛边。
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'uniapp-PWstudy', 'static', 'pin.png')

BRAND = (228, 23, 61, 255)      # #e4173d 绯红
BRAND_DK = (187, 19, 50, 255)   # #bb1332 深一档，描边与尖部用
WHITE = (255, 255, 255, 255)

SS = 4                          # 超采样倍数（先画大再缩，边缘才平滑）
W, H = 28 * SS, 36 * SS         # = marker 的显示尺寸 28×36 px
R = 10 * SS                     # 圆头半径
CX = W // 2
CY = R + 2 * SS                 # 圆心稍微下移，给顶部描边留位置
TIP = H - 1 * SS                # 尖端落在底边上（anchor {x:.5, y:1} → 尖端即坐标点）
BORDER = max(2, int(1.6 * SS))  # 白描边


def pin_points(scale):
    """水滴的三个切点（scale>1 时整体往外扩，做白影用）"""
    import math
    a = math.radians(58)                       # 切线与水平方向的夹角
    r = R * scale
    px, py = CX + r * math.cos(a), CY + r * math.sin(a)
    qx, qy = CX - r * math.cos(a), CY + r * math.sin(a)
    return [(px, py), (CX, TIP + (TIP - CY) * (scale - 1)), (qx, qy)]


def main():
    im = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    # 先铺白影（形状整体外扩一圈），再压红色形状 —— 描边画在形状同一路径上会把
    # 圆头和尖部的接缝切断，缩到 28px 就成了两截（第一版踩过）
    b = R + BORDER
    d.polygon(pin_points(1 + float(BORDER) / R), fill=WHITE)
    d.ellipse((CX - b, CY - b, CX + b, CY + b), fill=WHITE)
    d.polygon(pin_points(1), fill=BRAND)
    d.ellipse((CX - R, CY - R, CX + R, CY + R), fill=BRAND)
    # 白圆心（半径 = 圆头的 38%）
    r2 = int(R * 0.38)
    d.ellipse((CX - r2, CY - r2, CX + r2, CY + r2), fill=WHITE)
    im.resize((28, 36), Image.LANCZOS).save(OUT)
    print('wrote %s (%d bytes)' % (OUT, os.path.getsize(OUT)))


if __name__ == '__main__':
    main()
