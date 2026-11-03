<template>
  <view class="container page-nav cal-page" :class="appTheme" :style="appBgStyle">
    <!-- 完成弹窗开着时，顶栏返回先收弹窗（与物理返回键同一个规矩） -->
    <float-navbar title="日程" :back="true" @before-back="onNavBack" />

    <!-- 月历 -->
    <view class="card">
      <view class="card-head">
        <!-- 月份切换：箭头紧贴月份文字（原来这两个箭头挤在「今天」两边，
             用户以为是切"哪一天"，点下去翻的却是月份 —— 2026-11-01 真机反馈） -->
        <view class="cm-month">
          <text class="cm-marrow" @tap="shift(-1)">‹</text>
          <text class="card-title">{{ year }} 年 {{ month }} 月</text>
          <text class="cm-marrow" @tap="shift(1)">›</text>
        </view>
        <!-- 日期切换：按「天」走，跨月自动翻页；中间的日期点了回今天 -->
        <view class="cm-nav">
          <text class="cm-arrow" @tap="shiftDay(-1)">‹</text>
          <text class="cm-today" @tap="goToday">{{ picked === todayStr ? '今天' : '回今天' }}</text>
          <text class="cm-arrow" @tap="shiftDay(1)">›</text>
        </view>
      </view>
      <view class="cm-week">
        <text v-for="w in weekNames" :key="w" class="cm-wname">{{ w }}</text>
      </view>
      <!-- 左右滑动切月：整块网格都是手势区（比两个小箭头好按得多，单手也能滑）。
           坐标只在 JS 侧记，touchmove 期间**一次 data 都不写** —— 这 42 个格子每改
           一次 data 就是一次"逻辑层 → 视图层"通信，拿跟手位移换这点手感不值。
           翻月后的方向感交给进场动画（见 .cm-in-left / .cm-in-right）。 -->
      <view
        class="cm-grid"
        :class="cmEnter ? 'cm-in-' + cmEnter : ''"
        @touchstart="cmTouchStart"
        @touchmove="cmTouchMove"
        @touchend="cmTouchEnd"
        @touchcancel="cmTouchEnd"
      >
        <view
          v-for="(c, i) in cells"
          :key="i"
          class="cm-cell"
          :class="{
            'cm-cell-out': !c.inMonth,
            'cm-cell-today': c.date === todayStr,
            'cm-cell-on': c.date === picked,
            'cm-cell-rest': c.rest,
            'cm-cell-mark': c.marks && c.marks.length
          }"
          @tap="pick(c.date)"
        >
          <view v-if="c.marks && c.marks.length" class="cm-mark" :style="markStyle(c.marks)"></view>
          <view v-if="c.marks && c.marks.length" class="cm-mark-bar" :style="{ background: markBar(c.marks) }"></view>
          <text class="cm-day">{{ c.d }}</text>
          <view v-if="c.count" class="cm-dots">
            <text v-for="n in dotList(c.count)" :key="n" class="cm-dot"></text>
          </view>
          <text v-if="c.holiday" class="cm-hol">{{ c.holiday }}</text>
        </view>
      </view>
      <view class="cm-legend">
        <text class="lg-item"><text class="cm-dot"></text> {{ $t('有任务') }}</text>
        <text class="lg-item"><text class="lg-sw" :style="{ background: legTutor }"></text> {{ $t('补习 / 固定安排') }}</text>
        <text class="lg-item"><text class="lg-sw" :style="{ background: legBlocked }"></text> {{ $t('节日 / 无法学习') }}</text>
        <text class="lg-hint">{{ $t('左右滑动切月') }}</text>
      </view>
    </view>

    <!-- 选中那天的事：与首页「日程表」卡共用同一个组件（一套样式、一套口径） -->
    <view class="card">
      <view class="card-head">
        <text class="card-title">{{ pickedText }}</text>
        <view class="card-more-row">
          <!-- 「空」只在天和标注都空时说：这天标了补习/节日时还说"空"是自相矛盾的 -->
          <text class="card-more">{{ list.length ? list.length + ' 项' : (pickedMarks.length ? pickedMarks.length + ' ' + $t('条标注') : $t('空')) }}</text>
          <text class="mk-add" @tap="openMark(picked)">{{ pickedMarks.length ? $t('管理标注') : $t('标注这天') }}</text>
        </view>
      </view>
      <!-- 标注内容：用户自己打的字必须看得见（颜色只是辅助，内容才是他要的信息） -->
      <view v-if="pickedMarks.length" class="mk-list">
        <view v-for="m in pickedMarks" :key="m.id" class="mk-chip" :style="{ background: rgbaOf(m.color, 0.4) }">
          <text class="mk-dot" :style="{ background: m.color }"></text>
          <text class="mk-label">{{ m.label }}</text>
          <text v-if="m.time" class="mk-time">{{ m.time }}</text>
          <text class="mk-edit" @tap.stop="editMark(m)">{{ $t('改') }}</text>
          <text class="mk-del" @tap.stop="deleteMark(m.id)">×</text>
        </view>
      </view>
      <schedule-list
        :rows="list"
        :ops="true"
        :tip="true"
        :empty-text="pickedMarks.length ? $t('这一天没有学习任务，只有上面的标注。') : ''"
        @changed="onListChanged"
        @done="onTaskDone"
      />
    </view>

    <!-- 跟 AI 说说今天：翻到某天发现"这天没空 / 排得不对"时，就地一句话，
         不用再绕回首页找对话入口。组件与首页是同一个（components/coach-box），
         口径一致：AI 会记功、判断偏差，并给"去重排"的出口。 -->
    <view class="card">
      <coach-box ref="coach" @changed="onCoachChanged" />
    </view>

    <!-- 日历标注编辑弹层：选一天 → 列出当天标注 / 新增或改色（淡色） -->
    <view class="mark-mask" v-if="markDlg.show" @tap="closeMark" @touchmove.stop.prevent="noop">
      <view class="mark-card" @tap.stop="noop" @touchmove.stop="noop">
        <view class="mark-head">
          <text class="mark-title">{{ markDlg.editingId ? $t('编辑标注') : $t('标注这一天') }}</text>
          <text class="mark-date">{{ markDlg.date ? markDlg.date.slice(5) : '' }}</text>
          <text class="mark-x" @tap="closeMark">×</text>
        </view>

        <!-- 当天已有的标注（新增模式才列，编辑模式聚焦表单） -->
        <view v-if="!markDlg.editingId && pickedMarks.length" class="mark-have">
          <view v-for="m in pickedMarks" :key="m.id" class="mark-have-row">
            <text class="mk-dot" :style="{ background: m.color }"></text>
            <text class="mark-have-name">{{ m.label }}</text>
            <text class="mark-have-edit" @tap.stop="editMark(m)">{{ $t('改') }}</text>
            <text class="mark-have-del" @tap.stop="deleteMark(m.id)">{{ $t('删除') }}</text>
          </view>
        </view>

        <!-- 编辑 / 新增表单 -->
        <view class="mark-form">
          <view class="mark-label-row">
            <text class="mark-fl">{{ $t('内容') }}</text>
            <input class="mark-input" v-model="markDlg.label" :maxlength="20" :placeholder="$t('如：补习班 / 春节')" />
          </view>

          <text class="mark-fl">{{ $t('类型') }}</text>
          <view class="mark-types">
            <view v-for="t in types" :key="t.key" class="mark-type" :class="{ on: markDlg.type === t.key }" @tap="pickMarkType(t.key)">{{ t.name }}</view>
          </view>

          <text class="mark-fl">{{ $t('颜色（淡色）') }}</text>
          <view class="mark-colors">
            <view v-for="c in pastel" :key="c" class="mark-color" :class="{ on: markDlg.color === c }" :style="{ background: c }" @tap="pickMarkColor(c)"></view>
          </view>

          <view class="mark-btns">
            <view class="mark-btn ghost" @tap="closeMark">{{ $t('取消') }}</view>
            <view class="mark-btn primary" @tap="saveMark">{{ markDlg.editingId ? $t('保存') : $t('保存到这天') }}</view>
          </view>
        </view>
      </view>
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
import * as calmark from '../../../utils/calmark.js'
import * as appSettings from '../../../utils/settings.js'
// 手势阈值借 tab 切页那一套（8px 判轴 / 1.2 纵横比 / 60px 触发）：
// 同一个人手、两种翻页，手感不该有两套数字。这里只用 DRAG，不用它的切页逻辑。
import * as tabSlide from '../../../utils/tab-slide.js'
import FloatNavbar from '../../../components/float-navbar/float-navbar.vue'
import ScheduleList from '../../../components/schedule-list/schedule-list.vue'
import TaskDoneDialog from '../../../components/task-done-dialog/task-done-dialog.vue'
import CoachBox from '../../../components/coach-box/coach-box.vue'

