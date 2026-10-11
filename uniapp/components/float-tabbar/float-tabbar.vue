<template>
  <view class="ftb-wrap">
    <view class="ftb">
      <!-- 选中指示：整格平移（transform，不触发重排），内层胶囊留出与 item 相同的左右间距 -->
      <view class="ftb-ind" :class="{ 'no-anim': !indAnim }" :style="{ transform: 'translateX(' + indX + '%)' }">
        <view class="ftb-ind-pill"></view>
      </view>

      <view
        v-for="t in tabs"
        :key="t.key"
        class="ftb-item"
        :class="{ active: activeKey === t.key }"
        :data-k="t.key"
        hover-class="ftb-item-press"
        hover-start-time="0"
        hover-stay-time="40"
        @tap="go"
      >
        <!-- 图标纯 CSS 绘制：颜色吃 currentColor（由 .ftb-icon 的 color 决定），
             所以换主题色 / 深色模式都能跟着变 —— 之前用 PNG，颜色写在图片里，换色不生效 -->
        <view class="ftb-icon" :class="{ 'ftb-icon-on': activeKey === t.key }">
          <block v-if="t.key === 'home'">
            <view class="ic-stem"></view>
            <view class="ic-ring"><view class="ic-hand"></view></view>
          </block>
          <block v-else-if="t.key === 'goals'">
            <view class="ic-target"><view class="ic-dot"></view></view>
          </block>
          <block v-else-if="t.key === 'stats'">
            <view class="ic-bars">
              <view class="ic-bar ic-bar-1"></view>
              <view class="ic-bar ic-bar-2"></view>
              <view class="ic-bar ic-bar-3"></view>
            </view>
          </block>
          <block v-else>
            <view class="ic-head"></view>
            <view class="ic-body"></view>
          </block>
        </view>
        <text class="ftb-text">{{ tabText(t) }}</text>
      </view>
    </view>
  </view>
</template>

<script>
// 悬浮磨砂玻璃 tabBar（页面内显式注册，不依赖 easycom）
// 用法：在每个 tab 页根节点末尾放 <float-tabbar ref="tabbar" current="home" />，
//      页面 onShow 里再调一次 this.$refs.tabbar.sync()，指示胶囊会从"上一个 tab"滑过来。
// 原生 tabBar 由 utils/nav.js 的 hideNativeTabBar() 隐藏（App 端）。
//
// tab 页在 uni-app 里是常驻的（switchTab 不销毁页面），所以有两个坑：
//  ① 每个页面各有一个本组件实例，实例里记的"当前位置"在切回来时是**上一个停留的 tab**
//     而不是"本页面自己的位置"——起点必须统一取模块级 lastIndex，否则第二次进入
//     会变成"位置本来就在目标上"，动画直接消失（看起来就是没反馈）。
//  ② 同理 pending（点击时的即时高亮）会残留在缓存的实例里，回来时不清理就会
//     高亮到别人身上（选中态与页面不同步）。

import { TABS, tabIndex, markSwitch, tabText } from '../../utils/tab-slide.js';

// 模块级：记住上一次停留的 tab 下标，实现跨页面的连续滑动
let lastIndex = -1;

