# _tools/gen-mascot.py - 看板娘 plana 的表情包与 App 图标生成（只读源图，一次性工具）
#
# 源图：9 张 1024x1024 的剪贴板 jpg（同一个角色，只有表情不同）。
# 产物：
#   uniapp-PWstudy/static/mascot/*.jpg   512x512 q85，启动页圆框 / 默认头像用（9 个表情）
#   uniapp-PWstudy/static/mascot.jpg     512x512 q85，老引用的兜底路径（= 捂嘴默认脸）
#   uniapp-PWstudy/static/icons/*.png    App 图标（48/72/96/144/192/1024），manifest.json 已指向这里
#
# 用法：python _tools/gen-mascot.py <源图目录>
# 源图文件名 → 表情 key 的映射写死在 SRC 里，换图重跑即可。
import os
import sys

from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
UNI = os.path.join(ROOT, 'uniapp-PWstudy')
OUT_DIR = os.path.join(UNI, 'static', 'mascot')
ICON_DIR = os.path.join(UNI, 'static', 'icons')
SIZE = 512
Q = 85

# 源文件名（前缀即可） → 表情 key
SRC = [
    ('485Z', 'plana'),      # 捂嘴（无嘴）：默认脸，App 图标与默认头像都从这张出
    ('489Z', 'nervous'),    # 紧张波浪嘴
    ('491Z', 'surprise'),   # 惊讶 o 嘴
    ('493Z', 'happy'),      # 开心笑
    ('495Z', 'calm'),       # 平静
    ('497Z', 'angry'),      # 生气
    ('499Z', 'tongue'),     # 吐舌
    ('501Z', 'sad'),        # 委屈扁嘴
    ('503Z', 'shock'),      # 震惊
]

ICON_SIZES = [48, 72, 96, 144, 192, 1024]


def find_src(src_dir, prefix):
    for n in os.listdir(src_dir):
        if prefix in n and n.lower().endswith(('.jpg', '.jpeg', '.png')):
            return os.path.join(src_dir, n)
    raise SystemExit('找不到源图：' + prefix)


def save_jpg(im, path):
    im.convert('RGB').save(path, 'JPEG', quality=Q, optimize=True)


def main():
    src_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.expanduser(
        r'~\.workbuddy\clipboard-images')
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ICON_DIR, exist_ok=True)

    made = {}
    for prefix, key in SRC:
        im = Image.open(find_src(src_dir, prefix))
        if im.size != (SIZE, SIZE):
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
        out = os.path.join(OUT_DIR, key + '.jpg')
        save_jpg(im, out)
        made[key] = im
        print('  ✓ static/mascot/%s.jpg  %.0f KB' % (key, os.path.getsize(out) / 1024))

    # 老引用兜底：static/mascot.jpg = 默认脸（捂嘴）
    default = made['plana']
    save_jpg(default, os.path.join(UNI, 'static', 'mascot.jpg'))
    print('  ✓ static/mascot.jpg（= plana 默认脸）')

    # App 图标：从 1024 原图重采样（图标要锐利，不用 512 的二次缩））
    hi = Image.open(find_src(src_dir, '485Z')).convert('RGB')
    for s in ICON_SIZES:
        out = os.path.join(ICON_DIR, 'icon-%d.png' % s)
        hi.resize((s, s), Image.LANCZOS).save(out, 'PNG', optimize=True)
        print('  ✓ static/icons/icon-%d.png' % s)


if __name__ == '__main__':
    main()
