<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="学习 App" />

    <!-- 权限说明与引导 -->
    <view class="card">
      <view class="pc-title">使用时长是怎么统计的</view>
      <view class="pc-txt">
        ① 从首页「学习 App」点图标跳过去：自动记录从出发到回来的用时（无需任何权限）。
        ② 开启系统的「使用情况访问」后：还能统计你直接打开这些 App 的总时长，两组数据取大值展示。所有数据只存在手机里，不上传。
      </view>
      <view v-if="isAndroid && !permitted" class="pc-perm" @tap="openPerm">
        <text class="pc-perm-txt">系统统计未开启</text>
        <text class="pc-perm-btn">去开启 ›</text>
      </view>
      <view v-else-if="isAndroid" class="pc-ok">系统统计已开启</view>
    </view>

    <!-- 已添加的 App -->
    <view class="card" v-if="dock.length">
      <view class="card-head">
        <text class="card-title">我的学习 App（{{ dock.length }}）</text>
        <text class="card-more" @tap="adding = !adding">＋ 添加</text>
      </view>
      <view v-for="a in dock" :key="a.pkg" class="dock-row">
        <view class="dr-icon" :class="{ 'dr-rest': a.purpose === 'rest' }">{{ initialOf(a) }}</view>
        <view class="dr-main">
          <view class="dr-name">{{ a.name }}</view>
          <view class="dr-pkg">{{ a.pkg }}</view>
        </view>
        <view class="dr-purpose" @tap="togglePurpose(a)">
          {{ a.purpose === 'rest' ? '休息' : '学习' }}
        </view>
        <text class="dr-del" @tap="askRemove(a)">移除</text>
      </view>
    </view>
    <view class="card" v-else>
      <view class="pc-title">还没添加 App</view>
      <view class="pc-txt">把背单词、刷题、看课用的 App 加进来，首页就能一键直达并自动计时。</view>
      <button class="btn-primary pc-btn" @tap="adding = true">＋ 添加 App</button>
    </view>

    <!-- 添加面板 -->
    <view class="card add-card" v-if="adding">
      <view class="card-head">
        <text class="card-title">{{ isAndroid ? '从已安装应用里选' : '手动添加' }}</text>
        <text class="card-more" @tap="adding = false">收起</text>
      </view>

      <template v-if="isAndroid">
        <input
          class="search"
          :value="kw"
          placeholder="搜索应用名"
          placeholder-style="color:#a8b0ab;font-size:26rpx"
          @input="onSearch"
        />
        <view v-if="loadingApps" class="pc-txt">正在读取应用列表…</view>
        <template v-else>
          <view v-if="appsError" class="pc-warn">{{ appsError }}</view>
          <view v-if="!all.length" class="pc-txt">
            实在读不到就用手动添加：填 App 名称，能从别的途径拿到包名（如应用商店详情页）就一起填上。
          </view>
          <view v-else-if="!candidates.length" class="pc-txt">没有匹配「{{ kw }}」的应用</view>
          <scroll-view v-else class="app-scroll" scroll-y>
            <view
              v-for="c in candidates"
              :key="c.pkg"
              class="cand"
              :class="{ 'cand-added': isAdded(c) }"
              @tap="add(c)"
            >
              <view class="dr-icon">{{ (c.name || '?').slice(0, 1).toUpperCase() }}</view>
              <view class="dr-main">
                <view class="dr-name">{{ c.name }}</view>
                <view class="dr-pkg">{{ c.pkg }}</view>
              </view>
              <text class="cand-add">{{ isAdded(c) ? '已添加' : '添加' }}</text>
            </view>
          </scroll-view>
        </template>
      </template>

      <template v-else>
        <view class="m-row">
          <text class="m-label">App 名称</text>
          <input class="m-input" v-model="manual.name" placeholder="例如：不背单词" />
        </view>
        <view class="m-row">
          <text class="m-label">包名（选填）</text>
          <input class="m-input" v-model="manual.pkg" placeholder="com.example.app" />
        </view>
        <view class="m-row">
          <text class="m-label">用途</text>
          <view class="seg">
            <text class="seg-opt" :class="{ 'seg-on': manual.purpose === 'study' }" @tap="manual.purpose = 'study'">学习</text>
            <text class="seg-opt" :class="{ 'seg-on': manual.purpose === 'rest' }" @tap="manual.purpose = 'rest'">休息</text>
          </view>
        </view>
        <button class="btn-primary pc-btn" @tap="addManual">保存</button>
      </template>

      <!-- 手动添加在 App 端也要有：列表读不全时的最后退路 -->
      <view v-if="isAndroid" class="manual-toggle" @tap="manualOpen = !manualOpen">
        {{ manualOpen ? '收起手动添加' : '列表里没有？手动添加 ›' }}
      </view>
      <view v-if="isAndroid && manualOpen" class="manual-box">
        <view class="m-row">
          <text class="m-label">App 名称</text>
          <input class="m-input" v-model="manual.name" placeholder="例如：不背单词" />
        </view>
        <view class="m-row">
          <text class="m-label">包名（选填）</text>
          <input class="m-input" v-model="manual.pkg" placeholder="com.example.app" />
        </view>
        <button class="btn-ghost pc-btn" @tap="addManual">保存</button>
      </view>
    </view>

    <view style="height: 40rpx"></view>

    <app-dialog
      :show="dlg.show"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :mode="dlg.mode"
      :items="dlg.items"
      :danger="dlg.danger"
      :seq="dlg.seq"
      @confirm="onDlgYes"
      @cancel="dlg.show = false"
    />
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as apptime from '../../../utils/apptime.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatNavbar, AppDialog },
  data() {
    return {
      dock: [],
      permitted: false,
      isAndroid: false,
      adding: false,
      all: [],
      kw: '',
      loadingApps: false,
      appsError: '',
      manual: { name: '', pkg: '', purpose: 'study' },
      // 统一弹窗（components/app-dialog）
      dlg: { show: false, mode: 'confirm', title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', items: [], pkg: '' },
      manualOpen: false
    }
  },
  computed: {
    candidates() {
      const k = String(this.kw || '').trim().toLowerCase()
      if (!k) return this.all.slice(0, 60)
      return this.all.filter(a => a.name.toLowerCase().indexOf(k) >= 0 || a.pkg.toLowerCase().indexOf(k) >= 0).slice(0, 60)
    }
  },
  onShow() {
    this.refresh()
    if (this.isAndroid && !this.all.length) this.loadApps()
  },
  methods: {
    refresh() {
      // 清一遍脏数据：早期版本可能存进过 pkg/name 为空的死行（真机截图出现过 null/undefined）
      const st = pw.get()
      const before = st.dock.length
      st.dock = st.dock.filter(a => a && a.pkg)
      st.dock.forEach(a => { if (!a.name || a.name === 'null') a.name = a.pkg })
      if (st.dock.length !== before) pw.touch()
      this.dock = st.dock
      this.isAndroid = apptime.supported()
      this.permitted = this.isAndroid && apptime.hasUsagePermission()
    },
    loadApps() {
      this.loadingApps = true
      // 读应用列表在部分低端机上偏慢，延一帧再跑，先让页面完成首绘
      setTimeout(() => {
        try {
          this.all = apptime.installedApps()
          this.appsError = apptime.lastAppsError || ''
        } catch (e) {
          this.all = []
          this.appsError = '读取应用列表失败：' + ((e && e.message) || '未知错误')
        }
        this.loadingApps = false
      }, 60)
    },
    onSearch(e) { this.kw = e.detail.value },
    isAdded(c) { return this.dock.some(a => a.pkg === c.pkg) },
    add(c) {
      if (this.isAdded(c)) return
      pw.dockAdd(c.pkg, c.name, 'study')
      this.refresh()
      uni.showToast({ title: '已添加', icon: 'success' })
    },
    addManual() {
      const name = String(this.manual.name || '').trim()
      if (!name) { uni.showToast({ title: '先填个名字', icon: 'none' }); return }
      // 有包名就能一键直达 + 参与系统级统计；没有则只做记录用
      const pkg = String(this.manual.pkg || '').trim() || 'manual:' + name
      pw.dockAdd(pkg, name, this.manual.purpose)
      this.manual.name = ''
      this.manual.pkg = ''
      this.refresh()
      uni.showToast({ title: '已添加', icon: 'success' })
    },
    togglePurpose(a) {
      pw.dockSetPurpose(a.pkg, a.purpose === 'rest' ? 'study' : 'rest')
      this.refresh()
    },
    // ---------- 统一弹窗 ----------
    ask(cfg) {
      this.dlg = Object.assign(
        { show: true, mode: 'confirm', title: '', content: '', confirmText: '确定',
          danger: false, action: '', items: [], pkg: '' },
        cfg || {},
        { seq: (this.dlg && this.dlg.seq || 0) + 1 }
      )
    },
    onDlgYes() {
      const act = this.dlg.action
      const pkg = this.dlg.pkg
      this.dlg.show = false
      if (act === 'remove') {
        pw.dockRemove(pkg)
        this.refresh()
      }
    },
    askRemove(a) {
      this.ask({
        title: '移除 App',
        content: '「' + a.name + '」不再出现在首页，历史统计保留。',
        confirmText: '移除',
        danger: true,
        action: 'remove',
        pkg: a.pkg
      })
    },
    openPerm() {
      apptime.openUsageSettings()
    },
    initialOf(a) {
      return String(a.name || a.pkg || '?').slice(0, 1).toUpperCase()
    }
  }
}
</script>

