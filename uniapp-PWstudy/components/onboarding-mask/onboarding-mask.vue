<template>
  <!-- 新手引导遮罩：全屏模态层。
       点遮罩 / 点按钮 = 下一步；「跳过」直接结束。
       touch 事件全部截断，避免引导期间把底下的页面横滑切走。 -->
  <view
    v-if="step"
    class="gd-root"
    :class="{ 'gd-dark': dark }"
    @tap="onNext"
    @touchstart.stop
    @touchmove.stop.prevent
    @touchend.stop
    @touchcancel.stop
  >
    <!-- 高亮挖洞：巨大 spread 的 box-shadow 在框外铺满遮罩色，中间自然镂空。
         各端（H5/小程序/App webview）都支持 box-shadow，比四块矩形拼接稳。 -->
    <view v-if="box" class="gd-hole" :style="layout.hole" @tap.stop="onNext"></view>

    <!-- 气泡：有高亮时贴着目标（下方 → 上方 → 居中三级兜底），无高亮（欢迎步骤）时整屏居中 -->
    <view v-if="box" class="gd-tip" :style="layout.tip" @tap.stop="onNext">
      <!-- 指示箭头：气泡在目标下方就朝上指，反之朝下；居中态（放不下）不画 -->
      <view
        v-if="layout.side !== 'center'"
        class="gd-arrow"
        :class="'gd-arrow-' + layout.side"
        :style="layout.arrow"
      ></view>
      <view class="gd-head">
        <text class="gd-step-no">{{ stepNo }}</text>
        <text class="gd-skip" @tap.stop="onSkip">{{ $t('跳过') }}</text>
      </view>
      <text class="gd-title">{{ $t(step.title) }}</text>
      <text class="gd-body">{{ $t(step.body) }}</text>
      <view class="gd-foot">
        <view class="gd-dots">
          <view v-for="n in total" :key="n" class="gd-dot" :class="{ on: n - 1 <= index }"></view>
        </view>
        <view class="gd-btn" @tap.stop="onNext">{{ isLast ? $t('开始使用') : $t('下一步') }}</view>
      </view>
    </view>

    <!-- 欢迎步骤：没有挖洞，整层半透明，气泡垂直居中 -->
    <view v-else class="gd-center" @tap.stop="onNext">
      <view class="gd-tip gd-tip-center" @tap.stop="onNext">
        <view class="gd-head">
          <text class="gd-step-no">{{ stepNo }}</text>
          <text class="gd-skip" @tap.stop="onSkip">{{ $t('跳过') }}</text>
        </view>
        <text class="gd-title">{{ $t(step.title) }}</text>
        <text class="gd-body">{{ $t(step.body) }}</text>
        <view class="gd-foot">
          <view class="gd-dots">
            <view v-for="n in total" :key="n" class="gd-dot" :class="{ on: n - 1 <= index }"></view>
          </view>
          <view class="gd-btn" @tap.stop="onNext">{{ isLast ? $t('开始使用') : $t('下一步') }}</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
// components/onboarding-mask.vue - 新手引导的遮罩层（纯展示组件）
// 步骤文案与状态在 utils/onboarding.js，测量与推进在 pages/home/home.vue。
// 这里只负责：画挖洞、画气泡（上下自适应 / 居中两态）、把 next/skip 抛回给页面。
//
// 用大 spread box-shadow 实现"遮罩挖洞"而不是四块矩形拼接：
//   - 一次渲染一个元素，位置变化不会露出接缝
//   - H5 / 小程序 / App webview 对 box-shadow 支持一致
//
// 深浅色不依赖 CSS 变量：模态层要保证任何背景下都可读，
// 由页面传 dark 直接切两套固定配色（与主题切换解耦）。

