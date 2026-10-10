<template>
  <view class="container page-nav" :class="appTheme" :style="appBgStyle">
    <float-navbar title="目标详情" />

    <view v-if="g" class="body">
      <!-- 概览 -->
      <view class="card">
        <view class="gd-title">{{ g.title }}</view>
        <view class="gd-meta">截止 {{ g.deadline }} · 剩 {{ remainDays }} 天 · 每天 {{ g.dailyMin }} 分钟</view>
        <view class="progress-track">
          <view class="progress-fill" :style="{ width: progress.pct + '%' }"></view>
        </view>
        <view class="gd-sub">{{ progress.done }}/{{ progress.total }} 番茄 · {{ progress.pct }}%</view>
        <view v-if="g.strategy" class="gd-strategy">{{ g.strategy }}</view>
        <view v-if="g.risks.length" class="gd-risks">
          <text v-for="(r, i) in g.risks" :key="i" class="gd-risk">⚠ {{ r }}</text>
        </view>
      </view>

      <!-- 阶段与任务 -->
      <view class="card" v-for="(group, gi) in grouped" :key="gi">
        <view class="card-head">
          <text class="card-title">{{ group.title }}</text>
          <text class="card-more">阶段 {{ gi + 1 }}</text>
        </view>
        <view v-for="t in group.tasks" :key="t.id" class="task" @tap="toggle(t)">
          <view class="tk-check" :class="{ 'tk-check-on': t.status === 'done', 'tk-check-drop': t.status === 'dropped' }">
            {{ t.status === 'done' ? '✓' : '' }}
          </view>
          <view class="tk-main">
            <view class="tk-title" :class="{ 'tk-title-done': t.status !== 'todo' }">{{ t.title }}</view>
            <view class="tk-sub">
              第 {{ t.day }} 天开始 · {{ t.donePomos }}/{{ t.pomos }} 番茄
              <text v-if="t.status === 'dropped'" class="tk-drop">已砍掉</text>
              <text v-else-if="t.status === 'done'" class="tk-done">已完成</text>
            </view>
            <view v-if="t.res && t.res.length" class="tk-res">
              <text v-for="(r, ri) in t.res" :key="ri" class="tk-res-chip">📖 {{ r }}</text>
            </view>
          </view>
          <text v-if="t.status === 'todo'" class="tk-drop-btn" @tap.stop="askDrop(t)">砍掉</text>
          <text class="tk-guide" @tap.stop="openGuide(t)">要点</text>
        </view>
      </view>

      <!-- 操作 -->
      <view class="actions">
        <button class="btn-ghost act-btn" @tap="goReplan">AI 重新规划</button>
        <button class="btn-primary act-btn" @tap="goFocusNext">继续专注</button>
      </view>
    </view>

    <!-- 学习要点弹层 -->
    <view v-if="guideOpen" class="pop-mask" @tap="guideOpen = false">
      <view class="pop-card guide-card" @tap.stop>
        <view class="dlg-title">{{ guideTask ? guideTask.title : '学习要点' }}</view>
        <view v-if="guideLoading" class="gd-loading">
          <text class="gd-dot">·</text><text class="gd-dot">·</text><text class="gd-dot">·</text>
          <text class="gd-loading-txt"> AI 正在拆这个任务</text>
        </view>
        <view v-else-if="guideError" class="gd-err">{{ guideError }}</view>
        <view v-else-if="guide" class="gd-body">
          <view class="gd-summary">{{ guide.summary }}</view>
          <view class="gd-sec-title">怎么做</view>
          <view v-for="(s, i) in guide.steps" :key="i" class="gd-step">
            <text class="gd-step-n">{{ i + 1 }}</text>
            <text class="gd-step-txt">{{ s }}</text>
          </view>
          <view class="gd-sec-title">怎么算学会</view>
          <view class="gd-check">{{ guide.check }}</view>
          <view class="gd-foot">建议投入 {{ guide.minutes }} 分钟 · {{ guideFromCache ? '来自缓存' : 'AI 生成' }}</view>
        </view>
        <view class="dlg-actions">
          <button class="btn-ghost dlg-btn" @tap="guideOpen = false">知道了</button>
          <button class="btn-primary dlg-btn" @tap="openPartner">用背单词 App 学</button>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as taskGuide from '../../../utils/task-guide.js'