<style>
.card { margin-bottom: 20rpx; }
.pc-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.pc-txt { margin-top: 14rpx; font-size: 24rpx; line-height: 1.8; color: #5a6560; color: var(--ink-2, #5a6560); }
.pc-warn {
  margin: 16rpx 0; padding: 16rpx 20rpx;
  border-radius: 14rpx;
  background: rgba(247, 144, 9, 0.12);
  font-size: 23rpx; line-height: 1.7; color: #8a5800;
}
.manual-toggle { margin-top: 22rpx; font-size: 24rpx; color: var(--brand-strong, #be123c); text-align: center; }
.manual-box { margin-top: 10rpx; padding-top: 6rpx; border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }
.pc-btn { margin-top: 24rpx; height: 84rpx; font-size: 27rpx; }
.pc-perm {
  margin-top: 20rpx;
  display: flex; align-items: center; justify-content: space-between;
  padding: 18rpx 24rpx;
  border-radius: 16rpx;
  background: rgba(247, 144, 9, 0.1);
}
.pc-perm-txt { font-size: 24rpx; color: #8a5800; }
.pc-perm-btn { font-size: 25rpx; font-weight: 600; color: #f79009; }
.pc-ok {
  margin-top: 20rpx;
  padding: 14rpx 24rpx;
  border-radius: 16rpx;
  background: rgba(59, 109, 17, 0.1);
  font-size: 24rpx; color: #3b6d11;
}

.card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 20rpx;
}
.card-title { font-size: 29rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.card-more { font-size: 24rpx; color: #be123c; color: var(--brand-strong, #be123c); }

.dock-row { display: flex; align-items: center; padding: 16rpx 0; }
.dr-icon {
  width: 76rpx; height: 76rpx;
  border-radius: 20rpx;
  background: rgba(225, 29, 72, 0.12);
  background: rgba(var(--brand-rgb, 225, 29, 72), 0.12);
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx; font-weight: 600;
  color: #be123c;
  color: var(--brand-strong, #be123c);
  flex-shrink: 0;
}
.dr-rest { background: rgba(122, 124, 122, 0.16); color: #5a6560; color: var(--ink-2, #5a6560); }
.dr-main { flex: 1; min-width: 0; margin: 0 20rpx; }
.dr-name { font-size: 27rpx; color: #17201a; color: var(--ink-1, #17201a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-pkg { margin-top: 4rpx; font-size: 20rpx; color: #98a19b; color: var(--ink-3, #98a19b); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-purpose {
  flex-shrink: 0;
  font-size: 22rpx;
  padding: 8rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(225, 29, 72, 0.1);
  background: rgba(var(--brand-rgb, 225, 29, 72), 0.1);
  color: #be123c;
  color: var(--brand-strong, #be123c);
  margin-right: 16rpx;
}
.dr-del {
  flex-shrink: 0;
  font-size: 22rpx;
  color: #e5484d;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(229, 72, 77, 0.08);
}

.search {
  background: rgba(255, 255, 255, 0.7);
  background: rgba(var(--surface-rgb, 255, 255, 255), 0.7);
  border: 2rpx solid rgba(255, 255, 255, 0.8);
  border: 2rpx solid var(--hairline, rgba(var(--surface-rgb, 255, 255, 255), 0.8));
  border-radius: 16rpx;
  padding: 16rpx 22rpx;
  font-size: 26rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  margin-bottom: 12rpx;
}
.app-scroll { max-height: 640rpx; }
.cand { display: flex; align-items: center; padding: 12rpx 0; }
.cand-added { opacity: 0.45; }
.cand-add { flex-shrink: 0; font-size: 24rpx; color: #be123c; color: var(--brand-strong, #be123c); }

.m-row { display: flex; align-items: center; padding: 18rpx 0; }
.m-label { width: 150rpx; font-size: 25rpx; color: #5a6560; color: var(--ink-2, #5a6560); flex-shrink: 0; }
.m-input { flex: 1; font-size: 26rpx; color: #17201a; color: var(--ink-1, #17201a); text-align: right; }
.seg { display: flex; }
.seg-opt {
  font-size: 23rpx;
  padding: 8rpx 26rpx;
  border-radius: 999rpx;
  margin-left: 12rpx;
  background: rgba(23, 32, 26, 0.06);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.seg-on { background: #e11d48; background: var(--brand, #e11d48); color: #ffffff; }
</style>
