<template>
  <view class="ftb-wrap">
    <view class="ftb">
      <!-- 选中指示：整格平移（transform，不触发重排），内层胶囊留出与 item 相同的左右间距 -->
      <view class="ftb-ind" :style="{ transform: 'translateX(' + indX + '%)' }">
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
//      页面 onShow 里调 syncTabbar(this)（utils/nav.js）给实例一次对账机会。
// 原生 tabBar 由 utils/nav.js 的 hideNativeTabBar() 隐藏（App 端）。
//
// ★ 选中态只有唯一数据源：页面写死的 current prop（2026-10-31 重构）
//
// 真机录屏实锤过的旧病：红色选中态和淡红胶囊经常"不同步"——切页瞬间出现
// "胶囊在 A、红色挂在 B"，然后红色才跳过来，看着就像"框先动、红后跟"。
// 根因链（scrcpy 60fps 逐帧取证）：
//  ① tab 页在 App 端是常驻 webview，每页各有一个本组件实例，实例状态（当时的
//     pending 即时高亮 / indIndex 胶囊位置）在页面不可见期间冻结；
//  ② 切回页面时首帧先用缓存脏状态上屏：红色 = 上次点击残留的 pending，
//     胶囊 = 上次离开时的位置 —— 两个值来自不同历史时刻，天然互相对不上；
//  ③ onShow 里的 sync() 纠偏落在首帧之后（App 端渲染先行、上屏在后），
//     于是红色"跳一下"、胶囊再动 —— 用户看到的就是不同步。
// 修法不是把 sync 提前（赶不赢首帧渲染管线），而是**让脏状态无处生存**：
//  - 删掉 pending：App 端点击后一两帧页面就被切走，"即时高亮"用户根本看不到，
//    真正的即时反馈是 hover 按压态 + 触感震动（都已有）。红色选中态只读 current。
//  - 胶囊位置也只由 current 派生（computed），不再存实例 data、不再有
//    "从上一个 tab 滑过来"的跨页动画 —— App 端每个页面是独立 webview，
//    模块级 lastIndex 各存一份，那个滑动动画在主战场从来就没真正生效过。
//  - 于是页面可见 ⇒ current 正确 ⇒ 红色和胶囊永远指向同一个 tab，
//    分裂从数据层面不可能发生。
// sync() 只剩一个职责：页面可见 ⇒ 清掉本实例残留的连点锁（不清的话，
// 快速切回后第一次点 tab 会被锁吞掉，"点了没反应"）。

import { TABS, tabIndex, markSwitch, tabText } from '../../utils/tab-slide.js';
// 触感反馈：点 tab 震一下（跟着设置 › 触感反馈的总开关走，utils/haptic.js）
import * as haptic from '../../utils/haptic.js';

