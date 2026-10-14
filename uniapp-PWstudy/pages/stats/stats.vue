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
    <float-navbar title="统计" />

    <view class="page-slide" :class="slideCls" :style="slideStyle">

      <!-- 今日 -->
      <view class="card strip">
        <view class="st-item">
          <text class="st-num">{{ today.focusMin }}</text>
          <text class="st-label">专注(分)</text>
        </view>
        <view class="st-item">
          <text class="st-num">{{ today.pomo }}</text>
          <text class="st-label">专注(段)</text>
        </view>
        <view class="st-item">
          <text class="st-num">{{ totalDone }}</text>
          <text class="st-label">累计(段)</text>
        </view>
      </view>

      <!-- 近 7 天柱状图（纯 CSS，不用 Canvas：与打卡走势同一套理由） -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">近 7 天专注</text>
          <text class="card-more">共 {{ weekMin }} 分钟</text>
        </view>
        <view class="chart">
          <view v-for="(d, i) in week" :key="d.date" class="ch-col">
            <view class="ch-bar-wrap">
              <view class="ch-bar" :class="{ 'ch-bar-zero': !d.focusMin }" :style="{ height: barH(d.focusMin) + '%' }">
                <text v-if="d.focusMin" class="ch-val">{{ d.focusMin }}</text>
              </view>
            </view>
            <text class="ch-day">{{ i === 6 ? '今天' : d.date.slice(8) }}</text>
          </view>
        </view>
      </view>

      <!-- 近 12 周热力图（GitHub 风格，纯 view 画） -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">近 12 周专注热力</text>
          <text class="card-more">{{ heatDays }} 天有记录</text>
        </view>
        <view class="heat">
          <view v-for="(col, ci) in heat" :key="ci" class="ht-col">
            <view
              v-for="(cell, ri) in col"
              :key="ri"
              class="ht-cell"
              :class="'ht-l' + cell.level"
            ></view>
          </view>
        </view>
        <view class="heat-foot">
          <text class="hf-label">少</text>
          <view class="ht-cell ht-l0"></view>
          <view class="ht-cell ht-l1"></view>
          <view class="ht-cell ht-l2"></view>
          <view class="ht-cell ht-l3"></view>
          <view class="ht-cell ht-l4"></view>
          <text class="hf-label">多</text>
          <text class="hf-tip">{{ heatTip }}</text>
        </view>
      </view>

      <!-- 一天里哪几段真的学得进去 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">时段分布</text>
          <text class="card-more">近 30 天</text>
        </view>
        <view class="hours">
          <view v-for="(m, h) in hours" :key="h" class="hr-col">
            <view class="hr-bar" :class="{ 'hr-bar-zero': !m }" :style="{ height: hourH(m) + '%' }"></view>
          </view>
        </view>
        <view class="hr-axis">
          <text class="hr-tick">0</text>
          <text class="hr-tick">6</text>
          <text class="hr-tick">12</text>
          <text class="hr-tick">18</text>
          <text class="hr-tick">23</text>
        </view>
        <view v-if="bestText" class="hr-best">{{ bestText }}</view>
      </view>

      <!-- 按近期速度外推：目标大概哪天做完 -->
      <view class="card" v-if="forecasts.length">
        <view class="card-head">
          <text class="card-title">按最近 7 天的速度</text>
          <text class="card-more">预计完成</text>
        </view>
        <view v-for="f in forecasts" :key="f.id" class="fc-row" @tap="goDetail(f.id)">
          <view class="fc-main">
            <view class="fc-title">{{ f.title }}</view>
            <view class="fc-sub">{{ f.done }}/{{ f.total }} 专注 · 每天约 {{ f.perDay }} 个</view>
          </view>
          <view class="fc-right">
            <text class="fc-date" :class="{ 'fc-date-late': f.late }">{{ f.dateText }}</text>
            <text v-if="f.late" class="fc-late">比截止晚 {{ f.lateDays }} 天</text>
          </view>
        </view>
        <view class="hr-best">速度按最近 7 天实际完成的专注算，没学的日子算 0 —— 是对自己诚实的值。</view>
      </view>

      <!-- AI 周复盘 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">AI 周复盘</text>
          <text class="card-more" @tap="loadReview">{{ review ? '重新生成' : '生成' }}</text>
        </view>
        <view v-if="reviewLoading" class="rv-loading">
          <text class="rv-dot">·</text><text class="rv-dot">·</text><text class="rv-dot">·</text>
          <text> AI 正在看这一周</text>
        </view>
        <view v-else-if="reviewError" class="rv-err">{{ reviewError }}</view>
        <view v-else-if="review" class="rv-body">
          <view class="rv-summary">{{ review.summary }}</view>
          <view v-if="review.good" class="rv-line"><text class="rv-tag rv-tag-good">做得好</text>{{ review.good }}</view>
          <view v-if="review.bad" class="rv-line"><text class="rv-tag rv-tag-bad">该改的</text>{{ review.bad }}</view>
          <view v-if="review.focus" class="rv-focus">下周最重要的一件事：{{ review.focus }}</view>
          <view v-if="review.next.length" class="rv-next">
            <view v-for="(s, i) in review.next" :key="i" class="rv-next-item">· {{ s }}</view>
          </view>
        </view>
        <view v-else class="rv-hint">把这一周的专注数据交给 AI，换一句人话总结 + 下周该怎么做。</view>
      </view>

      <!-- 学习 App 用时 -->
      <view class="card">
        <view class="card-head">
          <text class="card-title">今日学习 App 用时</text>
          <text class="card-more" @tap="goApps()">管理 ›</text>
        </view>
        <view v-if="!appRows.length" class="empty">
          <text class="empty-txt">还没有数据。把学习类 App 加进「学习 App」，从首页点图标过去用时就会被记录。</text>
        </view>
        <view v-else>
          <view v-for="r in appRows" :key="r.pkg" class="app-row">
            <text class="ar-name">{{ r.name }}</text>
            <text v-if="r.words" class="ar-badge">{{ r.words }} 词</text>
            <view class="ar-track">
              <view class="ar-fill" :style="{ width: r.pct + '%' }"></view>
            </view>
            <text class="ar-min">{{ r.min }}分</text>
          </view>
        </view>
        <!-- 权限引导：未授权时提示系统级统计不可用 -->
        <view v-if="needPermission" class="perm" @tap="openPerm">
          <text class="perm-txt">开启「使用情况访问」后，即使不从本 App 出发也能统计时长</text>
          <text class="perm-btn">去开启</text>
        </view>
      </view>

    </view>

    <float-tabbar ref="tabbar" current="stats" />
  </view>