export default {
  name: 'FloatTabbar',
  props: {
    // 当前 tab key：home / library / review / profile
    current: { type: String, default: '' }
  },
  data() {
    return {
      indIndex: -1,
      // 起点跳转时临时关掉过渡，否则会先朝反方向滑一下再滑回来（"指示器错位"）
      indAnim: true,
      // 点击后立刻生效的"待切换"key：导航完成前先把高亮反馈给手指
      pending: '',
      tabs: TABS
    };
  },
  computed: {
    // 页面传进来的 current 要等新页面挂载后才正确；pending 让点击瞬间就有高亮
    activeKey() {
      return this.pending || this.current;
    },
    curIndex() {
      return tabIndex(this.current);
    },
    indX() {
      return (this.indIndex < 0 ? 0 : this.indIndex) * 100;
    }
  },
  created() {
    // 初始位置直接取"上一次停留的 tab"，避免第一帧闪一下到别处
    this.indIndex = lastIndex >= 0 ? lastIndex : -1;
    // -1 表示"当前没有滑动"；不能用 0，会和首页下标撞上
    this.__sliding = -1;
    this.__timer = 0;
    this.__navLock = false;   // 连点保护，同时标记"导航在途"
  },
  mounted() {
    this.sync();
    // #ifdef APP-PLUS
    this.probeVisible();
    // #endif
  },
  beforeUnmount() {
    if (this.__timer) { clearTimeout(this.__timer); this.__timer = 0; }
  },
  methods: {
    // 底栏文案走 i18n：读一下 __lang 建立渲染依赖，切语言后自动重画
    tabText(t) {
      void this.__lang;
      return tabText(t && t.key);
    },
    // 从"上一个 tab"连续滑到当前 tab；冷启动（没有上一个）直接就位、不播动画。
    //
    // 关键：这个方法会被调用两次（组件 mounted 一次 + 页面 onShow 一次）。
    // 旧实现第二次调用会把 indIndex 直接置成目标位置，把正在跑的滑动"掐断"，
    // 表现为"有时候滑、有时候直接跳"。这里用 __sliding 记住"正在滑向哪里"，
    // 重复的 sync 直接返回，动画就能稳定播完。
    sync() {
      const target = this.curIndex < 0 ? 0 : this.curIndex;
      this.clearStalePending();
      if (this.__sliding === target) return;          // 已经在滑向这个位置，别打断

      // 起点统一用模块级 lastIndex：tab 页常驻，实例自己的 indIndex 不可信
      const from = lastIndex >= 0 ? lastIndex : target;
      if (from !== target) {
        if (this.__timer) { clearTimeout(this.__timer); this.__timer = 0; }
        // ① 无过渡地落到起点 ② 下一帧再开过渡滑到目标
        this.indAnim = false;
        this.indIndex = from;
        this.__sliding = target;
        this.__timer = setTimeout(() => {
          this.__timer = 0;
          this.indAnim = true;
          this.indIndex = target;
          this.__sliding = -1;
          lastIndex = target;
        }, 20);
        return;
      }
      this.indAnim = true;
      this.indIndex = target;
      this.__sliding = -1;
      lastIndex = target;
    },
    // 缓存实例里残留的 pending 会在回到本页时把高亮指到别的 tab。
    // 只有"刚点过、导航还没落地"这一种情况 pending 才是有效反馈（__navLock 期间），
    // 其余一律清掉 —— 选中态始终与当前页面保持一致。
    clearStalePending() {
      if (this.pending && !this.__navLock) this.pending = '';
    },
    go(e) {
      const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.k : '';
      const t = this.tabs.find(x => x.key === key);
      if (!t || t.key === this.activeKey) return;      // 点当前 tab：不重复导航、不重播动画
      if (this.__navLock) return;                      // 连点保护
      this.__navLock = true;
      setTimeout(() => { this.__navLock = false; }, 350);
      // 手指离开前先把高亮切过去（导航由系统接管，可能要一两帧才切页面）
      this.pending = t.key;
      // 记下方向，目标页据此决定从左还是从右滑入
      markSwitch(this.current, t.key);
      uni.switchTab({ url: t.path });
    },
    // 供新手引导测量组件内元素（视口坐标）；拿不到给 null。
    // 页面级的 createSelectorQuery 选不进自定义组件内部，必须组件自己量。
    rect(sel, cb) {
      try {
        uni.createSelectorQuery().in(this).select(sel).boundingClientRect(cb).exec();
      } catch (e) {
        if (cb) cb(null);
      }
    },
    // 诊断：「底部导航不见了」在 App 端几乎总是 webview 没重排 —— 原生 tabBar 隐藏后
    // 页面窗口仍按"被占掉一块"的高度布局，本组件的 fixed bottom:0 于是沉到屏幕外。
    // 这里把关键数值打出来：Chrome 里 inspect App webview，看 lost 就能定性。
    // 只打日志、不擅自改布局 —— 各机型状态栏 / 虚拟按键高度不一，自动纠偏容易误伤。
    probeVisible() {
      setTimeout(() => {
        try {
          const sys = uni.getSystemInfoSync();
          if (!sys) return;
          const lost = (sys.screenHeight || 0) - (sys.windowHeight || 0);
          console.log('[float-tabbar] screen=' + sys.screenHeight + ' window=' + sys.windowHeight + ' lost=' + lost);
          if (lost > 120) {
            console.warn('[float-tabbar] 窗口比屏幕矮了 ' + lost + 'px —— 像是原生 tabBar 占位后 webview 没重排，自绘底栏会沉到屏幕外');
          }
        } catch (e) { /* 系统信息拿不到就跳过诊断 */ }
      }, 800);
    }
  }
};
</script>

<style scoped>
/* 外层只负责定位，不拦截触摸：只有中间的胶囊可点 */
.ftb-wrap {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 500;
  padding: 0 24rpx;
  padding-bottom: calc(20rpx + constant(safe-area-inset-bottom));
  padding-bottom: calc(20rpx + env(safe-area-inset-bottom));
  pointer-events: none;
}