import * as link from '../../../utils/link.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatNavbar },
  data() {
    return {
      id: '', g: null,
      guideOpen: false, guideLoading: false, guideError: '',
      guideTask: null, guide: null, guideFromCache: false
    }
  },
  computed: {
    remainDays() {
      return this.g ? pw.dayDiff(pw.today(), this.g.deadline) : 0
    },
    progress() {
      return this.g ? pw.goalProgress(this.g) : { done: 0, total: 0, pct: 0 }
    },
    grouped() {
      if (!this.g) return []
      const out = []
      this.g.tasks.forEach(t => {
        let mi = 0
        for (let i = 0; i < this.g.milestones.length; i++) {
          if (this.g.milestones[i].id === t.msId) { mi = i; break }
        }
        while (out.length <= mi) out.push({ title: this.g.milestones[out.length] ? this.g.milestones[out.length].title : '阶段', tasks: [] })
        out[mi].tasks.push(t)
      })
      return out
    }
  },
  onShow() {
    this.refresh()
  },
  methods: {
    refresh() {
      this.g = pw.goalOf(this.id)
    },
    toggle(t) {
      if (t.status === 'dropped') return
      pw.setTaskStatus(this.id, t.id, t.status === 'done' ? 'todo' : 'done')
      this.refresh()
    },
    // ---------- 学习要点 ----------
    openGuide(t) {
      this.guideTask = t
      this.guideOpen = true
      this.guideError = ''
      this.guideFromCache = false
      const cached = taskGuide.get(t)
      if (cached) {
        this.guide = cached
        this.guideFromCache = true
        this.guideLoading = false
        return
      }
      this.guide = null
      this.guideLoading = true
      taskGuide.fetch(t, this.g).then(r => {
        if (!this.guideOpen) return
        this.guide = r.data
        this.guideFromCache = r.fromCache
        this.guideLoading = false
      }).catch(e => {
        this.guideLoading = false
        this.guideError = (e && e.message) ? e.message : '生成失败，请稍后再试'
      })
    },
    // 呼起背单词 App 学这个任务（联动接口，那边装了才跳得过去）
    openPartner() {
      const t = this.guideTask
      if (!t) return
      const ok = link.openPartner(t, (t.pomos || 1) * 25)
      if (!ok) {
        uni.showToast({ title: '还没装背单词 App，或当前端不支持跳转', icon: 'none' })
        return
      }
      this.guideOpen = false
    },
    askDrop(t) {
      uni.showModal({
        title: '砍掉这个任务？',
        content: t.title,
        confirmText: '砍掉',
        confirmColor: '#E5484D',
        success: (r) => {
          if (r.confirm) {
            pw.setTaskStatus(this.id, t.id, 'dropped')
            this.refresh()
          }
        }
      })
    },
    goReplan() {
      uni.navigateTo({ url: '/pkgPlan/pages/replan/replan?id=' + this.id })
    },
    goFocusNext() {
      const q = pw.todayQueue(99).filter(x => x.goal.id === this.id)
      if (q.length) {
        uni.navigateTo({
          url: '/pkgPlan/pages/focus/focus?auto=1&taskId=' + q[0].task.id +
               '&goalId=' + this.id +
               '&title=' + encodeURIComponent(q[0].task.title)
        })
      } else {
        uni.navigateTo({ url: '/pkgPlan/pages/focus/focus?auto=1' })
      }
    }
  },
  onLoad(query) {
    this.id = (query && query.id) || ''
  }
}
</script>

<style>
.body .card { margin-bottom: 20rpx; }

