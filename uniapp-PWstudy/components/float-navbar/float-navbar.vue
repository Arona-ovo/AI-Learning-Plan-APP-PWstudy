<template>
  <view class="fnb-wrap" :style="{ paddingTop: (barH + 8) + 'px' }">
    <!-- 搜索模式：未聚焦时左右两个图标槽收起（width 0），输入框铺满整个胶囊；
         聚焦（或已有关键词）时两个槽展开到 76rpx，输入框只横向收缩、保持居中，
         上下始终与胶囊同高 —— 收缩 / 还原都走 width 过渡动画。
         例外：最右侧的模式键不参与收起（常驻），理由见下面那颗键的注释。 -->
    <view class="fnb" :class="{ 'fnb-search-mode': search, 'fnb-cmd-mode': isCommand }">
      <!-- 左槽：非搜索模式**恒为返回键**（忙不忙都在），搜索模式才是放大镜 / 转圈。
           ⚠️ 转圈以前也挤在左槽：AI 忙碌时左槽被转圈顶掉，同一个页面"加载完才冒出
           返回键"，看着就像返回键时有时无。转圈改挂右槽（右槽在非搜索态本就空着），
           两种状态互不顶掉 —— 返回键才是这一槽的主职，忙碌只是告知。 -->
      <view class="fnb-side" :class="{ 'fnb-side-flat': isFlat }" @tap="onLeftTap">
        <text v-if="!search && showBack" class="fnb-back" hover-class="fnb-back-press" hover-start-time="0" hover-stay-time="70">‹</text>
        <view v-else-if="search && busy" class="fnb-spin" hover-start-time="0" hover-stay-time="70"></view>
        <view v-else-if="search && isCommand" class="fnb-wand" hover-class="fnb-mag-press" hover-start-time="0" hover-stay-time="70">
          <view class="wand-v"></view>
          <view class="wand-h"></view>
        </view>
        <view v-else-if="search" class="fnb-mag" hover-class="fnb-mag-press" hover-start-time="0" hover-stay-time="70">
          <view class="mag-ring"></view>
          <view class="mag-handle"></view>
        </view>
      </view>

      <input
        v-if="search"
        class="fnb-search"
        :class="{ 'fnb-search-cmd': isCommand }"
        :value="value"
        :placeholder="placeholder"
        placeholder-style="color:#a8b0ab;font-size:26rpx"
        :confirm-type="isCommand ? 'send' : 'search'"
        @input="onInput"
        @confirm="onConfirm"
        @focus="onFocus"
        @blur="onBlur"
      />
      <text v-else class="fnb-title">{{ title }}</text>

      <view class="fnb-side" :class="{ 'fnb-side-flat': isFlat }" @tap="onClear">
        <text v-if="search && value" class="fnb-clear">×</text>
        <!-- 非搜索态的忙碌指示放这儿（AI 重排 / 目标规划在跑）：左槽留给返回键 -->
        <view v-else-if="!search && busy" class="fnb-spin"></view>
      </view>

      <!-- 首页专属：专注设置入口。放在胶囊右侧、常驻（非搜索态才显示）。
           点一下 = 弹出「专注设置」卡片（强制模式 / 拦截通知 / 自动进休息 都在里面），
           与番茄 ToDo 把同类设置收进同一处的思路一致。focusOn 为真时图标染品牌色，
           一眼看出"有专注相关开关开着"。 -->
      <view
        v-if="focusBtn && !search"
        class="fnb-side fnb-side-focus"
        @tap="onFocusTap"
      >
        <view class="fnb-focus" :class="{ 'fnb-focus-on': focusOn }">
          <view class="fnb-shield"></view>
        </view>
      </view>

      <!-- 模式切换键：自动判定再准也有看走眼的时候，留一颗手动开关兜底。
           点一下就在「搜 / AI」之间切换并锁定，清空输入才回到自动判定。
           常驻（不挂 fnb-side-flat，跟着一起收起会有两个麻烦）：
             ① 收起态是 width:0 + pointer-events:none —— 键还在屏幕上但点不动，
                用户看到的就是"这颗键失灵了"；
             ② 锁定态被藏起来更危险：用户以为自己没锁，随手打个单词却被当成
                AI 指令真的去改首页。
           空闲时也必须能看到"回车会走哪条路"，所见即所得才成立。 -->
      <view
        v-if="search && switchable"
        class="fnb-side fnb-side-mode"
        @tap="onModeTap"
      >
        <view class="fnb-mode" :class="{ 'fnb-mode-on': isCommand, 'fnb-mode-lock': locked }">
          <text class="fnb-mode-txt">{{ modeText }}</text>
          <view v-if="locked" class="fnb-lock"></view>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
