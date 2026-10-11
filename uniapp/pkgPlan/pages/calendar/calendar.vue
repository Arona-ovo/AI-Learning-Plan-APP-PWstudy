<template>
  <view class="container page-nav cal-page" :class="appTheme" :style="appBgStyle">
    <float-navbar title="日程" :back="true" />

    <!-- 月历 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">{{ year }} 年 {{ month }} 月</text>
        <view class="cm-nav">
          <text class="cm-arrow" @tap="shift(-1)">‹</text>
          <text class="cm-today" @tap="goToday">今天</text>
          <text class="cm-arrow" @tap="shift(1)">›</text>
        </view>
      </view>
      <view class="cm-week">
        <text v-for="w in weekNames" :key="w" class="cm-wname">{{ w }}</text>
      </view>
      <view class="cm-grid">
        <view
          v-for="(c, i) in cells"
          :key="i"
          class="cm-cell"
          :class="{
            'cm-cell-out': !c.inMonth,
            'cm-cell-today': c.date === todayStr,
            'cm-cell-on': c.date === picked,
            'cm-cell-rest': c.rest
          }"
          @tap="pick(c.date)"
        >
          <text class="cm-day">{{ c.d }}</text>
          <view v-if="c.count" class="cm-dots">
            <text v-for="n in dotList(c.count)" :key="n" class="cm-dot"></text>
          </view>
          <text v-if="c.holiday" class="cm-hol">{{ c.holiday }}</text>
        </view>
      </view>
      <view class="cm-legend">
        <text class="lg-item"><text class="cm-dot"></text> 有任务</text>
        <text class="lg-item"><text class="lg-rest"></text> 假期 / 周末</text>
      </view>
    </view>

    <!-- 选中那天的事 -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">{{ pickedText }}</text>
        <text class="card-more">{{ list.length ? list.length + ' 项' : '空' }}</text>
      </view>
      <view v-if="!list.length" class="empty">
        <text class="empty-txt">这一天没有安排任务。</text>
      </view>
      <view v-else>
        <view v-for="t in list" :key="t.key" class="ct-row">
          <view class="ct-main">
            <view class="ct-title" :class="{ 'ct-title-done': t.status !== 'todo' }">{{ t.title }}</view>
            <view class="ct-sub">
              {{ t.goalTitle }} · {{ t.donePomos }}/{{ t.pomos }} 番茄
              <text v-if="t.status === 'done'" class="ct-done">已完成</text>
              <text v-else-if="t.status === 'dropped'" class="ct-drop">已砍掉</text>
              <text v-else-if="t.overdue" class="ct-late">已超期</text>
            </view>
          </view>
          <view v-if="t.status === 'todo'" class="ct-ops">
            <text class="ct-op" @tap="moveTask(t, -1)">前移</text>
            <text class="ct-op" @tap="moveTask(t, 1)">后移</text>
          </view>
        </view>
        <view class="ct-tip">前移/后移一天：直接改任务日期，不走 AI（小改动自己动手更快）。</view>
      </view>
    </view>
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as holiday from '../../../utils/holiday.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default {
  components: { FloatNavbar },
  data() {
    return {
      weekNames: WEEK,
      year: 2026, month: 10,
      cells: [],
      picked: '',
      todayStr: pw.today(),
      list: []
    }
  },
  computed: {
    pickedText() {
      if (!this.picked) return ''
      const t = holiday.dayType(this.picked)
      const tag = t === 'holiday' ? '（' + holiday.holidayName(this.picked) + '）'
        : (t === 'weekend' ? '（周末）' : (t === 'makeup' ? '（调休补班）' : ''))
      return this.picked.slice(5).replace('-', ' 月 ') + ' 日' + tag
    }
  },
  onLoad() {
    const t = pw.today().split('-')
    this.year = Number(t[0])
    this.month = Number(t[1])
    this.picked = pw.today()
    this.build()
    this.refreshList()
  },
  onShow() {
    // 重排会改 tasks[].day，从重排页退回日历页必须重算。
    // 以前只有 onLoad：页面常驻着，日历上还是重排前的排期，看着像"改了没生效"。
    // 这里不重置 picked / 月份 —— 用户翻到别的月份再回来，不该被弹回今天。
    this.build()
    this.refreshList()
  },
  methods: {
    build() {
      const first = new Date(this.year, this.month - 1, 1)
      const daysInMonth = new Date(this.year, this.month, 0).getDate()
      const lead = (first.getDay() + 6) % 7     // 周一开头
      const cells = []
      const st = pw.get()
      const goals = pw.activeGoals()
      // 反查"每个日期有哪些任务"：task.day 是相对目标开始日的第几天
      const byDate = {}
      goals.forEach(g => {
        const start = (g.createdAt ? pw.dateStr(new Date(g.createdAt)) : pw.today())
        ;(g.tasks || []).forEach(t => {
          if (t.status === 'dropped') return
          const date = holiday.addDays(start, (t.day || 1) - 1)
          byDate[date] = byDate[date] || []
          byDate[date].push({
            key: g.id + '#' + t.id, goalId: g.id, id: t.id, title: t.title,
            goalTitle: g.title, pomos: t.pomos, donePomos: t.donePomos || 0,
            status: t.status || 'todo', startDay: t.day
          })
        })
      })
      this.__byDate = byDate
      for (let i = 0; i < lead; i++) {
        const d = new Date(this.year, this.month - 1, 1 - (lead - i))
        cells.push({ date: holiday.toStr(d), d: d.getDate(), inMonth: false, count: 0 })
      }
      for (let d = 1; d <= daysInMonth; d++) {
        const date = this.year + '-' + holiday.pad(this.month) + '-' + holiday.pad(d)
        const type = holiday.dayType(date)
        cells.push({
          date, d, inMonth: true,
          count: (byDate[date] || []).length,
          rest: type === 'holiday' || type === 'weekend',
          holiday: type === 'holiday' ? holiday.holidayName(date) : ''
        })
      }
      while (cells.length % 7 !== 0) {
        const last = cells[cells.length - 1]
        const nd = holiday.addDays(last.date, 1)
        cells.push({ date: nd, d: Number(nd.slice(8)), inMonth: false, count: (byDate[nd] || []).length })
      }
      this.cells = cells
    },
    refreshList() {
      const rows = (this.__byDate && this.__byDate[this.picked]) || []
      const today = pw.today()
      this.list = rows.map(t => {
        const g = pw.goalOf(t.goalId)
        const start = g && g.createdAt ? pw.dateStr(new Date(g.createdAt)) : today
        const elapsed = pw.dayDiff(start, today) + 1
        return Object.assign({}, t, { overdue: (t.startDay || 1) < elapsed && t.status === 'todo' })
      })
    },
    pick(date) {
      this.picked = date
      this.refreshList()
    },
    shift(n) {
      let m = this.month + n
      let y = this.year
      if (m < 1) { m = 12; y-- }
      if (m > 12) { m = 1; y++ }
      this.year = y
      this.month = m
      this.build()
    },
    goToday() {
      const t = pw.today().split('-')
      this.year = Number(t[0])
      this.month = Number(t[1])
      this.picked = pw.today()
      this.build()
      this.refreshList()
    },
    moveTask(t, delta) {
      const g = pw.goalOf(t.goalId)
      if (!g) return
      const start = g.createdAt ? pw.dateStr(new Date(g.createdAt)) : pw.today()
      const oldDate = holiday.addDays(start, (t.startDay || 1) - 1)
      const newDate = holiday.addDays(oldDate, delta)
      const newDay = pw.dayDiff(start, newDate) + 1
      if (newDay < 1) {
        uni.showToast({ title: '不能再往前了', icon: 'none' })
        return
      }
      pw.moveTaskDay(t.goalId, t.id, newDay)
      uni.showToast({ title: '已改到 ' + newDate.slice(5), icon: 'none' })
      this.build()
      this.refreshList()
    },
    dotList(n) {
      return n > 3 ? 3 : n
    }
  }
}
</script>