.gd-title { font-size: 32rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); line-height: 1.5; }
.gd-meta { margin: 14rpx 0 18rpx; font-size: 23rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.gd-sub { margin-top: 12rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.gd-strategy {
  margin-top: 18rpx; padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(46, 107, 255, 0.07);
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.07);
  font-size: 25rpx; line-height: 1.7;
  color: #17201a;
  color: var(--ink-1, #17201a);
}
.gd-risks { margin-top: 14rpx; display: flex; flex-direction: column; }
.gd-risk { font-size: 23rpx; line-height: 1.7; color: #8a5800; }

.card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 16rpx;
}
.card-title { font-size: 28rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.card-more { font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

.task { display: flex; align-items: center; padding: 18rpx 0; }
.tk-check {
  width: 44rpx; height: 44rpx;
  border-radius: 50%;
  border: 3rpx solid rgba(23, 32, 26, 0.2);
  border: 3rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.2);
  display: flex; align-items: center; justify-content: center;
  font-size: 26rpx;
  color: #ffffff;
  flex-shrink: 0;
}
.tk-check-on { background: #2e6bff; background: var(--brand, #2e6bff); border-color: transparent; }
.tk-check-drop { background: rgba(23, 32, 26, 0.15); border-color: transparent; }
.tk-main { flex: 1; min-width: 0; margin: 0 20rpx; }
.tk-title { font-size: 27rpx; line-height: 1.5; color: #17201a; color: var(--ink-1, #17201a); }
.tk-title-done { color: #98a19b; color: var(--ink-3, #98a19b); text-decoration: line-through; }
.tk-sub { margin-top: 6rpx; font-size: 22rpx; color: #98a19b; color: var(--ink-3, #98a19b); }
.tk-drop { color: #e5484d; margin-left: 8rpx; }
.tk-done { color: #3b6d11; margin-left: 8rpx; }
/* AI 附的学习资料建议：小字灰底胶囊，一行放不下自动换行 */
.tk-res { margin-top: 8rpx; display: flex; flex-wrap: wrap; }
.tk-res-chip {
  margin: 0 10rpx 8rpx 0;
  padding: 4rpx 14rpx;
  border-radius: 999rpx;
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.06);
  font-size: 21rpx; line-height: 1.6;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
  max-width: 100%;
  box-sizing: border-box;
}
.tk-drop-btn {
  flex-shrink: 0;
  font-size: 23rpx;
  color: #e5484d;
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(229, 72, 77, 0.08);
}

.tk-guide {
  flex-shrink: 0;
  margin-left: 12rpx;
  font-size: 23rpx;
  color: var(--brand-strong, #1d4fd8);
  padding: 6rpx 20rpx;
  border-radius: 999rpx;
  background: rgba(var(--brand-rgb, 46, 107, 255), 0.1);
}

/* ===== 学习要点弹层 ===== */
.guide-card { max-height: 78vh; overflow: hidden; }
.gd-loading { padding: 30rpx 0; text-align: center; color: var(--ink-3, #98a19b); font-size: 26rpx; }
.gd-dot { animation: gd-blink 1.2s ease-in-out infinite; }
.gd-dot:nth-child(2) { animation-delay: 0.2s; }
.gd-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes gd-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.gd-err {
  padding: 24rpx; border-radius: 14rpx; margin: 10rpx 0 20rpx;
  background: rgba(229, 72, 77, 0.1);
  font-size: 25rpx; line-height: 1.6; color: #e5484d;
}
.gd-summary {
  font-size: 28rpx; font-weight: 600; line-height: 1.7;
  color: var(--ink-1, #17201a);
}
.gd-sec-title {
  margin: 28rpx 0 14rpx;
  font-size: 24rpx; color: var(--ink-3, #98a19b);
}
.gd-step { display: flex; margin-bottom: 14rpx; }
.gd-step-n {
  width: 36rpx; height: 36rpx; flex-shrink: 0;
  margin-right: 14rpx; margin-top: 4rpx;
  border-radius: 50%;
  background: var(--brand, #e11d48); color: #fff;
  font-size: 20rpx; line-height: 36rpx; text-align: center;
  font-family: Georgia, serif;
}
.gd-step-txt { flex: 1; font-size: 26rpx; line-height: 1.7; color: var(--ink-1, #17201a); }
.gd-check {
  padding: 20rpx 22rpx; border-radius: 14rpx;
  background: rgba(59, 109, 17, 0.1);
  font-size: 25rpx; line-height: 1.7; color: #3b6d11;
}
.gd-foot { margin-top: 24rpx; font-size: 21rpx; color: var(--ink-3, #98a19b); text-align: right; }
.dlg-actions { display: flex; margin-top: 8rpx; }
.dlg-actions .dlg-btn { flex: 1; }
.dlg-actions .dlg-btn:first-child { margin-right: 18rpx; }

.actions { display: flex; margin: 10rpx 0 30rpx; }
.act-btn { flex: 1; }
.act-btn:first-child { margin-right: 20rpx; }
</style>
