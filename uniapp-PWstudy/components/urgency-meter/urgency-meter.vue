<template>
  <!-- 今日紧迫度：几乎不用文字。
       四个图形各说一件事：
         ① 环的填充    = 紧迫度（0-100）
         ② 核心的呼吸  = 紧迫度的强度（越急跳得越快）
         ③ 番茄方块    = 完成难度与进度（空心=已做，实心=还剩）
         ④ 24h 时间条  = 剩余时间（竖线是"现在"，色块是"还要多久"，
                          色块顶到条尾并开始闪 = 今天已经排不下了） -->
  <view class="urg" :class="['urg-lv' + u.level, { 'urg-alarm': u.level >= 3 }]">

    <!-- ① ② 紧迫度环 + 呼吸核心 -->
    <view class="ug-ring" :style="ringStyle">
      <view class="ug-inner">
        <view class="ug-halo" :style="haloStyle"></view>
        <view class="ug-core" :style="coreStyle"></view>
      </view>
    </view>

    <!-- ③ ④ 难度（番茄方块）与剩余时间（时间条） -->
    <view class="ug-side">
      <view class="ug-blocks">
        <view
          v-for="(b, i) in u.blocks"
          :key="i"
          class="ug-blk"
          :class="'ug-blk-' + b"
          :style="b === 'left' ? { background: u.color } : {}"
        ></view>
        <view v-if="u.overflow" class="ug-blk ug-blk-more"></view>
      </view>
      <view class="ug-track">
        <view class="ug-past" :style="{ width: u.passedPct + '%' }"></view>
        <view
          class="ug-need"
          :class="{ 'ug-need-over': u.over }"
          :style="needStyle"
        ></view>
        <view class="ug-now" :style="{ left: u.nowPct + '%' }"></view>
      </view>
    </view>

    <!-- 唯一的"文字"：一个问号。点开才解释这几条到底在说什么 -->
    <view class="ug-help" hover-class="ug-help-press" @tap.stop="onHelp">?</view>
  </view>
</template>

<script>
export default {
  props: {
    u: { type: Object, default: () => ({}) }
  },
  computed: {
    ringStyle() {
      const deg = Math.round((Number(this.u.score) || 0) * 3.6);
      const c = this.u.color || '#F79009';
      return { background: 'conic-gradient(' + c + ' ' + deg + 'deg, rgba(23,32,26,0.08) ' + deg + 'deg)' };
    },
    // 呼吸周期跟着紧迫度走：从容时慢到几乎不动，告急时接近心跳
    beat() {
      return (Number(this.u.beatMs) || 2000) + 'ms';
    },
    coreStyle() {
      return { background: this.u.color || '#F79009', animationDuration: this.beat };
    },
    haloStyle() {
      return {
        borderColor: this.u.color || '#F79009',
        animationDuration: this.beat,
        opacity: 0.18 + (Number(this.u.level) || 0) * 0.1
      };
    },
    needStyle() {
      const start = Number(this.u.nowPct) || 0;
      // 顶到条尾就截断（剩下的一点留给"已经排不下"这个信号去闪）
      const w = Math.min(Number(this.u.fillPct) || 0, Math.max(0, 100 - start));
      return { left: start + '%', width: w + '%', background: this.u.color || '#F79009' };
    }
  },
  methods: {
    onHelp() {
      this.$emit('help', this.u);
    }
  }
}
</script>

<style>
.urg {
  position: relative;
  display: flex;
  align-items: center;
}

/* ===== ① ② 紧迫度环 ===== */
.ug-ring {
  width: 140rpx; height: 140rpx;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.ug-inner {
  width: 104rpx; height: 104rpx;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.9);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.9);
  display: flex; align-items: center; justify-content: center;
  position: relative;
}
.ug-core {
  width: 44rpx; height: 44rpx;
  border-radius: 50%;
  animation-name: ug-breathe;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
}
.ug-halo {
  position: absolute;
  width: 84rpx; height: 84rpx;
  border-radius: 50%;
  border-width: 2rpx;
  border-style: solid;
  animation-name: ug-breathe;
  animation-timing-function: ease-in-out;
  animation-iteration-count: infinite;
  animation-direction: reverse;
}

@keyframes ug-breathe {
  0%   { transform: scale(0.70); opacity: 0.45; }
  50%  { transform: scale(1);    opacity: 1; }
  100% { transform: scale(0.70); opacity: 0.45; }
}

/* ===== ③ 番茄方块：难度与进度 ===== */
.ug-side { flex: 1; min-width: 0; margin-left: 34rpx; padding-right: 34rpx; }
.ug-blocks { display: flex; flex-wrap: wrap; margin-bottom: 20rpx; }
.ug-blk {
  width: 18rpx; height: 18rpx;
  border-radius: 6rpx;
  margin: 0 6rpx 8rpx 0;
  background: rgba(23, 32, 26, 0.1);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.1);
}
.ug-blk-done { opacity: 0.55; }
.ug-blk-more {
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
  opacity: 0.6;
}

/* ===== ④ 24 小时时间条：整条是一天，竖线是现在，色块是还要多久 ===== */
.ug-track {
  position: relative;
  height: 20rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.09);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.09);
}
.ug-past {
  position: absolute; left: 0; top: 0; height: 100%;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.13);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.13);
}
.ug-need {
  position: absolute; top: 3rpx; height: 14rpx;
  border-radius: 999rpx;
  transition: width 400ms cubic-bezier(0.22, 0.61, 0.36, 1), left 400ms ease;
}
.ug-need-over {
  animation: ug-blink 900ms ease-in-out infinite;
}
.ug-now {
  position: absolute; top: -5rpx;
  width: 4rpx; height: 30rpx;
  border-radius: 2rpx;
  background: rgba(23, 32, 26, 0.5);
  background: rgba(var(--ink-1, 23, 32, 26), 0.5);
}

@keyframes ug-blink {
  0%, 100% { opacity: 1; }
  50%      { opacity: 0.35; }
}

/* ===== 告急：环外再套一圈跟着呼吸的光晕，不用一个字也知道出事了 =====
       （光晕挂在环上而不是整张卡上：卡是方的，方光晕看着像错位） */
.urg-alarm .ug-ring {
  animation: ug-alarm 1600ms ease-in-out infinite;
}
@keyframes ug-alarm {
  0%, 100% { box-shadow: 0 0 0 0 rgba(190, 18, 60, 0); }
  50%      { box-shadow: 0 0 0 12rpx rgba(190, 18, 60, 0.16); }
}

/* ===== 那一个问号 ===== */
.ug-help {
  position: absolute;
  top: -10rpx; right: -10rpx;
  width: 44rpx; height: 44rpx;
  border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  border-width: 2rpx;
  border-style: solid;
  border-color: rgba(23, 32, 26, 0.08);
  border-color: var(--hairline, rgba(23, 32, 26, 0.08));
  background: rgba(255, 255, 255, 0.5);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.5);
}
.ug-help-press { opacity: 0.5; }
</style>