export default {
  name: 'OnboardingMask',
  props: {
    // 当前步骤（utils/onboarding.js 的 STEPS 项）；null 时不渲染
    step: { type: Object, default: null },
    index: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    // 目标元素的视口矩形 { left, top, width, height }（px）；null = 欢迎步骤
    box: { type: Object, default: null },
    dark: { type: Boolean, default: false }
  },
  // resize：转屏 / 分屏 / 折叠屏展开后让页面重新量一次目标（尺寸变了，旧矩形全作废）
  emits: ['next', 'skip', 'resize'],
  data() {
    return {
      sw: 375,  // 视口宽（px）
      sh: 667,  // 视口高（px）
      _onResize: null
    };
  },
  created() {
    this.readScreen();
  },
  mounted() {
    // ⚠️ 在 created 里读一次是不够的：转屏、分屏、折叠屏展开都会改视口尺寸，
    //    气泡还按旧尺寸摆会直接飞出屏幕 —— 必须订阅窗口变化并回抛 resize 让页面重测。
    if (typeof uni.onWindowResize !== 'function') return;
    this._onResize = (res) => {
      const w = res && res.size && res.size.windowWidth;
      const h = res && res.size && res.size.windowHeight;
      if (!w || !h || (w === this.sw && h === this.sh)) return;
      this.readScreen({ windowWidth: w, windowHeight: h });
      this.$emit('resize');
    };
    try {
      uni.onWindowResize(this._onResize);
    } catch (e) { /* 不支持就算了，按首屏尺寸摆 */ }
  },
  unmounted() {
    if (!this._onResize || typeof uni.offWindowResize !== 'function') return;
    try {
      uni.offWindowResize(this._onResize);
    } catch (e) { /* 同上 */ }
    this._onResize = null;
  },
  computed: {
    isLast() {
      return this.index >= this.total - 1;
    },
    stepNo() {
      return (this.index + 1) + ' / ' + this.total;
    },
    /** 气泡估算高度：横屏（屏高变矮）时按比例收紧，别照搬竖屏的 190 */
    estTipH() {
      return Math.round(Math.min(190, Math.max(120, this.sh * 0.42)));
    },
    /**
     * 一次算完挖洞 + 气泡 + 箭头三处位置，避免三份 computed 各夹一次视口、
     * 夹出互相矛盾的结果（改一处忘了另一处就是"洞在屏幕外、气泡贴着边"）。
     * @return {{hole:string, tip:string, arrow:string, side:string}}
     */
    layout() {
      const b = this.box;
      const none = { hole: '', tip: '', arrow: '', side: 'center' };
      if (!b) return none;
      // 1) 挖洞：夹回视口 —— 目标半露在屏幕外（滚动位置 / 转屏）时也要挖得出来，
      //    否则挖洞跑出屏幕，用户只看到一整片黑、不知道在看哪
      const l = Math.max(0, Math.min(b.left, this.sw - 1));
      const t = Math.max(0, Math.min(b.top, this.sh - 1));
      const w = Math.max(1, Math.min(b.width, this.sw - l));
      const h = Math.max(1, Math.min(b.height, this.sh - t));
      const hole = 'left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;';

      // 2) 气泡：下方 → 上方 → 整屏居中，三级兜底
      const tw = Math.min(this.sw - 32, 320);
      const eh = this.estTipH;
      const belowTop = t + h + 14;
      const aboveTop = t - 14 - eh;
      let side = 'below';
      let left = 0;
      let top = 0;
      if (belowTop + eh <= this.sh) {
        side = 'below';
        left = Math.max(12, Math.min(b.left - 8, this.sw - tw - 12));
        top = belowTop;
      } else if (aboveTop >= 12) {
        side = 'above';
        left = Math.max(12, Math.min(b.left - 8, this.sw - tw - 12));
        top = aboveTop;
      } else {
        // 上下都塞不下（横屏 / 目标占了半屏）：居中，箭头没法指就不画
        side = 'center';
        left = Math.max(12, (this.sw - tw) / 2);
        top = Math.max(12, Math.min((this.sh - eh) / 2, this.sh - eh - 12));
      }
      const tip = 'left:' + Math.round(left) + 'px;top:' + Math.round(top) + 'px;width:' + tw + 'px;';

      // 3) 箭头：水平对齐挖洞中心，夹在气泡内（别露到气泡外）
      const cx = l + w / 2;
      const ax = Math.max(14, Math.min(cx - left - 8, tw - 26));
      const arrow = 'left:' + Math.round(ax) + 'px;';
      return { hole: hole, tip: tip, arrow: arrow, side: side };
    }
  },
  methods: {
    readScreen(info) {
      let i = info;
      if (!i) {
        try {
          i = uni.getSystemInfoSync();
        } catch (e) {
          i = null;
        }
      }
      this.sw = (i && i.windowWidth) || 375;
      this.sh = (i && i.windowHeight) || 667;
    },
    onNext() {
      this.$emit('next');
    },
    onSkip() {
      this.$emit('skip');
    }
  }
};
</script>

<style scoped>
/* 层级：要压过悬浮 tabBar（z-index 500）与悬浮顶栏（400） */
.gd-root {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 950;
}

