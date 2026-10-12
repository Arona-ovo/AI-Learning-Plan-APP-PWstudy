<template>
  <view class="cover" :class="[appTheme, { compact: compact }]" :style="appBgStyle" @tap="enter">
    <view class="deco deco-1"></view>
    <view class="deco deco-2"></view>
    <view class="deco deco-3"></view>

    <view class="stage">
      <view class="ring"></view>
      <view class="mascot-wrap">
        <image class="mascot" :src="faceSrc" mode="aspectFill" />
      </view>
    </view>

    <view class="brand">
      <view class="app-name anim" style="animation-delay:.25s">PWSTUDY</view>
      <view class="divider anim" style="animation-delay:.55s"></view>
      <view class="app-en anim" style="animation-delay:.75s">AI STUDY PLANNER</view>
    </view>

    <view class="footer anim" style="animation-delay:1s">
      <view class="load-track"><view class="load-fill"></view></view>
      <view class="hint">TAP TO START</view>
    </view>
  </view>
</template>

<script>
import * as mascot from '../../utils/mascot.js'

export default {
  data() {
    return {
      faceSrc: mascot.srcOf('plana'),
      // 矮屏紧凑档：折叠屏展开 / 平板这类"接近方屏"的设备，垂直方向放不下
      // 头像 + 大间距的固定结构（详见样式里的 .cover.compact 注释）
      compact: false
    }
  },
  onLoad() {
    // 多邻国式：圆框里那张脸跟着状态走 —— 今天做没做、最近摆没摆、截止日紧不紧。
    // 只在启动这一刻取一次：封面只停留两秒多，表情不需要实时刷新。
    try {
      this.faceSrc = mascot.pick().src
    } catch (e) {
      this.faceSrc = mascot.srcOf('plana')
    }
    this.pickLayout()
    // 2.4 秒后自动进入首页，与底部进度条动画同步
    this.timer = setTimeout(() => this.enter(), 2400)
  },
  onUnload() {
    clearTimeout(this.timer)
  },
  methods: {
    /**
     * 按屏幕高宽比挑一档布局。
     *
     * 横向尺寸一律用 rpx（按屏宽等比），所以**任何屏宽下形状都不会变**——
     * 圆永远是圆，头像框永远是正方形。真正会随屏幕变的是**垂直方向够不够放**：
     * 100vh 换算成 rpx 是 750 × (高/宽)，屏越方它越小，而封面内容是固定 rpx 的一摞。
     * 主流手机高宽比 ≥ 1.7，富余一大截；折叠屏展开 / 平板能掉到 1.0~1.2，就会挤爆。
     *
     * 所以这里只看比例，不看分辨率 —— 720p 和 4K 只要比例一样，布局问题完全一样。
     */
    pickLayout() {
      try {
        const s = uni.getSystemInfoSync() || {}
        const w = Number(s.windowWidth || s.screenWidth || 0)
        const h = Number(s.windowHeight || s.screenHeight || 0)
        if (w > 0 && h > 0) this.compact = h / w < 1.35
      } catch (e) {
        this.compact = false
      }
    },
    enter() {
      if (this.entered) return
      this.entered = true
      clearTimeout(this.timer)
      uni.switchTab({ url: '/pages/home/home' })
    }
  }
}
</script>

<style>
/* 浅蓝封面：底色贴近全局背景的浅蓝调，避免启动时出现深色大色块 */
.cover {
  position: relative;
  min-height: 100vh;
  background: linear-gradient(165deg, #f2f7ff 0%, #e0ecff 52%, #cfe0ff 100%);
  background: linear-gradient(165deg, rgba(var(--brand-rgb, 228, 23, 61), 0.06) 0%, rgba(var(--brand-rgb, 228, 23, 61), 0.13) 52%, rgba(var(--brand-rgb, 228, 23, 61), 0.22) 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  box-sizing: border-box;
  padding: 180rpx 48rpx 100rpx;
  overflow: hidden;
}

/* 深色模式下的封面：避免夜里启动时闪一下亮屏 */
.app-dark.cover {
  background: linear-gradient(165deg, rgba(var(--brand-rgb, 228, 23, 61), 0.14) 0%, rgba(8, 10, 9, 0.6) 52%, #121513 100%);
}

.deco { position: absolute; border-radius: 50%; }
.deco-1 {
  width: 420rpx; height: 420rpx; right: -160rpx; top: -140rpx;
  background: radial-gradient(circle, rgba(228, 23, 61, 0.18), rgba(228, 23, 61, 0));
  background: radial-gradient(circle, rgba(var(--brand-rgb, 228, 23, 61), 0.18), rgba(var(--brand-rgb, 228, 23, 61), 0));
}
.deco-2 {
  width: 300rpx; height: 300rpx; left: -120rpx; top: 46%;
  background: radial-gradient(circle, rgba(228, 23, 61, 0.12), rgba(228, 23, 61, 0));
  background: radial-gradient(circle, rgba(var(--brand-rgb, 228, 23, 61), 0.12), rgba(var(--brand-rgb, 228, 23, 61), 0));
}
.deco-3 {
  width: 200rpx; height: 200rpx; right: 8%; bottom: 14%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.75), rgba(255, 255, 255, 0));
  background: radial-gradient(circle, rgba(var(--surface-rgb, 255, 255, 255), 0.75), rgba(var(--surface-rgb, 255, 255, 255), 0));
}

/* ⚠️ 这里的 opacity:0 + stageIn 是跟**原生启动图**配对的一份契约：
   原生启动图只画渐变背景、不画任何图案 —— 图案（圆圈 / 脸）全部由本页画并**淡入**。
   所以这个圆框不能"啪"地出现：那样 splash → cover 还是一次硬切，前面那张图的
   平滑渐变就白做了。反过来，如果哪天把圆框动画删了，启动图会"闪一下再跳出一张脸"。
   两边一起受 _tools/check-native-assets.js 第 5 组管。 */
.stage {
  position: relative;
  width: 340rpx; height: 340rpx;
  display: flex; align-items: center; justify-content: center;
  opacity: 0;
  animation: stageIn 0.6s ease 0.15s forwards;
}

.ring {
  position: absolute;
  width: 340rpx; height: 340rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(228, 23, 61, 0.4);
  border: 3rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
  animation: ringPulse 2.4s ease-out infinite;
}

.mascot-wrap {
  width: 320rpx; height: 320rpx;
  border-radius: 50%;
  background: #ffffff;
  background: var(--solid, #ffffff);
  border: 8rpx solid rgba(255, 255, 255, 0.95);
  border: 8rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.95));
  box-shadow: 0 16rpx 56rpx rgba(228, 23, 61, 0.22);
  box-shadow: 0 16rpx 56rpx rgba(var(--brand-rgb, 228, 23, 61), 0.22);
  overflow: hidden;
  animation: float 3.2s ease-in-out infinite;
}

