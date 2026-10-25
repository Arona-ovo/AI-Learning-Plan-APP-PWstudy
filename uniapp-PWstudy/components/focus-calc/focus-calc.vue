<template>
  <!-- touchmove 在遮罩层截断：fixed 不等于层级断开，滑动照样会滚背后的页面
       （2026-10-26，与 home.vue 的 .fs-mask 同一处毛病）。卡内没有可滚区域，整层吞掉。 -->
  <view class="fc-mask" v-if="show" @tap="close" @touchmove.stop.prevent="noop">
    <view class="fc-card" @tap.stop="noop">
      <view class="fc-screen">
        <text class="fc-expr">{{ expr || '0' }}</text>
        <text class="fc-res" v-if="res !== ''">= {{ res }}</text>
      </view>
      <view class="fc-pad">
        <view class="fc-row">
          <text class="fc-key fc-fn" @tap="clear">C</text>
          <text class="fc-key fc-op" @tap="op('÷')">÷</text>
          <text class="fc-key fc-op" @tap="op('×')">×</text>
          <text class="fc-key fc-fn" @tap="back">⌫</text>
        </view>
        <view class="fc-row">
          <text class="fc-key" @tap="num('7')">7</text>
          <text class="fc-key" @tap="num('8')">8</text>
          <text class="fc-key" @tap="num('9')">9</text>
          <text class="fc-key fc-op" @tap="op('−')">−</text>
        </view>
        <view class="fc-row">
          <text class="fc-key" @tap="num('4')">4</text>
          <text class="fc-key" @tap="num('5')">5</text>
          <text class="fc-key" @tap="num('6')">6</text>
          <text class="fc-key fc-op" @tap="op('+')">+</text>
        </view>
        <view class="fc-row">
          <text class="fc-key" @tap="num('1')">1</text>
          <text class="fc-key" @tap="num('2')">2</text>
          <text class="fc-key" @tap="num('3')">3</text>
          <text class="fc-key fc-eq" @tap="equal">=</text>
        </view>
        <view class="fc-row">
          <text class="fc-key fc-wide" @tap="num('0')">0</text>
          <text class="fc-key" @tap="num('.')">.</text>
          <text class="fc-key" @tap="num('00')">00</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
// components/focus-calc/focus-calc.vue - 专注页内置计算器
//
// 为什么要内置（番茄ToDo 也有一个，2026-10-15 逐帧看到的）：
//   学数学/算账时人很自然地要按计算器，切出去用系统计算器会**触发强制模式拉回** ——
//   那是正当需求被当成逃逸。与其给计算器开白名单（等于开了个"随便切"的口子），
//   不如把它搬进来：专注不用中断，强制模式也不用破例。
//
// 界面上**一个中文都没有**（全是数字与运算符），所以不占 i18n 的额度。
//
// 运算说明：先 × ÷ 后 + −（有优先级，不是左到右硬算）——
//   2+3×4 得 14 而不是 20，跟人拿起实体计算器的预期一致。
export default {
  name: 'FocusCalc',
  props: {
    show: { type: Boolean, default: false }
  },
  data() {
    return { expr: '', res: '' }
  },
  watch: {
    show(v) { if (v) { this.expr = ''; this.res = '' } }
  },
  methods: {
    noop() {},
    close() { this.$emit('close') },
    num(n) {
      // 单个数字里不许出现两个小数点（1..2 这种式子没人会写）
      if (n === '.') {
        const tail = this.expr.split(/[+\-×÷]/).pop() || ''
        if (tail.indexOf('.') >= 0) return
      }
      if (this.expr.length >= 24) return
      this.expr += n
      this.res = ''
    },
    op(o) {
      if (!this.expr) return
      const last = this.expr.slice(-1)
      // 连着按运算符 = 改主意，替换掉上一个，不许出现 "3+×4"
      if ('+−×÷'.indexOf(last) >= 0) this.expr = this.expr.slice(0, -1) + o
      else this.expr += o
      this.res = ''
    },
    back() {
      this.expr = this.expr.slice(0, -1)
      this.res = ''
    },
    clear() {
      this.expr = ''
      this.res = ''
    },
    equal() {
      const v = this.evaluate(this.expr)
      // 算不出来（除以 0 / 式子不完整）就如实说，不编一个数字出来
      this.res = (v === null) ? '—' : this.fmt(v)
    },
    /** 两遍算：先 × ÷，再 + − */
    evaluate(src) {
      const toks = String(src).match(/\d*\.?\d+|[+\-×÷]/g)
      if (!toks || !toks.length) return null
      const a = []
      let i = 0
      while (i < toks.length) {
        const t = toks[i]
        if (t === '×' || t === '÷') {
          const l = Number(a.pop())
          const r = Number(toks[i + 1])
          if (!isFinite(l) || !isFinite(r)) return null
          if (t === '÷' && r === 0) return null        // 除以 0：没有"结果"可给
          a.push(t === '×' ? l * r : l / r)
          i += 2
        } else { a.push(t); i += 1 }
      }
      // 开头是负号时当一元处理：-5 → 0 - 5
      let v = 0
      let j = 0
      if (a[0] !== '+' && a[0] !== '-') { v = Number(a[0]); j = 1 }
      while (j < a.length) {
        const op = a[j]
        const r = Number(a[j + 1])
        if (!isFinite(v) || !isFinite(r)) return null
        v = op === '+' ? v + r : v - r
        j += 2
      }
      return isFinite(v) ? v : null
    },
    /** 去掉浮点噪声：0.1+0.2 要显示 0.3，不是 0.30000000000000004 */
    fmt(v) {
      const r = Math.round(v * 1e10) / 1e10
      return String(r)
    }
  }
}
</script>

<style>
.fc-mask {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(23, 32, 26, 0.42);
  display: flex; align-items: flex-end; justify-content: center;
}

.fc-card {
  width: 100%;
  padding: 28rpx 24rpx calc(28rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background: #fffdf8;
  background: var(--bg, #fffdf8);
}

.fc-screen {
  padding: 14rpx 18rpx 24rpx;
  display: flex; flex-direction: column; align-items: flex-end; gap: 6rpx;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.07));
}

.fc-expr {
  font-size: 40rpx;
  font-weight: 500;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  max-width: 100%;
}

.fc-res {
  font-size: 28rpx;
  color: #e4173d;
  color: var(--brand, #e4173d);
  font-weight: 600;
}

.fc-pad { margin-top: 18rpx; }
.fc-row { display: flex; gap: 14rpx; margin-bottom: 14rpx; }

.fc-key {
  flex: 1;
  height: 96rpx;
  border-radius: 20rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: #17201a;
  color: var(--ink-1, #17201a);
  font-size: 34rpx;
  font-weight: 500;
  display: flex; align-items: center; justify-content: center;
}

.fc-key:active { opacity: 0.7; }

.fc-op {
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}

.fc-fn { font-size: 28rpx; color: #5a6560; color: var(--ink-2, #5a6560); }

.fc-eq {
  background: #e4173d;
  background: var(--brand, #e4173d);
  color: #fff;
}

.fc-wide { flex: 2; }
</style>