export default {
  name: 'FloatTabbar',
  props: {
    // 当前 tab key：home / goals / stats / profile（每个页面写死自己的）
    current: { type: String, default: '' }
  },
  data() {
    return {
      tabs: TABS
    };
  },
  computed: {
    // 选中态唯一来源：current prop。不许引入任何"点击即时高亮"之类的
    // 第二来源 —— 那正是红与胶囊分裂的根因（见文件头注释）。
    activeKey() {
      return this.current;
    },
    curIndex() {
      return tabIndex(this.current);
    },
    // 胶囊整格平移：25% 宽一格，translateX 一个格宽 = 100%
    indX() {
      const i = this.curIndex;
      return (i < 0 ? 0 : i) * 100;
    }
  },
  created() {
    this.__navLock = false;   // 连点保护，同时标记"导航在途"
    this.__navLockT = 0;      // 连点锁的定时器 id（sync 提前解锁时要用）
  },
  mounted() {
    this.sync();
    // #ifdef APP-PLUS
    this.probeVisible();
    // #endif
  },
  beforeUnmount() {
    if (this.__navLockT) { clearTimeout(this.__navLockT); this.__navLockT = 0; }
  },
  methods: {
    // 底栏文案走 i18n：读一下 __lang 建立渲染依赖，切语言后自动重画
    tabText(t) {
      void this.__lang;
      return tabText(t && t.key);
    },
    // 页面 onShow 时由 syncTabbar(this) 调一次。现在没有滑动状态机要伺候，
    // 只剩一件事：页面可见 ⇒ 本实例的连点锁必是残留（锁的合法生命期是
    // "点下 → 导航落地"，只活在被离开的那个页面实例上），无条件清。
    // 不清的话：快速切回（onShow 落在 350ms 锁窗口内）后第一次点 tab 被吞。
    sync() {
      this.__navLock = false;
      if (this.__navLockT) { clearTimeout(this.__navLockT); this.__navLockT = 0; }
    },
    go(e) {
      const key = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.k : '';
      const t = this.tabs.find(x => x.key === key);
      if (!t || t.key === this.current) return;        // 点当前 tab：不重复导航
      if (this.__navLock) return;                      // 连点保护
      this.__navLock = true;
      // 记下定时器 id：切页很快落地时 sync() 会提前清它，
      // 不记 id 的话那把清不掉，得等 350ms 自己过期
      if (this.__navLockT) clearTimeout(this.__navLockT);
      this.__navLockT = setTimeout(() => { this.__navLock = false; this.__navLockT = 0; }, 350);
      // 震一下（tap 档，最轻）。⚠️ 必须在"点当前 tab / 连点"都拦掉之后 ——
      // 那两种情况不该有反馈。震不动也要把页切了，所以包 catch。
      try { haptic.tick('tap') } catch (err) { /* 忽略 */ }
      // 记下方向，目标页据此决定从左还是从右滑入
      markSwitch(this.current, t.key);
      // ⚠️ switchTab 会**静默**失败：上一次路由还没落地（快速连点 / 手势快滑切页
      //    刚松手又点）时，uni 直接拒绝本次跳转且不抛错。歇一拍重试一次
      //    （同 nav.js safeNav 的 locked 思路；350ms 在 markSwitch 的 1500ms
      //    方向 TTL 之内，重试落地动画照播）。两次都被拒就只能让用户再点一下
      //    —— 连点锁 350ms 自行过期，之后点击照常。
      const retry = () => { uni.switchTab({ url: t.path }); };
      uni.switchTab({
        url: t.path,
        fail: () => { setTimeout(retry, 350); }
      });
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
  /* ★ 0.68 → 0.97：底栏是常年压在滚动内容之上的功能层，任何明显的半透明都会让
     内容（统计页红色图表柱、列表项文字）从底栏"透出来"变成重影（用户两次反馈）。
     0.97 近似不透明：内容只剩 3%，肉眼不可见；仍留一丝背景色让底栏跟暖砂底不脱节。
     磨砂玻璃的层次改由边框 + 投影承担（不再靠降低透明度）。 */
  background: rgba(255, 255, 255, 0.97);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.97);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.6);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.6));
  box-shadow: 0 12rpx 40rpx rgba(23, 32, 26, 0.14), 0 2rpx 8rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 12rpx 40rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.14), 0 2rpx 8rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  pointer-events: auto;
  overflow: hidden;
}

/* 不支持 backdrop-filter 的端：底栏同样保持近乎不透明，内容不会透出 */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .ftb {
    background: rgba(var(--surface-rgb, 255, 255, 255), 0.97);
  }
}

/* 选中指示：整格平移。宽度固定 25%，与 flex:1 + margin:6rpx 的 item 完全对齐；
   用 transform 而不是 left，避免每帧重排（滑动更顺、不卡）。
   位置由 current prop 派生（computed indX）—— transition 留着：
   若未来某页把 current 改成动态值，胶囊仍会平滑跟过去。 */
.ftb-ind {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 25%;
  z-index: 0;
  transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
  will-change: transform;
}

.ftb-ind-pill {
  position: absolute;
  top: 12rpx;
  bottom: 12rpx;
  left: 6rpx;
  right: 6rpx;
  border-radius: 44rpx;
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
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

/* 按下反馈：轻微、快速回弹，避免"按下去半天才弹回来"的黏滞感。
   点击后的即时反馈全靠它 + 触感震动 —— 不要再造"即时高亮"第二选中态。 */
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
  color: #e4173d;
  color: var(--brand, #e4173d);
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
  color: #e4173d;
  color: var(--brand, #e4173d);
  font-weight: 600;
}
</style>