const WEEK = ['一', '二', '三', '四', '五', '六', '日']

export default {
  components: { FloatNavbar, ScheduleList, TaskDoneDialog, CoachBox },
  data() {
    return {
      weekNames: WEEK,
      year: 2026, month: 10,
      cells: [],
      picked: '',
      todayStr: pw.today(),
      list: [],
      doneDlgOn: false,
      // 翻月进场方向：'' | 'left' | 'right'。动画放完必须清空（同名 class
      // 再来一次不会重播），见 playMonthIn()。
      cmEnter: '',
      // 日历标注（补习日 / 节日·无法学习日）：图例用的两种默认色，从设置读
      legTutor: '#bcd0f7',
      legBlocked: '#f6c2cf',
      // 标注编辑弹层：选一天 → 列出那天的标注 / 新增或改色
      markDlg: { show: false, date: '', editingId: '', label: '', type: 'tutor', color: '#bcd0f7' },
      // 淡色色板（标注改色用）+ 三种语义（弹层里的类型选择）
      pastel: calmark.PASTEL,
      types: [],
      // 当月「日期 → 标注数组」映射。
      // ⚠️ 必须放 data（响应式）：原来挂在 this.__marks 这种非 data 属性上，
      //    模板里碰不到它的变化；配合下面 pickedMarks 用 computed 才能"存完立刻显示"。
      marksByDate: {}
    }
  },
  computed: {
    // 日期文案（含节假日 / 周末 / 调休）与首页卡同一口径
    pickedText() {
      return schedule.dateLabel(this.picked)
    },
    /**
     * 选中那天的标注。
     * ⚠️ 必须是 computed，不能是 methods —— 模板里写的是 `pickedMarks`（不带括号），
     *    methods 时 `pickedMarks` 解析成函数本体，`.length` 是形参个数（0）
     *    → 永远"没有标注"、v-for 也遍历不出东西。真机现象就是：
     *    格子颜色变了、内容却一条都不显示、按钮还一直写"标注这天"。
     */
    pickedMarks() {
      const m = this.marksByDate || {}
      return m[this.picked] || []
    }
  },
  onLoad() {
    const t = pw.today().split('-')
    this.year = Number(t[0])
    this.month = Number(t[1])
    this.picked = pw.today()
    const cal = (appSettings.get() && appSettings.get().calendar) || {}
    this.legTutor = cal.tutorColor || '#bcd0f7'
    this.legBlocked = cal.blockedColor || '#f6c2cf'
    this.pastel = calmark.PASTEL
    this.types = [
      { key: 'tutor', name: this.$t('补习 / 固定安排') },
      { key: 'blocked', name: this.$t('节日 / 无法学习') },
      { key: 'event', name: this.$t('普通标注') }
    ]
    this.build()
    this.refreshList()
  },
  onShow() {
    // 重排会改 tasks[].day，从重排页退回日历页必须重算。
    // 以前只有 onLoad：页面常驻着，日历上还是重排前的排期，看着像"改了没生效"。
    // 这里不重置 picked / 月份 —— 用户翻到别的月份再回来，不该被弹回今天。
    // 但要清掉手势追踪标记：手指按到一半被电话/切页打断时，留着 tracking=true
    // 会让下一次抬手凭空算出一段位移。
    this.__tracking = false
    this.build()
    this.refreshList()
    this.runReplanFlow()
  },
  onUnload() {
    if (this.__cmTimer) { clearTimeout(this.__cmTimer); this.__cmTimer = 0 }
  },
  /**
   * 返回键先收完成弹窗（与首页同一个规矩：按返回只是"不说了"，不是离开页面）。
   * 这一层不做拦截 —— 收完就放行，日历页没有"硬控"那回事。
   */
  onBackPress() {
    return this.closeDoneDlg()
  },
  methods: {
    /** 完成弹窗开着就收掉并回报 true（收完就放行，日历页不做硬控） */
    closeDoneDlg() {
      if (this.doneDlgOn && this.$refs.doneDlg) { this.$refs.doneDlg.close(); return true }
      return false
    },

    /** 顶栏返回键：与物理返回键同一条规矩（先收弹窗，收掉那一下不离开页面） */
    onNavBack(veto) {
      if (this.closeDoneDlg() && typeof veto === 'function') veto()
    },
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
      // 日历标注：把「补习日 / 节日·无法学习日」按色铺到格子上（app 级，独立于目标）
      const marks = calmark.byMonth(this.year, this.month)
      // 响应式写入（模板里 pickedMarks 依赖它）：整个对象换掉，computed 一定会重算
      this.marksByDate = marks
      cells.forEach(c => { c.marks = marks[c.date] || [] })
      this.cells = cells
    },
    refreshList() {
      this.list = schedule.rowsOf(this.picked, this.__byDate)
    },
    // 组件里前移/后移改了任务日期 → 重算月历（格子里的任务数跟着变）与当日列表
    onListChanged() {
      this.build()
      this.refreshList()
      // ⚠️ 强刷：勾选圈绑的是 pwstore 裸对象的 status，App 端不保证重建数组就重渲染
      //    （真机："取消完要退出 app 重进才刷新"，2026-10-25 实锤）。
      this.$forceUpdate && this.$forceUpdate()
    },
    /**
     * AI 对话改动了记录（记功 / 偏差）→ 月历格子里的任务数与当日列表都要重算。
     * 不刷新的话，用户刚说"这项我做完了"，上面的列表还显示 0/2，看着像没生效。
     */
    onCoachChanged() {
      this.build()
      this.refreshList()
      this.$forceUpdate && this.$forceUpdate()
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
      // 刚滑动翻过月的那一下 tap 是手势的副产物（WebView 对几十 px 的位移
      // 仍会合成一次 click），不能让它顺手把选中日改掉。
      if (this.__swipedAt && Date.now() - this.__swipedAt < 320) { this.__swipedAt = 0; return }
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
    /* ---------- 左右滑动切月（2026-11-01 用户反馈：点小箭头一月一月翻太烦） ----------
       判定照 tab 切页那一套：先看主轴，横向明显大于纵向才认；纵向一律放过，
       让页面正常上下滚 —— 日历卡长在滚动页里，把上下滚吃掉会更难受。
       坐标只记在实例上（不进 data）：touchmove 触发频率可以到 120Hz，
       每写一次 data 都是一次跨层通信，而这里根本不需要跟手位移。 */
    cmTouchStart(e) {
      const t = e && e.touches && e.touches[0]
      if (!t) return
      this.__sx = t.clientX
      this.__sy = t.clientY
      this.__dx = 0
      this.__axis = 0          // 0 未判定 / 1 横向（翻月） / -1 纵向（放手）
      this.__tracking = true
    },
    cmTouchMove(e) {
      if (!this.__tracking) return
      const t = e && e.touches && e.touches[0]
      if (!t) return
      const dx = t.clientX - this.__sx
      const dy = t.clientY - this.__sy
      if (!this.__axis) {
        const ax = Math.abs(dx)
        const ay = Math.abs(dy)
        if (ax < tabSlide.DRAG.AXIS && ay < tabSlide.DRAG.AXIS) return
        if (ax < ay * tabSlide.DRAG.RATIO) { this.__axis = -1; this.__tracking = false; return }
        this.__axis = 1
      }
      // 只记最后一个位（不写 data）；判定用位移，不用速度 —— 慢速拖到位也该翻
      this.__dx = dx
    },
    cmTouchEnd() {
      if (!this.__tracking) return
      this.__tracking = false
      // 纵向手势 / 只是点了一下：什么都不做，交给原来的 tap
      if (this.__axis !== 1) return
      const dx = this.__dx || 0
      if (Math.abs(dx) < tabSlide.DRAG.TRIGGER) return
      // 手指往左 → 看下个月（新月份从右边进来）；往右 → 上个月
      const dir = dx < 0 ? 1 : -1
      this.__swipedAt = Date.now()
      this.shift(dir)
      this.playMonthIn(dir)
    },
    /** 翻月后的进场动画：新月份从"来向"滑入，方向感跟手感一致 */
    playMonthIn(dir) {
      this.cmEnter = dir > 0 ? 'right' : 'left'
      if (this.__cmTimer) clearTimeout(this.__cmTimer)
      // ⚠️ 动画放完必须摘掉 class：同名 class 停留在身上时，下次再翻月不会重播
      this.__cmTimer = setTimeout(() => { this.cmEnter = ''; this.__cmTimer = 0 }, 240)
    },
    /**
     * 按天切（‹ 今天 › 那两个箭头）。
     * 与 shift(n) 分清楚：shift 翻**月**，这里翻**天** —— 用户看着「今天」两边的箭头
     * 一定是想切日期，翻月份是另一件事（2026-11-01 真机反馈）。
     * 跨月时自动翻页，不用他再手动点一下月份。
     */
    shiftDay(n) {
      const d = holiday.addDays(this.picked || this.todayStr, n)
      this.picked = d
      const y = Number(d.slice(0, 4))
      const m = Number(d.slice(5, 7))
      if (y !== this.year || m !== this.month) {
        this.year = y
        this.month = m
        this.build()
      }
      this.refreshList()
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
    },
    // ---------- 日历标注（补习日 / 节日·无法学习日） ----------
    /** hex + 透明度 → rgba 字符串（Webview 兼容性最稳，不靠 #rrggbbaa） */
    rgbaOf(hex, a) {
      const h = String(hex || '').replace('#', '')
      if (h.length !== 6 && h.length !== 3) return 'rgba(188,208,247,' + a + ')'
      let r, g, b
      if (h.length === 3) { r = parseInt(h[0] + h[0], 16); g = parseInt(h[1] + h[1], 16); b = parseInt(h[2] + h[2], 16) }
      else { r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16) }
      return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'
    },
    /** 格子的标注底色（取第一条标注的色，淡色铺底） */
    markStyle(marks) {
      const c = (marks && marks[0] && marks[0].color) || '#bcd0f7'
      return { background: this.rgbaOf(c, 0.42) }
    },
    /** 格子顶部的标注色条 */
    markBar(marks) {
      return (marks && marks[0] && marks[0].color) || '#bcd0f7'
    },
    /** 点格子开标注弹层：新增模式（editingId 为空） */
    openMark(date) {
      const t = date || this.picked
      this.markDlg = { show: true, date: t, editingId: '', label: '', type: 'tutor', color: calmark.defaultColorForType('tutor', appSettings.get()) }
    },
    closeMark() {
      this.markDlg = { show: false, date: '', editingId: '', label: '', type: 'tutor', color: '#bcd0f7' }
    },
    noop() {},
    pickMarkType(key) {
      this.markDlg.type = key
      // 切类型时，颜色落到该类型的默认淡色（除非用户已经手动选了别的色）
      if (!this.markDlg.editingId) this.markDlg.color = calmark.defaultColorForType(key, appSettings.get())
    },
    pickMarkColor(c) { this.markDlg.color = c },
    /** 编辑某条已有标注：把它的内容填进表单 */
    editMark(m) {
      if (!m) return
      // 从"选中那天的 chip"点进来时弹层还没开过，markDlg.date 是空的 —— 回落到选中日
      this.markDlg = {
        show: true,
        date: this.markDlg.date || this.picked,
        editingId: m.id,
        label: m.label,
        type: m.type,
        color: m.color
      }
    },
    /** 保存新增 / 编辑。新增 = 这天的一条「一次性」标注（rule=dates）。 */
    saveMark() {
      const d = this.markDlg
      const label = String(d.label || '').trim()
      if (!label) {
        uni.showToast({ title: this.$t('请填写标注内容'), icon: 'none' })
        return
      }
      if (d.editingId) {
        calmark.update(d.editingId, { label: label, type: d.type, color: d.color })
      } else {
        calmark.add({ type: d.type, label: label, color: d.color, rule: 'dates', dates: [d.date] })
      }
      this.closeMark()
      this.build(); this.refreshList()
      this.$forceUpdate && this.$forceUpdate()
      uni.showToast({ title: this.$t('已保存标注'), icon: 'none' })
    },
    deleteMark(id) {
      if (!id) return
      calmark.remove(id)
      this.build(); this.refreshList()
      this.$forceUpdate && this.$forceUpdate()
      // 若正在编辑这条，关掉表单
      if (this.markDlg.editingId === id) this.markDlg.editingId = ''
    },
    /** 选中某天：既刷新当日列表，也刷新底部标注条 */
    pick(date) {
      if (this.__swipedAt && Date.now() - this.__swipedAt < 320) { this.__swipedAt = 0; return }
      this.picked = date
      this.refreshList()
    }
  }
}
</script>

