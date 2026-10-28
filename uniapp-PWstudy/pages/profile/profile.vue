<template>
  <view
    class="container page-tabbar page-nav"
    :class="appTheme"
    :style="appBgStyle"
    @touchstart="onSlideStart"
    @touchmove="onSlideMove"
    @touchend="onSlideEnd"
    @touchcancel="onSlideEnd"
  >
    <float-navbar :title="$t('我的')" :back="false" />

    <!-- 内容区：切 tab 时整体左右滑动 -->
    <view class="page-slide" :class="slideCls" :style="slideStyle">
    <!-- 个人信息卡 -->
    <view class="card profile-card">
      <image class="avatar" :src="avatarSrc" mode="aspectFill" />
      <view class="p-info">
        <view class="p-name">{{ profile.nickname }}</view>
        <view class="p-account">账号：{{ profile.account }}</view>
        <view class="p-bio" v-if="profile.bio">{{ profile.bio }}</view>
      </view>
      <text class="p-edit" @tap="startEdit">{{ $t('编辑资料 ›') }}</text>
    </view>

    <!-- 账号卡：未登录→登录/注册；已登录→账号名 + 退出登录 -->
    <view class="card account-card">
      <block v-if="account.logged">
        <view class="ac-main">
          <text class="ac-name">{{ account.username }}</text>
          <text class="ac-sub">{{ $t('本机账号 · 数据只存在这台设备') }}</text>
        </view>
        <text class="ac-action" @tap="doLogout">{{ $t('退出登录') }}</text>
      </block>
      <block v-else>
        <view class="ac-main">
          <text class="ac-name">{{ $t('未登录') }}</text>
          <text class="ac-sub">{{ $t('登录后学习记录与收藏会写入本机账号') }}</text>
        </view>
        <view class="ac-btn" @tap="goLogin">{{ $t('登录 / 注册') }}</view>
      </block>
    </view>

    <!-- 编辑资料（内联展开） -->
    <view v-if="editing" class="card edit-card">
      <view class="field">
        <text class="field-label">{{ $t('昵称') }}</text>
        <input class="field-input" :value="draft.nickname" maxlength="20" @input="e => draft.nickname = e.detail.value" />
      </view>
      <view class="field">
        <text class="field-label">{{ $t('个性签名') }}</text>
        <input class="field-input" :value="draft.bio" maxlength="40" :placeholder="$t('一句话介绍自己')" @input="e => draft.bio = e.detail.value" />
      </view>
      <view class="edit-actions">
        <button class="btn-ghost cancel-btn" @tap="cancelEdit">{{ $t('取消') }}</button>
        <button class="btn-primary save-btn" @tap="saveEdit">{{ $t('保存') }}</button>
      </view>
    </view>

    <!-- 学习数据条 -->
    <view class="card stat-strip">
      <view class="st-item">
        <text class="st-num">{{ overview.todayMin }}</text>
        <text class="st-label">{{ $t('今日专注(分)') }}</text>
      </view>
      <view class="st-item">
        <text class="st-num">{{ overview.pomo }}</text>
        <text class="st-label">{{ $t('今日专注') }}</text>
      </view>
      <view class="st-item">
        <text class="st-num">{{ overview.goals }}</text>
        <text class="st-label">{{ $t('进行中目标') }}</text>
      </view>
    </view>

    <!-- 功能入口 -->
    <view class="card menu-card">
      <view class="menu-item" @tap="go('/pkgPlan/pages/apps/apps')">
        <text class="menu-title">{{ $t('学习 App 管理') }}</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgPlan/pages/range/range')">
        <view class="menu-main">
          <text class="menu-title">{{ $t('学习范围') }}</text>
          <text class="menu-hint" v-if="rangeHint">{{ rangeHint }}</text>
        </view>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgPlan/pages/wizard/wizard')">
        <text class="menu-title">{{ $t('新建目标') }}</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgManage/pages/settings/settings')">
        <text class="menu-title">{{ $t('设置') }}</text>
        <view class="dot-update" v-if="updateDot"></view>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgManage/pages/setup/setup')">
        <text class="menu-title">{{ $t('权限与后台保活') }}</text>
        <text class="menu-hint" v-if="setupPending">{{ setupPending }} 项待处理</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgManage/pages/backup/backup')">
        <text class="menu-title">{{ $t('数据备份') }}</text>
        <text class="menu-arrow">›</text>
      </view>
      <view class="menu-item" @tap="go('/pkgManage/pages/donate/donate')">
        <text class="menu-title">{{ $t('支持 PWstudy') }}</text>
        <text class="menu-arrow">›</text>
      </view>
    </view>
    </view>

    <!-- 悬浮磨砂玻璃标签栏（原生 tabBar 已隐藏） -->
    <float-tabbar ref="tabbar" current="profile" />
  </view>
