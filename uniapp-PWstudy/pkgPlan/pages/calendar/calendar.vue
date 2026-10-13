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

    <!-- 选中那天的事：与首页「日程表」卡共用同一个组件（一套样式、一套口径） -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">{{ pickedText }}</text>
        <text class="card-more">{{ list.length ? list.length + ' 项' : '空' }}</text>
      </view>
      <schedule-list
        :rows="list"
        :ops="true"
        :tip="true"
        @changed="onListChanged"
        @done="onTaskDone"
      />
    </view>

    <!-- 任务完成弹窗（fixed 层，放在页面根下）：与首页同一个组件、同一套文案 -->
    <task-done-dialog ref="doneDlg" @open="doneDlgOn = true" @close="doneDlgOn = false" />
  </view>
</template>

<script>
import * as pw from '../../../utils/pwstore.js'
import * as holiday from '../../../utils/holiday.js'
import * as schedule from '../../../utils/schedule.js'
import * as harvest from '../../../utils/harvest.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import ScheduleList from '../../../components/schedule-list/schedule-list.vue'
import TaskDoneDialog from '../../../components/task-done-dialog/task-done-dialog.vue'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default {
  components: { FloatNavbar, ScheduleList, TaskDoneDialog },
  data() {
    return {
      weekNames: WEEK,
      year: 2026, month: 10,
      cells: [],
      picked: '',
      todayStr: pw.today(),
      list: [],
      doneDlgOn: false
    }
  },
  computed: {
    // 日期文案（含节假日 / 周末 / 调休）与首页卡同一口径
    pickedText() {
      return schedule.dateLabel(this.picked)
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
    this.runReplanFlow()
  },
  /**
   * 返回键先收完成弹窗（与首页同一个规矩：按返回只是"不说了"，不是离开页面）。
   * 这一层不做拦截 —— 收完就放行，日历页没有"硬控"那回事。
   */
  onBackPress() {
    if (this.doneDlgOn && this.$refs.doneDlg) { this.$refs.doneDlg.close(); return true }
    return false
  },
  methods: {
    build() {
      const first = new Date(this.year, this.month - 1, 1)
      const daysInMonth = new Date(this.year, this.month, 0).getDate()
      const lead = (first.getDay() + 6) % 7     // 周一开头
      const cells = []
      // 反查"每个日期有哪些任务"交给 utils/schedule.js —— 首页「日程表」卡用的是同一份
      const byDate = schedule.byDate()
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
      this.list = schedule.rowsOf(this.picked, this.__byDate)
    },
    // 组件里前移/后移改了任务日期 → 重算月历（格子里的任务数跟着变）与当日列表
    onListChanged() {
      this.build()
      this.refreshList()
    },
    // ---------- 任务完成反馈 + 动态重排（utils/harvest.js）----------
    /** 勾掉一项 → 弹「恭喜你完成任务」（取消完成不弹） */
    onTaskDone(row) {
      const d = this.$refs.doneDlg
      if (!d) return
      let atText = ''
      try {
        const it = harvest.listOf(pw.today()).filter(x => x.taskId === (row.id || row.taskId))[0]
        if (it) atText = it.atText || ''
      } catch (e) {}
      d.open({ goalId: row.goalId, id: row.id || row.taskId, title: row.title, goalTitle: row.goalTitle }, atText)
      this.runReplanFlow()
    },
    /**
     * 与首页同一条线：跨天兜底 + 当天全部完成自动重排。
     * 真落地了要重算月历（重排会改 tasks[].day，格子里的任务数跟着变）。
     * ⚠️ 这里只跑兜底那一条 —— "全部完成"的提示与待确认询问留在首页弹，
     *    两个页面同时问同一件事会把人烦死。
     */
    async runReplanFlow() {
      try {
        const sw = await harvest.sweep()
        if (sw && sw.ok && sw.applied) {
          this.build()
          this.refreshList()
          try { uni.showToast({ title: '昨天有没做完的，已重排后面 ' + sw.applied + ' 项', icon: 'none', duration: 3000 }) } catch (e) {}
        }
      } catch (e) {
        console.warn('[calendar] 自动重排失败', e && e.message)
      }
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
    // 保留：月历格子 / 其它入口仍可能走这里，实际移动逻辑在 utils/schedule.js
    moveTask(t, delta) {
      const r = schedule.move(t, delta)
      if (!r.ok) {
        uni.showToast({ title: r.msg, icon: 'none' })
        return
      }
      uni.showToast({ title: r.msg, icon: 'none' })
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

/* 日程表的 .ct-* 样式已搬到 components/schedule-list —— 页面里不再留一份，
   否则改样式时很容易只改一边（首页和日历页看着就不一样了） */
</style>
