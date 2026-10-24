# 白噪音素材来源与许可

`static/noise/` 里的五种环境音，两种来源，逐条列清楚。
**换素材前先读 `_tools/build-ambient.py` 文件头的四条挑选标准**，改完记得同步本文件
（`_tools/check-ambient.js` 会核对两边对不对得上）。

## 真实录音（2 种）

| 音色 | 文件 | 作者 / 出处 | 许可 |
| --- | --- | --- | --- |
| 雨声 | `rain.wav` | ezwa，[pdsounds.org](http://www.pdsounds.org/sounds/rain)，经 Wikimedia Commons 转载 | **Public domain**（PD-author） |
| 沙滩 | `beach.wav` | Jarrod stanley（J.D. Savanyu），Own work | **CC0 1.0** |

- 雨声原始页：<https://commons.wikimedia.org/wiki/File:Rain_(1).ogg>
- 沙滩原始页：<https://commons.wikimedia.org/wiki/File:Ocean_Waves_on_a_Tropical_Beach.ogg>

两份都是**无需署名、可商用、可再分发**的许可，所以 App 里不另设署名界面。
⚠️ 换素材时如果挑了 CC-BY / CC-BY-SA / FAL 的（Commons 上这类居多），
就必须在 App 的关于页补署名与许可链接 —— 届时本文件要写明署名义务落到哪个界面。

### 处理方式

源录音 → 选一段窗口 → 单声道 32kHz → RMS 归一 → 首尾交叉淡化成无缝循环。
具体参数（起点、时长、峰值上限）写在 `_tools/build-ambient.py` 的 `SOURCES` 里。

⚠️ 为什么只挑 crest（峰值因子）低的窗口：白噪音是按 RMS 归一 + 夹峰值的，
素材里只要有一段 crest 特别高的地方，夹峰值就会把**整段**压下去十几 dB ——
这个音色比别的所有音色轻一大截，而界面完全看不出异常（音量条满的，就是没声）。
这次挑掉过一份 CC0 的小雨录音：crest 23，成品 RMS 只有 0.019（目标 0.12），
比别的音色轻 16dB。另两份（Commons 上一份花园雨、一份"heavy loop"）直接是
**母带削波**（峰值 1.000），同样不能用。

## 自己合成（3 种）

| 音色 | 文件 | 来源 |
| --- | --- | --- |
| 白噪 | `white.wav` | `_tools/gen-noise.py` 合成 |
| 粉噪 | `pink.wav` | 同上 |
| 棕噪 | `brown.wav` | 同上 |

噪声类本来就没有"真实采样"可言，自己合成零版权风险、离线可播。

## 共同的处理口径

- 格式一律 **PCM 单声道 16bit**（安卓 MediaPlayer 对别的编码支持不稳）
- 五种音色的 **RMS 全部归一到 0.12** —— 听感响度由 RMS 决定，按峰值归一的话
  切到白噪会突然吵一倍（白噪峰值因子只有 3~4dB）
- 首尾交叉淡化成无缝循环，**把尾部混到头部**（方向反了循环点会有样本级跳变，
  真实录音上就是"啪"一下，见 `noise_util.crossfade_loop` 的说明）

## 重新生成

```bash
python _tools/build-ambient.py    # 雨声 / 沙滩（首次会下载源录音到 _tools/_cache/）
python _tools/gen-noise.py        # 白噪 / 粉噪 / 棕噪
```

两条产线共用 `_tools/noise_util.py` 的柔化 / 归一 / 交叉淡化，不会分叉。
