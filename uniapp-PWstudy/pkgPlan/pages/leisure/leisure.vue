<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="休闲关注" :back="true" />

    <view class="card">
      <view class="pc-title">{{ $t('挑几个你容易沉迷的 App') }}</view>
      <view class="pc-txt">{{ $t('我们会后台静默统计它们在你手机上的使用时间（数据只存在本机，不上传）。当你刷太久、或一整天没专注时，主动提醒你回来学习。') }}</view>
      <view v-if="isAndroid && !permitted" class="pc-perm" @tap="openPerm">
        <text class="pc-perm-txt">{{ $t('需要开启「使用情况访问」才能统计') }}</text>
        <text class="pc-perm-btn">{{ $t('去开启') }} ›</text>
      </view>
      <view v-else-if="isAndroid" class="pc-ok">{{ $t('已选 {n} 个', { n: selected.length }) }}</view>
    </view>

    <view class="card" v-if="isAndroid">
      <view class="card-head">
        <text class="card-title">{{ $t('从已安装应用里选') }}</text>
        <text class="card-more" @tap="tapAll">{{ $t('全不选') }}</text>
      </view>
      <input
        class="search"
        :value="kw"
        :placeholder="$t('搜索应用名')"
        placeholder-style="color:#a8b0ab;font-size:26rpx"
        @input="onSearch"
      />
      <view v-if="loadingApps" class="apps-loading">
        <view class="al-spin"></view>
        <text class="al-txt">{{ loadingTip }}</text>
      </view>
      <template v-else>
        <view v-if="!all.length" class="pc-txt">{{ $t('读不到应用列表，可稍后重试') }}</view>
        <scroll-view v-else class="app-scroll" scroll-y>
          <view
            v-for="c in candidates"
            :key="c.pkg"
            class="cand"
            :class="{ 'cand-added': isAdded(c) }"
            @tap="toggle(c)"
          >
            <view class="dr-icon" :class="{ 'dr-rest': isAdded(c) }">{{ initialOf(c) }}</view>
            <view class="dr-main">
              <view class="dr-name">{{ c.name }}</view>
              <view class="dr-pkg">{{ c.pkg }}</view>
            </view>
            <text class="cand-add">{{ isAdded(c) ? $t('已选') : $t('选') }}</text>
          </view>
        </scroll-view>
      </template>
    </view>

    <view v-else class="card">
      <view class="pc-txt">{{ $t('休闲关注统计目前仅支持安卓端。') }}</view>
    </view>

    <view style="height: 40rpx"></view>
  </view>
</template>

<script>
import * as settings from '../../../utils/settings.js'
import * as apptime from '../../../utils/apptime.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      isAndroid: false,
      permitted: false,
      all: [],
      kw: '',
      loadingApps: false,
      _refreshed: false,
      selected: []   // [{pkg,name}]
    }
  },
  computed: {
    loadingTip() {
      return this.all.length ? this.$t('正在更新应用列表…') : this.$t('正在读取应用列表…第一次会慢一点')
    },
    candidates() {
      const k = String(this.kw || '').trim().toLowerCase()
      const base = this.all.slice(0, 80)
      if (!k) return base
      return base.filter(a => a.name.toLowerCase().indexOf(k) >= 0 || a.pkg.toLowerCase().indexOf(k) >= 0)
    }
  },
  onShow() {
    this.isAndroid = apptime.supported()
    this.permitted = this.isAndroid && apptime.hasUsagePermission()
    this.selected = (settings.get().leisure && settings.get().leisure.pkgs) || []
    if (this.isAndroid) this.loadApps()
  },
  methods: {
    loadApps() {
      if (this.all.length) return
      const cached = apptime.installedAppsCached()
      if (cached.length) { this.all = cached; this.readApps(true); return }
      this.readApps(false)
    },
    readApps(silent) {
      if (this._refreshed) return
      this._refreshed = true
      if (!silent) this.loadingApps = true
      setTimeout(() => {
        try {
          const list = apptime.installedApps()
          if (list && list.length) this.all = list
        } catch (e) {}
        this.loadingApps = false
      }, silent ? 200 : 60)
    },
    onSearch(e) { this.kw = e.detail.value },
    initialOf(a) { return String(a.name || a.pkg || '?').slice(0, 1).toUpperCase() },
    isAdded(c) { return this.selected.some(s => s.pkg === c.pkg) },
    toggle(c) {
      if (this.isAdded(c)) {
        this.selected = this.selected.filter(s => s.pkg !== c.pkg)
      } else {
        this.selected.push({ pkg: c.pkg, name: c.name })
      }
      this.persist()
    },
    tapAll() { this.selected = []; this.persist() },
    persist() {
      const cur = settings.get().leisure || {}
      const next = Object.assign({}, cur, { pkgs: this.selected.slice() })
      settings.set({ leisure: next })
      this.permitted = this.isAndroid && apptime.hasUsagePermission()
    },
    openPerm() { try { apptime.openUsageSettings() } catch (e) {} }
  }
}
</script>

<style>
.card { margin-bottom: var(--app-gap, 20rpx); }
.pc-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.pc-txt { margin-top: 14rpx; font-size: 24rpx; line-height: 1.8; color: #5a6560; color: var(--ink-2, #5a6560); }
.pc-perm {
  margin-top: 20rpx; display: flex; align-items: center; justify-content: space-between;
  padding: 18rpx 24rpx; border-radius: 16rpx; background: rgba(247, 144, 9, 0.1);
}
.pc-perm-txt { font-size: 24rpx; color: #8a5800; }
.pc-perm-btn { font-size: 25rpx; font-weight: 600; color: #f79009; }
.pc-ok { margin-top: 20rpx; padding: 14rpx 24rpx; border-radius: 16rpx; background: rgba(59, 109, 17, 0.1); font-size: 24rpx; color: #3b6d11; }
.card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 18rpx; }
.card-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.card-more { font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }
.search {
  background: rgba(255, 255, 255, 0.7); background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8); border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx; padding: 16rpx 22rpx; font-size: 26rpx; color: #17201a; color: var(--ink-1, #17201a);
  margin-bottom: 12rpx;
}
.apps-loading { padding: 10rpx 0 8rpx; }
.al-spin {
  width: 40rpx; height: 40rpx; margin: 10rpx auto 14rpx; border-radius: 50%;
  border: 4rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.18); border-top-color: var(--brand, #e4173d);
  animation: al-spin 0.8s linear infinite;
}
@keyframes al-spin { to { transform: rotate(360deg); } }
.al-txt { display: block; text-align: center; font-size: 23rpx; line-height: 1.6; color: var(--ink-2, #5a6560); }
.app-scroll { max-height: 900rpx; }
.cand { display: flex; align-items: center; padding: 14rpx 0; }
.cand-added { opacity: 0.7; }
.cand-add { flex-shrink: 0; font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }
.dr-icon {
  width: 72rpx; height: 72rpx; border-radius: 20rpx; background: rgba(228, 23, 61, 0.12); background: rgba(var(--brand-rgb, 228, 23, 61), 0.12);
  display: flex; align-items: center; justify-content: center; font-size: 29rpx; font-weight: 600;
  color: #bb1332; color: var(--brand-strong, #bb1332); flex-shrink: 0;
}
.dr-icon.dr-rest { background: rgba(59, 109, 17, 0.12); color: #3b6d11; }
.dr-main { flex: 1; min-width: 0; margin: 0 20rpx; }
.dr-name { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-pkg { margin-top: 4rpx; font-size: 20rpx; color: #98a19b; color: var(--ink-3, #98a19b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