import * as insets from '../../utils/insets.js';
// 悬浮磨砂玻璃顶栏（与底部 float-tabbar 同一套视觉语言）
// 用法：页面根节点加 class="page-nav"，模板顶部放 <float-navbar title="xxx" />
//      pages.json 对应页面需要 "navigationStyle": "custom"（否则会多出原生导航栏）
// 返回键：默认按页面栈深度自动判断（栈深 > 1 才显示），也可用 :back="true/false" 强制

export default {
  name: 'FloatNavbar',
  props: {
    title: { type: String, default: '' },
    // 不传则自动判断：页面栈里还有上一页才显示返回键
    back: { type: Boolean, default: null },
    // 搜索模式：中间渲染输入框而不是标题（首页用）
    search: { type: Boolean, default: false },
    value: { type: String, default: '' },
    placeholder: { type: String, default: t('搜索') },
    // 输入模式：search（查词） / command（AI 指令）—— 只影响图标与描边颜色
    mode: { type: String, default: 'search' },
    // 模式是否被用户手动锁定（锁定时模式键上带一个小锁点）
    locked: { type: Boolean, default: false },
    // 是否显示右侧的模式切换键（只有"搜索 + 指令"双模式的页面才需要）
    switchable: { type: Boolean, default: false },
    // 执行中：左槽换成转圈
    busy: { type: Boolean, default: false },
    // 首页专属：是否显示"专注设置"入口（常驻在胶囊右侧，点开弹出设置卡片）
    focusBtn: { type: Boolean, default: false },
    // 有任意专注开关开着时图标染品牌色（强制模式 / 拦截通知 / 自动进休息）
    focusOn: { type: Boolean, default: false }
  },
  data() {
    // stackN: -1 = 还没量过（先沿用实时栈）；量过之后以量到的值为准
    return { barH: 0, focused: false, stackN: -1 }
  },
  computed: {
    /**
     * 返回键显示与否。
     * ⚠️ 页面栈**不能只在创建时问一次**：页面组件创建时 getCurrentPages() 常常
     *   还没把当前页算进去（栈里只有上一页），于是"从底栏页直接点进来的页面"全部
     *   判定成栈深 1 = 没有返回键 —— 这就是"有的页面有箭头、有的没有"的来处。
     *   两道保险：① 页面显式声明 :back="true/false"（推荐，绝对确定）；
     *   ② 不声明时挂载后再量一次栈深（那时当前页已在栈里），且是响应式的。
     */
    showBack() {
      if (this.back === true) return true
      if (this.back === false) return false
      if (this.stackN >= 0) return this.stackN > 1
      try {
        const pages = getCurrentPages()
        return Array.isArray(pages) && pages.length > 1
      } catch (e) {
        return false
      }
    },
    // 收缩态只在「搜索模式 + 既没聚焦也没有关键词」时出现
    active() {
      return !!this.focused || !!this.value
    },
    isFlat() {
      return !!this.search && !this.active
    },
    isCommand() {
      return !!this.search && this.mode === 'command'
    },
    modeText() {
      return this.isCommand ? 'AI' : t('搜')
    }
  },
  created() {
    // 状态栏高度走 utils/insets.js：
    // 它先用 plus.navigator 问系统（含"是否沉浸式"的判断），再退回系统信息，
    // 比只读 uni.getSystemInfoSync().statusBarHeight 稳 —— 那个在部分机型上返回 0，
    // 胶囊就会整个顶进状态栏，看起来像"搜索框消失了"，而且那一带点不动。
    this.barH = insets.statusBar()
    this.measureStack()
  },
  mounted() {
    // 挂载后再量一次栈深：这时当前页一定已经在栈里了（创建时未必）
    this.measureStack()
    // 冷启动兜底：极个别端首帧拿不到，挂载后补取一次（insets 内部有缓存，很便宜）
    if (this.barH) return
    setTimeout(() => {
      if (this.barH) return
      const h = insets.statusBar()
      if (h) this.barH = h
    }, 120)
  },
  methods: {
    // 供新手引导测量组件内元素（视口坐标）；拿不到给 null。
    // 页面级的 createSelectorQuery 选不进自定义组件内部，必须组件自己量。
    rect(sel, cb) {
      try {
        uni.createSelectorQuery().in(this).select(sel).boundingClientRect(cb).exec()
      } catch (e) {
        cb && cb(null)
      }
    },
    /**
     * 把 input / confirm 事件里的值抠出来。
     * 各端 detail 的形态并不一致：有的是 { value }，有的直接就是字符串，
     * 某些端在键盘回车时还会给出别的形状。以前直接取 e.detail.value，
     * 一旦拿到的是对象，String() 之后就变成 "[object Object]" 被当成搜索词
     * —— 于是 AI 去解释这个词、还把它写进词库，搜索结果里就冒出一个 "Object"。
     * 这里统一兜一层：拿不到字符串就退回当前值，绝不让对象往外传。
     */
    pickValue(e) {
      const d = e && e.detail
      if (typeof d === 'string') return d
      if (d && typeof d.value === 'string') return d.value
      if (d && typeof d.text === 'string') return d.text
      return this.value || ''
    },
    onInput(e) {
      this.$emit('input', this.pickValue(e))
    },
    onConfirm(e) {
      this.$emit('search', this.pickValue(e))
    },
    // 聚焦/失焦驱动胶囊的收缩与还原
    onFocus() {
      this.focused = true
      this.$emit('focus', this.value || '')
    },
    onBlur(e) {
      this.focused = false
      const v = e && e.detail && e.detail.value != null ? e.detail.value : (this.value || '')
      this.$emit('blur', v)
    },
    // 供父页面主动收起（清空搜索时把胶囊还原成铺满态）
    blurInput() {
      this.focused = false
      try { uni.hideKeyboard() } catch (e) {}
      this.$emit('blur', this.value || '')
    },
    // 左槽：非搜索模式是返回键；搜索模式是放大镜，点击即执行搜索
    onLeftTap() {
      if (!this.search) { this.onBack(); return }
      this.$emit('search', this.value || '')
    },
    onClear() {
      this.$emit('input', '')
      this.$emit('clear')
    },
    // 首页"专注设置"入口：只发事件，卡片的渲染与开关落盘由父页面（home.vue）决定
    onFocusTap() {
      this.$emit('open-focus')
    },
    // 模式键：只发事件，切到哪个模式由父页面决定（它才知道当前输入该怎么判）
    onModeTap() {
      if (!this.search || !this.switchable) return
      this.$emit('mode-toggle', this.mode === 'command' ? 'search' : 'command')
    },
    /**
     * 返回。⚠️ 不能直接 navigateBack —— 那样会绕开页面的 onBackPress：
     * 专注页正是靠 onBackPress 在强制模式下把人按住的，顶栏要是自己走一条路，
     * "点左上角就跑出去了"，强制模式等于没有。
     * 所以先同步 emit 一次 veto 回调：页面想拦就当场调用它（emit 是同步的，
     * 页面拿到回调时还没导航），没拦才真的返回。
     */
    onBack() {
      if (!this.showBack) return
      let vetoed = false
      this.$emit('before-back', () => { vetoed = true })
      if (vetoed) return
      const pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : []) || []
      if (pages.length > 1) {
        uni.navigateBack()
      } else {
        uni.switchTab({ url: '/pages/home/home' })
      }
    },
    /** 把当前页面栈深度记进响应式字段（栈还没建好时记 -1，保持"没量过"） */
    measureStack() {
      try {
        const pages = (typeof getCurrentPages === 'function' ? getCurrentPages() : []) || []
        this.stackN = Array.isArray(pages) ? pages.length : -1
      } catch (e) {
        this.stackN = -1
      }
    }
  }
}
</script>