</template>

<script>
import * as pw from '../../utils/pwstore.js'
import * as link from '../../utils/link.js'
import * as apptime from '../../utils/apptime.js'
import * as holiday from '../../utils/holiday.js'
import { reviewWeek } from '../../services/plan-agent.js'
import { aiGateReason } from '../../services/config.js'
import { hideNativeTabBar, syncTabbar, safeNav } from '../../utils/nav.js'
import tabSlideMixin from '../../utils/tab-slide-mixin.js'
import FloatTabbar from '../../components/float-tabbar/float-tabbar.vue'
import FloatNavbar from '../../components/float-navbar/float-navbar.vue'

export default {
  components: { FloatTabbar, FloatNavbar },
  mixins: [tabSlideMixin('stats')],
  data() {
    return {
      today: { focusMin: 0, pomo: 0 },
      week: [],
      totalDone: 0,
      appRows: [],
      needPermission: false,
      heat: [],
      heatDays: 0,
      hours: [],
      forecasts: [],
      review: null,
      reviewLoading: false,
      reviewError: ''
    }
  },
  computed: {
    weekMin() {
      return this.week.reduce((s, d) => s + d.focusMin, 0)
    },
    heatTip() {
      return this.heatDays ? '连续记录是最难的部分，别断' : '还没有记录，做完一段专注就有了'
    },
    bestText() {
      const best = pw.bestHours(30)
      if (!best.length) return ''
      const names = best.map(b => b.h + ' 点').join('、')
      return '你最常进入状态的时段：' + names + '（近 30 天累计）'
    }
  },
  onShow() {
    hideNativeTabBar()
    syncTabbar(this)
    // 回到统计页时顺手拉一次系统级统计（有权限才生效）
    try { apptime.syncToday() } catch (e) {}
    this.refresh()
  },
  methods: {
    refresh() {
      const ov = pw.overview()
      this.today = { focusMin: ov.todayMin, pomo: ov.pomo }
      this.week = pw.recentDays(7)
      let done = 0
      pw.get().sessions.forEach(s => { if (s.done) done++ })
      this.totalDone = done
      this.appRows = this.buildAppRows()
      this.needPermission = apptime.supported() && !apptime.hasUsagePermission()
      this.heat = this.buildHeat()
      this.hours = pw.hourProfile(30)
      this.forecasts = this.buildForecasts()
    },
    // ---------- 热力图 ----------
    buildHeat() {
      const st = pw.get()
      const out = []
      const t = pw.today()
      const d = new Date()
      const dow = (d.getDay() + 6) % 7          // 0 = 周一
      const start = pw.addDays(t, -(7 * 11 + dow))
      let days = 0
      for (let w = 0; w < 12; w++) {
        const col = []
        for (let i = 0; i < 7; i++) {
          const date = pw.addDays(start, w * 7 + i)
          const rec = st.daily[date]
          const min = (rec && rec.focusMin) || 0
          if (min > 0 && date <= t) days++
          col.push({ date, min, level: date > t ? -1 : this.levelOf(min) })
        }
        out.push(col)
      }
      this.heatDays = days
      return out
    },
    levelOf(min) {
      if (!min) return 0
      if (min < 25) return 1
      if (min < 60) return 2
      if (min < 120) return 3
      return 4
    },
    hourH(min) {
      const max = Math.max(1, ...this.hours)
      return Math.max(3, Math.round(min * 100 / max))
    },
    // ---------- 预计完成日 ----------
    buildForecasts() {
      return pw.activeGoals().map(g => {
        const p = pw.goalProgress(g)
        const f = pw.forecast(g, 7)
        const remain = pw.dayDiff(pw.today(), g.deadline)
        let dateText = '数据不足'
        let late = false
        let lateDays = 0
        if (p.total - p.done <= 0) {
          dateText = '已全部完成'
        } else if (f.ok) {
          dateText = f.date ? (f.date + '（' + f.days + ' 天后）') : '做不完？'
          if (f.days > remain) { late = true; lateDays = f.days - remain }
        }
        return {
          id: g.id, title: g.title, done: p.done, total: p.total,
          perDay: f.perDay || 0, dateText, late, lateDays
        }
      })
    },
    goDetail(id) { uni.navigateTo({ url: '/pkgPlan/pages/goal-detail/goal-detail?id=' + id }) },
    // ---------- AI 周复盘 ----------
    loadReview() {
      let gate = ''
      try { gate = aiGateReason() || '' } catch (e) {}
      if (gate) {
        this.reviewError = gate
        return
      }
      this.reviewLoading = true
      this.reviewError = ''
      const days = pw.recentDays(7)
      const goals = pw.activeGoals().map(g => {
        const p = pw.goalProgress(g)
        return {
          title: g.title, done: p.done, total: p.total, pct: p.pct,
          remainDays: pw.dayDiff(pw.today(), g.deadline)
        }
      })
      const queue = pw.todayQueue(99)
      const overdue = queue.filter(x => x.overdue).length
      reviewWeek({
        goals, days, overdue,
        holidayText: holiday.summaryFor(pw.addDays(pw.today(), -7), pw.addDays(pw.today(), 14))
      }).then(r => {
        this.review = r
        this.reviewLoading = false
      }).catch(e => {
        this.reviewLoading = false
        this.reviewError = (e && e.message) ? e.message : '生成失败，请稍后再试'
      })
    },
    buildAppRows() {
      const d = pw.get().daily[pw.today()]
      if (!d || !d.byApp) return []
      const names = {}
      pw.dock().forEach(a => { names[a.pkg] = a.name })
      // 伙伴 App（背单词）不登记在「学习 App」里 —— 它的用时是那边学完回传进来的，
      // 名字不补上，这一行就会原样显示成 "app:awword"
      names[link.PARTNER_KEY] = '背单词'
      // 词数只有伙伴 App 拿得到：系统的使用情况统计只知道"你待了多久"，
      // 不知道你在里面过了几个词，所以这个数只能靠回传
      const words = pw.vocabWords()
      const rows = Object.keys(d.byApp).map(pkg => ({
        pkg,
        name: names[pkg] || pkg,
        min: d.byApp[pkg],
        words: pkg === link.PARTNER_KEY ? words : 0
      })).filter(r => r.min > 0).sort((a, b) => b.min - a.min)
      const max = rows.length ? rows[0].min : 1
      rows.forEach(r => { r.pct = Math.max(6, Math.round(r.min * 100 / max)) })
      return rows
    },
    barH(min) {
      const max = Math.max(1, ...this.week.map(d => d.focusMin))
      return Math.max(4, Math.round(min * 100 / max))
    },
    goApps() { safeNav('/pkgPlan/pages/apps/apps') },
    openPerm() { apptime.openUsageSettings() }
  }
}
</script>