/* 挖洞：本体透明，只有 box-shadow 往外铺遮罩色 + 白描边呼吸提示可点 */
.gd-hole {
  position: fixed;
  border-radius: 16px;
  border: 2px solid rgba(255, 255, 255, 0.85);
  box-shadow: 0 0 0 9999px rgba(10, 14, 12, 0.62);
  animation: gd-breath 1.6s ease-in-out infinite;
}

@keyframes gd-breath {
  0%, 100% { border-color: rgba(255, 255, 255, 0.85); }
  50% { border-color: rgba(255, 255, 255, 0.3); }
}

/* 欢迎步骤：整屏半透明（没有挖洞），气泡居中 */
.gd-center {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  background: rgba(10, 14, 12, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 气泡卡片：固定浅色系，保证任何背景上可读 */
.gd-tip {
  position: fixed;
  box-sizing: border-box;
  padding: 16px 16px 14px;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.97);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.25);
}

.gd-tip-center {
  position: relative;
  width: 300px;
  max-width: calc(100vw - 48px);
}

/* 指示箭头：纯 CSS 三角，颜色跟气泡一致（深色档在下面单独换色） */
.gd-arrow {
  position: absolute;
  width: 0;
  height: 0;
  border-left: 8px solid transparent;
  border-right: 8px solid transparent;
}

/* 气泡在目标下方 → 箭头长在气泡顶上、朝上指 */
.gd-arrow-below {
  top: -8px;
  border-bottom: 8px solid rgba(255, 255, 255, 0.97);
}

/* 气泡在目标上方 → 箭头长在气泡底下、朝下指 */
.gd-arrow-above {
  bottom: -8px;
  border-top: 8px solid rgba(255, 255, 255, 0.97);
}

.gd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.gd-step-no {
  font-size: 12px;
  font-weight: 600;
  color: #bb1332;
  letter-spacing: 1px;
}

.gd-skip {
  font-size: 12px;
  color: #98a19b;
  padding: 4px 0 4px 12px;
}

.gd-title {
  display: block;
  font-size: 17px;
  font-weight: 600;
  color: #17201a;
  line-height: 1.35;
}

.gd-body {
  display: block;
  margin-top: 6px;
  font-size: 13px;
  color: #5a6560;
  line-height: 1.6;
}

.gd-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 14px;
}

.gd-dots {
  display: flex;
  align-items: center;
}

.gd-dot {
  width: 6px;
  height: 6px;
  border-radius: 3px;
  background: rgba(23, 32, 26, 0.14);
  margin-right: 5px;
  transition: background 160ms ease, width 160ms ease;
}

/* 当前步与已走过的点：实心绯红（小红点属于"选中态"，允许用实心） */
.gd-dot.on {
  width: 14px;
  background: #e4173d;
}

/* 主按钮走 tint（淡红底 + 深红字 + 红描边）：大块实心红在这个 App 里是被否决过的 */
.gd-btn {
  padding: 8px 18px;
  border-radius: 999px;
  background: rgba(228, 23, 61, 0.1);
  border: 1px solid rgba(228, 23, 61, 0.4);
  color: #bb1332;
  font-size: 13px;
  font-weight: 600;
}

.gd-btn:active {
  opacity: 0.85;
}

/* 深色模式：固定深色配色（不跟主题变量，模态层要稳定可读） */
.gd-dark .gd-tip {
  background: rgba(30, 34, 32, 0.97);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.5);
}

.gd-dark .gd-arrow-below {
  border-bottom-color: rgba(30, 34, 32, 0.97);
}

.gd-dark .gd-arrow-above {
  border-top-color: rgba(30, 34, 32, 0.97);
}

.gd-dark .gd-title {
  color: #eaf0ed;
}

.gd-dark .gd-body {
  color: #a7b3ae;
}

.gd-dark .gd-skip {
  color: #74807b;
}

.gd-dark .gd-dot {
  background: rgba(234, 240, 237, 0.18);
}

.gd-dark .gd-dot.on {
  background: #f97c8a;
}

.gd-dark .gd-step-no {
  color: #f97c8a;
}

.gd-dark .gd-btn {
  background: rgba(249, 124, 138, 0.16);
  border-color: rgba(249, 124, 138, 0.45);
  color: #f97c8a;
}

/* 流畅模式：关掉呼吸动画（与全局 perf-smooth 约定一致） */
.perf-smooth .gd-hole {
  animation: none;
}
</style>