.mascot { width: 100%; height: 100%; }

.brand {
  display: flex; flex-direction: column; align-items: center;
  margin-top: 72rpx;
}

.app-name {
  font-size: 46rpx;
  font-weight: 500;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  letter-spacing: 10rpx;
  text-indent: 10rpx;
  font-family: Georgia, "Times New Roman", serif;
}

.app-en {
  margin-top: 32rpx;
  font-size: 20rpx;
  letter-spacing: 5rpx;
  text-indent: 5rpx;
  color: rgba(190, 18, 60, 0.62);
  font-family: Georgia, "Times New Roman", serif;
}

.divider {
  width: 64rpx; height: 2rpx;
  background: rgba(228, 23, 61, 0.38);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.38);
  margin-top: 36rpx;
}

/* ⚠️ 这里以前是 position:absolute + bottom:100rpx —— 在矮屏上内容会往下溢出，
   绝对定位的进度条却钉在 100vh 底部不动，于是它和品牌文字叠在一起（且被 overflow 裁掉）。
   改成 margin-top:auto 让它留在 flex 流里：屏够高就贴底，屏不够就跟着内容往下走，
   两种情况下都不会和上面的东西重叠。 */
.footer {
  margin-top: auto;
  align-self: stretch;
  display: flex; flex-direction: column; align-items: center;
}

/* 矮屏紧凑档（高宽比 < 1.35，见 pickLayout）：垂直方向整体收一档。
   只收纵向尺寸和间距 —— 横向的 rpx 本来就跟着屏宽等比缩放，改它反而会变形。
   收完之后总高约 586rpx，即使高宽比掉到 0.8（比方还扁）也放得下。 */
.cover.compact { padding-top: 96rpx; padding-bottom: 72rpx; }
.cover.compact .stage,
.cover.compact .ring { width: 260rpx; height: 260rpx; }
.cover.compact .mascot-wrap { width: 244rpx; height: 244rpx; }
.cover.compact .brand { margin-top: 40rpx; }
.cover.compact .app-name { font-size: 40rpx; letter-spacing: 8rpx; text-indent: 8rpx; }
.cover.compact .divider { margin-top: 24rpx; }
.cover.compact .app-en { margin-top: 20rpx; }
.cover.compact .hint { margin-top: 16rpx; }

.load-track {
  width: 240rpx; height: 4rpx;
  border-radius: 999rpx;
  background: rgba(228, 23, 61, 0.18);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.18);
  overflow: hidden;
}

.load-fill {
  height: 100%; width: 0;
  border-radius: 999rpx;
  background: #e4173d;
  background: var(--brand, #e4173d);
  animation: load 2.4s linear forwards;
}

.hint {
  margin-top: 24rpx;
  font-size: 20rpx;
  letter-spacing: 4rpx;
  text-indent: 4rpx;
  color: rgba(190, 18, 60, 0.6);
}

.anim { opacity: 0; animation: fadeUp 0.7s ease forwards; }

@keyframes fadeUp {
  from { opacity: 0; transform: translateY(36rpx); }
  to { opacity: 1; transform: translateY(0); }
}
/* 圆框（圈 + 脸）从原生启动图的渐变背景上"浮"出来，接住 splash，
   见 .stage 上方的注释；时长与延迟沿用同一套节奏（0.6s ease 0.15s）。 */
@keyframes stageIn {
  from { opacity: 0; transform: scale(0.92); }
  to { opacity: 1; transform: scale(1); }
}
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-14rpx); }
}
@keyframes ringPulse {
  0% { transform: scale(1); opacity: 0.6; }
  100% { transform: scale(1.45); opacity: 0; }
}
@keyframes load {
  from { width: 0; }
  to { width: 100%; }
}
</style>