/* 磨砂玻璃胶囊 */
.ftb {
  position: relative;
  display: flex;
  align-items: center;
  height: 112rpx;
  border-radius: 56rpx;
  background: rgba(255, 255, 255, 0.68);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.68);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.6);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.6));
  box-shadow: 0 12rpx 40rpx rgba(23, 32, 26, 0.14), 0 2rpx 8rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 12rpx 40rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.14), 0 2rpx 8rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  pointer-events: auto;
  overflow: hidden;
}

/* 选中指示：整格平移。宽度固定 25%，与 flex:1 + margin:6rpx 的 item 完全对齐；
   用 transform 而不是 left，避免每帧重排（滑动更顺、不卡）。 */
.ftb-ind {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 25%;
  z-index: 0;
  /* 跟手优先：220ms + 起步就快的曲线。再短会失去"连续滑动"的过渡感，
     再长就会觉得点了之后还要等一下才到位。 */
  transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}

/* 跳到起点时关掉过渡（否则会先朝反方向滑一下） */
.ftb-ind.no-anim {
  transition: none !important;
}

.ftb-ind-pill {
  position: absolute;
  top: 12rpx;
  bottom: 12rpx;
  left: 6rpx;
  right: 6rpx;
  border-radius: 44rpx;
  background: rgba(225, 29, 72, 0.1);
  background: rgba(var(--brand-rgb, 225, 29, 72), 0.1);
}

.ftb-item {
  position: relative;
  z-index: 1;
  flex: 1;
  height: 88rpx;
  margin: 0 6rpx;
  border-radius: 44rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: transform 120ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 120ms ease;
}

/* 按下反馈：轻微、快速回弹，避免"按下去半天才弹回来"的黏滞感 */
.ftb-item-press {
  transform: scale(0.94);
  opacity: 0.7;
}

/* 图标容器：color 只在这里定一次，下面的图形一律用 currentColor，
   于是"换主题色"只需要改这一处（选中态由 .ftb-icon-on 覆盖）。 */
.ftb-icon {
  width: 40rpx;
  height: 40rpx;
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ftb-icon-on {
  color: #e11d48;
  color: var(--brand, #e11d48);
}

/* 专注：秒表（顶部提手 + 圆环 + 指针） */
.ic-stem {
  width: 8rpx;
  height: 8rpx;
  border-radius: 2rpx;
  background: currentColor;
  margin-bottom: 3rpx;
}
.ic-ring {
  width: 28rpx;
  height: 28rpx;
  border-radius: 50%;
  border: 5rpx solid currentColor;
  box-sizing: border-box;
  position: relative;
}
.ic-hand {
  position: absolute;
  left: 50%;
  top: 3rpx;
  margin-left: -2rpx;
  width: 4rpx;
  height: 9rpx;
  border-radius: 2rpx;
  background: currentColor;
}

/* 目标：靶心 */
.ic-target {
  width: 30rpx;
  height: 30rpx;
  border-radius: 50%;
  border: 5rpx solid currentColor;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.ic-dot {
  width: 9rpx;
  height: 9rpx;
  border-radius: 50%;
  background: currentColor;
}

/* 统计：柱状图 */
.ic-bars {
  display: flex;
  align-items: flex-end;
}
.ic-bar {
  width: 7rpx;
  border-radius: 3rpx;
  background: currentColor;
  margin: 0 3rpx;
}
.ic-bar-1 { height: 12rpx; }
.ic-bar-2 { height: 20rpx; }
.ic-bar-3 { height: 28rpx; }

/* 我的：人像 */
.ic-head {
  width: 13rpx;
  height: 13rpx;
  border-radius: 50%;
  background: currentColor;
}
.ic-body {
  margin-top: 4rpx;
  width: 28rpx;
  height: 14rpx;
  border-radius: 14rpx 14rpx 0 0;
  background: currentColor;
}

/* 选中时图标弹一下（240ms）。class 只在"变为选中"时才加上，
   所以每次切换恰好播一次；页面被缓存后重新显示不会重播。 */
.ftb-item.active .ftb-icon {
  animation: ftb-pop 240ms cubic-bezier(0.34, 1.4, 0.4, 1);
}

@keyframes ftb-pop {
  0% { transform: scale(0.88); }
  60% { transform: scale(1.1); }
  100% { transform: scale(1); }
}

.ftb-text {
  margin-top: 4rpx;
  font-size: 20rpx;
  line-height: 1.2;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  letter-spacing: 1rpx;
  transition: color 140ms ease;
}

.ftb-item.active .ftb-text {
  color: #e11d48;
  color: var(--brand, #e11d48);
  font-weight: 600;
}
</style>
