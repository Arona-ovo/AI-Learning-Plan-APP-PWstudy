# 打包资源：桌面图标与原生启动图

> 这两样东西的共同点：**都只在 APK 里生效**，H5 / 小程序预览看不出来；
> 而且配错时 HBuilderX **一句错都不报**，静默用 DCloud 的默认图。
> 2026-10-12 复查时发现 PWstudy 的图标层级就是错的（下面第一节即事故复盘）。
> 守这道闸的是 `_tools/check-native-assets.js`（含 12 条反向测试）。

---

## 一、图标：必须挂 `app-plus.distribute.icons.android`

```
app-plus
└── distribute
    ├── android
    │   ├── packagename        ← 全小写（写 packageName 不生效，见 partner-handoff）
    │   └── permissions
    ├── icons                  ← ★ 图标在这一层
    │   └── android
    │       ├── mdpi    48
    │       ├── hdpi    72
    │       ├── xhdpi   96
    │       ├── xxhdpi  144
    │       └── xxxhdpi 192
    └── splashscreen           ← 启动图（见第二节）
```

### 事故：写错一层，整包图标全丢

2026-10-12 之前的 manifest 写的是 `distribute.android.icons` —— **多下了一层**。
后果不是报错，而是云端打包**静默回退到 DCloud 默认图标**（绿底白 H）。

铁证（同一份成功打出来的 APK，直接解压看资源）：

| 来源 | 路径 | 尺寸 | 字节 | 是什么 |
| --- | --- | --- | --- | --- |
| PWstudy 的 APK | `res/drawable-xxhdpi/icon.png` | 144×144 | **890** | DCloud 的绿 H |
| 我们的真图 | `uniapp-PWstudy/static/icons/icon-144.png` | 144×144 | **32,599** | 阿罗娜 |
| 对照组 AWword（层级正确） | `res/drawable-xxhdpi/icon.png` | 144×144 | 33,662 | 它自己的图 |

一次配置错误**同时毁掉两样东西**：桌面图标，以及「通用启动界面」（= 应用图标 + 应用名）。

### 自查 / 复现手法（不依赖任何工具链）

```bash
# 1) 直接从 APK 里把真正打进去的图标抠出来（zip 就是容器，改后缀即可）
python - <<'PY'
import zipfile, hashlib
z = zipfile.ZipFile(r'uniapp-PWstudy/unpackage/release/apk/<某个成功包>.apk')
b = z.read('res/drawable-xxhdpi/icon.png')
open('_tools/_scratch/_img/shipped-icon.png', 'wb').write(b)
print(len(b), hashlib.md5(b).hexdigest()[:12])
PY
# 2) 和 static/icons/icon-144.png 对一眼：几百字节 vs 几万字节，一眼就是默认图
# 3) 包名用 aapt2 dump badging <apk> 复核（以实测为准，别信 manifest 声明）
```

`check-native-assets.js` 第 1、2 组把这条钉死：错层级必须不存在（`distribute.android.icons`
出现即红），五个档位必须存在、是 PNG、像素尺寸对得上，并且**体积要大于 1 KB** ——
默认图在那个尺寸下只有几百字节，这条是"静默回退"最灵敏的信号。

---

## 二、启动图：`.9.png` + 只画渐变背景

### 2.1 为什么必须九宫格

云打包把启动图**铺满整屏**（fitXY）。普通 png 的比例只要和屏幕对不上，整张图就会被拉长 ——
实测事故：图 1080×1882（比例 0.574）遇上 1212×2616 的手机（比例 0.463），纵向拉伸约 24%，
圆头像变竖椭圆、字母被抻长。用户原话："第一次打开软件，图片是被拉伸的"。

官方解法是 `.9.png`（"指定特定的区域进行拉伸而不失真"）：四条黑边画在最外一圈 1px，
其余边缘像素保持透明。**上/左 = 可拉伸区**，**右/下 = padding 区（要拉满，
否则部分设备显示灰边）**。

### 2.2 为什么图案一个都不画

启动图上曾经画过「圆头像 + 品牌文字 + 进度槽」，想跟 cover 页无缝衔接，结果是硬切：
`.9.png` 的图案区是**固定像素**（xxhdpi 内容宽 1080），而 cover 页的圆圈是 **rpx 布局**
（340rpx = 屏宽 × 340/750）——1212px 宽的屏上前者 ≈490px、后者 ≈549px（差 12%），
命中 xhdpi 时差 40%。位图图案的绝对尺寸跟不上每台屏幕的宽度，是死结。