</template>

<script>
import { t } from '../../utils/i18n.js';
import * as settings from '../../utils/settings'
import * as pw from '../../utils/pwstore.js'
import * as auth from '../../services/auth'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import * as updater from '../../utils/updater.js'
import * as setup from '../../utils/setup.js'
import * as forced from '../../utils/forced.js'
import * as loc from '../../utils/location.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

// 未设置昵称时的默认显示（与 utils/settings.js 的 defaults().profile.nickname 保持一致）
const DEFAULT_NICKNAME = 'plana'

export default {
  components: { FloatTabbar, FloatNavbar },
  mixins: [tabSlideMixin('profile')],
  data() {
    return {
      profile: { avatar: '', nickname: DEFAULT_NICKNAME, account: '', bio: '' },
      overview: { todayMin: 0, pomo: 0, goals: 0 },
      editing: false,
      draft: { nickname: '', bio: '' },
      account: { logged: false, username: '' },
      setupPending: 0,
      // 「学习范围」那一项的副标题：只在开关打开后才有话说
      // （关着是出厂默认，不该显示"未开启"这种像在催人的字样）
      rangeHint: '',
      // 「设置」右侧那个小红点：有新版本才亮。
      // 它不记"看过了" —— 每次进页面重读一次，装完新版版本号不再比本机新，
      // 红点自己就没了。
      updateDot: false
    }
  },
  computed: {
    avatarSrc() {
      return this.profile.avatar || '/static/mascot/plana.jpg'
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    // 强制模式下专注正跑着 → 这儿不该出现，直接把人送回专注页（判定在 utils/forced.js）
    try { if (forced.guardInside('/pages/profile/profile')) return } catch (e) {}
    this.refresh()
    try { this.setupPending = setup.pending().length } catch (e) {}
    // 只在开关打开后才显示：关着是出厂默认，挂个"未开启"像在催人开
    try {
      const n = loc.on() ? loc.places().length : -1;
      this.rangeHint = n < 0 ? '' : (n ? n + ' ' + t('个地点') : t('还没圈地点'));
    } catch (e) { this.rangeHint = '' }
    // 每次进「我的」都重读一次红点：装完新版之后 pending 里的版本号就不再比
    // 本机新，红点自动消失 —— 不用记"看过了"，也就不会有清不掉的标记。
    this.refreshUpdateDot()
    // 订阅登录态：登录页登录成功后这里能立刻更新（不依赖页面重新加载）
    if (!this.__authOff) {
      this.__authOff = auth.onChange(() => {
        this.account = this.readAccount()
      })
    }
  },
  onUnload() {
    if (this.__authOff) { this.__authOff(); this.__authOff = null }
  },
  methods: {
    readAccount() {
      const u = auth.currentUser()
      return u ? { logged: true, username: u.nickname || u.username } : { logged: false, username: '' }
    },
    goLogin() {
      uni.navigateTo({ url: '/pkgManage/pages/login/login' })
    },
    async doLogout() {
      try {
        const s = auth.session()
        await auth.logout()
        this.account = { logged: false, username: '' }
        uni.showToast({ title: s ? t('已退出登录') : t('当前未登录'), icon: 'none' })
      } catch (e) {
        uni.showToast({ title: t('退出失败'), icon: 'none' })
      }
    },
    /**
     * 读一次红点。异步（要拿本机版本比），失败一律当"没更新" ——
     * 一个读不出来的状态不该亮红点。
     */
    refreshUpdateDot() {
      try {
        updater.hasUpdate().then((v) => { this.updateDot = !!v }, () => { this.updateDot = false })
      } catch (e) { this.updateDot = false }
    },
    refresh() {
      this.account = this.readAccount()
      this.profile = Object.assign({}, settings.get().profile)
      const ov = pw.overview()
      this.overview = {
        todayMin: ov.todayMin,
        pomo: ov.pomo,
        goals: ov.activeGoals
      }
    },
    startEdit() {
      this.draft = { nickname: this.profile.nickname, bio: this.profile.bio }
      this.editing = true
    },
    cancelEdit() {
      this.editing = false
    },
    saveEdit() {
      const nickname = String(this.draft.nickname || '').trim()
      if (!nickname) {
        uni.showToast({ title: t('昵称不能为空'), icon: 'none' })
        return
      }
      settings.set({ profile: { nickname, bio: String(this.draft.bio || '').trim() } })
      this.editing = false
      this.refresh()
      uni.showToast({ title: t('已保存'), icon: 'success' })
    },
    // 跳转失败要能看见：uni 的默认行为是静默失败，之前"点了没反应"排查半天没有线索，
    // 这里把 fail 的原因直接 toast 出来。
    go(url) {
      uni.navigateTo({
        url,
        fail: (e) => {
          console.error('[profile] 跳转失败 ' + url, e)
          uni.showToast({ title: '打开失败：' + ((e && (e.errMsg || e.message)) || '未知原因'), icon: 'none' })
        }
      })
    }
  }
}
</script>

<style>
.profile-card {
  display: flex;
  align-items: center;
  margin-bottom: 20rpx;
}

.avatar {
  width: 110rpx;
  height: 110rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(255, 255, 255, 0.8);
  border: 3rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  box-shadow: 0 4rpx 14rpx rgba(23, 32, 26, 0.06);
  box-shadow: 0 4rpx 14rpx rgba(var(--shadow-rgb, 23, 32, 26), 0.06);
  flex-shrink: 0;
  background: #e4e9e4;
}

.p-info { flex: 1; margin-left: 26rpx; min-width: 0; }

.p-name {
  font-size: 34rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
  letter-spacing: 1rpx;
}

.p-account { margin-top: 8rpx; font-size: 22rpx; color: #98a19b; }
.p-account { margin-top: 8rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.p-bio {
  margin-top: 8rpx;
  font-size: 24rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.p-edit { font-size: 26rpx; color: #bb1332; flex-shrink: 0; }
.p-edit { font-size: 26rpx; color: var(--brand-strong, #bb1332); flex-shrink: 0; }

/* 账号卡 */
.account-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20rpx;
}

.ac-main { flex: 1; min-width: 0; }

.ac-name {
  font-size: 30rpx;
  font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.ac-sub {
  display: block;
  margin-top: 6rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.ac-btn {
  flex-shrink: 0;
  font-size: 26rpx;
  font-weight: 600;
  color: #bb1332; color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1); background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border: 2rpx solid rgba(228, 23, 61, 0.4); border: 2rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.4);
  border-radius: 999rpx;
  padding: 14rpx 36rpx;
}

.ac-action {
  flex-shrink: 0;
  font-size: 26rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}

.edit-card { margin-bottom: var(--app-gap, 20rpx); }

.field { display: flex; align-items: center; margin-bottom: 20rpx; }

.field-label { width: 140rpx; font-size: 26rpx; color: #5a6560; flex-shrink: 0; }
.field-label { width: 140rpx; font-size: 26rpx; color: var(--ink-2, #5a6560); flex-shrink: 0; }

.field-input {
  flex: 1;
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  -webkit-backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  backdrop-filter: var(--glass-sm, blur(8px) saturate(180%));
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 16rpx 20rpx;
  font-size: 28rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
}

.edit-actions { display: flex; }

.cancel-btn { width: 30%; margin-right: 20rpx; height: 80rpx; font-size: 28rpx; }

.save-btn { flex: 1; height: 80rpx; font-size: 28rpx; }

.stat-strip { display: flex; padding: 30rpx 0; margin-bottom: 20rpx; }

.st-item { flex: 1; display: flex; flex-direction: column; align-items: center; }

.st-num { font-size: 38rpx; font-weight: 700; color: #e4173d; }
.st-num { font-size: 38rpx; font-weight: 700; color: var(--brand, #e4173d); }

.st-label { font-size: 22rpx; color: #5a6560; margin-top: 6rpx; }
.st-label { font-size: 22rpx; color: var(--ink-2, #5a6560); margin-top: 6rpx; }

.menu-card { padding: 8rpx 36rpx; }

.menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 32rpx 0;
  border-bottom: 2rpx solid rgba(23, 32, 26, 0.07);
  border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}

.menu-item:last-child { border-bottom: none; }

.menu-title { font-size: 30rpx; color: #17201a; }
.menu-title { font-size: 30rpx; color: var(--ink-1, #17201a); }

.menu-arrow { font-size: 32rpx; color: #c8cdc9; }
/* 有更新时的小红点。8px 的小圆点 —— 实心红只用在这么小的面积上，
   大块实心红一律换成 tint 按钮（见设计规范）。 */
.dot-update {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--brand-strong);
  margin-right: 8rpx;
  flex: none;
}

.menu-main { flex: 1; min-width: 0; }

.menu-hint { display: block; margin-top: 6rpx; font-size: 22rpx; color: #98a19b; }
.menu-hint { display: block; margin-top: 6rpx; font-size: 22rpx; color: var(--ink-3, #98a19b); }

.menu-disabled .menu-title { color: #b0b7b2; }

.menu-disabled .menu-arrow { color: #dfe3e0; }
</style>
