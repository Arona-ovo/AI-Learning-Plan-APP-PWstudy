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
    <float-navbar title="目标" />

    <view class="page-slide" :class="slideCls" :style="slideStyle">

      <view class="head-row">
        <button class="btn-primary new-btn" @tap="goWizard()">＋ 新目标（AI 规划）</button>
        <button class="btn-ghost cal-btn" @tap="goCalendar()">日程</button>
      </view>

      <!-- 空态 -->
      <view class="card" v-if="!goals.length">
        <view class="big-empty">
          <view class="be-ring"><view class="be-dot"></view></view>
          <view class="be-title">还没有目标</view>
          <view class="be-sub">写下你想在几周或几个月内达成的事——通过考试、读完一批书、练成一项技能。AI 会把它拆成里程碑和每天的任务。</view>
        </view>
      </view>

      <!-- 目标列表 -->
      <view v-for="g in goals" :key="g.id" class="card goal-card" @tap="goDetail(g.id)">
        <view class="g-top">
          <text class="g-title">{{ g.title }}</text>
          <text class="g-badge" :class="{ 'g-badge-late': remainDays(g) <= 0 }">
            {{ remainDays(g) > 0 ? '剩 ' + remainDays(g) + ' 天' : '已到期' }}
          </text>
        </view>
        <view class="g-meta">截止 {{ g.deadline }} · 每天 {{ g.dailyMin }} 分钟 · {{ g.milestones.length }} 个阶段</view>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: progressOf(g).pct + '%' }"></view>
        </view>
        <view class="g-foot">
          <text>{{ progressOf(g).done }}/{{ progressOf(g).total }} 专注 · {{ progressOf(g).pct }}%</text>
          <text class="g-today">{{ todayCount(g) ? '今日任务 ' + todayCount(g) + ' 个' : '今日无任务' }}</text>
        </view>
        <view class="g-actions">
          <text class="g-btn" @tap.stop="goReplan(g.id)">重新规划</text>
          <text class="g-btn g-btn-danger" @tap.stop="confirmArchive(g)">归档</text>
        </view>
      </view>

      <!-- 已归档（折叠入口） -->
      <view class="card archived-card" v-if="archived.length" @tap="showArchived = !showArchived">
        <text class="card-title">已归档（{{ archived.length }}）</text>
        <text class="card-more">{{ showArchived ? '收起' : '展开' }}</text>
      </view>
      <view class="card goal-card" v-for="g in (showArchived ? archived : [])" :key="'a' + g.id" @tap="goDetail(g.id)">
        <view class="g-top">
          <text class="g-title g-title-archived">{{ g.title }}</text>
        </view>
        <view class="g-meta">已归档 · {{ progressOf(g).pct }}%</view>
      </view>

    </view>

    <app-dialog
      :show="dlg.show"
      :title="dlg.title"
      :content="dlg.content"
      :confirm-text="dlg.confirmText"
      :danger="dlg.danger"
      :seq="dlg.seq"
      @confirm="onDlgYes"
      @cancel="dlg.show = false"
    />

    <float-tabbar ref="tabbar" current="goals" />
  </view>
</template>

<script>
import * as pw from '../../utils/pwstore.js'
import { hideNativeTabBar, syncTabbar } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'
import AppDialog from '../../components/app-dialog/app-dialog.vue'