<style>
.cal-page { min-height: 100vh; padding-bottom: 60rpx; }

.cm-nav { display: flex; align-items: center; }
.cm-month { display: flex; align-items: center; }
.cm-marrow { font-size: 26rpx; color: var(--ink-3, #98a19b); padding: 0 10rpx; }
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
.cm-day { font-size: 25rpx; color: var(--ink-1, #17201a); font-variant-numeric: tabular-nums; }
.cm-cell-out .cm-day { color: var(--ink-3, #98a19b); opacity: 0.5; }
.cm-cell-rest { /* 假期/周末不再单独上色（按用户要求去掉黄色）；补习/固定安排日以淡蓝标出 */ }
.cm-cell-today .cm-day { color: var(--brand, #e4173d); font-weight: 600; }
.cm-cell-on { background: rgba(var(--brand-rgb, 228, 23, 61), 0.16); }
/* 既有标注又被选中的那天：标注底色会盖住选中底色，补一圈描边，
   否则"下面这张卡说的是哪天"要靠日期文字去对，一眼看不出来 */
.cm-cell-on .cm-mark { box-shadow: inset 0 0 0 3rpx rgba(var(--brand-rgb, 228, 23, 61), 0.7); }
.cm-dots { display: flex; margin-top: 6rpx; }
.cm-dot {
  width: 8rpx; height: 8rpx; border-radius: 50%; margin: 0 3rpx;
  background: var(--brand, #e4173d);
}
.cm-hol {
  position: absolute; bottom: 6rpx;
  font-size: 17rpx; color: #98a19b;
}
/* 允许换行：英文的 "Swipe to change month" 比中文长得多，一行放不下时
   让提示整条落到第二行靠右，而不是把前面两项挤成两行字 */
.cm-legend { display: flex; align-items: center; flex-wrap: wrap; margin-top: 18rpx; }
.lg-item { display: flex; align-items: center; margin-right: 28rpx; font-size: 21rpx; color: var(--ink-3, #98a19b); }
/* 「左右滑动切月」：贴在行尾当提示，不抢主体的注意力 */
.lg-hint { margin-left: auto; font-size: 21rpx; color: var(--ink-3, #98a19b); }

/* ===== 翻月进场 =====
   位移只有 24rpx：这是"确实翻页了"的确认，不是主角。幅度做大了晃眼，
   而且日历一屏 6 行数字，越大的位移越容易让人以为数据在跳。
   方向与手势一致：往左滑（看下个月）→ 新月份从右边进来。 */
.cm-in-left { animation: cm-in-left 200ms cubic-bezier(0.22, 0.61, 0.36, 1); }
.cm-in-right { animation: cm-in-right 200ms cubic-bezier(0.22, 0.61, 0.36, 1); }
@keyframes cm-in-left {
  from { transform: translateX(-24rpx); opacity: 0.3; }
  to { transform: translateX(0); opacity: 1; }
}
@keyframes cm-in-right {
  from { transform: translateX(24rpx); opacity: 0.3; }
  to { transform: translateX(0); opacity: 1; }
}
/* 图例色块：补习（淡蓝）/ 节日·无法学习（淡红），颜色由设置页读出来 */
.lg-sw {
  width: 22rpx; height: 14rpx; border-radius: 4rpx; margin-right: 8rpx;
}

/* 日历标注：淡色铺底 + 顶部色条（补习日 / 节日·无法学习日） */
.cm-mark {
  position: absolute; left: 0; top: 0; right: 0; bottom: 0;
  border-radius: 12rpx; z-index: 0;
}
.cm-mark-bar {
  position: absolute; left: 0; top: 0; right: 0; height: 6rpx;
  border-radius: 12rpx 12rpx 0 0; z-index: 1;
}
.cm-cell-mark .cm-day,
.cm-cell-mark .cm-hol,
.cm-cell-mark .cm-dots { position: relative; z-index: 2; }

/* 选中那天底部的标注条（与日程表共用那一天） */
.card-more-row { display: flex; align-items: center; }
.mk-add {
  margin-left: 18rpx; font-size: 22rpx; color: var(--brand-strong, #bb1332);
  padding: 6rpx 18rpx; border-radius: 999rpx;
  background: rgba(var(--brand-rgb, 228, 23, 61), 0.1);
}
.mk-list { display: flex; flex-direction: column; margin-bottom: 14rpx; }
.mk-chip {
  display: flex; align-items: center; margin-top: 10rpx; padding: 12rpx 16rpx;
  border-radius: 12rpx;
}
.mk-dot { width: 18rpx; height: 18rpx; border-radius: 50%; margin-right: 12rpx; flex-shrink: 0; }
.mk-label { flex: 1; min-width: 0; font-size: 24rpx; color: var(--ink-1, #17201a); }
.mk-time { font-size: 21rpx; color: var(--ink-3, #98a19b); margin-left: 10rpx; }
.mk-edit { font-size: 22rpx; color: var(--brand-strong, #bb1332); margin-left: 12rpx; }
.mk-del { font-size: 30rpx; color: var(--ink-3, #98a19b); margin-left: 14rpx; padding: 0 6rpx; }

/* 标注编辑弹层（底部抽屉式） */
.mark-mask {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(23, 32, 26, 0.42);
  display: flex; align-items: flex-end; justify-content: center;
  z-index: 90;
}
.mark-card {
  width: 100%;
  padding: 26rpx 24rpx calc(24rpx + env(safe-area-inset-bottom));
  border-radius: 32rpx 32rpx 0 0;
  background: #fffdf8;
  background: var(--bg, #fffdf8);
}
.mark-head { display: flex; align-items: center; margin-bottom: 18rpx; }
.mark-title { font-size: 30rpx; font-weight: 600; color: var(--ink-1, #17201a); }
.mark-date { margin-left: 14rpx; font-size: 24rpx; color: var(--ink-3, #98a19b); }
.mark-x {
  margin-left: auto; font-size: 40rpx; color: var(--ink-3, #98a19b);
  padding: 0 8rpx; line-height: 1;
}
.mark-have { margin-bottom: 8rpx; }
.mark-have-row { display: flex; align-items: center; padding: 12rpx 0; border-top: 2rpx solid rgba(23, 32, 26, 0.06); }
.mark-have-name { flex: 1; min-width: 0; font-size: 26rpx; color: var(--ink-1, #17201a); }
.mark-have-edit { font-size: 24rpx; color: var(--brand-strong, #bb1332); margin-left: 12rpx; }
.mark-have-del { font-size: 24rpx; color: var(--ink-3, #98a19b); margin-left: 16rpx; }
.mark-fl { display: block; font-size: 24rpx; color: var(--ink-2, #5a6560); margin: 18rpx 0 12rpx; }
.mark-label-row { display: flex; align-items: center; margin-bottom: 4rpx; }
.mark-input {
  flex: 1; min-width: 0; height: 72rpx; box-sizing: border-box;
  padding: 0 22rpx; font-size: 26rpx; color: var(--ink-1, #17201a);
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  border-radius: 16rpx;
}
.mark-types { display: flex; flex-wrap: wrap; }
.mark-type {
  font-size: 24rpx; padding: 12rpx 24rpx; border-radius: 999rpx; margin-right: 12rpx; margin-bottom: 12rpx;
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: var(--ink-2, #5a6560);
}
.mark-type.on { background: rgba(var(--brand-rgb, 228, 23, 61), 0.14); color: var(--brand-strong, #bb1332); font-weight: 600; }
.mark-colors { display: flex; flex-wrap: wrap; }
.mark-color {
  width: 60rpx; height: 60rpx; border-radius: 14rpx; margin-right: 14rpx; margin-bottom: 14rpx;
  border: 4rpx solid transparent;
}
.mark-color.on { border-color: var(--ink-1, #17201a); transform: scale(1.06); }
.mark-btns { display: flex; gap: 18rpx; margin-top: 20rpx; }
.mark-btn {
  flex: 1; height: 88rpx; border-radius: 18rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx; font-weight: 600;
}
.mark-btn.ghost {
  background: rgba(23, 32, 26, 0.05);
  background: rgba(var(--neutral-rgb, 23, 32, 26), 0.05);
  color: var(--ink-2, #5a6560);
}
.mark-btn.primary { background: var(--brand, #e4173d); color: #fff; }

/* 日程表的 .ct-* 样式已搬到 components/schedule-list —— 页面里不再留一份，
   否则改样式时很容易只改一边（首页和日历页看着就不一样了） */
</style>