<style scoped>
/* 外层只负责定位与状态栏留白；只有中间的胶囊可点 */
.fnb-wrap {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  z-index: 400;
  padding: 0 24rpx 8rpx;
  pointer-events: none;
}

/* 标题是绝对定位的（不占流），所以左右槽之间**没有东西把它们撑开** ——
   不加 space-between 的话所有槽会一齐挤到左边（右槽串到返回键旁边）。
   搜索模式下输入框 flex:1 会吃掉全部剩余空间，这一条自然不生效。 */
.fnb {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 88rpx;
  padding: 0 8rpx;
  border-radius: 44rpx;
  background: rgba(255, 255, 255, 0.68);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.68);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.7);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.7));
  box-shadow: 0 10rpx 30rpx rgba(23, 32, 26, 0.07), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 10rpx 30rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.07), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
  pointer-events: auto;
}

/* 搜索模式：胶囊去掉左右内边距，输入框才能真正铺满 */
.fnb-search-mode {
  padding: 0;
}

/* 指令态：胶囊描边换成品牌色，一眼能看出"这条会改页面" */
.fnb-cmd-mode {
  border-color: rgba(228, 23, 61, 0.55);
  border-color: rgba(var(--brand-rgb, 228, 23, 61), 0.55);
  box-shadow: 0 10rpx 30rpx rgba(228, 23, 61, 0.14), 0 2rpx 6rpx rgba(23, 32, 26, 0.04);
  box-shadow: 0 10rpx 30rpx rgba(var(--brand-rgb, 228, 23, 61), 0.14), 0 2rpx 6rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.04);
}

