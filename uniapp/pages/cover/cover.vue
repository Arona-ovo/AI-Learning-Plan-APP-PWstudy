<template>
  <view class="cover" :class="[appTheme, { compact: compact }]" :style="coverStyle" @tap="enter">
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

// 封面停留时长。CSS 里进度条动画的时长必须与之相等（check-cover 守着这条等式），
// 否则会出现"进度条还没走满就跳走"或"走满了还干等"。
const COVER_MS = 2400

export default {
  data() {
    return {
      faceSrc: mascot.srcOf('plana'),
      // 矮屏紧凑档：折叠屏展开 / 平板这类"接近方屏"的设备，垂直方向放不下
      // 头像 + 大间距的固定结构（详见样式里的 .cover.compact 注释）
      compact: false,
      // 实测可视高度（px）。有导航栏 / 挖孔屏的机型上 100vh 不等于可视高度，
      // 单靠 CSS 的 min-height:100vh 会把底部进度条顶到屏幕外（详见样式注释）
      minH: ''
    }
  },
  computed: {
    // 主题背景（theme-mixin 下发）+ 实测高度，合并成一份 inline style
    coverStyle() {
      const s = Object.assign({}, this.appBgStyle || {})
      if (this.minH) s.minHeight = this.minH
      return s
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
    // 兜底：万一 onReady 不回调（极端情况），也要进首页，绝不能卡在封面
    this.arm(COVER_MS + 600)
  },
  onReady() {
    // 计时改从"首帧渲染完"起算：onLoad 时样式还没应用、CSS 动画尚未开始，
    // 慢机上两者能差出几百毫秒 —— 结果是进度条没走满就跳走。
    // 多留 120ms 缓冲，保证进度条一定走完再切页。
    this.arm(COVER_MS + 120)
  },
  onUnload() {
    clearTimeout(this.timer)
  },
  methods: {
    arm(ms) {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => this.enter(), ms)
    },
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
        if (w > 0 && h > 0) {
          this.compact = h / w < 1.35
          this.minH = h + 'px'
        }
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
  /* 100vh 是**兜底**：JS 取到 windowHeight 后会用 inline style 覆盖它（见 pickLayout）。
     为什么还要实测值 —— 带导航栏 / 挖孔屏 / 折叠屏的机型上 100vh 不等于可视高度，
     偏大时底部那条进度条会被顶到屏幕外（用户看到的是"启动页没有进度条"）。 */
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

/* ⚠️ 这里的 stageIn 是跟**原生启动图**配对的一份契约：
   原生启动图只画渐变背景、不画任何图案 —— 图案（圆圈 / 脸）全部由本页画并**淡入**。
   所以这个圆框不能"啪"地出现：那样 splash → cover 还是一次硬切，前面那张图的
   平滑渐变就白做了。反过来，如果哪天把圆框动画删了，启动图会"闪一下再跳出一张脸"。
   两边一起受 _tools/check-native-assets.js 第 5 组管。

   ⚠️⚠️ 这里刻意**不写** `opacity: 0`：淡入交给 stageIn 的 from 帧 + backwards
   （backwards 只在延迟期套用 from 状态，动画结束后元素回到自身样式 = 可见）。
   写死 opacity:0 意味着"动画一旦不执行，圆框就永远不出现"——省电模式、
   部分 ROM 限制后台动画、webview 差异、甚至动效档位误伤，都会让启动页变成
   一张空渐变，而这在开发机上永远测不出来。用 backwards 的降级结果是
   "没有淡入效果"，而不是"没有内容"。 */
.stage {
  position: relative;
  width: 340rpx; height: 340rpx;
  display: flex; align-items: center; justify-content: center;
  animation: stageIn 0.6s ease 0.15s backwards;
}

.ring {
  position: absolute;
  /* 显式四边归零 + margin:auto 居中。
     不写 left/top 时 abspos 的"静态位置"由父级 flex 的 justify/align 决定 ——
     CSS 规范是这么写的，但**不是每个渲染引擎都照做**（部分 webview / 小程序层
     会把它放到包含块左上角）。那正是"圆圈不对称"最隐蔽的一种来源：
     差的是 border 那几 rpx，开发机上看不出来。
     这里也不占用 transform —— ringPulse 要靠 transform 做缩放，
     若用 translate(-50%,-50%) 定位会被动画的 transform 整个覆盖掉，圆会跳位。 */
  left: 0; right: 0; top: 0; bottom: 0;
  width: 340rpx; height: 340rpx;
  margin: auto;
  /* content-box 下声明 340 实际外框是 340+3×2=346，和头像框的间距只剩 5rpx；
     且 border 在某些引擎里按整数 px 取整，左右/上下可能各差 1px —— 肉眼就能看出
     圈不圆、偏一边。声明值 = 外框，间距恒为 10rpx，任何屏宽下都等比。 */
  box-sizing: border-box;
  border-radius: 50%;
  border: 3rpx solid rgba(228, 23, 61, 0.4);
  border: 3rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
  animation: ringPulse 2.4s ease-out infinite;
}

.mascot-wrap {
  /* 同上：320rpx 是**外框**（含 8rpx 白边），里面那张脸才是 304rpx。
     不写的话实际外框 336rpx，圈与脸的间距会和设计稿对不上。 */
  box-sizing: border-box;
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

/* 进度条：用 transform 缩放，**不用 width 动画**。
   width 每帧都要重排一次布局，低端机上这段正好和页面初始化抢主线程 —— 表现就是
   "圈出来的时候卡一下"。transform 走合成层，不碰布局。
   这里同样不加 fill-mode：元素自身就是满格（scaleX(1)），动画只是从 0 涨到 1。
   所以动画一旦不执行，结果是"进度条直接是满的"，而不是永远空着让人以为卡死。 */
.load-fill {
  height: 100%; width: 100%;
  transform: scaleX(1);
  transform-origin: left center;
  border-radius: 999rpx;
  background: #e4173d;
  background: var(--brand, #e4173d);
  animation: load 2.4s linear;
}

.hint {
  margin-top: 24rpx;
  font-size: 20rpx;
  letter-spacing: 4rpx;
  text-indent: 4rpx;
  color: rgba(190, 18, 60, 0.6);
}

/* 同上：不写 opacity:0。淡入的"起始隐藏"全部由 fadeUp 的 from 帧承担，
   动画不执行时这些文字照常显示（降级 = 没有淡入，不是没有字）。
   这条和 .stage 是同一个道理，但风险更大 —— 这里管的是品牌名和底部提示，
   全空的话整屏只剩一个圈，用户第一反应是"这个 App 加载失败了"。 */
.anim { animation: fadeUp 0.7s ease backwards; }

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
  from { transform: scaleX(0); }
  to { transform: scaleX(1); }
}

/* 系统级「减少动效」（Android 的"移除动画"、iOS 的"减弱动态效果"）：
   只停**纯装饰**的循环动画（脉冲圈 / 头像浮动）—— 它们在屏幕外也照样逐帧跑，
   停了对"这是 PWstudy、正在启动"这句话没有任何损失。
   淡入与进度条一律保留：前者是内容出现的方式，后者是"还在启动"的语义信号，
   关掉会让人以为卡死（与 App.vue 里 .fx-motion-off 不关加载指示器的口径一致）。 */
@media (prefers-reduced-motion: reduce) {
  .ring,
  .mascot-wrap { animation: none !important; }
}
</style>
