<template>
  <view class="container page-nav start-page" :class="appTheme" :style="appBgStyle">
    <float-navbar :title="$t('开始前的几件事')" :back="true" />

    <view class="card lead">
      <text class="lead-title">{{ $t('先把这几件事定下来') }}</text>
      <text class="lead-txt">
        {{ $t('上面几项是 Android 要你点头才给的能力，缺一件对应的功能就会「看着像坏了」；下面几个开关决定你要不要被管着。全部都可以跳过，也都能在设置里改回来。') }}
      </text>
    </view>

    <!-- ① 系统权限：直接拿 setup 的清单（唯一出处），不在这里另写一份名单 -->
    <view class="card">
      <text class="card-title">{{ $t('要系统放行的') }}</text>
      <view
        v-for="it in items"
        :key="it.key"
        class="st-item"
        @tap="toggleWhy(it.key)"
      >
        <view class="st-head">
          <view class="st-dot" :class="{ 'st-dot-ok': it.ok }"></view>
          <view class="st-info">
            <text class="st-title">
              {{ shortTitle(it.title) }}
              <text v-if="!it.must" class="st-opt">{{ $t('可选') }}</text>
            </text>
            <!-- why 很长（每一项都写了"缺了会怎样"），首屏全摊开会把按钮挤到屏幕外。
                 默认只给标题，点一下才展开 —— 想知道的人看得到，不想看的直接划过去。 -->
            <text v-if="open === it.key" class="st-why">{{ it.why }}</text>
            <text v-else class="st-tap">{{ $t('为什么需要它？') }}</text>
          </view>
        </view>
        <view
          v-if="!it.ok"
          class="st-btn"
          :class="{ 'st-btn-must': it.must }"
          @tap.stop="fix(it.key)"
        >{{ $t('去开启') }}</view>
        <text v-else class="st-done">{{ $t('已开启') }}</text>
      </view>
      <!-- 开了强制模式会多出两项（悬浮窗 / 无障碍）：它们的 must 是函数，
           开关一动清单就变，这里必须说清楚，否则用户以为凭空多出来的两项是 bug -->
      <text v-if="forced" class="st-note">{{ $t('开了强制模式，「显示在其他应用上层」和「无障碍」就变成必办项 —— 它们是拉你回来的唯一通道。') }}</text>
    </view>

    <!-- ② 可选开关：这些不是权限，是"要不要被管着" -->
    <view class="card">
      <text class="card-title">{{ $t('要不要被管着') }}</text>
      <view class="st-row">
        <view class="st-rinfo">
          <text class="st-rtitle">{{ $t('强制模式') }}</text>
          <text class="st-rsub">{{ $t('一离开学习 App 就立刻把你拉回来') }}</text>
        </view>
        <switch :checked="forced" color="#e4173d" @change="e => onSwitch('forced', e)" />
      </view>
      <view class="st-row">
        <view class="st-rinfo">
          <text class="st-rtitle">{{ $t('严格模式') }}</text>
          <text class="st-rsub">{{ $t('离开学习 App 就提醒，30 秒不回来这次作废') }}</text>
        </view>
        <switch :checked="strict" color="#e4173d" @change="e => onSwitch('strict', e)" />
      </view>
      <view class="st-row">
        <view class="st-rinfo">
          <text class="st-rtitle">{{ $t('自动进休息') }}</text>
          <text class="st-rsub">{{ $t('专注跑完自动接着休息，不用再点一次') }}</text>
        </view>
        <switch :checked="autoRest" color="#e4173d" @change="e => onSwitch('autoRest', e)" />
      </view>
      <view class="st-row is-last">
        <view class="st-rinfo">
          <text class="st-rtitle">{{ $t('学习范围') }}</text>
          <text class="st-rsub">{{ $t('记下我在不在学习地点（要用到定位，只在打开 App 与专注起止时看一眼）') }}</text>
        </view>
        <switch :checked="rangeOn" color="#e4173d" @change="e => onSwitch('range', e)" />
      </view>
    </view>

    <button class="btn-primary st-go" @tap="finish">{{ $t('就这样，开始用') }}</button>
    <button class="btn-ghost" @tap="later">{{ $t('以后再说') }}</button>
    <view class="st-tip">{{ $t('随时可以在「设置 › 开始前的几件事」里回来改。') }}</view>
  </view>
</template>

<script>
import * as setup from '../../../utils/setup.js'
import * as settings from '../../../utils/settings.js'
import * as forced from '../../../utils/forced.js'
import * as strict from '../../../utils/strict.js'
import * as loc from '../../../utils/location.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

// 标题简写走 setup.shortTitle（去掉括号里的补充说明）—— 弹窗 / toast / 列表三处
// 都要用它，各写一份必然分叉，所以它是唯一出处。
const shortTitle = setup.shortTitle