.fnb-search-cmd {
  background: rgba(228, 23, 61, 0.06);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.06);
  border-color: rgba(228, 23, 61, 0.24);
  border-color: rgba(var(--brand-rgb, 228, 23, 61), 0.24);
}

/* 执行中转圈 */
.fnb-spin {
  width: 30rpx;
  height: 30rpx;
  border-radius: 50%;
  border: 4rpx solid rgba(23, 32, 26, 0.12);
  border: 4rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.12);
  border-top-color: #e4173d;
  border-top-color: var(--brand, #e4173d);
  animation: fnb-rotate 0.9s linear infinite;
}

@keyframes fnb-rotate {
  to { transform: rotate(360deg); }
}

/* ===== 模式切换键（搜 / AI）=====
   自动判定再准也有看走眼的时候：把"想让 AI 改页面"判成查词只是白搜一次，
   把"想查词"判成指令则会真的去改首页 —— 后者代价大得多。
   所以顶栏右侧常驻一颗模式键，所见即所得：键上写着什么，回车就走哪条路。
   点过之后进入锁定态（右上角一个小点），打字不再自动改判，清空输入才解锁。 */
.fnb-mode {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 46rpx;
  min-width: 58rpx;
  padding: 0 14rpx;
  box-sizing: border-box;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.72);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.72);
  border: 2rpx solid rgba(23, 32, 26, 0.1);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.1));
  transition: background 200ms ease, border-color 200ms ease, opacity 160ms ease;
}

.fnb-mode:active { opacity: 0.6; }

.fnb-mode-txt {
  font-size: 22rpx;
  font-weight: 600;
  line-height: 1;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}

/* 指令态：整颗键染上品牌色，和胶囊描边、魔杖图标同一套语言 */
.fnb-mode-on {
  background: rgba(228, 23, 61, 0.12);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
  border-color: rgba(228, 23, 61, 0.34);
  border-color: rgba(var(--brand-rgb, 228, 23, 61), 0.34);
}

.fnb-mode-on .fnb-mode-txt {
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
}