所以定案：**启动图只画渐变背景**（拉伸无感），圆圈 / 脸 / 文字全部由 `pages/cover/cover.vue`
绘制并**淡入**（`.stage` 的 `opacity:0` + `@keyframes stageIn`）。两边衔接只剩背景，
背景是平滑渐变，任意比例都对得上。

⚠️ 因此 `cover.vue` 的 `.stage` 淡入**不是装饰**，是这份契约的另一半：
谁把圆框动画删了，启动图就会"闪一下再跳出一张脸"。`check-native-assets.js` 第 5 组守这条。

### 2.3 颜色不是手抄的：`_tools/gen-splash.py` 从源码推导

```
utils/settings.js   accent: 'rose'、background: 'sand'        ← 出厂主题色 / 出厂底色
utils/theme.js      ACCENTS.rose.rgb = "228, 23, 61"
                    BACKGROUNDS.sand.solid = "#f0e4d2"         ← cover 根节点 inline 的 background-color
pages/cover/cover.vue  .cover 的 165deg 渐变：绯红 6% → 13% → 22%  ← cover 根节点 class 的 background-image
                    ↓ 半透明渐变合成到实色底：c = base·(1-a) + brand·a
启动图色标          #efd8c9@0% → #eec9bf@52% → #edb7b1@100%
```

```bash
# 需要 Pillow（只有系统 Python 装了）
C:/Users/33156/AppData/Local/Programs/Python/Python312/python.exe _tools/gen-splash.py
# 产物 uniapp-PWstudy/static/splash/splash-{hdpi,xhdpi,xxhdpi}.9.png
#      + _tools/_scratch/splash-preview-*.png（按真机尺寸铺开的预览，肉眼核对）
```

改封面配色 / 换出厂主题色 / 换出厂底色之后，**必须重新跑一遍再打包**：
`check-native-assets.js` 第 5 组会独立地把同样的推导重算一次，再拿 `.9.png` 的**真实像素**
比对（角点 + 中心，容差 8 个色阶）—— 忘了重新生成就红。

### 2.4 manifest 里的开关

```jsonc
"app-plus": {
    "splashscreen": {
        "alwaysShowBeforeRender": true,   // 等首页首帧渲染完再撤，否则中间闪一帧白底
        "waiting": false,                 // 自定义启动图上不再叠 DCloud 的加载圈
        "autoclose": true,
        "delay": 0
    },
    "distribute": {
        "splashscreen": {
            "androidStyle": "default",    // default = 用下面这套自定义启动图；common = 通用启动界面
            "android": {
                "hdpi":   "static/splash/splash-hdpi.9.png",
                "xhdpi":  "static/splash/splash-xhdpi.9.png",
                "xxhdpi": "static/splash/splash-xxhdpi.9.png"
            }
        }
    }
}
```

⚠️ HBuilderX 的 manifest 可视化编辑器**在改动「模块配置」时会顺手把 `alwaysShowBeforeRender`
写回 false**（实测：取消勾选某个原生模块之后它就变了）。看到守卫报这条红，
直接把 manifest 改回 `true`，**别改断言**。

### 2.5 深色模式的取舍（已知边界）

Android 原生启动窗口只有**一张**图，不分深浅色。我们固定用出厂浅色档：

- 浅色用户（默认）：启动图 → cover 底色完全连续；
- 深色用户：先看到暖砂渐变，再切到深色 cover。

这比原来"白底 + 默认图标 + 加载圈"轻得多，AWword 侧是同样的选择。

---

## 三、落地清单（改这两样东西时）

1. 改图标：换掉源图 `uniapp-PWstudy/assets/icon-src.jpg`，跑 `python _tools/gen-icons.py`
   （中心裁方 + 各尺寸 LANCZOS 缩放，顺带生成 `static/mascot.jpg`）；
   手工换也可以，但尺寸必须是 48/72/96/144/192 的正方形
2. 改启动图配色：先改 `cover.vue` / 出厂主题色，再跑 `_tools/gen-splash.py`
3. 跑 `node _tools/check-native-assets.js`（应 ALL PASS）
4. 跑一次反向测试 `node _tools/_scratch/neg-native-assets.js`（12 项，应全被抓到且还原后仍是绿）
5. **重新云打包**——这两样都是打进 APK 的原生资源，**wgt 热更新换不掉**
6. 装到真机看一眼桌面图标 + 冷启动第一屏（这两样只有真机 / APK 才看得出来）