<style>
.strip { display: flex; padding: 34rpx 0; margin-bottom: 20rpx; }
.st-item { flex: 1; display: flex; flex-direction: column; align-items: center; }
.st-num { font-size: 40rpx; font-weight: 600; color: #e4173d; color: var(--brand, #e4173d); font-family: Georgia, serif; }
.st-label { font-size: 22rpx; color: #5a6560; color: var(--ink-2, #5a6560); margin-top: 6rpx; }

.card-head {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 24rpx;
}
.card-title { font-size: 30rpx; font-weight: 600; color: #17201a; color: var(--ink-1, #17201a); }
.card-more { font-size: 24rpx; color: #bb1332; color: var(--brand-strong, #bb1332); }

/* ===== 柱状图 ===== */
.chart { display: flex; align-items: flex-end; height: 260rpx; }
.ch-col { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; }
.ch-bar-wrap {
  flex: 1; width: 100%;
  display: flex; align-items: flex-end; justify-content: center;
}
.ch-bar {
  width: 34rpx;
  border-radius: 12rpx 12rpx 6rpx 6rpx;
  background: rgba(228, 23, 61, 0.75);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.75);
  min-height: 6rpx;
  display: flex; align-items: flex-start; justify-content: center;
  transition: height 0.3s ease;
}
.ch-bar-zero { background: rgba(23, 32, 26, 0.1); background: rgba(var(--neutral-rgb, 23, 32, 26), 0.1); }
.ch-val {
  margin-top: -34rpx;
  font-size: 20rpx;
  color: #5a6560;
  color: var(--ink-2, #5a6560);
}
.ch-day { margin-top: 12rpx; font-size: 20rpx; color: #98a19b; color: var(--ink-3, #98a19b); }

/* ===== 热力图 ===== */
.heat { display: flex; justify-content: space-between; }
.ht-col { display: flex; flex-direction: column; }
.ht-cell {
  width: 28rpx; height: 28rpx;
  border-radius: 6rpx;
  margin-bottom: 6rpx;
  background: rgba(23, 32, 26, 0.07);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07);
}
.ht-l0 { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.07); }
.ht-l1 { background: rgba(var(--brand-rgb, 228, 23, 61), 0.22); }
.ht-l2 { background: rgba(var(--brand-rgb, 228, 23, 61), 0.42); }
.ht-l3 { background: rgba(var(--brand-rgb, 228, 23, 61), 0.68); }
.ht-l4 { background: rgba(var(--brand-rgb, 228, 23, 61), 0.95); }
.ht-col .ht-cell:last-child { margin-bottom: 0; }
.heat-foot { display: flex; align-items: center; margin-top: 18rpx; }
.hf-label { font-size: 20rpx; color: var(--ink-3, #98a19b); margin: 0 8rpx; }
.hf-tip { margin-left: auto; font-size: 21rpx; color: var(--ink-3, #98a19b); }

/* ===== 时段分布 ===== */
.hours { display: flex; align-items: flex-end; height: 180rpx; }
.hr-col { flex: 1; display: flex; align-items: flex-end; justify-content: center; height: 100%; }
.hr-bar {
  width: 60%;
  border-radius: 6rpx 6rpx 2rpx 2rpx;
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.7);
  min-height: 4rpx;
}
.hr-bar-zero { background: rgba(var(--neutral-rgb, 23, 32, 26), 0.1); }
.hr-axis { display: flex; justify-content: space-between; margin-top: 10rpx; }
.hr-tick { font-size: 19rpx; color: var(--ink-3, #98a19b); }
.hr-best { margin-top: 18rpx; font-size: 22rpx; line-height: 1.7; color: var(--ink-2, #5a6560); }

/* ===== 预计完成 ===== */
.fc-row { display: flex; align-items: center; padding: 18rpx 0; border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.06); }
.fc-row:last-of-type { border-bottom: none; }
.fc-main { flex: 1; min-width: 0; padding-right: 18rpx; }
.fc-title { font-size: 26rpx; color: var(--ink-1, #17201a); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fc-sub { font-size: 21rpx; color: var(--ink-3, #98a19b); margin-top: 6rpx; }
.fc-right { flex-shrink: 0; text-align: right; }
.fc-date { font-size: 24rpx; color: var(--ink-1, #17201a); font-family: Georgia, serif; }
.fc-date-late { color: #e5484d; }
.fc-late { display: block; font-size: 20rpx; color: #e5484d; margin-top: 4rpx; }

/* ===== AI 周复盘 ===== */
.rv-loading { padding: 20rpx 0; font-size: 25rpx; color: var(--ink-3, #98a19b); }
.rv-dot { animation: rv-blink 1.2s ease-in-out infinite; }
.rv-dot:nth-child(2) { animation-delay: 0.2s; }
.rv-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes rv-blink { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
.rv-err { font-size: 24rpx; line-height: 1.6; color: #e5484d; }
.rv-hint { font-size: 23rpx; line-height: 1.7; color: var(--ink-3, #98a19b); }
.rv-summary { font-size: 27rpx; line-height: 1.75; color: var(--ink-1, #17201a); }
.rv-line { margin-top: 16rpx; font-size: 25rpx; line-height: 1.7; color: var(--ink-2, #5a6560); }
.rv-tag {
  display: inline-block; margin-right: 12rpx; padding: 2rpx 12rpx; border-radius: 999rpx;
  font-size: 20rpx; color: #fff;
}
.rv-tag-good { background: #3b6d11; }
.rv-tag-bad { background: #e5484d; }
.rv-focus {
  margin-top: 20rpx; padding: 18rpx 22rpx; border-radius: 14rpx;
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
  font-size: 25rpx; line-height: 1.7; color: var(--ink-1, #17201a);
}
.rv-next { margin-top: 16rpx; }
.rv-next-item { font-size: 24rpx; line-height: 1.8; color: var(--ink-2, #5a6560); }

/* ===== App 用时 ===== */
.app-row { display: flex; align-items: center; padding: 16rpx 0; }
.ar-name {
  width: 170rpx; flex-shrink: 0;
  font-size: 25rpx;
  color: #17201a;
  color: var(--ink-1, #17201a);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ar-track {
  flex: 1; height: 14rpx;
  border-radius: 999rpx;
  background: rgba(23, 32, 26, 0.08);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.08);
  overflow: hidden;
  margin: 0 18rpx;
}
.ar-fill {
  height: 100%;
  border-radius: 999rpx;
  background: #e4173d;
  background: var(--brand, #e4173d);
}
.ar-min { width: 90rpx; text-align: right; font-size: 24rpx; color: #5a6560; color: var(--ink-2, #5a6560); flex-shrink: 0; }

/* 伙伴 App 回传的词数。用法对齐主按钮的 tint 模式：淡底 + 深字 + 描边，不写实心 */
.ar-badge {
  flex-shrink: 0;
  margin-right: 12rpx;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  font-size: 21rpx;
  line-height: 1.6;
  color: var(--brand-strong, #bb1332);
  background: rgba(var(--brand-rgb), 0.1);
  border: 1rpx solid rgba(var(--brand-rgb), 0.4);
}

.empty { padding: 10rpx 0; }
.empty-txt { font-size: 25rpx; line-height: 1.7; color: #5a6560; color: var(--ink-2, #5a6560); }

.perm {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 20rpx; padding: 18rpx 22rpx;
  border-radius: 16rpx;
  background: rgba(247, 144, 9, 0.1);
}
.perm-txt { flex: 1; font-size: 22rpx; line-height: 1.6; color: #8a5800; margin-right: 16rpx; }
.perm-btn { flex-shrink: 0; font-size: 24rpx; font-weight: 600; color: #f79009; }
</style>