export default {
  components: { FloatNavbar },
  data() {
    return {
      items: [],        // setup.status()：权限清单（含 must 与实测结果）
      open: '',         // 当前展开说明的那一项的 key
      forced: false,
      strict: false,
      autoRest: false,
      rangeOn: false
    }
  },
  computed: {
    /** 还没办好的必办项数：决定"开始用"之后首页还要不要再提醒一次 */
    pendingCount() {
      return this.items.filter(x => x.must && !x.ok).length
    }
  },
  onShow() {
    // 系统设置页是全屏的，勾完回来才看得到结果 —— 所以每次显示都重测一遍
    this.refresh()
  },
  onHide() {
    if (this.__later) { clearTimeout(this.__later); this.__later = 0 }
  },
  onUnload() {
    if (this.__later) { clearTimeout(this.__later); this.__later = 0 }
  },
  methods: {
    shortTitle,
    refresh() {
      this.items = setup.status()
      this.readSwitches()
    },
    /** 开关的当前值：全部从 settings 读，页面上不存第二份 */
    readSwitches() {
      try {
        const f = (settings.get().focus) || {}
        this.forced = !!f.forced
        this.strict = !!f.strict
        this.autoRest = !!f.autoRest
      } catch (e) {}
      try {
        this.rangeOn = !!(settings.get().range || {}).on
      } catch (e) {}
    },
    toggleWhy(key) {
      this.open = this.open === key ? '' : key
    },
    /** 去系统页开权限。回来那次 onShow 会刷；这里再补一次是给"服务由系统绑定"
        那类项留时间（勾上开关到服务真的挂上要一两秒）。 */
    fix(key) {
      const ok = setup.fixItem(key)
      if (!ok) {
        try { uni.showToast({ title: this.$t('没能打开设置页，请手动去系统设置'), icon: 'none' }) } catch (e) {}
      }
      if (this.__later) clearTimeout(this.__later)
      this.__later = setTimeout(() => { this.__later = 0; this.refresh() }, 1200)
    },
    /**
     * 四个开关共用一个入口：它们都是"写进 settings + 让对应模块同步一次"。
     * ⚠️ 改完一定要 refresh()：强制模式的 must 是函数，一开就把悬浮窗 / 无障碍
     *    变成必办项，清单不刷的话用户根本看不到那两项，还以为强制模式开好了。
     */
    onSwitch(key, e) {
      const v = !!(e && e.detail && e.detail.value)
      try {
        if (key === 'range') {
          loc.turnOn(v)
        } else {
          const patch = { focus: {} }
          patch.focus[key] = v
          settings.set(patch)
        }
      } catch (err) {}
      // 与原生侧对一次账（前台服务 / 严格模式守卫的开关状态）
      try { if (key === 'forced' || key === 'strict') { forced.sync(); strict.sync() } } catch (err) {}
      this.readSwitches()
      this.refresh()
      if (key === 'forced' && v) {
        try { uni.showToast({ title: this.$t('还差「显示在其他应用上层」和「无障碍」才拉得动'), icon: 'none', duration: 2200 }) } catch (e) {}
      }
    },
    finish() {
      // 全都办好了就别再让首页弹一次权限提醒；还有缺项的话首页那张卡留着，
      // 那是真的会掉链子的部分，不该因为用户点了"开始用"就一起静音。
      if (!this.pendingCount) setup.markPrompted()
      this.back()
    },
    later() {
      this.back()
    },
    back() {
      try {
        uni.navigateBack({
          fail: () => { uni.switchTab({ url: '/pages/home/home' }) }
        })
      } catch (e) {
        try { uni.switchTab({ url: '/pages/home/home' }) } catch (e2) {}
      }
    }
  }
}
</script>

<style>
.start-page { padding-bottom: 60rpx; }

.lead-title { font-size: 30rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.lead-txt {
  display: block;
  margin-top: 16rpx;
  font-size: 24rpx; line-height: 1.75;
  color: #5a6560; color: var(--ink-2, #5a6560);
}

/* ===== 权限清单 ===== */
.st-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.06);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.06));
}
.st-item:last-child { border-bottom: none; }
.st-head { display: flex; flex: 1; min-width: 0; }
.st-dot {
  width: 16rpx; height: 16rpx; border-radius: 50%;
  background: #e5484d;
  margin: 10rpx 18rpx 0 0; flex-shrink: 0;
}
.st-dot-ok { background: #3b9d11; }
.st-info { flex: 1; min-width: 0; }
.st-title { font-size: 28rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.st-opt {
  margin-left: 12rpx; font-size: 20rpx; font-weight: 400;
  color: #98a19b; color: var(--ink-3, #98a19b);
}
.st-tap {
  display: block; margin-top: 6rpx;
  font-size: 22rpx;
  color: #bb1332; color: var(--brand-strong, #bb1332);
}
.st-why {
  display: block; margin-top: 8rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #5a6560; color: var(--ink-2, #5a6560);
}
.st-btn {
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
.st-btn-must {
  color: #ffffff;
  background: #e4173d; background: var(--brand, #e4173d);
  border-color: transparent;
}
.st-done {
  flex-shrink: 0; margin-left: 20rpx;
  font-size: 24rpx; color: #3b9d11;
}
.st-note {
  display: block; margin-top: 20rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #5a6560; color: var(--ink-2, #5a6560);
}

/* ===== 开关 ===== */
.st-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 24rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.06);
  border-bottom: 2rpx solid var(--hairline, rgba(23, 32, 26, 0.06));
}
.st-row.is-last { border-bottom: none; padding-bottom: 4rpx; }
.st-rinfo { flex: 1; min-width: 0; margin-right: 20rpx; }
.st-rtitle { font-size: 28rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.st-rsub {
  display: block; margin-top: 6rpx;
  font-size: 22rpx; line-height: 1.6;
  color: #5a6560; color: var(--ink-2, #5a6560);
}

.st-go { margin-top: 30rpx; }
.st-tip { margin-top: 20rpx; text-align: center; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
</style>
