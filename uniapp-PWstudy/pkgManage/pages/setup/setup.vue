<template>
  <view class="container page-nav setup-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="权限与后台保活" :back="true" />

    <view class="card lead">
      <text class="lead-title">先让系统放行这三件事</text>
      <text class="lead-txt">
        PWstudy 要在后台跑计时、要读你在用哪个 App —— 这些都是 Android 需要你点头才给的能力。
        缺哪一项，对应的功能就会"看起来像坏了"：点了开始没动静、应用列表空白、锁屏后计时断掉。
      </text>
    </view>

    <view class="card">
      <view
        v-for="it in items"
        :key="it.key"
        class="su-item"
      >
        <view class="su-head">
          <view class="su-dot" :class="{ 'su-dot-ok': it.ok }"></view>
          <view class="su-info">
            <text class="su-title">
              {{ it.title }}
              <text v-if="!it.must" class="su-opt">可选</text>
            </text>
            <text class="su-why">{{ it.why }}</text>
          </view>
        </view>
        <button
          v-if="!it.ok"
          class="su-btn"
          :class="{ 'su-btn-must': it.must }"
          @tap="fix(it.key)"
        >去设置</button>
        <text v-else class="su-done">已完成</text>
      </view>
    </view>

    <view class="card">
      <text class="card-title">为什么没有"无障碍"？</text>
      <text class="lead-txt">
        无障碍服务（AccessibilityService）能拿到更强的能力，但它要求用户在一个全屏警示页里
        手动授权，且会被系统当成"辅助工具"长期展示 —— 代价太大，而这里要的三件事它一样都解决不了。
        所以 PWstudy 只申请真正用得上的权限，不碰无障碍。
      </text>
    </view>

    <button class="btn-ghost su-skip" @tap="done">先不弄，继续用</button>
    <view class="tip">随时可以在「我的 › 权限与后台保活」里回来。</view>
  </view>
</template>

<script>
import * as setup from '../../../utils/setup.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

// 「无障碍（强制模式：把你拉回来）」整句塞进 toast 太长，去掉括号里的补充说明
function shortTitle(t) {
  return String(t || '').split('（')[0].replace(/（|\）/g, '').trim() || '权限'
}

export default {
  components: { FloatNavbar },
  data() {
    return { items: [] }
  },
  onShow() {
    this.refresh()
  },
  onHide() {
    if (this.__later) { clearTimeout(this.__later); this.__later = 0 }
  },
  onUnload() {
    if (this.__later) { clearTimeout(this.__later); this.__later = 0 }
  },
  methods: {
    refresh(fromFix) {
      const was = {}
      this.items.forEach(i => { was[i.key] = i.ok })
      this.items = setup.status()
      // 开了就得让人知道开上了：只提示"刚才点的那一项"，而且必须是真的从没开变成开
      // （勾了开关但系统还没 bind 上服务时查出来仍是 false，那就什么都不说，等下一次刷新）
      if (!fromFix || !this.__fixing) return
      const it = this.items.filter(x => x.key === this.__fixing)[0]
      if (it && it.ok && was[it.key] === false) {
        try {
          uni.showToast({ title: shortTitle(it.title) + '已开启', icon: 'success', duration: 1800 })
        } catch (e) {}
      }
    },
    fix(key) {
      this.__fixing = key
      const ok = setup.fixItem(key)
      if (!ok) {
        try { uni.showToast({ title: '没能打开设置页，请手动去系统设置', icon: 'none' }) } catch (e) {}
      }
      // 系统页是全屏的，回来才会看到结果 —— 回来那次 onShow 会刷。
      // 这里再补一次是因为**无障碍服务由系统绑定**，勾上开关到服务真的挂上要一两秒，
      // 查早了拿到的还是旧值（专注页也是等 1.2s 再查的）。
      if (this.__later) clearTimeout(this.__later)
      this.__later = setTimeout(() => { this.__later = 0; this.refresh(true) }, 1200)
    },
    done() {
      setup.skip()
      try { uni.navigateBack() } catch (e) { uni.switchTab({ url: '/pages/home/home' }) }
    }
  }
}
</script>

<style>
.setup-page { padding-bottom: 60rpx; }

.lead-title { font-size: 30rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.lead-txt {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx; line-height: 1.75;
  color: #5a6560; color: var(--ink-2, #5a6560);
}

.su-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 26rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.06);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.06));
}
.su-item:last-child { border-bottom: none; padding-bottom: 0; }
.su-head { display: flex; flex: 1; min-width: 0; }
.su-dot {
  width: 16rpx; height: 16rpx; border-radius: 50%;
  background: #e5484d;
  margin: 10rpx 18rpx 0 0; flex-shrink: 0;
}
.su-dot-ok { background: #3b9d11; }
.su-info { flex: 1; min-width: 0; }
.su-title { font-size: 28rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.su-opt {
  margin-left: 12rpx; font-size: 20rpx; font-weight: 400;
  color: #98a19b; color: var(--ink-3, #98a19b);
}
.su-why {
  display: block; margin-top: 8rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #5a6560; color: var(--ink-2, #5a6560);
}
.su-btn {
  flex-shrink: 0; margin-left: 20rpx; padding: 0 26rpx; height: 64rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 25rpx; letter-spacing: 1rpx; text-indent: 1rpx;
  border-radius: 999rpx;
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(255, 255, 255, 0.6);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.6);
  border: 2rpx solid rgba(228, 23, 61, 0.34);
  border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.34);
}
.su-btn-must {
  color: #ffffff;
  background: #e4173d; background: var(--brand, #e4173d);
  border-color: transparent;
}
.su-done {
  flex-shrink: 0; margin-left: 20rpx;
  font-size: 24rpx; color: #3b9d11;
}
.su-skip { margin-top: 30rpx; }
.tip { margin-top: 20rpx; text-align: center; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
</style>
