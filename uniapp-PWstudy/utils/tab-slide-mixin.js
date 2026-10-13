// utils/tab-slide-mixin.js - tab 页的"内容左右滑动"（局部 mixin）
//
// 用法（四个 tab 页各自引入，参数 = 本页的 tab key）：
//   import tabSlideMixin from '../../utils/tab-slide-mixin.js'
//   export default { mixins: [tabSlideMixin('home')], ... }
// 模板：把"内容区"包一层（顶栏与底栏留在外面，它们不该跟着滑）：
//   <view class="page-slide" :class="slideCls" :style="slideStyle"
//         @touchstart="onSlideStart" @touchmove="onSlideMove"
//         @touchend="onSlideEnd" @touchcancel="onSlideEnd"> ... </view>
//
// 注意：滑动的 transform 只能加在**内容包裹层**上，不能加在页面根节点上 ——
// 根节点上有 fixed 的背景层（.app-root::before/::after），一旦根节点被 transform，
// fixed 会改以它为参照，背景就会跟着内容一起跑。

import * as tabSlide from './tab-slide.js';

export default function tabSlideMixin(key) {
  const idx = tabSlide.tabIndex(key);

  return {
    data() {
      return {
        slideEnter: '',      // 进场方向：'' | 'left' | 'right'
        slideDx: 0,          // 跟手位移(px)
        slideDrag: false     // 是否正在跟手（跟手时关掉过渡）
      };
    },
    computed: {
      slideCls() {
        if (this.slideDrag) return ['dragging'];
        return this.slideEnter ? ['slide-in-' + this.slideEnter] : [];
      },
      // 跟手时才写 transform；松手后交给 CSS 过渡弹回 / 进场动画
      slideStyle() {
        if (!this.slideDrag || !this.slideDx) return {};
        return { transform: 'translateX(' + this.slideDx + 'px)' };
      }
    },
    onShow() {
      // 每次回到本页都先复位（防止上一次拖拽的位移残留），再播进场动画
      this.slideDrag = false;
      this.slideDx = 0;
      this.__axis = 0;
      this.__tracking = false;
      const dir = tabSlide.takeEnter(key);
      if (!dir) return;
      this.slideEnter = dir;
      if (this.__slideTimer) clearTimeout(this.__slideTimer);
      // 动画放完就摘掉 class：transform 归零后 fixed 元素才恢复正常参照
      this.__slideTimer = setTimeout(() => {
        this.slideEnter = '';
        this.__slideTimer = 0;
      }, 320);
    },
    onHide() {
      if (this.__slideTimer) { clearTimeout(this.__slideTimer); this.__slideTimer = 0; }
    },
    methods: {
      onSlideStart(e) {
        const t = e && e.touches && e.touches[0];
        if (!t) return;
        this.__sx = t.clientX;
        this.__sy = t.clientY;
        this.__axis = 0;          // 0 未判定 / 1 横向 / -1 纵向
        this.__tracking = true;
        this.__dx = 0;
        this.__last = 0;          // 上一次真正下发位移的时间戳（节流用）
      },
      onSlideMove(e) {
        if (!this.__tracking) return;
        const t = e && e.touches && e.touches[0];
        if (!t) return;
        const dx = t.clientX - this.__sx;
        const dy = t.clientY - this.__sy;
        if (!this.__axis) {
          const ax = Math.abs(dx);
          const ay = Math.abs(dy);
          if (ax < tabSlide.DRAG.AXIS && ay < tabSlide.DRAG.AXIS) return;
          // 纵向为主 → 交给页面正常滚动，本次手势作废
          if (ax < ay * tabSlide.DRAG.RATIO) {
            this.__axis = -1;
            this.__tracking = false;
            return;
          }
          this.__axis = 1;
        }
        if (this.__axis !== 1) return;
        // 节流到每帧最多一次：touchmove 在 App 端可以到 120Hz，每来一次就改 data
        // 就是一次"逻辑层 → 视图层"通信，首页节点多时直接把帧预算吃光。
        // 方向判定放在节流之前 —— 它不改 data，必须保持灵敏。
        const now = Date.now();
        if (now - (this.__last || 0) < 16) return;
        this.__last = now;
        // 边缘（没有相邻 tab）时只给一点位移，提示"到头了"
        const edge = !(dx < 0 ? tabSlide.neighbor(key, 1) : tabSlide.neighbor(key, -1));
        this.__dx = tabSlide.dampOffset(dx) * (edge ? 0.35 : 1);
        this.slideDrag = true;
        this.slideDx = Math.round(this.__dx);
      },
      onSlideEnd() {
        if (!this.__tracking) return;
        this.__tracking = false;
        if (!this.slideDrag) return;
        const dx = this.__dx;
        // 手指往左 → 看下一个（索引更大，将从右滑入）；往右 → 看上一个
        const target = dx < 0 ? tabSlide.neighbor(key, 1) : tabSlide.neighbor(key, -1);
        if (target && Math.abs(dx) >= tabSlide.DRAG.TRIGGER) {
          // 不复位位移：页面马上被切走，复位反而会出现"弹回再跳走"的多余动画。
          // 下次 onShow 会统一复位（见上面 onShow）。
          tabSlide.markSwitch(key, target.key);
          uni.switchTab({ url: target.path });
          return;
        }
        // 没过阈值 / 边缘：松手弹回
        this.slideDrag = false;
        this.slideDx = 0;
      }
    }
  };
}
