# 白噪音素材来源与许可

`static/noise/` 里的五种环境音，两种来源，逐条列清楚。
**换素材前先读 `_tools/build-ambient.py` 文件头的挑选标准**，改完记得同步本文件
（`_tools/check-ambient.js` 会核对两边对不对得上）。

## 真实录音（1 种：沙滩海浪）

| 音色 | 文件 | 来源 | 许可 |
| --- | --- | --- | --- |
| 沙滩 | `beach.wav` | Sea and river wave sounds (VistulaShort) — RandomMind（[opengameart](https://opengameart.org/content/sea-and-river-wave-sounds)） | CC0 1.0 |

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

## 程序合成（4 种）

| 音色 | 文件 | 来源 |
| --- | --- | --- |
| 白噪 | `white.wav` | `_tools/gen-noise.py` 合成 |
| 粉噪 | `pink.wav` | 同上 |
| 棕噪 | `brown.wav` | 同上 |
| 雨声 | `rain.wav` | `_tools/gen-rain.py` 合成（**自合成 / synthesized**） |

### 雨声为什么改成合成

雨声在 2026-10-26 当天经历了「真实录音 → 程序合成 → 真实录音」的来回，结论：

- 最早真实录音（ezwa/pdsounds 公有领域）被反馈「太密集像暴雨、偏吵」—— 这是**素材本身的性格**，
  真实录音改不了（大雨滤波只能变闷）。
- 当天曾改程序合成，但三轮都「不像真的」（像滤波噪音）—— 于是回归真实录音，换了性格更合适的
  CC0《AMB Rain Loop 1》（本身为无缝循环设计、温和不过密）。
- **但用户实测后认为真实雨声仍然太嘈杂。** 真实录音的密度/频谱是固定的，调不动；而用户要的
  是「更稀、更平」的雨声。只有合成能把水珠密度、频谱柔和度完全可控地做出来，且零版权风险。
  所以 2026-10-27 起雨声改用 `_tools/gen-rain.py` 合成：一层很轻的低通雨幕底噪 + 稀疏水珠瞬态
  （约 8 滴/秒、带随机间隙）+ 很慢的雨势起伏 LFO + 整体低通到 3.5kHz 压掉刺耳高频。
  口径与另三种一致：RMS 0.10、峰值 ≤0.95、首尾交叉淡化无缝循环、32k 单声道 16bit。

噪声类本来就没有"真实采样"可言，自己合成零版权风险、离线可播。

## 共同的处理口径

- 格式一律 **PCM 单声道 16bit**（安卓 MediaPlayer 对别的编码支持不稳）
- 五种音色的 **RMS 归一到一致响度**：白/粉/棕噪 0.12，雨声/沙滩 0.10（低 1.6dB 是刻意的"不吵"，仍在护栏 ±2dB 窗口内，切换不跳变）
- 首尾交叉淡化成无缝循环，**把尾部混到头部**（方向反了循环点会有样本级跳变）

## 重新生成

```bash
python _tools/build-ambient.py    # 仅沙滩（从 opengameart 拉 CC0 真实录音后处理；联网，已下载则复用缓存）
python _tools/gen-rain.py         # 雨声（程序合成：稀疏平缓）
python _tools/gen-noise.py        # 白噪 / 粉噪 / 棕噪
```

两条产线共用 `_tools/noise_util.py` 的柔化 / 归一 / 交叉淡化，不会分叉。