/* 锁定标记：右上角一个小点，提示"这条是我自己定的，不再自动改判" */
.fnb-lock {
  position: absolute;
  right: 6rpx;
  top: 6rpx;
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: #e4173d;
  background: var(--brand, #e4173d);
}

/* 指令态图标：一根小魔杖（两条短线交叉，纯 CSS） */
.fnb-wand {
  position: relative;
  width: 32rpx;
  height: 32rpx;
  transition: transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.wand-v {
  position: absolute;
  left: 14rpx;
  top: 2rpx;
  width: 4rpx;
  height: 28rpx;
  border-radius: 2rpx;
  background: #e4173d;
  background: var(--brand, #e4173d);
  transform: rotate(45deg);
}

.wand-h {
  position: absolute;
  left: 2rpx;
  top: 14rpx;
  width: 28rpx;
  height: 4rpx;
  border-radius: 2rpx;
  background: #e4173d;
  background: var(--brand, #e4173d);
  transform: rotate(45deg);
}

.fnb-search-mode .fnb-side-flat .fnb-wand {
  transform: scale(0.72);
}

@media (prefers-reduced-motion: reduce) {
  .fnb-spin { animation: none; }
}

.fnb-side {
  width: 72rpx;
  height: 72rpx;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* 首页"专注设置"入口：盾牌图标（"专注 / 防护"的直觉符号）。
   未开启是中性灰，有任意专注开关开着时染品牌色 —— 一眼看出"有专注设置开着"。 */
.fnb-side-focus { margin-left: 4rpx; }
.fnb-focus {
  width: 42rpx;
  height: 42rpx;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  transition: color 160ms ease, opacity 160ms ease;
}
.fnb-focus:active { opacity: 0.6; }
.fnb-focus-on { color: #e4173d; color: var(--brand, #e4173d); }
.fnb-shield {
  position: relative;
  width: 28rpx;
  height: 32rpx;
  border: 4rpx solid currentColor;
  border-top: none;
  border-radius: 7rpx 7rpx 16rpx 16rpx;
  box-sizing: border-box;
}
.fnb-shield::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 6rpx;
  width: 4rpx;
  height: 13rpx;
  background: currentColor;
  transform: translateX(-50%) rotate(45deg);
}
.fnb-shield::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 13rpx;
  width: 11rpx;
  height: 4rpx;
  background: currentColor;
  transform: translateX(-50%) rotate(45deg);
}

/* 搜索模式的左右槽：展开态 76rpx，收起态 0（输入框随之铺满 / 收缩） */
.fnb-search-mode .fnb-side {
  width: 76rpx;
  height: 100%;
  overflow: hidden;
  transition: width 260ms cubic-bezier(0.22, 0.61, 0.36, 1), opacity 200ms ease;
}

.fnb-search-mode .fnb-side.fnb-side-flat {
  width: 0;
  opacity: 0;
  pointer-events: none;
}

.fnb-back {
  font-size: 48rpx;
  line-height: 1;
  color: #e4173d;
  color: var(--brand, #e4173d);
  transition: opacity 180ms ease, transform 180ms ease;
}

.fnb-back-press { opacity: 0.5; transform: translateX(-4rpx); }

/* 标题必须**相对整颗胶囊**居中，不能靠 flex:1 + text-align:center。
   左右两槽的宽度并不相等（首页右侧多一颗管理键、返回键页左侧才有内容），
   flex 只会让标题在**剩下的那块空间**里居中 —— 右槽越宽，标题越偏左，
   "PWstudy" 看着就像被右上角那颗键挤跑了。
   所以改成绝对定位铺满胶囊 + 对称内缩：不管左右各自多宽，视觉中心恒在屏幕中线。
   ⚠️ pointer-events:none 是必须的：标题盖在左槽之上，不穿透会把返回键点死。 */
.fnb-title {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 100%;
  line-height: 88rpx;
  padding: 0 88rpx;
  box-sizing: border-box;
  text-align: center;
  font-size: 30rpx;
  font-weight: 500;
  letter-spacing: 1rpx;
  text-indent: 1rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  pointer-events: none;
}

/* 搜索模式：胶囊内嵌输入框（首页）
   - 上下：height 100%，始终与胶囊同高（收缩时只动左右，不动上下）
   - 左右：flex 1，随左右槽的 width 过渡自动收缩 / 铺满，且两侧等宽 → 始终居中 */
.fnb-search {
  flex: 1;
  height: 100%;
  min-width: 0;
  box-sizing: border-box;
  padding: 0 28rpx;
  margin: 0;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  /* 输入框用浅灰填充：顶栏本身已经是白色窗体，再叠白就看不见输入框了 */
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  backdrop-filter: var(--glass-lg, blur(12px) saturate(180%));
  border: 2rpx solid rgba(23, 32, 26, 0.08);
  border: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.08));
  border-radius: 999rpx;
}

/* 放大镜：纯 CSS 画的线性图标（不引外部图片，App/H5/小程序都一致） */
.fnb-mag {
  position: relative;
  width: 34rpx;
  height: 34rpx;
  transition: opacity 200ms ease, transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

.mag-ring {
  position: absolute;
  left: 0;
  top: 0;
  width: 24rpx;
  height: 24rpx;
  box-sizing: border-box;
  border: 3rpx solid #e4173d;
  border: 3rpx solid var(--brand, #e4173d);
  border-radius: 50%;
}

.mag-handle {
  position: absolute;
  left: 19rpx;
  top: 19rpx;
  width: 3rpx;
  height: 13rpx;
  border-radius: 2rpx;
  background: #e4173d;
  background: var(--brand, #e4173d);
  transform: rotate(-45deg);
  transform-origin: 0 0;
}

.fnb-mag-press { opacity: 0.5; }

/* 收起时图标同步缩小一点，配合槽位宽度一起过渡 */
.fnb-search-mode .fnb-side-flat .fnb-mag,
.fnb-search-mode .fnb-side-flat .fnb-clear {
  transform: scale(0.72);
}

.fnb-clear {
  font-size: 34rpx;
  line-height: 1;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
  transition: opacity 200ms ease, transform 220ms cubic-bezier(0.22, 0.61, 0.36, 1);
}

@media (prefers-reduced-motion: reduce) {
  .fnb-search-mode .fnb-side,
  .fnb-mag,
  .fnb-clear {
    transition: none;
  }
}
</style>