<style>
.cal-page { min-height: 100vh; padding-bottom: 60rpx; }

.cm-nav { display: flex; align-items: center; }
.cm-arrow { font-size: 34rpx; color: var(--ink-2, #5a6560); padding: 0 16rpx; }
.cm-today { font-size: 23rpx; color: var(--brand-strong, #bb1332); }

.cm-week { display: flex; margin-bottom: 8rpx; }
.cm-wname { flex: 1; text-align: center; font-size: 21rpx; color: var(--ink-3, #98a19b); }

.cm-grid { display: flex; flex-wrap: wrap; }
.cm-cell {
  width: 14.28%;
  height: 104rpx;
  box-sizing: border-box;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  border-radius: 12rpx;
  position: relative;
}
.cm-day { font-size: 25rpx; color: var(--ink-1, #17201a); font-family: Georgia, serif; }
.cm-cell-out .cm-day { color: var(--ink-3, #98a19b); opacity: 0.5; }
.cm-cell-rest { background: rgba(247, 144, 9, 0.08); }
.cm-cell-today .cm-day { color: var(--brand, #e4173d); font-weight: 600; }
.cm-cell-on { background: rgba(var(--brand-rgb, 228, 23, 61), 0.16); }
.cm-dots { display: flex; margin-top: 6rpx; }
.cm-dot {
  width: 8rpx; height: 8rpx; border-radius: 50%; margin: 0 3rpx;
  background: var(--brand, #e4173d);
}
.cm-hol {
  position: absolute; bottom: 6rpx;
  font-size: 17rpx; color: #b25e00;
}
.cm-legend { display: flex; margin-top: 18rpx; }
.lg-item { display: flex; align-items: center; margin-right: 28rpx; font-size: 21rpx; color: var(--ink-3, #98a19b); }
.lg-rest {
  width: 22rpx; height: 14rpx; border-radius: 4rpx; margin-right: 8rpx;
  background: rgba(247, 144, 9, 0.28);
}

.ct-row { display: flex; align-items: center; padding: 18rpx 0; border-bottom: 2rpx solid rgba(var(--neutral-rgb, 23, 32, 26), 0.06); }
.ct-row:last-of-type { border-bottom: none; }
.ct-main { flex: 1; min-width: 0; }
.ct-title { font-size: 27rpx; color: var(--ink-1, #17201a); }
.ct-title-done { color: var(--ink-3, #98a19b); text-decoration: line-through; }
.ct-sub { margin-top: 6rpx; font-size: 21rpx; color: var(--ink-3, #98a19b); }
.ct-done { margin-left: 10rpx; color: #3b6d11; }
.ct-drop { margin-left: 10rpx; }
.ct-late { margin-left: 10rpx; color: #e5484d; }
.ct-ops { flex-shrink: 0; display: flex; }
.ct-op {
  margin-left: 14rpx; padding: 8rpx 18rpx; border-radius: 999rpx;
  font-size: 22rpx; color: var(--brand-strong, #bb1332);
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}
.ct-tip { margin-top: 18rpx; font-size: 21rpx; line-height: 1.7; color: var(--ink-3, #98a19b); }

.empty { padding: 10rpx 0; }
.empty-txt { font-size: 25rpx; line-height: 1.7; color: var(--ink-2, #5a6560); }
</style>