export default {
  components: { FloatTabbar, FloatNavbar, AppDialog },
  mixins: [tabSlideMixin('goals')],
  data() {
    return {
      goals: [],
      archived: [],
      showArchived: false,
      // 统一弹窗（components/app-dialog）：不用 uni.showModal，样式跟卡片一致
      dlg: { show: false, title: '', content: '', confirmText: '确定', danger: false, seq: 0, action: '', goalId: '' }
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    this.refresh()
  },
  methods: {
    refresh() {
      const st = pw.get()
      this.goals = st.goals.filter(g => g.status === 'active')
      this.archived = st.goals.filter(g => g.status === 'archived')
    },
    remainDays(g) { return pw.dayDiff(pw.today(), g.deadline) },
    progressOf(g) { return pw.goalProgress(g) },
    todayCount(g) { return pw.todayQueue(99).filter(x => x.goal.id === g.id).length },
    goWizard() { uni.navigateTo({ url: '/pkgPlan/pages/wizard/wizard' }) },
    goCalendar() { uni.navigateTo({ url: '/pkgPlan/pages/calendar/calendar' }) },
    goDetail(id) { uni.navigateTo({ url: '/pkgPlan/pages/goal-detail/goal-detail?id=' + id }) },
    goReplan(id) { uni.navigateTo({ url: '/pkgPlan/pages/replan/replan?id=' + id }) },
    // ---------- 统一弹窗 ----------
    ask(cfg) {
      this.dlg = Object.assign(
        { show: true, title: '', content: '', confirmText: '确定', danger: false, action: '', goalId: '' },
        cfg || {},
        { seq: (this.dlg && this.dlg.seq || 0) + 1 }
      )
    },
    onDlgYes() {
      const act = this.dlg.action
      const id = this.dlg.goalId
      this.dlg.show = false
      if (act === 'archive') {
        pw.archiveGoal(id)
        this.refresh()
      }
    },
    confirmArchive(g) {
      this.ask({
        title: '归档目标',
        content: '「' + g.title + '」会从进行中列表移开，数据保留。确定归档？',
        confirmText: '归档',
        action: 'archive',
        goalId: g.id
      })
    }
  }
}
</script>

<style>
.head-row { display: flex; align-items: stretch; margin-bottom: 20rpx; }
.new-btn { flex: 1; margin-bottom: 0; margin-right: 18rpx; }
.cal-btn { width: 150rpx; flex-shrink: 0; margin-bottom: 0; }

.big-empty { padding: 30rpx 10rpx 20rpx; display: flex; flex-direction: column; align-items: center; text-align: center; }
.be-ring {
  width: 140rpx; height: 140rpx;
  border-radius: 50%;
  border: 6rpx solid rgba(228, 23, 61, 0.2);
  border: 6rpx solid rgba(var(--brand-rgb, 228, 23, 61), 0.2);
  display: flex; align-items: center; justify-content: center;
}
.be-dot {
  width: 44rpx; height: 44rpx; border-radius: 50%;
  background: rgba(228, 23, 61, 0.3);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.3);
}
.be-title { margin-top: 26rpx; font-size: 30rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.be-sub { margin-top: 14rpx; font-size: 25rpx; line-height: 1.7; color: #5a6560; color: var(--ink-2, #5a6560); }

.goal-card { margin-bottom: 20rpx; }
.g-top { display: flex; align-items: flex-start; justify-content: space-between; }
.g-title {
  flex: 1; min-width: 0;
  font-size: 30rpx; font-weight: 600;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.g-title-archived { color: #98a19b; color: var(--ink-3, #98a19b); font-weight: 500; }
.g-badge {
  flex-shrink: 0; margin-left: 16rpx;
  font-size: 22rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  background: rgba(228, 23, 61, 0.1);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  border-radius: 999rpx;
  padding: 6rpx 18rpx;
}
.g-badge-late { color: #e5484d; background: rgba(229, 72, 77, 0.1); }
.g-meta { margin: 14rpx 0 18rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.g-foot {
  display: flex; justify-content: space-between;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: #98a19b;
  color: var(--ink-3, #98a19b);
}
.g-actions {
  display: flex; justify-content: flex-end;
  margin-top: 18rpx; padding-top: 18rpx;
  border-top: 2rpx solid rgba(23, 32, 26, 0.07);
  border-top: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}
.g-btn {
  font-size: 25rpx;
  color: #bb1332;
  color: var(--brand-strong, #bb1332);
  padding: 6rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(228, 23, 61, 0.08);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.08);
  margin-left: 14rpx;
}
.g-btn-danger { color: #e5484d; background: rgba(229, 72, 77, 0.08); }
.archived-card { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20rpx; }
</style>
