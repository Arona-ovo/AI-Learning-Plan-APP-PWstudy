# 白噪音素材来源与许可

`static/noise/` 里的五种环境音，两种来源，逐条列清楚。
**换素材前先读 `_tools/build-ambient.py` 文件头的挑选标准**，改完记得同步本文件
（`_tools/check-ambient.js` 会核对两边对不对得上）。

## 真实录音（2 种：雨声 / 沙滩海浪）

| 音色 | 文件 | 来源 | 许可 |
| --- | --- | --- | --- |
| 雨声 | `rain.wav` | AMB Rain Loop 1 — Kresiek The Furry（[opengameart](https://opengameart.org/content/amb-rain-loop-1)） | CC0 1.0 |
| 沙滩 | `beach.wav` | Sea and river wave sounds (VistulaShort) — RandomMind（[opengameart](https://opengameart.org/content/sea-and-river-wave-sounds)） | CC0 1.0 |

雨声/沙滩在 2026-10-26 当天经历了「真实录音 → 程序合成 → 真实录音」的来回，结论记一下：

- 最早用的是真实录音（雨声 ezwa/pdsounds 公有领域、沙滩 Jarrod stanley/CC0），但真机反馈
  「雨声太密集像暴雨、沙滩太连续没有一阵一阵、整体偏吵」—— 这些是**素材本身的性格**，
  真实录音改不了（大雨滤波只能变闷、平稳段天然没有涌浪起伏）。于是当天改成程序合成，
  密度/涌浪周期/频谱全部可控。
- 但合成三轮都「不像真的」：雨声听着像滤波噪音、沙滩频率太固定。**根因是合成很难做出
  真雨「无数有音高的水珠」和海浪「一阵一阵的涌浪」那种自然纹理。**
- 用户最终要求「不要生成的，直接在网上找现成的」—— 所以回归真实录音，但**换用性格合适的
  CC0 实况录音**：雨声用 Kresiek The Furry 的《AMB Rain Loop 1》（本身就是为无缝循环设计的
  雨声，温和不过密），海浪用 RandomMind 的《Sea and river wave sounds》（自然涌浪、非平稳段）。

### 处理方式

真实录音（opengameart，CC0） → ffmpeg 转 32k 单声道 16bit wav
  → `noise_util.declick` 削孤立爆音
  → **RMS 归一到 0.10**（与白/粉/棕噪 0.12 差 1.6dB，在护栏 ±2dB 窗口内）
  → **只压峰的软限幅**（把越界峰压到 ≤0.95，主体不动 → 保住 RMS，避免整段被峰值夹压垮）
  → `noise_util.crossfade_loop` 首尾交叉淡化成无缝循环（尾部混到头部）。
海浪还会先用 1s 能量包络挑一个「从波谷起、峰谷差明显」的 30s 窗口，让 30s 里有清晰涌浪、
且循环点落在安静处。具体流程写在 `_tools/build-ambient.py`。

⚠️ 为什么按 RMS 归一而不是峰值：白噪峰值因子只有 3~4dB，按峰值归一会让切到白噪
  突然吵一倍。按 RMS 归一五种音色才一样响（见 noise_util.normalize 的说明）。

## 自己合成（3 种）

| 音色 | 文件 | 来源 |
| --- | --- | --- |
| 白噪 | `white.wav` | `_tools/gen-noise.py` 合成 |
| 粉噪 | `pink.wav` | 同上 |
| 棕噪 | `brown.wav` | 同上 |

噪声类本来就没有"真实采样"可言，自己合成零版权风险、离线可播。

## 共同的处理口径

- 格式一律 **PCM 单声道 16bit**（安卓 MediaPlayer 对别的编码支持不稳）
- 五种音色的 **RMS 归一到一致响度**：白/粉/棕噪 0.12，雨声/沙滩 0.10（低 1.6dB 是刻意的"不吵"，仍在护栏 ±2dB 窗口内，切换不跳变）
- 首尾交叉淡化成无缝循环，**把尾部混到头部**（方向反了循环点会有样本级跳变）

## 重新生成

```bash
python _tools/build-ambient.py    # 雨声 / 沙滩（从 opengameart 拉 CC0 真实录音后处理；联网，已下载则复用缓存）
python _tools/gen-noise.py        # 白噪 / 粉噪 / 棕噪
```

两条产线共用 `_tools/noise_util.py` 的柔化 / 归一 / 交叉淡化，不会分叉。
